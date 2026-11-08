// DemoAcquisitionSource: makes simulated sample blocks in the browser.
// Same interface as connection.js so the rest of the UI can't tell the difference.
// Behaves like the FPGA: CAPTURE_LENGTH samples per capture at the selected sample rate.

import { CAPTURE_LENGTH } from './protocol.js';

const BLOCK_INTERVAL_MS = 33; // ~30 blocks/s
const INPUT_MAX_V = 2.5;      // input limit (same as the real board)

const PULSE_DUTY = 0.2; // pulse is high for 20% of each cycle

const shapes = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  square: (p) => (p < 0.5 ? 1 : -1),
  triangle: (p) => 1 - 4 * Math.abs(p - 0.5),
  pulse: (p) => (p < PULSE_DUTY ? 1 : -1), // short high pulse, low the rest of the cycle (a step that repeats)
};

// Roughly Gaussian noise with standard deviation `sigma`.
const noise = (sigma) => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sigma;

export class DemoAcquisitionSource {
  /** @param {() => {demo: object, sampleRate: number}} getConfig */
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.callback = null;
    this.timer = null;
    this.sequence = 0;
    this.state = 'disconnected';
  }

  async connect() { this.state = 'connected'; return true; }
  async disconnect() { this.stop(); this.state = 'disconnected'; }

  start() {
    if (this.timer || this.state === 'disconnected') return;
    this.timer = setInterval(() => this.emit(), BLOCK_INTERVAL_MS);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
  configure() { /* the demo reads settings directly through getConfig */ }
  onSamples(callback) { this.callback = callback; }

  getStatus() {
    return { state: this.state, simulated: true, fpgaState: this.timer ? 'done' : 'idle', label: 'Demo · simulated' };
  }

  emit() {
    const { demo, sampleRate } = this.getConfig();
    const shape = shapes[demo.shape] ?? shapes.sine;
    const t0 = performance.now() / 1000;
    const samples = new Float32Array(CAPTURE_LENGTH);

    for (let i = 0; i < CAPTURE_LENGTH; i++) {
      const t = t0 + i / sampleRate;
      const phase = (t * demo.frequency) % 1;
      const v = demo.offset + demo.amplitude * shape(phase) + noise(demo.noise);
      samples[i] = Math.min(INPUT_MAX_V, Math.max(0, v)); // like the real input: clipped to 0–2.5 V
    }

    this.callback?.({
      channel: 'CH1',
      sampleRate,
      sampleCount: CAPTURE_LENGTH,
      sequence: this.sequence++,
      timestamp: Date.now(),
      format: 'volts',
      simulated: true,
      samples,
    });
  }
}
