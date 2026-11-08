# Architecture

```
Signal (0–2.5 V) → DE10-Lite input → FPGA pipeline → parallel bus → ESP32 → Wi-Fi → Browser
```

## Analog input
- For now: ADALM2000 signal generator kept within 0–2.5 V (e.g. 1.25 V offset, ≤ 2.5 V peak-to-peak). No extra circuit.
- Later add-on: op-amp front end to scale bigger or negative signals into 0–2.5 V, plus input protection.

## FPGA — `fpga/quartus/` (Nick), project `Hackathon2026Fall.qpf`, top level `oscilloscope_top`
- `oscilloscope_top.sv` — top level: ADC system, SPI control, capture, parallel transmitter; `ADDR_WIDTH = 11` (2048 samples); 100 kHz bus clock (50 MHz ÷ 500)
- `max10_adc_interface.sv` — drives the MAX 10 Modular ADC; free-running pacing timer sets the sample rate (register 0x06, Hz)
- `osc_capture.sv` — circular capture buffer with pre/post-trigger and rising/falling edge trigger
- `parallel_sample_tx.sv` — sends a finished capture to the ESP32 on the 12-bit bus (DATA_CLK / DATA_VALID / DATA_READY)
- `spi_config_slave.sv` — SPI register map (status, control, trigger, pre/post, sample rate, length, ADC width)
- `spi_control_bridge.sv` — moves SPI register values safely into the 50 MHz clock domain
- `adc_pll.*` — 50 MHz → 10 MHz ADC clock · `osc_adc_system.qsys` + `osc_adc_system/` — Modular ADC IP (generated)
- `output_files/oscilloscope_debug.stp` — SignalTap setup used for bring-up
- `fpga/sim/tb_osc_capture.sv` — testbench for `osc_capture.sv`
- Interface to the ESP32 (SPI registers + 12-bit parallel bus): `docs/PROTOCOL.md`.

## ESP32 — `firmware/webscope_esp32/` (Arduino IDE)
- `webscope_esp32.ino` — Nick's SPI + parallel-bus code (unchanged) + 3 marked hooks
- `web_ui.ino` — Wi-Fi, web page from LittleFS, browser settings → FPGA registers, 2048-sample captures over WebSocket
- `data/` — generated copy of `ui/` for LittleFS (`python tools/sync_ui.py`)

## UI — `ui/` (Dominique)
- `index.html`, `styles.css` — layout (desktop/landscape + stacked upright-phone layout)
- `src/main.js` — startup wiring only (data → trigger mode → measurements → display)
- `src/fit.js` — scales the 960×650 instrument on wide screens; switches upright phones to the stacked layout
- `src/slider.js` — slider control (drag, −/+, arrow keys, tap value to type)
- `src/cursors.js` — time/volt cursors: drag on screen + readouts
- `src/exporter.js` — save screen picture (PNG) and samples (CSV)
- `src/guideArt.js` — guide illustrations: the enclosure (power, leads) and the pushbutton circuit (inline SVG)
- `src/shape.js` — guesses the live wave shape (sine / square / triangle / pulse) for the waveform buttons
- `src/glitchFilter.js` — Live: removes single-sample spikes from bad parallel-bus reads (and counts them)
- `src/state.js` — all settings in one place
- `src/scales.js` — V/div and time/div steps, number formatting
- `src/mockSource.js` — Demo Mode data (simulated 2048-sample captures at the selected sample rate)
- `src/connection.js` — Live Mode data (ESP32 WebSocket: configure / capture_start / capture_abort, auto-reconnect)
- `src/trigger.js` — software trigger (FPGA trigger later); Auto / Normal / Single modes live in main.js
- `src/measurements.js` — frequency, period, Vpp, RMS, min/max/mean, duty, width, rise/fall (interpolated edges, whole-cycle mean/RMS; accuracy in `docs/VALIDATION.md`)
- `src/autoset.js` — one-button Auto Set (also picks the sample rate)
- `src/plot.js` — canvas waveform display
- `src/controls.js` — buttons/sliders ↔ state, screen gestures (drag to move, pinch to zoom), measurement readouts
- `src/probeGuide.js` — first-run guide (4 pages: power, button circuit, leads, go Live) + live signal check
- `src/protocol.js` — constants shared with the ESP32 (block header, capture length, sample rates + real-rate correction, ADC ↔ volts calibration)
- `src/frameDecoder.js` — ESP32 data → volts (binary block with header, raw uint16 after capture_meta, or JSON samples)

Both data sources share one interface: `connect()`, `disconnect()`, `start()`, `stop()`, `onSamples(cb)`, `getStatus()`.
Sample block: `{ channel, sampleRate, sampleCount, sequence, timestamp, format, simulated, samples }`.

## Build order
1. Fake data end to end
2. Real ADC
3. Trigger, buffer, timebase, filter
4. UI controls the FPGA

## Pin map
See `docs/PROTOCOL.md` (SPI, 12-bit parallel bus, DATA_CLK/VALID/READY).
