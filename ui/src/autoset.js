// Auto Set: pick volts/div, position, time/div, trigger level and sample rate from measurements.
// Runs over a few blocks: first find the signal at a medium setting, then refine.

import { VOLTS_PER_DIV, TIME_PER_DIV, DIVS_X, stepAtLeast } from './scales.js';
import { SAMPLE_RATES, CAPTURE_LENGTH, effectiveRate } from './protocol.js';

const SEARCH_TIMEBASES = [1e-3, 2e-2, 1e-5]; // medium, slow, fast
const CYCLES_ON_SCREEN = 3;
const SCREENS_PER_CAPTURE = 2;               // capture ≥ 2 screens, so the trigger can sit in the middle
export const ROLL_TIMEBASE = 0.2;            // 200 ms/div: scrolling view for slow or steady signals

/** Fastest supported sample rate whose capture (CAPTURE_LENGTH samples) still covers `seconds`. */
export function rateForWindow(seconds) {
  return SAMPLE_RATES.find((r) => CAPTURE_LENGTH / effectiveRate(r) >= seconds) ?? SAMPLE_RATES[SAMPLE_RATES.length - 1];
}

export class AutoSet {
  constructor(state) { this.state = state; this.active = false; }

  start(lastSequence) {
    this.active = true;
    this.step = 0;
    this.refining = false;
    this.useTimebase(SEARCH_TIMEBASES[0], lastSequence);
  }

  // Set time/div and a sample rate that fills it, then ignore blocks made before the change.
  useTimebase(seconds, lastSequence) {
    this.state.timePerDivIndex = stepAtLeast(TIME_PER_DIV, seconds);
    this.state.sampleRate = rateForWindow(SCREENS_PER_CAPTURE * DIVS_X * TIME_PER_DIV[this.state.timePerDivIndex]);
    this.waitFor = lastSequence + 2;
  }

  /** Call for every new block. Returns true when settings changed. */
  update(block, m) {
    if (!this.active || block.sequence < this.waitFor || !m) return false;
    const { state } = this;
    const ch = state.channels.CH1;

    // Vertical: fit the signal in ~6 of 8 divisions and center it.
    ch.voltsPerDivIndex = stepAtLeast(VOLTS_PER_DIV, Math.max(m.vpp, 0.05) / 6);
    // Round to 1/10 of a division so the axis labels stay clean.
    const step = VOLTS_PER_DIV[ch.voltsPerDivIndex] / 10;
    const center = Math.round((m.max + m.min) / 2 / step) * step;
    ch.offset = center === 0 ? 0 : -center;
    state.trigger.level = center;

    if (m.frequency) {
      this.useTimebase((CYCLES_ON_SCREEN * m.period) / DIVS_X, block.sequence);
      if (this.refining) this.active = false; // second pass done
      this.refining = true;
    } else if (m.kind === 'dc' || ++this.step >= SEARCH_TIMEBASES.length) {
      // DC or nothing periodic found (a button, a steady level): slowest rate + scrolling roll view.
      this.active = false;
      state.sampleRate = SAMPLE_RATES[SAMPLE_RATES.length - 1];
      state.timePerDivIndex = stepAtLeast(TIME_PER_DIV, ROLL_TIMEBASE);
    } else {
      this.useTimebase(SEARCH_TIMEBASES[this.step], block.sequence);
    }
    return true;
  }
}
