// App settings in one place. Controls change it, then call changed().

import { DEFAULT_SAMPLE_RATE } from './protocol.js';

export const state = {
  mode: 'demo',          // 'demo' | 'live'
  running: true,
  sampleRate: DEFAULT_SAMPLE_RATE, // effective FPGA sample rate (Hz), one of SAMPLE_RATES; capture = CAPTURE_LENGTH samples
  timePerDivIndex: 9,    // 1 ms/div (see scales.js)
  channels: {
    CH1: { enabled: true, voltsPerDivIndex: 5, offset: -1.25, color: '#f5c518' }, // 0.5 V/div, centered on 1.25 V
  },
  // enabled: FPGA hardware trigger on/off (off = free run).
  // mode: 'auto' (always draws), 'normal' (only redraws on a trigger), 'single' (one capture, then stops)
  trigger: { enabled: true, edge: 'rising', level: 1.25, mode: 'auto' },
  glitchFilter: true,    // Live: remove single-sample spikes from bad bus reads (src/glitchFilter.js)
  // Cursors: mode 'off' | 'time' | 'volts'. Time cursors in screen divisions (0–10), volt cursors in volts.
  cursors: { mode: 'off', t1: 3, t2: 7, v1: 0.5, v2: 2 },
  tab: 'scope',          // control panel tab: 'scope' | 'measure'
  demo: { shape: 'sine', frequency: 1000, amplitude: 1, offset: 1.25, noise: 0.01 }, // stays inside 0–2.5 V
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const changed = () => listeners.forEach((fn) => fn(state));
