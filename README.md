# WebScope

Low-cost oscilloscope you use from your phone. DE10-Lite FPGA captures and filters the signal; ESP32 streams it over Wi-Fi to a web app.

Read `AGENTS.md` first (Claude Code loads it through `CLAUDE.md`).

## Hardware
- DE10-Lite
- ESP32 dev board

## Signal path
```
Signal (0–5 V) → DE10-Lite Arduino A0 → FPGA pipeline → link → ESP32 → Wi-Fi → Browser
```
- For now: ADALM2000 signal generator kept within 0–5 V (e.g. 2.5 V offset) straight into A0. No extra circuit.
- Later: front-end circuit for negative and higher voltages, plus input protection.

## Layout
- `fpga/` — Quartus project (Nick)
- `firmware/` — ESP32 PlatformIO project
- `ui/` — web app (Dominique), run with `?mock=1` for no hardware
