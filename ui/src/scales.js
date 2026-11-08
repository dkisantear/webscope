// Scale steps, screen grid size and number formatting. Nothing else.

export const DIVS_X = 10;
export const DIVS_Y = 8;

export const VOLTS_PER_DIV = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
export const TIME_PER_DIV = [
  1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4,
  1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5,
];

/** Index of the smallest step >= value (or the last step). */
export function stepAtLeast(steps, value) {
  const i = steps.findIndex((s) => s >= value);
  return i === -1 ? steps.length - 1 : i;
}

/** Index of the largest step <= value (or the first step). */
export function stepAtMost(steps, value) {
  let i = 0;
  steps.forEach((s, k) => { if (s <= value * 1.0001) i = k; });
  return i;
}

function fmt(value, units) {
  if (value === 0) return `0 ${units[0][1]}`;
  const abs = Math.abs(value);
  for (const [scale, unit] of units) {
    if (abs >= scale * 0.9995 || scale === units[units.length - 1][0]) {
      const n = value / scale;
      const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
      return `${Number(n.toFixed(digits))} ${unit}`;
    }
  }
  return String(value);
}

export const formatVolts = (v) => fmt(v, [[1, 'V'], [1e-3, 'mV']]);
export const formatTime = (s) => fmt(s, [[1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']]);
export const formatFreq = (f) => fmt(f, [[1e6, 'MHz'], [1e3, 'kHz'], [1, 'Hz']]);
export const formatRate = (r) => fmt(r, [[1e6, 'MSa/s'], [1e3, 'kSa/s'], [1, 'Sa/s']]);

/** Index of the step closest to value (compared on a log scale). */
export function nearestStep(steps, value) {
  let best = 0;
  steps.forEach((s, i) => {
    if (Math.abs(Math.log(s / value)) < Math.abs(Math.log(steps[best] / value))) best = i;
  });
  return best;
}

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6 };

/**
 * Parse typed text like "2.5", "500u", "2 ms", "1k", "20 mV".
 * A bare number uses the units currently on screen ("500 µs" → typing 200 means 200 µs).
 * @returns {number} value in base units (V, s, Hz), or NaN
 */
export function parseQuantity(text, shownText = '') {
  const m = String(text).trim().match(/^(-?\d*\.?\d+)\s*([a-zA-Zµ/]*)$/);
  if (!m) return NaN;
  let suffix = m[2].replace(/\/div$/i, '').replace(/(hz|v|s)$/i, '');
  if (!m[2]) suffix = (String(shownText).trim().match(/\s([pnuµmkKM]?)(?:Hz|V|s)$/) ?? [, ''])[1];
  if (!(suffix in PREFIX)) return NaN;
  return Number(m[1]) * PREFIX[suffix];
}
