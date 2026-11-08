// Startup and wiring only: settings → data source → trigger → measurements → display.

import { state, onChange, changed } from './state.js';
import { VOLTS_PER_DIV, TIME_PER_DIV, DIVS_X, stepAtMost, formatRate, formatTime } from './scales.js';
import { CAPTURE_LENGTH, voltsToCode, effectiveRate } from './protocol.js';
import { DemoAcquisitionSource } from './mockSource.js';
import { WebSocketAcquisitionSource } from './connection.js';
import { findTrigger } from './trigger.js';
import { measure } from './measurements.js';
import { AutoSet } from './autoset.js';
import { Plot } from './plot.js';
import { initControls, renderControls, showStatus, showMeasurements, showCaptureNote, showShape, showAcquisition } from './controls.js';
import { detectShape } from './shape.js';
import { initProbeGuide } from './probeGuide.js';
import { fitToScreen } from './fit.js';
import { RollBuffer, measureRoll } from './rollBuffer.js';
import { initTips } from './tips.js';
import { savePicture, saveCsv } from './exporter.js';
import { removeGlitches } from './glitchFilter.js';

const MEASUREMENT_UPDATE_MS = 250;      // readable numbers, fewer DOM updates
const WAIT_AFTER_MS = 300;              // Normal/Single: show WAIT when no trigger for this long
const PRE_TRIGGER = CAPTURE_LENGTH / 2; // hardware trigger lands mid-capture, so the screen can center on it

const plot = new Plot(document.getElementById('scope'));
const windowSeconds = () => TIME_PER_DIV[state.timePerDivIndex] * DIVS_X;
const captureSeconds = () => CAPTURE_LENGTH / effectiveRate(state.sampleRate); // real time, not nominal

const sources = {
  demo: new DemoAcquisitionSource(() => ({ demo: state.demo, sampleRate: effectiveRate(state.sampleRate) })),
  live: new WebSocketAcquisitionSource(),
};
let source = sources.demo;
let latest = null;        // newest sample block
let shown = null;         // block on screen (Normal/Single keep the last triggered one)
let latestMeas = null;
let hold = null;          // lowest/highest seen since Run
let captureError = null;  // text shown instead of a bad capture (wrong sample count)
const glitchTimes = [];   // when glitches were seen (last second), for the status line
let lastTrigAt = 0;
let lastShown = 0;
let lastConfig = '';
let lastRate = state.sampleRate;
const autoSet = new AutoSet(state);
const roll = new RollBuffer();

// Roll mode (like a bench scope): only at slow time/div, and only when one capture is much
// shorter than the screen. Faster settings draw the capture at its real width.
const ROLL_MIN_TIME_PER_DIV = 0.05; // 50 ms/div
const isRoll = () => !!latest
  && TIME_PER_DIV[state.timePerDivIndex] >= ROLL_MIN_TIME_PER_DIV
  && windowSeconds() > (2 * latest.samples.length) / latest.sampleRate;

/** Time/div that fills the screen with one capture at the current sample rate. */
const fitTimebase = () => { state.timePerDivIndex = stepAtMost(TIME_PER_DIV, captureSeconds() / DIVS_X); };

/**
 * Live data: find single-sample spikes (bad bus reads). Removes them when the filter is on; always counts them,
 * and logs the first one each second to the browser console (F12) with its ADC codes, to help debug the bus.
 */
let lastGlitchLog = 0;
function countGlitches(block) {
  const target = state.glitchFilter ? block.samples : Float32Array.from(block.samples);
  const fixed = removeGlitches(target);
  const now = performance.now();
  fixed.forEach(() => glitchTimes.push(now));
  if (fixed.length && block.raw && now - lastGlitchLog > 1000) {
    lastGlitchLog = now;
    const i = fixed[0], r = block.raw;
    const near = r[i > 0 ? i - 1 : i + 1];
    console.info(`[glitch] ${fixed.length} in capture #${block.sequence}; sample ${i}: code ${r[i]} next to ${near}`
      + ` (bits that differ: 0b${(r[i] ^ near).toString(2).padStart(12, '0')})`);
  }
}

/** Capture settings for the ESP32 → FPGA (docs/PROTOCOL.md "configure"). */
function captureConfig() {
  return {
    sampleRate: state.sampleRate,
    captureLength: CAPTURE_LENGTH,
    triggerEnabled: state.trigger.enabled,
    triggerRising: state.trigger.edge === 'rising',
    triggerLevel: voltsToCode(state.trigger.level),
    preTrigger: PRE_TRIGGER,
    postTrigger: CAPTURE_LENGTH - PRE_TRIGGER,
    auto: state.trigger.mode === 'auto', // Auto: free-run if no trigger arrives
  };
}

/** Send settings to the ESP32 whenever they change (it applies them before every capture). */
function syncConfig() {
  const config = captureConfig();
  const json = JSON.stringify(config);
  if (json === lastConfig) return;
  lastConfig = json;
  source.configure(config);
}

/** Trigger position in `block` for the current settings (−1 = none). */
function triggerIndex(block) {
  if (!state.trigger.enabled) return -1;
  if (block.hwTriggered) return PRE_TRIGGER; // the FPGA already put the trigger mid-capture
  const n = block.samples.length;
  const windowSamples = windowSeconds() * block.sampleRate;
  const half = windowSamples / 2;
  const hysteresis = VOLTS_PER_DIV[state.channels.CH1.voltsPerDivIndex] * 0.1;
  const [from, to] = n >= windowSamples ? [Math.ceil(half), Math.floor(n - half)] : [0, n];
  return findTrigger(block.samples, state.trigger.level, state.trigger.edge, from, to, hysteresis);
}

function handleBlock(block) {
  if (!state.running) return;
  // The FPGA always captures CAPTURE_LENGTH samples. Anything else is an error, never plotted.
  if (!block.simulated && block.samples.length !== CAPTURE_LENGTH) {
    captureError = `Capture error: got ${block.samples.length} samples, expected ${CAPTURE_LENGTH}.`
      + (block.samples.length === 32 ? ' The ESP32 is still running the old 32-sample test sketch.' : '');
    refreshReadouts();
    return;
  }
  captureError = null;
  if (!block.simulated) countGlitches(block);
  latest = block;
  latestMeas = measure(block.samples, block.sampleRate);
  if (latestMeas) {
    roll.push(performance.now() / 1000, latestMeas.min, latestMeas.max);
    hold = hold ? { min: Math.min(hold.min, latestMeas.min), max: Math.max(hold.max, latestMeas.max) }
      : { min: latestMeas.min, max: latestMeas.max };
  }
  if (autoSet.update(block, latestMeas)) changed();

  const free = !state.trigger.enabled;
  const triggered = free || triggerIndex(block) >= 0;
  if (triggered) lastTrigAt = performance.now();
  if (state.trigger.mode === 'auto' || triggered || isRoll()) shown = block;
  if (state.trigger.mode === 'single' && triggered && !isRoll() && !autoSet.active) {
    state.running = false;      // got the one capture: freeze it
    source.stop();
    changed();
  }

  const now = performance.now();
  if (now - lastShown > MEASUREMENT_UPDATE_MS) {
    refreshReadouts();
    guide.update(latestMeas, block.simulated);
    lastShown = now;
  }
}
Object.values(sources).forEach((s) => s.onSamples(handleBlock));
sources.live.onStatus(() => { if (source === sources.live) { showStatus(source.getStatus()); refreshReadouts(); } });

function refreshReadouts() {
  const roll_ = isRoll();
  const m = roll_ ? measureRoll(roll.window(roll.lastTime - windowSeconds())) : latestMeas;
  showMeasurements(captureError ? null : m, source.getStatus().simulated, hold, roll_);
  showCaptureNote(latest && !roll_ ? latest.samples.length / latest.sampleRate : null);
  const now = performance.now();
  while (glitchTimes.length && now - glitchTimes[0] > 1000) glitchTimes.shift();
  showAcquisition(source.getStatus(), latest, captureError, { perSecond: glitchTimes.length, filtering: state.glitchFilter });
  if (state.mode === 'live') {
    // Roll view: shape of what's on screen (one middle point per capture); otherwise the capture itself.
    const pts = roll_ ? roll.window(roll.lastTime - windowSeconds()).map((p) => (p.lo + p.hi) / 2) : latest?.samples;
    showShape(captureError ? null : detectShape(pts));
  }
}

async function setMode(mode) {
  if (mode === state.mode && source.getStatus().state !== 'disconnected') return;
  await source.disconnect();
  state.mode = mode;
  source = sources[mode];
  fitTimebase(); // start with one capture filling the screen
  latest = null;
  shown = null;
  latestMeas = null;
  hold = null;
  captureError = null;
  roll.clear();
  lastConfig = '';
  syncConfig();
  const ok = await source.connect();
  if (ok && state.running) source.start();
  showStatus(source.getStatus());
  guide.update(null, source.getStatus().simulated);
  changed();
}

function toggleRun() {
  state.running = !state.running;
  if (state.running) hold = null; // "highest/lowest seen" restarts with each Run
  state.running ? source.start() : source.stop();
  changed();
}

function setTriggerMode(mode) {
  state.trigger.mode = mode;
  if (mode !== 'single' && !state.running) toggleRun(); // leaving Single goes live again
  else changed();
}

function liveMessage(status) {
  if (status.state === 'connecting') return 'Connecting to WebScope…';
  if (status.state !== 'connected') return 'No signal: Live Mode not connected';
  if (status.fpga === false) return 'Connected, but the FPGA is not responding';
  if (status.fpgaState === 'waiting' || status.fpgaState === 'armed') return 'Waiting for trigger… (try Auto, or move the level into the wave)';
  return 'Connected. Waiting for data…';
}

function trigState(triggered) {
  if (!state.trigger.enabled) return 'FREE';
  if (state.trigger.mode === 'auto') return triggered ? "T'D" : 'AUTO';
  if (!state.running) return triggered ? "T'D" : '';
  return performance.now() - lastTrigAt > WAIT_AFTER_MS ? 'WAIT' : "T'D";
}

/** Work out which slice of the block to draw, aligned on the trigger. */
function buildView() {
  const ch = state.channels.CH1;
  const view = {
    voltsPerDiv: VOLTS_PER_DIV[ch.voltsPerDivIndex],
    timePerDiv: TIME_PER_DIV[state.timePerDivIndex],
    offset: ch.offset,
    color: ch.color,
    triggerLevel: state.trigger.level,
    triggerEdge: state.trigger.edge,
    triggerEnabled: state.trigger.enabled,
    running: state.running,
    cursors: state.cursors,
    acq: `${formatRate(effectiveRate(state.sampleRate))} · ${CAPTURE_LENGTH} pts · ${formatTime(captureSeconds())}`,
    samples: null,
    message: null,
  };

  if (captureError) { view.message = captureError; view.error = true; return view; }

  if (!shown) {
    view.message = state.mode === 'live' ? liveMessage(source.getStatus())
      : state.trigger.mode !== 'auto' && latest ? 'Waiting for trigger… (try Auto, or move the level into the wave)' : '';
    if (latest && state.trigger.mode !== 'auto') view.trigState = trigState(false);
    return view;
  }

  if (isRoll()) {
    // Newest point at the right edge; frozen at the last point while stopped.
    const now = state.running ? performance.now() / 1000 : roll.lastTime;
    view.roll = { now, span: windowSeconds(), points: roll.window(now - windowSeconds()) };
    view.trigState = 'ROLL';
    return view;
  }

  // The screen shows windowSamples samples' worth of time. Each sample is drawn at its real
  // time position, so a capture shorter than the screen only fills its true share of it.
  const n = shown.samples.length;
  const windowSamples = windowSeconds() * shown.sampleRate;
  const half = windowSamples / 2;
  const t = triggerIndex(shown);

  view.samples = shown.samples;
  view.windowSamples = windowSamples;
  view.triggered = t >= 0;
  view.trigState = trigState(t >= 0);
  view.start = t >= 0 ? t - half : (n - windowSamples) / 2; // sample index at the left edge (may be < 0)
  return view;
}

function frame() {
  plot.draw(buildView());
  requestAnimationFrame(frame);
}

initControls({
  onModeChange: setMode,
  onRunToggle: toggleRun,
  onAutoSet: () => {
    if (state.trigger.mode === 'single') state.trigger.mode = 'auto'; // Auto Set needs a running picture
    state.trigger.enabled = true;
    if (!state.running) toggleRun(); // Auto Set always runs, like a real scope
    hold = null;
    autoSet.start(latest?.sequence ?? 0);
    changed();
  },
  onTriggerMode: setTriggerMode,
  onHoldReset: () => { hold = null; refreshReadouts(); },
  onSavePng: () => savePicture(plot.canvas),
  onSaveCsv: () => saveCsv(shown),
  getMeasurement: () => latestMeas,
  plot,
});
onChange(() => {
  // A new sample rate changes how much time one capture covers: refit the time axis to it
  // (unless Auto Set is choosing both together) and drop data taken at the old rate.
  if (state.sampleRate !== lastRate) {
    lastRate = state.sampleRate;
    if (!autoSet.active) fitTimebase();
    roll.clear();
    hold = null;
  }
  syncConfig();
  renderControls();
  refreshReadouts();
});
const guide = initProbeGuide(document.getElementById('guideBtn'));
initTips(document.getElementById('tipsBtn'));
fitToScreen(() => requestAnimationFrame(() => plot.resize()));

state.mode = '';     // force the first setMode to connect
setMode('demo');
requestAnimationFrame(frame);
