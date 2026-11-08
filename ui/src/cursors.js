// Cursors: two draggable lines on the screen for measuring time or voltage between any two points.
// Positions live in state.cursors (time cursors in screen divisions 0–10, volt cursors in volts).

import { state } from './state.js';
import { DIVS_X, DIVS_Y, TIME_PER_DIV, VOLTS_PER_DIV, formatTime, formatVolts, formatFreq } from './scales.js';

const HIT_PX = 16; // how close (layout px) a press must be to grab a cursor

const vScale = () => {
  const ch = state.channels.CH1;
  return { offset: ch.offset, voltsPerDiv: VOLTS_PER_DIV[ch.voltsPerDivIndex] };
};

/** Time at a screen position in divisions (0 = left edge). Roll mode: 0 s = newest, at the right edge. */
export function timeAtDiv(d, roll) {
  return (roll ? d - DIVS_X : d - DIVS_X / 2) * TIME_PER_DIV[state.timePerDivIndex];
}

/** Which cursor is under layout point (x, y)? Returns 't1' | 't2' | 'v1' | 'v2' | null. */
export function pickCursor(plot, x, y) {
  const c = state.cursors;
  if (c.mode === 'off') return null;
  const dist = c.mode === 'time'
    ? (k) => Math.abs(plot.gx + (c[k] / DIVS_X) * plot.gw - x)
    : (k) => Math.abs(plot.y(c[k], vScale()) - y);
  const keys = c.mode === 'time' ? ['t1', 't2'] : ['v1', 'v2'];
  const best = keys.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  return dist(best) <= HIT_PX ? best : null;
}

/** Move cursor `key` to layout point (x, y). */
export function moveCursor(plot, key, x, y) {
  const c = state.cursors;
  if (key[0] === 't') {
    c[key] = Math.min(DIVS_X, Math.max(0, ((x - plot.gx) / plot.gw) * DIVS_X));
  } else {
    const { offset, voltsPerDiv } = vScale();
    const divs = (plot.gy + plot.gh / 2 - y) / (plot.gh / DIVS_Y);
    const lim = (DIVS_Y / 2) * voltsPerDiv;
    c[key] = Math.min(lim - offset, Math.max(-lim - offset, divs * voltsPerDiv - offset));
  }
}

/** Text for the cursor readout, or null when cursors are off. */
export function cursorReadout(roll) {
  const c = state.cursors;
  if (c.mode === 'time') {
    const a = timeAtDiv(c.t1, roll), b = timeAtDiv(c.t2, roll), d = Math.abs(b - a);
    return { l1: 'C1 time', v1: formatTime(a), l2: 'C2 time', v2: formatTime(b), d: formatTime(d), f: d > 0 ? formatFreq(1 / d) : '—' };
  }
  if (c.mode === 'volts') {
    return { l1: 'C1 volts', v1: formatVolts(c.v1), l2: 'C2 volts', v2: formatVolts(c.v2), d: formatVolts(Math.abs(c.v2 - c.v1)), f: null };
  }
  return null;
}

/** Put volt cursors around the signal when they're first turned on, so they're easy to find. */
export function placeVoltCursors(m) {
  if (m) { state.cursors.v1 = m.min; state.cursors.v2 = m.max; }
}
