# WebScope

Low-cost oscilloscope you use from your phone. DE10-Lite FPGA captures the signal; ESP32 streams it over Wi-Fi to a web app.

Read `AGENTS.md` first (Claude Code loads it through `CLAUDE.md`).

## Hardware
- DE10-Lite
- ESP32 dev board

## Signal path
```
Signal (0–2.5 V) → DE10-Lite Arduino A0 → MAX 10 ADC → FPGA capture (2048 samples) → 12-bit parallel bus → ESP32 → Wi-Fi → Browser
```
- **Input limit: 0–2.5 V.** Never go above 2.5 V or below 0 V.
- For now: ADALM2000 signal generator kept within 0–2.5 V (e.g. 1.25 V offset, at most 2.5 V peak-to-peak) straight into A0. No extra circuit.
- Later: front-end circuit for negative and higher voltages, plus input protection.

## Current specs
- 12-bit samples, 2048 per capture, sample rates 10 kSa/s … 500 kSa/s (the 1 MSa/s setting really samples at 500 kSa/s)
- Hardware trigger (rising/falling, level), Auto / Normal / Single
- Measurements validated against known signals: `docs/VALIDATION.md`

## Layout
- `fpga/quartus/` — Nick's Quartus project (`Hackathon2026Fall.qpf`, top level `oscilloscope_top`): RTL, ADC IP, PLL, pin assignments
- `fpga/sim/` — testbench for the capture engine
- `firmware/webscope_esp32/` — ESP32 Arduino sketch: Nick's SPI + parallel-bus code + `web_ui.ino` (Wi-Fi, web page, WebSocket). See `firmware/README.md`
- `ui/` — web app (Dominique), runs in Demo Mode with no hardware
- `tools/` — `serve_ui.py` (run the UI from a laptop), `sync_ui.py` (copy the UI into the sketch for LittleFS)
- `docs/` — architecture, protocol, validation, pitch

## Run the UI
From the repo root:
```bash
python tools/serve_ui.py
```
Open http://localhost:8000 (Demo Mode). Caching is off, so a refresh always shows your latest edits.

**Live data without reflashing:** join the WebScope Wi-Fi and open `http://localhost:8000/?esp=192.168.4.1`.
UI changes never need Arduino this way. Put the UI on the board once it's final (`firmware/README.md`).

(Opening `index.html` directly won't work; browsers block JS modules from `file://`.)

## Build the FPGA
Open `fpga/quartus/Hackathon2026Fall.qpf` in Quartus Prime Lite 20.1, compile, program the DE10-Lite.
Build output (`db/`, `output_files/`) is not in git.
