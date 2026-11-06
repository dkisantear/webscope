# Architecture

```
Probe → Analog front end → DE10-Lite ADC → FPGA pipeline → link → ESP32 → Wi-Fi → Browser
```

## Analog front end (breadboard)
- Op-amp stage: scale/offset the input into the ADC range (bipolar signals centered at mid-scale).
- Clamp diodes for protection.

## FPGA — `fpga/rtl/` (Nick)
- `scope_pkg.sv` — shared constants
- `scope_top.sv` — top level, wiring only
- `adc_sampler.sv` — MAX 10 ADC IP wrapper
- `test_pattern.sv` — fake signal, same interface as `adc_sampler`
- `fir_filter.sv` — low-pass FIR with bypass
- `decimator.sv` — timebase
- `trigger.sv` — edge trigger + auto mode
- `capture_buffer.sv` — on-chip RAM frame buffer
- `link_tx.sv` — sends frames to the ESP32 (UART first, SPI later)
- `config_regs.sv` — settings (switches first, ESP32 commands later)

## ESP32 — `firmware/src/` (both)
- `main.cpp` — setup/loop wiring only
- `fpga_link.cpp` — receives frames from the FPGA
- `frame_parser.cpp` — sync, length, checksum
- `ws_server.cpp` — WebSocket to the browser
- `wifi_ap.cpp` — ESP32's own Wi-Fi network
- `web_files.cpp` — serves the UI from flash
- `test_mode.cpp` — fake frames

## UI — `ui/src/` (Dominique)
- `protocol.js` — shared constants
- `main.js` — startup wiring only
- `connection.js` / `mockSource.js` — data in
- `frameDecoder.js` — bytes → volts
- `plot.js` — canvas waveform
- `measurements.js` — Vpp, frequency, RMS
- `controls.js` — timebase, trigger, filter, run/stop

## Build order
1. Fake data end to end
2. Real ADC + front end
3. Trigger, buffer, timebase, filter
4. UI controls the FPGA
5. Faster link (if measured throughput needs it)

## Pin map
| Signal | DE10-Lite | ESP32 |
|---|---|---|
| Link | TBD | TBD |
| GND | GND | GND |
| Analog in | Arduino A0 | — |
