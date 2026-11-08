# Protocol

Change this file first, then the code on both sides. Source of truth for the FPGA side: Nick's RTL + sketch (`firmware/webscope_esp32/webscope_esp32.ino`).

## ESP32 ↔ FPGA control: SPI
- Pins: SCLK 18, MISO 19, MOSI 23, CS 5 · 1 MHz · mode 0 · MSB first
- Transaction: 6 bytes. Read: `0x80 | addr`, then 5 bytes; value = bytes 2–5 (big-endian). Write: `addr`, `0x00`, then 4 value bytes (big-endian).

| Register | Addr | Use |
|---|---|---|
| STATUS | 0x00 | bit0 busy, bit1 triggered, bit2 done |
| CONTROL | 0x01 | bit0 arm, bit1 abort, bit2 clear |
| TRIGGER_LEVEL | 0x02 | ADC code 0–4095 |
| TRIGGER_CONFIG | 0x03 | bit0 trigger enabled, bit1 rising edge (0 = falling) |
| PRETRIGGER | 0x04 | samples kept before the trigger |
| POSTTRIGGER | 0x05 | samples from the trigger on (includes the trigger sample) |
| SAMPLE_RATE | 0x06 | effective ADC sample rate in Hz (supported values below) |
| CAPTURE_LENGTH | 0x07 | samples captured (read) |
| ADC_WIDTH | 0x08 | ADC bits (expected 12) |

- Capture buffer: **2048 samples**, fixed (Nick's FPGA: `ADDR_WIDTH = 11`). PRETRIGGER + POSTTRIGGER = 2048.
  The FPGA keeps only 12 bits of each count, so values above 2048 wrap (e.g. 4096 → 0 = empty capture).
- Supported sample rates (Hz): **1 000 000, 500 000, 250 000, 100 000, 50 000, 20 000, 10 000**. Anything else is rejected by the ESP32.
  At the 1 000 000 setting the ADC really delivers 500 kSa/s (measured); the UI uses 500 kSa/s for that
  setting's time axis and readings (`MEASURED_RATE` in `ui/src/protocol.js`).
- Capture duration = 2048 ÷ sample rate (2.05 ms at 1 MHz … 204.8 ms at 10 kHz).
- Parallel-bus readout clock: 100 kHz (50 MHz ÷ 500), so one readout takes ~20 ms.

## FPGA → ESP32 data: 12-bit parallel bus
- Data bits 0–11 → GPIO 16, 17, 21, 22, 25, 26, 27, 32, 33, 34, 35, 36
- DATA_CLK GPIO 4 (FPGA drives; ESP32 samples on rising edge)
- DATA_VALID GPIO 13 (FPGA → ESP32) · DATA_READY GPIO 14 (ESP32 → FPGA)
- 3.3 V logic on both sides. Analog input to the FPGA: 0–2.5 V.

### Capture flow (ESP32, every capture)
1. Write SAMPLE_RATE, TRIGGER_LEVEL, TRIGGER_CONFIG, PRETRIGGER, POSTTRIGGER from the latest browser config.
2. CONTROL = arm.
3. Poll STATUS until done. Timeout = 2 × capture duration + 300 ms.
   On timeout: CONTROL = abort. If the config says `auto`, capture again once with the trigger disabled (free run); otherwise report `waiting` and try again.
4. Read CAPTURE_LENGTH (must be 2048; 0 or anything else = error), raise DATA_READY, read exactly that many samples on DATA_CLK while DATA_VALID, lower DATA_READY.
5. Send one sample block (below) to the browser.

## ESP32 ↔ Browser: WebSocket `ws://<esp32>:81/`

### Browser → ESP32 (JSON text)
| Message | Meaning |
|---|---|
| `{"type":"configure","sampleRate":100000,"captureLength":2048,"triggerEnabled":true,"triggerRising":true,"triggerLevel":2048,"preTrigger":1024,"postTrigger":1024,"auto":true}` | Settings for every following capture. `triggerLevel` is an ADC code. `auto` = free-run if no trigger arrives (scope "Auto" mode). The browser sends it on connect, before every `capture_start`, and whenever a setting changes. |
| `{"type":"capture_start"}` | Capture continuously with the latest config. |
| `{"type":"capture_abort"}` | Stop capturing; ESP32 writes CONTROL = abort. |

Legacy `{"cmd":"run"}` / `{"cmd":"stop"}` are still accepted as start / abort.

### ESP32 → Browser
**Binary sample block**, little-endian, 16-byte header + samples:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | magic `0x57` ('W') |
| 1 | 1 | version `1` |
| 2 | 1 | type `1` = samples |
| 3 | 1 | ADC bits |
| 4 | 4 | sequence number |
| 8 | 4 | sample rate (Hz) actually used for this capture |
| 12 | 2 | sample count N (normal operation: 2048) |
| 14 | 1 | flags: bit0 overflow, bit1 hardware-triggered |
| 15 | 1 | reserved |
| 16 | 2N | samples: raw ADC codes, uint16 |

The browser also accepts (for other firmware):
- JSON `{"type":"samples","sampleRate":100000,"samples":[...ADC codes...]}`
- JSON `{"type":"capture_meta","sampleRate":100000,"sampleCount":2048}` followed by a binary message of raw uint16 samples with no header.

**A capture that is not exactly 2048 samples is an error**: the browser shows the error and does not plot it.

**Status (JSON text, ~1/s and on every change):**
`{"evt":"status","fpga":true,"running":true,"state":"done","blocks":120,"fails":0,"samples":2048,"rate":100000}`
`state`: `idle` · `armed` (waiting for trigger) · `reading` · `done` · `waiting` (Normal mode, no trigger yet) · `timeout` · `error`.

**Volts at the A0 pin (UI only):** `code / 4095 × 4.979 V − 0.0914 V` (`ui/src/protocol.js`).
The DE10-Lite halves A0 (316 Ω / 316 Ω divider + MCP6244 buffer) before the 2.5 V ADC; the constants come from a
three-point ADALM2000 calibration (1.00 / 0.10 / 0.05 V DC). Readable range ≈ −0.09 V to 4.89 V; WebScope's
safe input rule stays 0–2.5 V.
