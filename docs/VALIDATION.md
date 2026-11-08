# Measurement validation

## 1. Software check (done)
`ui/src/measurements.js` was tested against signals with known answers: 2048 samples, 12-bit ADC steps
through the real calibration, 3 mV noise, random phase, 30 runs each, sine / triangle / square / 25 % pulse,
10–130 points per cycle. Worst error with **≥ 20 points per cycle**:

| Measurement | Before fix | After fix |
|---|---|---|
| Frequency / period | 0.0 % | **≤ 0.05 %** |
| Pk-Pk, Max, Min | ≤ 1.6 % | **≤ 1.4 %** (sine ≤ 0.7 %; sharp triangle peaks need ≥ 50 points) |
| Mean | ≤ 1.9 % | **≤ 0.3 %** (whole cycles only) |
| RMS | ≤ 1.2 % | **≤ 0.3 %** (whole cycles only) |
| Duty cycle / pulse width | ≤ 20 % | **≤ 0.5 %** (edges interpolated between samples) |
| Rise / fall time (10–90 %) | 5–35 % | **≤ 2 %** (both levels interpolated) |

Below ~20 points per cycle the samples can miss the peaks and land on the same spots every cycle, so
Pk-Pk, duty and rise time get rough (any sampling scope does this). The UI says so in the summary line.
Edges faster than one sample (square waves) show rise time "—" instead of a made-up number.

## 2. Bench check with the ADALM2000 (fill in)
Generator W1 → CH1 row, grounds on the − rail. Offset 1.25 V, 2 V peak-to-peak unless noted. Compare with
Scopy's oscilloscope on the same node (Scopy is the reference).

| # | Signal | Rate setting (dropdown shows the real rate, section 3) | Expected | Scopy reads | WebScope reads | Error |
|---|---|---|---|---|---|---|
| 1 | DC 1.00 V | 100 kSa/s | Mean 1.00 V | | | |
| 2 | DC 2.00 V | 100 kSa/s | Mean 2.00 V | | | |
| 3 | Sine 1 kHz | 100 kSa/s | Freq 1 kHz · Pk-Pk 2.00 V · Mean 1.25 V · RMS 1.44 V | | | |
| 4 | Sine 10 kHz | 1 MSa/s | Freq 10 kHz · Pk-Pk 2.00 V · Rise 29.5 µs | | | |
| 5 | Square 1 kHz | 100 kSa/s | Freq 1 kHz · Duty 50 % · Pk-Pk 2.00 V | | | |
| 6 | Square 1 kHz, duty 25 % | 100 kSa/s | Duty 25 % · Width 250 µs | | | |
| 7 | Triangle 2 kHz | 250 kSa/s | Freq 2 kHz · Rise 200 µs · RMS 1.37 V | | | |
| 8 | Sine 15 kHz | 1 MSa/s | Freq 15 kHz · Pk-Pk 2.00 V | | | |

Pass: frequency within 0.5 %, voltages within 2 % (or 20 mV), duty within 1 point, rise time within 5 %.
If voltages are off by the same factor everywhere, redo the calibration in `ui/src/protocol.js`
(three DC points, see the comment there). If frequency is off by a constant factor, the FPGA's real ADC
rate differs from the selected sample rate (check `max10_adc_interface.sv`).

## 3. Real sample rate (measured on the board)
A 1 kHz sine read 3 / 2 / 1.5 / 1.2 / 1.1 / 1.04 / 1.02 kHz at the 1M / 500k / 250k / 100k / 50k / 20k / 10k
settings: every sample takes the selected interval **+ 2 µs**. Nick's `max10_adc_interface.sv` starts its
wait timer only after the ADC accepts a request, and one conversion + handshake takes ~2 µs.

| Setting | 1 M | 500 k | 250 k | 100 k | 50 k | 20 k | 10 k |
|---|---|---|---|---|---|---|---|
| Real rate (Sa/s) | 333 k | 250 k | 167 k | 83.3 k | 45.5 k | 19.2 k | 9.8 k |

The UI uses the real rate for the time axis, the dropdown labels and Auto Set (`ADC_SAMPLE_OVERHEAD_S` in
`ui/src/protocol.js`), so frequency and time readings are correct at every setting.

**FPGA fix (Nick, when there's time):** keep `adc_command_valid` high all the time so the ADC free-runs at
its full rate, and make the slower rates by passing on every Nth result (`sample_valid` on 1 of N responses,
N = 1 000 000 ÷ rate). Rates are then exact and 1 MSa/s is real. Afterwards set `ADC_SAMPLE_OVERHEAD_S = 0`.

**Fixed (Nov 7):** Nick's `max10_adc_interface.sv` now uses a free-running pacing timer (a request is marked
due every `sample_period` clocks, independent of when the ADC accepts it). `ADC_SAMPLE_OVERHEAD_S` is back to 0.
Re-check: 1 kHz sine at every setting should read 1.00 kHz. If only the top setting reads high, the ADC IP's
own maximum rate is lower than that setting (Platform Designer → modular_adc_0 → ADC Sample Rate).

**Re-check after the fix (Nov 7):** every setting reads 1.00 kHz except **1M, which reads 2 kHz** → the ADC
delivers at most **500 kSa/s** (one conversion per 2 µs as currently driven). The UI keeps the 1M option but
uses 500 kSa/s for its time axis and readings (`MEASURED_RATE` in `ui/src/protocol.js`), so it reads correctly.
Experiment for Nick (one line in `max10_adc_interface.sv`): at the 1M setting, keep the request line high
all the time so the ADC runs back-to-back at its own maximum:
`adc_command_valid = enable && adc_pll_locked && !rst && (request_pending || sample_period <= 50);`
If a 1 kHz sine then reads 1.00 kHz at 1M, remove the 1M entry from `MEASURED_RATE` in `ui/src/protocol.js`.
If it still reads 2 kHz, check Platform Designer → modular_adc_0 → ADC Sample Rate (must be 1 MHz).
