/*
 * WebScope live UI: Wi-Fi, web page hosting, WebSocket streaming, and capture settings from the browser.
 *
 * Added on top of Nick's parallel-bus code (webscope_esp32.ino): it only calls his existing
 * functions (spiWriteRegister/spiReadRegister, the DATA_CLK ISR, receivedSamples[]) and pins.
 *
 *   Browser  -- {"type":"configure",...} / capture_start / capture_abort -->  ESP32  -- SPI registers -->  FPGA
 *   Browser  <-- binary 2048-sample blocks (port 81) --                       ESP32  <-- parallel bus --   FPGA
 *
 * Messages and capture flow: docs/PROTOCOL.md.
 *
 * The web server + WebSocket run in their own FreeRTOS task on core 0, so page loads are never
 * blocked by FPGA captures in loop() (core 1). All SPI traffic stays in loop() (core 1).
 */

// ---------------- Wi-Fi ----------------
// Leave WIFI_SSID empty to have the ESP32 make its own network ("WebScope", open, 192.168.4.1).
// Fill it in to join an existing network instead (IP is printed on Serial at boot).
// Don't commit real passwords to GitHub.
static const char* WIFI_SSID     = "";
static const char* WIFI_PASSWORD = "";
static const char* AP_SSID       = "WebScope";
static constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 10000;

// ---------------- Capture settings (docs/PROTOCOL.md) ----------------
static constexpr uint8_t  REG_SAMPLE_RATE = 0x06;     // not in Nick's register list; same SPI map
static constexpr uint32_t CTRL_ARM   = 1u << 0;
static constexpr uint32_t CTRL_ABORT = 1u << 1;
static constexpr uint32_t STATUS_TRIGGERED = 1u << 1;
static constexpr uint32_t STATUS_DONE      = 1u << 2;
static constexpr uint32_t SUPPORTED_RATES[] = {1000000, 500000, 250000, 100000, 50000, 20000, 10000};
static constexpr uint32_t DEFAULT_RATE_HZ   = 100000;
static constexpr uint8_t  DEFAULT_ADC_BITS  = 12;
static constexpr uint32_t STATUS_INTERVAL_MS = 1000;
static constexpr uint32_t READ_TIMEOUT_MS    = 3000;   // parallel-bus readout of one capture
static constexpr uint32_t ARM_ACCEPT_MS      = 20;     // max wait for the FPGA to clear the old "done" after ARM

// ---------------- Block header (little-endian, 16 bytes) ----------------
static constexpr uint8_t BLOCK_MAGIC   = 0x57;  // 'W'
static constexpr uint8_t BLOCK_VERSION = 1;
static constexpr uint8_t BLOCK_TYPE_SAMPLES = 1;
static constexpr size_t  BLOCK_HEADER_BYTES = 16;
static constexpr uint8_t FLAG_OVERFLOW = 1;
static constexpr uint8_t FLAG_HW_TRIGGERED = 2;

WebServer webServer(80);
WebSocketsServer webSocket(81);

static constexpr size_t BLOCK_MAX_BYTES = BLOCK_HEADER_BYTES + CAPTURE_SAMPLES * 2;

struct CaptureConfig {
    uint32_t rate;
    bool     triggerEnabled;
    bool     triggerRising;
    uint32_t triggerLevel;   // ADC code
    uint32_t preTrigger;
    uint32_t postTrigger;
    bool     autoMode;       // free-run if no trigger arrives
};

// Shared between loop() (capture, core 1) and the web task (core 0).
static portMUX_TYPE      webMux          = portMUX_INITIALIZER_UNLOCKED;
static CaptureConfig     webConfig       = {DEFAULT_RATE_HZ, false, true, 2048, 0, CAPTURE_SAMPLES, true};
static volatile bool     webRunning      = true;    // capture_start / capture_abort
static volatile bool     webAbortPending = false;   // loop() writes CONTROL = abort
static volatile int      webClientCount  = 0;
static volatile bool     webFpgaOk       = false;
static volatile bool     webStatusDirty  = false;
static volatile uint32_t webBlocksOk     = 0;
static volatile uint32_t webBlocksBad    = 0;
static const char* volatile webFpgaState = "idle";
static uint8_t           webOutBuf[BLOCK_MAX_BYTES];  // block waiting to be sent
static volatile size_t   webOutLen       = 0;          // 0 = slot free

static CaptureConfig     webUsed;               // settings of the capture in progress (loop() only)
static uint8_t  webAdcBits  = DEFAULT_ADC_BITS;
static uint32_t webSequence = 0;
static uint8_t  webBlock[BLOCK_MAX_BYTES];             // built in loop()

void webSetState(const char* s)
{
    if (webFpgaState != s) { webFpgaState = s; webStatusDirty = true; }
}

// ---------------- Web page (served from LittleFS) ----------------
String webContentType(const String& path)
{
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".css"))  return "text/css";
    if (path.endsWith(".js"))   return "application/javascript";  // needed for JS modules
    if (path.endsWith(".svg"))  return "image/svg+xml";
    if (path.endsWith(".png"))  return "image/png";
    if (path.endsWith(".jpg"))  return "image/jpeg";
    return "text/plain";
}

void webHandleFile()
{
    String path = webServer.uri();
    if (path.endsWith("/")) path += "index.html";

    if (!LittleFS.exists(path)) {
        webServer.send(404, "text/plain",
                       "WebScope: " + path + " not found. Upload the UI to LittleFS (see firmware/README.md).");
        return;
    }
    File file = LittleFS.open(path, "r");
    webServer.streamFile(file, webContentType(path));
    file.close();
}

// ---------------- Status messages (JSON text) ----------------
void webSendStatus()
{
    uint32_t rate;
    portENTER_CRITICAL(&webMux);
    rate = webConfig.rate;
    portEXIT_CRITICAL(&webMux);

    char json[200];
    snprintf(json, sizeof(json),
             "{\"evt\":\"status\",\"fpga\":%s,\"running\":%s,\"state\":\"%s\",\"blocks\":%lu,\"fails\":%lu,\"samples\":%d,\"rate\":%lu}",
             webFpgaOk ? "true" : "false",
             webRunning ? "true" : "false",
             webFpgaState,
             static_cast<unsigned long>(webBlocksOk),
             static_cast<unsigned long>(webBlocksBad),
             CAPTURE_SAMPLES,
             static_cast<unsigned long>(rate));
    webSocket.broadcastTXT(json);
}

// ---------------- Browser commands (tiny JSON reader; no extra library) ----------------
// Finds "key": and returns the number after it, or fallback.
long webJsonNumber(const String& msg, const char* key, long fallback)
{
    int i = msg.indexOf(String("\"") + key + "\"");
    if (i < 0) return fallback;
    i = msg.indexOf(':', i);
    if (i < 0) return fallback;
    return msg.substring(i + 1).toInt();
}

// Finds "key": and returns true/false after it, or fallback.
bool webJsonBool(const String& msg, const char* key, bool fallback)
{
    int i = msg.indexOf(String("\"") + key + "\"");
    if (i < 0) return fallback;
    i = msg.indexOf(':', i);
    if (i < 0) return fallback;
    String rest = msg.substring(i + 1);
    rest.trim();
    if (rest.startsWith("true"))  return true;
    if (rest.startsWith("false")) return false;
    return fallback;
}

bool webRateSupported(uint32_t rate)
{
    for (uint32_t r : SUPPORTED_RATES) if (r == rate) return true;
    return false;
}

void webHandleCommand(const String& msg)
{
    if (msg.indexOf("\"configure\"") >= 0) {
        CaptureConfig c;
        portENTER_CRITICAL(&webMux);
        c = webConfig;
        portEXIT_CRITICAL(&webMux);

        uint32_t rate = static_cast<uint32_t>(webJsonNumber(msg, "sampleRate", c.rate));
        if (webRateSupported(rate)) c.rate = rate;          // unsupported rates are ignored
        c.triggerEnabled = webJsonBool(msg, "triggerEnabled", c.triggerEnabled);
        c.triggerRising  = webJsonBool(msg, "triggerRising", c.triggerRising);
        c.autoMode       = webJsonBool(msg, "auto", c.autoMode);
        long level = webJsonNumber(msg, "triggerLevel", c.triggerLevel);
        c.triggerLevel = static_cast<uint32_t>(constrain(level, 0L, 4095L));
        long pre  = webJsonNumber(msg, "preTrigger", c.preTrigger);
        long post = webJsonNumber(msg, "postTrigger", c.postTrigger);
        if (pre >= 0 && post >= 1 && pre + post == CAPTURE_SAMPLES) {  // buffer is fixed at CAPTURE_SAMPLES
            c.preTrigger = static_cast<uint32_t>(pre);
            c.postTrigger = static_cast<uint32_t>(post);
        }

        portENTER_CRITICAL(&webMux);
        webConfig = c;
        portEXIT_CRITICAL(&webMux);
    } else if (msg.indexOf("\"capture_start\"") >= 0 || msg.indexOf("\"run\"") >= 0) {
        webRunning = true;
    } else if (msg.indexOf("\"capture_abort\"") >= 0 || msg.indexOf("\"stop\"") >= 0) {
        webRunning = false;
        webAbortPending = true;
    }
    webStatusDirty = true;
}

// Web task: serves the page, runs the WebSocket, sends blocks and status. Never blocked by captures.
void webTask(void* /*unused*/)
{
    static uint8_t sendBuf[BLOCK_MAX_BYTES];
    uint32_t lastStatusMs = 0;

    for (;;) {
        webServer.handleClient();
        webSocket.loop();

        size_t len = 0;
        portENTER_CRITICAL(&webMux);
        if (webOutLen > 0) {
            len = webOutLen;
            memcpy(sendBuf, webOutBuf, len);
            webOutLen = 0;
        }
        portEXIT_CRITICAL(&webMux);
        if (len > 0 && webClientCount > 0) webSocket.broadcastBIN(sendBuf, len);

        if (webClientCount > 0 && (webStatusDirty || millis() - lastStatusMs > STATUS_INTERVAL_MS)) {
            webStatusDirty = false;
            lastStatusMs = millis();
            webSendStatus();
        }
        vTaskDelay(1);  // let Wi-Fi and the idle task run
    }
}

void webSetup()
{
    // ADC width from the FPGA register map (fallback 12 bits).
    uint32_t width = spiReadRegister(REG_ADC_WIDTH);
    if (width >= 1 && width <= 16) webAdcBits = static_cast<uint8_t>(width);

    if (!LittleFS.begin(true)) {
        Serial.println("WebScope: LittleFS mount failed (UI files not available).");
    }

    bool joined = false;
    if (strlen(WIFI_SSID) > 0) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
            delay(200);
        }
        joined = WiFi.status() == WL_CONNECTED;
    }
    if (!joined) {
        WiFi.mode(WIFI_AP);
        WiFi.softAP(AP_SSID);
    }
    WiFi.setSleep(false);  // lower latency for streaming

    webServer.onNotFound(webHandleFile);  // every path is a file in LittleFS
    webServer.begin();

    webSocket.begin();
    webSocket.onEvent([](uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
        if (type == WStype_CONNECTED) {
            webClientCount = webClientCount + 1;
            webStatusDirty = true;
        } else if (type == WStype_DISCONNECTED) {
            if (webClientCount > 0) webClientCount = webClientCount - 1;
        } else if (type == WStype_TEXT) {
            webHandleCommand(String(reinterpret_cast<const char*>(payload), length));
        }
    });

    // Web server + WebSocket get their own task on core 0 (loop() runs on core 1).
    xTaskCreatePinnedToCore(webTask, "webscope_web", 8192, nullptr, 1, nullptr, 0);

    IPAddress ip = joined ? WiFi.localIP() : WiFi.softAPIP();
    Serial.printf("WebScope: open http://%s  (%s)\n", ip.toString().c_str(),
                  joined ? WIFI_SSID : "join Wi-Fi network \"WebScope\"");
}

// Called from loop(). The web work happens in webTask, so nothing to do here.
void webLoop()
{
}

bool webClientsConnected()
{
    return webClientCount > 0;
}

// Write webUsed to the FPGA and ARM it. Returns when STATUS.done is set (true) or on timeout / abort (false).
// (No struct parameters: Arduino puts its generated function prototypes above the struct definition.)
bool webArmAndWait(bool triggerEnabled, uint32_t timeoutMs, uint32_t* statusOut)
{
    const CaptureConfig& c = webUsed;
    spiWriteRegister(REG_SAMPLE_RATE, c.rate);
    spiWriteRegister(REG_TRIGGER_LEVEL, c.triggerLevel);
    spiWriteRegister(REG_TRIGGER_CONFIG, (triggerEnabled ? 1u : 0u) | (c.triggerRising ? 2u : 0u));
    spiWriteRegister(REG_PRETRIGGER, triggerEnabled ? c.preTrigger : 0);
    spiWriteRegister(REG_POSTTRIGGER, triggerEnabled ? c.postTrigger : CAPTURE_SAMPLES);
    spiWriteRegister(REG_CONTROL, CTRL_ARM);
    webSetState("armed");

    // STATUS.done still shows the PREVIOUS capture until the FPGA has taken the ARM command
    // (it crosses clock domains). Wait for done to drop first, like the delay(10) in Nick's code;
    // otherwise we read the old capture (e.g. the Serial Plotter's 1-sample capture).
    uint32_t start = millis();
    while ((spiReadRegister(REG_STATUS) & STATUS_DONE) && millis() - start < ARM_ACCEPT_MS) {
        delay(1);
    }

    start = millis();
    for (;;) {
        uint32_t status = spiReadRegister(REG_STATUS);
        if (status & STATUS_DONE) { *statusOut = status; return true; }
        if (webAbortPending || millis() - start > timeoutMs) {
            spiWriteRegister(REG_CONTROL, CTRL_ABORT);
            return false;
        }
        delay(1);
    }
}

// Bring-up help: one Serial line per second describing the last capture (open Serial Monitor at 115200).
// Shows what we asked for and what the FPGA's registers read back.
void webDebugCapture(const char* outcome, uint32_t status, uint32_t length, int received, uint32_t ms)
{
    static uint32_t lastMs = 0;
    if (millis() - lastMs < 1000) return;
    lastMs = millis();
    Serial.printf("[cap] %s after %lu ms | asked rate=%lu trig=%d rise=%d lvl=%lu pre=%lu post=%lu"
                  " | FPGA reg rate=%lu cfg=%lu lvl=%lu pre=%lu post=%lu status=0x%lX len=%lu | got %d samples\n",
                  outcome, static_cast<unsigned long>(ms),
                  static_cast<unsigned long>(webUsed.rate), webUsed.triggerEnabled, webUsed.triggerRising,
                  static_cast<unsigned long>(webUsed.triggerLevel),
                  static_cast<unsigned long>(webUsed.preTrigger), static_cast<unsigned long>(webUsed.postTrigger),
                  static_cast<unsigned long>(spiReadRegister(REG_SAMPLE_RATE)),
                  static_cast<unsigned long>(spiReadRegister(REG_TRIGGER_CONFIG)),
                  static_cast<unsigned long>(spiReadRegister(REG_TRIGGER_LEVEL)),
                  static_cast<unsigned long>(spiReadRegister(REG_PRETRIGGER)),
                  static_cast<unsigned long>(spiReadRegister(REG_POSTTRIGGER)),
                  static_cast<unsigned long>(status), static_cast<unsigned long>(length), received);
}

// One full capture: configure → arm → wait for done → read the samples on the parallel bus.
// Uses Nick's spiWriteRegister/spiReadRegister, ISR and receivedSamples[] unchanged.
// Returns the sample count, 0 on failure, -1 when Normal mode is still waiting for a trigger.
int webCaptureBlock(bool* hwTriggered)
{
    portENTER_CRITICAL(&webMux);
    webUsed = webConfig;
    portEXIT_CRITICAL(&webMux);
    const CaptureConfig& used = webUsed;

    // Capture time + room to wait for a trigger edge.
    uint32_t captureMs = static_cast<uint32_t>((1000ULL * CAPTURE_SAMPLES) / used.rate);
    uint32_t timeoutMs = 2 * captureMs + 300;

    uint32_t status = 0;
    uint32_t t0 = millis();
    bool done = webArmAndWait(used.triggerEnabled, timeoutMs, &status);
    if (!done && webAbortPending) return 0;
    if (!done && used.triggerEnabled) {
        if (!used.autoMode) { webSetState("waiting"); return -1; }  // Normal: keep waiting for an edge
        done = webArmAndWait(false, timeoutMs, &status);             // Auto: no edge, so free-run once
    }
    if (!done) {
        webSetState("timeout");
        webDebugCapture("TIMEOUT (done never set)", spiReadRegister(REG_STATUS), spiReadRegister(REG_CAPTURE_LENGTH), 0, millis() - t0);
        return 0;
    }
    *hwTriggered = used.triggerEnabled && (status & STATUS_TRIGGERED);

    // The FPGA reports how many samples it captured. 0 or more than the buffer means the settings were
    // not taken (e.g. pre/post too big for its 9-bit counters): report it instead of waiting for nothing.
    uint32_t length = spiReadRegister(REG_CAPTURE_LENGTH);
    if (length < 1 || length > CAPTURE_SAMPLES) {
        webSetState("error");
        webDebugCapture("BAD CAPTURE_LENGTH", status, length, 0, millis() - t0);
        return 0;
    }
    int expected = static_cast<int>(length);

    webSetState("reading");
    receivedCount = 0;
    receiveOverflow = false;
    attachInterrupt(digitalPinToInterrupt(PIN_DATA_CLK), onDataClockRisingEdge, RISING);
    digitalWrite(PIN_DATA_READY, HIGH);

    uint32_t start = millis();
    while (receivedCount < expected && millis() - start < READ_TIMEOUT_MS) {
        delay(1);
    }

    digitalWrite(PIN_DATA_READY, LOW);
    detachInterrupt(digitalPinToInterrupt(PIN_DATA_CLK));
    webSetState(receivedCount == expected ? "done" : "error");
    webDebugCapture(receivedCount == expected ? "OK" : "SHORT READ", status, length, receivedCount, millis() - t0);
    return receivedCount;
}

void webStreamStep()
{
    if (webAbortPending) {
        webAbortPending = false;
        spiWriteRegister(REG_CONTROL, CTRL_ABORT);
        webSetState("idle");
    }
    if (!webRunning) {
        delay(5);
        return;
    }

    bool hwTriggered = false;
    int count = webCaptureBlock(&hwTriggered);

    if (count < 0) return;  // Normal mode, no trigger yet: not a failure
    if (count == 0) {
        webBlocksBad = webBlocksBad + 1;
        if (webFpgaOk) { webFpgaOk = false; webStatusDirty = true; }
        delay(50);
        return;
    }
    if (!webFpgaOk) { webFpgaOk = true; webStatusDirty = true; }
    webBlocksOk = webBlocksOk + 1;

    // Header
    uint8_t* h = webBlock;
    h[0] = BLOCK_MAGIC;
    h[1] = BLOCK_VERSION;
    h[2] = BLOCK_TYPE_SAMPLES;
    h[3] = webAdcBits;
    memcpy(h + 4, &webSequence, 4);                      // ESP32 is little-endian
    uint32_t rate = webUsed.rate;                        // the rate this capture was taken at
    memcpy(h + 8, &rate, 4);
    uint16_t n = static_cast<uint16_t>(count);
    memcpy(h + 12, &n, 2);
    h[14] = (receiveOverflow ? FLAG_OVERFLOW : 0) | (hwTriggered ? FLAG_HW_TRIGGERED : 0);
    h[15] = 0;
    webSequence++;

    // Samples (raw ADC codes, uint16 each)
    for (int i = 0; i < count; ++i) {
        uint16_t code = receivedSamples[i];
        memcpy(webBlock + BLOCK_HEADER_BYTES + i * 2, &code, 2);
    }

    // Hand the block to the web task. If it hasn't sent the previous one yet, drop this one.
    size_t len = BLOCK_HEADER_BYTES + count * 2;
    portENTER_CRITICAL(&webMux);
    if (webOutLen == 0) {
        memcpy(webOutBuf, webBlock, len);
        webOutLen = len;
    }
    portEXIT_CRITICAL(&webMux);
}
