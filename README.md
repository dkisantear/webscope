# WebScope

Low-cost oscilloscope you use from your phone. DE10-Lite FPGA captures and filters the signal; ESP32 streams it over Wi-Fi to a web app.

Read `AGENTS.md` first (Claude Code loads it through `CLAUDE.md`).

## Hardware
- DE10-Lite
- ESP32 dev board

## Signal path
```
Signal (0–2.5 V) → DE10-Lite Arduino A0 → FPGA pipeline → link → ESP32 → Wi-Fi → Browser
```
- **Input limit: 0–2.5 V.** Never go above 2.5 V or below 0 V.
- For now: ADALM2000 signal generator kept within 0–2.5 V (e.g. 1.25 V offset, at most 2.5 V peak-to-peak) straight into A0. No extra circuit.
- Later: front-end circuit for negative and higher voltages, plus input protection.

## Layout
- `fpga/` — Quartus project (Nick)
- `firmware/` — ESP32 PlatformIO project
- `ui/` — web app (Dominique), run with `?mock=1` for no hardware
