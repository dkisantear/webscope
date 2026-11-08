// Guess the shape of a signal: 'sine' | 'square' | 'triangle' | 'pulse' | null (flat or too little data).
// Used in Live mode to light up the matching waveform button.

const MIN_POINTS = 16;
const FLAT_V = 0.05;          // under this peak-to-peak, there's no shape to name
const EDGE_BAND = 0.1;        // "near the top/bottom" = within 10% of peak-to-peak
const TWO_LEVEL = 0.75;       // ≥75% of points near top or bottom → square or pulse
const SQUARE_DUTY = [0.35, 0.65];
const SINE_RATIO = 0.65;      // AC RMS ÷ half peak-to-peak: sine ≈ 0.71, triangle ≈ 0.58

/** @param {ArrayLike<number>} v volts */
export function detectShape(v) {
  const n = v?.length ?? 0;
  if (n < MIN_POINTS) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < n; i++) { if (v[i] < min) min = v[i]; if (v[i] > max) max = v[i]; sum += v[i]; }
  const vpp = max - min;
  if (vpp < FLAT_V) return null;

  const mean = sum / n, mid = (max + min) / 2, band = vpp * EDGE_BAND;
  let nearEdge = 0, high = 0, acSq = 0;
  for (let i = 0; i < n; i++) {
    if (v[i] <= min + band || v[i] >= max - band) nearEdge++;
    if (v[i] > mid) high++;
    acSq += (v[i] - mean) ** 2;
  }

  if (nearEdge / n >= TWO_LEVEL) {
    const duty = high / n;
    return duty >= SQUARE_DUTY[0] && duty <= SQUARE_DUTY[1] ? 'square' : 'pulse';
  }
  return Math.sqrt(acSq / n) / (vpp / 2) >= SINE_RATIO ? 'sine' : 'triangle';
}
