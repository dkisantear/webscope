/*
 * Hornet Oscilloscope - ESP32 SPI + parallel-bus test
 *
 * This sketch:
 *   1. Configures a 32-sample capture over SPI.
 *   2. Arms the FPGA.
 *   3. Waits for capture completion.
 *   4. Asserts DATA_READY.
 *   5. Captures samples on rising DATA_CLK edges.
 *
 * Important:
 * The current FPGA transmitter uses the 50 MHz system clock as DATA_CLK.
 * GPIO interrupts are not fast enough to capture a continuous 50 MHz bus.
 * This test is intended for a temporarily divided/slowed FPGA bus clock.
 * The final high-speed version should use ESP32 DMA/I2S or another hardware
 * peripheral instead of attachInterrupt().
 */

#include <Arduino.h>
#include <SPI.h>
#include "driver/gpio.h"

// ---- WebScope live UI (added; everything else in this file is Nick's original code) ----
// Web code lives in web_ui.ino. Libraries: "WebSockets" by Markus Sattler (Library Manager);
// WiFi, WebServer and LittleFS come with the ESP32 core.
#include <WiFi.h>   
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <LittleFS.h>

// ---------------- SPI pins ----------------
static constexpr int PIN_SPI_SCLK = 18;
static constexpr int PIN_SPI_MISO = 19;
static constexpr int PIN_SPI_MOSI = 23;
static constexpr int PIN_SPI_CS   = 5;

static constexpr uint32_t SPI_CLOCK_HZ = 1000000;

// ---------------- Parallel-bus pins ----------------
// These must match the FPGA data-bit order used in the wiring.
static constexpr int DATA_PINS[12] = {
    16, 17, 21, 22, 25, 26,
    27, 32, 33, 34, 35, 36
};

static constexpr int PIN_DATA_CLK   = 4;
static constexpr int PIN_DATA_VALID = 13;
static constexpr int PIN_DATA_READY = 14;

static constexpr int CAPTURE_SAMPLES = 2048;  // changed for WebScope: was 32 (bus test). FPGA buffer is 2048 (ADDR_WIDTH = 11).

// ---------------- FPGA register map ----------------
static constexpr uint8_t REG_STATUS         = 0x00;
static constexpr uint8_t REG_CONTROL        = 0x01;
static constexpr uint8_t REG_TRIGGER_LEVEL  = 0x02;
static constexpr uint8_t REG_TRIGGER_CONFIG = 0x03;
static constexpr uint8_t REG_PRETRIGGER     = 0x04;
static constexpr uint8_t REG_POSTTRIGGER    = 0x05;
static constexpr uint8_t REG_CAPTURE_LENGTH = 0x07;
static constexpr uint8_t REG_ADC_WIDTH      = 0x08;

SPISettings fpgaSpiSettings(SPI_CLOCK_HZ, MSBFIRST, SPI_MODE0);

uint32_t spiReadRegister(uint8_t address)
{
    uint8_t rx[6] = {};

    SPI.beginTransaction(fpgaSpiSettings);
    digitalWrite(PIN_SPI_CS, LOW);

    rx[0] = SPI.transfer(0x80 | (address & 0x7F));
    rx[1] = SPI.transfer(0x00);
    rx[2] = SPI.transfer(0x00);
    rx[3] = SPI.transfer(0x00);
    rx[4] = SPI.transfer(0x00);
    rx[5] = SPI.transfer(0x00);

    digitalWrite(PIN_SPI_CS, HIGH);
    SPI.endTransaction();

    return (static_cast<uint32_t>(rx[2]) << 24) |
           (static_cast<uint32_t>(rx[3]) << 16) |
           (static_cast<uint32_t>(rx[4]) << 8)  |
           static_cast<uint32_t>(rx[5]);
}

void spiWriteRegister(uint8_t address, uint32_t value)
{
    SPI.beginTransaction(fpgaSpiSettings);
    digitalWrite(PIN_SPI_CS, LOW);

    SPI.transfer(address & 0x7F);
    SPI.transfer(0x00);
    SPI.transfer((value >> 24) & 0xFF);
    SPI.transfer((value >> 16) & 0xFF);
    SPI.transfer((value >> 8) & 0xFF);
    SPI.transfer(value & 0xFF);

    digitalWrite(PIN_SPI_CS, HIGH);
    SPI.endTransaction();
}

void printStatus(uint32_t status)
{
    Serial.printf("STATUS = 0x%08lX  busy=%u triggered=%u done=%u\n",
                  static_cast<unsigned long>(status),
                  (status >> 0) & 1,
                  (status >> 1) & 1,
                  (status >> 2) & 1);
}

uint16_t IRAM_ATTR readParallelSample()
{
    uint16_t value = 0;

    for (int bit = 0; bit < 12; ++bit) {
        if (gpio_get_level(static_cast<gpio_num_t>(DATA_PINS[bit]))) {
            value |= static_cast<uint16_t>(1u << bit);
        }
    }

    return value;
}

volatile uint16_t receivedSamples[CAPTURE_SAMPLES];
volatile int receivedCount = 0;
volatile bool receiveOverflow = false;

void IRAM_ATTR onDataClockRisingEdge()
{
    if (!gpio_get_level(static_cast<gpio_num_t>(PIN_DATA_VALID))) {
        return;
    }

    uint16_t value = readParallelSample();

    if (receivedCount < CAPTURE_SAMPLES) {
        receivedSamples[receivedCount++] = value;
    } else {
        receiveOverflow = true;
    }
}

void setupParallelBus()
{
    for (int bit = 0; bit < 12; ++bit) {
        pinMode(DATA_PINS[bit], INPUT);
    }

    pinMode(PIN_DATA_CLK, INPUT);
    pinMode(PIN_DATA_VALID, INPUT);

    pinMode(PIN_DATA_READY, OUTPUT);
    digitalWrite(PIN_DATA_READY, LOW);
}

bool waitForCaptureDone(uint32_t timeoutMs)
{
    uint32_t startTime = millis();

    while (millis() - startTime < timeoutMs) {
        uint32_t status = spiReadRegister(REG_STATUS);
        printStatus(status);

        if (status & (1u << 2)) {
            return true;
        }

        delay(50);
    }

    return false;
}

void runParallelTest()
{
    Serial.println();
    Serial.println("--- FPGA parallel-bus test ---");

    uint32_t adcWidth = spiReadRegister(REG_ADC_WIDTH);
    Serial.printf("ADC width = 0x%08lX\n",
                  static_cast<unsigned long>(adcWidth));

    // Configure a simple immediate-trigger capture.
    spiWriteRegister(REG_TRIGGER_LEVEL, 2048);
    spiWriteRegister(REG_TRIGGER_CONFIG, 0x00000000); // trigger disabled
    spiWriteRegister(REG_PRETRIGGER, 0);
    spiWriteRegister(REG_POSTTRIGGER, CAPTURE_SAMPLES);

    Serial.println("Arming FPGA capture...");
    spiWriteRegister(REG_CONTROL, 0x00000001);

    if (!waitForCaptureDone(2000)) {
        Serial.println("ERROR: capture did not complete.");
        return;
    }

    uint32_t captureLength = spiReadRegister(REG_CAPTURE_LENGTH);
    Serial.printf("FPGA capture length = %lu samples\n",
                  static_cast<unsigned long>(captureLength));

    receivedCount = 0;
    receiveOverflow = false;

    attachInterrupt(
        digitalPinToInterrupt(PIN_DATA_CLK),
        onDataClockRisingEdge,
        RISING
    );

    Serial.println("Asserting DATA_READY...");
    digitalWrite(PIN_DATA_READY, HIGH);

    uint32_t startTime = millis();
    while (receivedCount < CAPTURE_SAMPLES && millis() - startTime < 1000) {
        delay(1);
    }

    digitalWrite(PIN_DATA_READY, LOW);
    detachInterrupt(digitalPinToInterrupt(PIN_DATA_CLK));

    Serial.printf("Received %d/%d samples\n",
                  receivedCount, CAPTURE_SAMPLES);

    for (int i = 0; i < receivedCount; ++i) {
        Serial.printf("sample[%02d] = %4u (0x%03X)\n",
                      i,
                      receivedSamples[i],
                      receivedSamples[i]);
    }

    if (receiveOverflow) {
        Serial.println("WARNING: received more samples than expected.");
    }

    if (receivedCount == CAPTURE_SAMPLES) {
        Serial.println("Parallel-bus test PASS");
    } else {
        Serial.println("Parallel-bus test FAIL");
    }
}

void captureOneSampleForPlotter()
{
    // Configure a one-sample immediate capture.
    spiWriteRegister(REG_TRIGGER_CONFIG, 0x00000000);
    spiWriteRegister(REG_PRETRIGGER, 0);
    spiWriteRegister(REG_POSTTRIGGER, 1);

    // ARM command.
    spiWriteRegister(REG_CONTROL, 0x00000001);
    delay(10);

    // Wait for FPGA capture completion.
    uint32_t start = millis();
    while (!(spiReadRegister(REG_STATUS) & (1u << 2))) {
        if (millis() - start > 500) {
            return;
        }
        delay(1);
    }

    receivedCount = 0;
    receiveOverflow = false;

    attachInterrupt(
        digitalPinToInterrupt(PIN_DATA_CLK),
        onDataClockRisingEdge,
        RISING
    );

    digitalWrite(PIN_DATA_READY, HIGH);

    start = millis();
    while (receivedCount < 1 && millis() - start < 100) {
        delay(1);
    }

    digitalWrite(PIN_DATA_READY, LOW);
    detachInterrupt(digitalPinToInterrupt(PIN_DATA_CLK));

    if (receivedCount > 0) {
        // Arduino Serial Plotter requires one numeric value per line.
        Serial.println(receivedSamples[0]);
    }
}

void setup()
{
    Serial.begin(115200);

    pinMode(PIN_SPI_CS, OUTPUT);
    digitalWrite(PIN_SPI_CS, HIGH);

    SPI.begin(
        PIN_SPI_SCLK,
        PIN_SPI_MISO,
        PIN_SPI_MOSI,
        PIN_SPI_CS
    );

    setupParallelBus();

    webSetup();  // added: Wi-Fi + web page + WebSocket
}

void loop()
{
    // added: serve the web page and WebSocket; while a browser is connected,
    // stream sample blocks to it instead of printing to the Serial Plotter.
    webLoop();
    if (webClientsConnected()) {
        webStreamStep();
        return;
    }

    captureOneSampleForPlotter();
    delay(20);
}