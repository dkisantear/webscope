// Constants shared with the ESP32 sketch (firmware/webscope_esp32/web_ui.ino).
// Must match docs/PROTOCOL.md.

export const WS_PORT = 81;
export const BLOCK_MAGIC = 0x57;          // 'W'
export const BLOCK_VERSION = 1;
export const BLOCK_TYPE_SAMPLES = 1;
export const BLOCK_HEADER_BYTES = 16;
export const FLAG_OVERFLOW = 1;           // header flags bit0
export const FLAG_HW_TRIGGERED = 2;       // header flags bit1

// FPGA capture: fixed 2048-sample buffer (Nick's ADDR_WIDTH = 11), only these effective sample rates (Hz).
export const CAPTURE_LENGTH = 2048;
export const SAMPLE_RATES = [1_000_000, 500_000, 250_000, 100_000, 50_000, 20_000, 10_000];

// Settings where the FPGA delivers a different rate than requested (measured with a 1 kHz sine).
// 1M: the ADC needs 2 µs per conversion, so it really samples at 500 kSa/s (1 kHz read 2 kHz).
// The time axis and every time/frequency reading use the real rate. Remove the entry once a 1 kHz sine
// reads 1.00 kHz at the 1M setting (docs/VALIDATION.md section 3).
const MEASURED_RATE = { 1_000_000: 500_000 };
export const DEFAULT_SAMPLE_RATE = 100_000;

// Extra time per sample on top of the selected interval (real rate = 1 / (1/rate + overhead)).
// Was 2 µs with the first FPGA build (its pacing timer restarted only after the ADC accepted a request).
// Nick's free-running pacing timer (max10_adc_interface.sv, Nov 7) removed it: 0 now. If a 1 kHz sine ever
// reads high at fast settings again, re-measure (docs/VALIDATION.md section 3).
export const ADC_SAMPLE_OVERHEAD_S = 0;
/** Real samples per second for a selected (requested) SAMPLE_RATES value. */
export const effectiveRate = (selected) => MEASURED_RATE[selected] ?? 1 / (1 / selected + ADC_SAMPLE_OVERHEAD_S);

// ADC code ↔ volts at the A0 pin: code / (2^bits − 1) × ADC_VREF + ADC_OFFSET_V.
// The DE10-Lite halves A0 (316 Ω / 316 Ω divider + MCP6244 buffer) before the 2.5 V ADC, so full scale at
// the pin is ~5 V. Calibrated with the ADALM2000 (DC 1.00 / 0.10 / 0.05 V read 0.548 / 0.0961 / 0.0702 V
// with the old 2.5 V scale): pin = (old − 0.0459) / 0.5021 → VREF 2.5 / 0.5021, offset −0.0459 / 0.5021.
export const ADC_BITS = 12;
export const ADC_VREF = 4.979;
export const ADC_OFFSET_V = -0.0914;
export const ADC_MAX_CODE = 2 ** ADC_BITS - 1;

export const codeToVolts = (code, bits = ADC_BITS) => (code / (2 ** bits - 1)) * ADC_VREF + ADC_OFFSET_V;
export const voltsToCode = (v) => Math.min(ADC_MAX_CODE, Math.max(0, Math.round(((v - ADC_OFFSET_V) / ADC_VREF) * ADC_MAX_CODE)));
