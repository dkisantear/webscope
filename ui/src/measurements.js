// Automatic measurements calculated from the samples themselves.
// Accuracy notes (checked against known test signals with 12-bit steps and noise, see docs/ARCHITECTURE.md):
//   - Edge times (frequency, duty, width, rise/fall) are interpolated between samples, not snapped to them.
//   - Mean and RMS use whole cycles only, so a capture that ends mid-cycle doesn't skew them.
//   - Vpp/Max/Min are the highest and lowest samples: with few points per cycle the true peak can fall
//     between samples and read low (like any sampling scope). Use ≥ 20 points per cycle for good Vpp.

const MIN_SAMPLES = 16;
const DC_THRESHOLD_V = 0.05;   // below this peak-to-peak, treat the signal as DC
const MAX_JITTER = 0.15;       // period spread allowed before frequency is "unstable"
const MIN_EDGE_SAMPLES = 1;    // edges faster than one sample can't be timed: report "—"
export const MIN_POINTS_PER_CYCLE = 20; // below this, warn that readings are rough (see accuracy notes)

/** Fractional position where the line from sample a to sample a+1 crosses `level`. */
function crossAt(s, a, level) {
  const d = s[a + 1] - s[a];
  return d === 0 ? a : a + (level - s[a]) / d;
}

/** @returns {null | {min,max,vpp,mean,rms,frequency,period,duty,widthHigh,rise,fall,kind}} */
export function measure(samples, sampleRate) {
  const n = samples?.length ?? 0;
  if (n < MIN_SAMPLES || !sampleRate) return null;

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const vpp = max - min;
  const { mean, rms } = stats(samples, 0, n);
  const result = {
    min, max, vpp, mean, rms,
    frequency: null, period: null, duty: null, widthHigh: null, rise: null, fall: null, kind: 'periodic',
  };

  if (vpp < DC_THRESHOLD_V) { result.kind = 'dc'; return result; }

  // Rising and falling crossings of the midpoint, interpolated between samples. 10% hysteresis:
  // an edge only counts after the wave has clearly been on the other side, so noise can't add edges.
  const mid = (max + min) / 2;
  const h = vpp * 0.1;
  const rising = [], falling = [];       // fractional sample positions
  const risingIdx = [], fallingIdx = []; // first sample past the midpoint (for edge timing)
  let lowArmed = false, highArmed = false;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (v < mid - h) lowArmed = true;
    if (v > mid + h) highArmed = true;
    if (lowArmed && v >= mid && i > 0) { rising.push(crossAt(samples, i - 1, mid)); risingIdx.push(i); lowArmed = false; }
    if (highArmed && v <= mid && i > 0) { falling.push(crossAt(samples, i - 1, mid)); fallingIdx.push(i); highArmed = false; }
  }

  const lo = min + 0.1 * vpp, hi = min + 0.9 * vpp;
  result.rise = edgeTime(samples, risingIdx, lo, hi, true, sampleRate);
  result.fall = edgeTime(samples, fallingIdx, lo, hi, false, sampleRate);

  if (rising.length < 2) { result.kind = 'too-few-cycles'; return result; }

  const intervals = rising.slice(1).map((c, i) => c - rising[i]);
  const avg = (rising[rising.length - 1] - rising[0]) / intervals.length;
  const spread = Math.max(...intervals) - Math.min(...intervals);
  // Allow ±1 sample per interval on top of the 15% jitter (noise moves crossings a little).
  if (intervals.length > 1 && spread > Math.max(MAX_JITTER * avg, 2)) { result.kind = 'unstable'; return result; }

  result.period = avg / sampleRate;
  result.frequency = 1 / result.period;
  result.pointsPerCycle = avg; // under ~20, Vpp / duty / rise readings lose accuracy

  // Mean and RMS over whole cycles (first to last rising crossing).
  const whole = stats(samples, Math.ceil(rising[0]), Math.floor(rising[rising.length - 1]) + 1);
  result.mean = whole.mean;
  result.rms = whole.rms;

  // Duty cycle: time high (rising → next falling) as a share of one period.
  const highs = [];
  for (let k = 0; k < rising.length - 1; k++) {
    const f = falling.find((x) => x > rising[k] && x < rising[k + 1]);
    if (f !== undefined) highs.push(f - rising[k]);
  }
  if (highs.length) {
    const high = highs.reduce((a, b) => a + b, 0) / highs.length;
    result.widthHigh = high / sampleRate;
    result.duty = high / avg;
  }
  return result;
}

function stats(s, from, to) {
  let sum = 0, sumSq = 0;
  for (let i = from; i < to; i++) { sum += s[i]; sumSq += s[i] * s[i]; }
  const count = Math.max(1, to - from);
  return { mean: sum / count, rms: Math.sqrt(sumSq / count) };
}

/**
 * Average 10%→90% (rising) or 90%→10% (falling) edge time around each midpoint crossing,
 * with both level crossings interpolated between samples. Null when the edge is faster than one sample.
 */
function edgeTime(s, crossings, lo, hi, isRising, sampleRate) {
  const last = s.length - 1;
  const times = [];
  for (const c of crossings) {
    let a = c - 1, b = c;
    if (isRising) {
      while (a > 0 && s[a] > lo) a--;          // last sample at or below 10%
      while (b < last && s[b] < hi) b++;       // first sample at or above 90%
      if (s[a] > lo || s[b] < hi) continue;    // edge runs off the block
      times.push(crossAt(s, b - 1, hi) - crossAt(s, a, lo));
    } else {
      while (a > 0 && s[a] < hi) a--;
      while (b < last && s[b] > lo) b++;
      if (s[a] < hi || s[b] > lo) continue;
      times.push(crossAt(s, b - 1, lo) - crossAt(s, a, hi));
    }
  }
  if (!times.length) return null;
  const avg = times.reduce((x, y) => x + y, 0) / times.length;
  return avg < MIN_EDGE_SAMPLES ? null : avg / sampleRate;
}
