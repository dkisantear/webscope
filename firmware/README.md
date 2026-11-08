# ESP32 firmware (Arduino IDE)

`webscope_esp32/` is Nick's parallel-bus test sketch plus a second tab, `web_ui.ino`, that adds:
- Wi-Fi (own network "WebScope", or join an existing one)
- the web page, served from the ESP32's flash (LittleFS)
- live sample blocks to the browser over a WebSocket (port 81)

Nick's functions, pins, registers and ISR are unchanged. The only edits to his file are marked `added` / `changed`:
the web `#include`s, `webSetup()` at the end of `setup()`, three lines at the top of `loop()`, and
`CAPTURE_SAMPLES` = 2048 (was 32 for the bus test; Nick's FPGA buffer is 2048, `ADDR_WIDTH = 11`).

## Behavior
- **No browser connected:** exactly the original behavior: one sample per loop to the Serial Plotter.
- **Browser connected (Live mode):** before every capture it writes the browser's settings to the FPGA
  (sample rate, trigger on/off, edge, level, pre/post-trigger), arms, waits for done, reads 2048 samples
  and streams them. Run/Stop in the UI starts/aborts captures. Details: `docs/PROTOCOL.md`.

## One-time setup
1. Arduino IDE → Boards Manager: **esp32 by Espressif**. Board: *ESP32 Dev Module*.
2. Library Manager: install **WebSockets** by Markus Sattler.
3. Install the LittleFS upload plugin for Arduino IDE 2.x: **arduino-littlefs-upload** (github.com/earlephilhower/arduino-littlefs-upload). Restart the IDE.

## Upload
1. From the repo root: `python tools/sync_ui.py` (copies `ui/` → `webscope_esp32/data/`).
2. Open `webscope_esp32/webscope_esp32.ino` and upload the sketch.
3. Close Serial Monitor/Plotter, then `Ctrl/Cmd + Shift + P` → **Upload LittleFS to Pico/ESP8266/ESP32**.
4. Open Serial Monitor (115200): it prints the address to open.
5. Join Wi-Fi **WebScope**, open **http://192.168.4.1**, switch to **Live**.

No time for step 3, or still changing the UI? Serve it from the laptop instead: `python tools/serve_ui.py`, join the WebScope Wi-Fi, open `http://localhost:8000/?esp=192.168.4.1`. No reflashing needed for UI changes.

## Settings to check (top of web_ui.ino)
- Sample rate now comes from the browser (1 MHz … 10 kHz, `SUPPORTED_RATES`) and is written to FPGA register 0x06.
- `WIFI_SSID` / `WIFI_PASSWORD`: leave empty for the ESP32's own network. Don't commit passwords.
- `CAPTURE_SAMPLES` (Nick's file) = 2048. Reading them uses one GPIO interrupt per sample, so the FPGA bus clock must stay slow enough; `READ_TIMEOUT_MS` (3 s) is the limit for one readout.

## Known limits (from Nick's notes)
- Capture uses a GPIO interrupt per sample, so the FPGA bus clock must be slowed. Full speed needs I2S/DMA capture later.
- Hardware trigger is used (TRIGGER_CONFIG bit0 enable, bit1 rising). In Auto mode, if no edge arrives in time the ESP32 aborts and captures once with the trigger off.
