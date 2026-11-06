# Protocol

Change this file first, then update the constants files.

## FPGA → ESP32 frame
| Bytes | Field |
|---|---|
| 2 | Sync `0xA5 0x5A` |
| 1 | Type (`0x01` waveform, `0x02` status) |
| 1 | Sequence number |
| 2 | Payload length (little-endian) |
| N | Payload |
| 1 | Checksum (XOR of type through payload) |

Waveform payload: settings byte(s), trigger index, then samples (12-bit).
Link: UART 921600 baud to start.

## ESP32 → FPGA (later)
`SET_CONFIG`: timebase, trigger level/edge, filter on/off, run/stop.

## ESP32 ↔ Browser
- WebSocket `/ws`
- ESP32 → browser: the FPGA frame, unchanged (binary)
- Browser → ESP32: JSON commands, e.g. `{"cmd":"set", ...}`
