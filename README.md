# WebScope

Low-cost oscilloscope you use from your phone. DE10-Lite FPGA captures and filters the signal; ESP32 streams it over Wi-Fi to a web app.

Read `AGENTS.md` first (Claude Code loads it through `CLAUDE.md`).

## Hardware
- DE10-Lite + USB cable
- ESP32 dev board + USB cable
- ADALM2000 (signal generator, ±5 V supply, reference scope, logic analyzer)
- Breadboard, jumpers (female–male for the GPIO header)
- Dual rail-to-rail op-amp, clamp diodes, 0.1 µF caps, resistors
- Phone for the demo

- `fpga/` — Quartus project (Nick)
- `firmware/` — ESP32 PlatformIO project
- `ui/` — web app (Dominique), run with `?mock=1` for no hardware
- `docs/` — architecture, protocol, pitch
