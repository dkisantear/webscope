// Connects sliders/buttons to state, and shows measurements + status.

import { state, changed } from './state.js';
import { VOLTS_PER_DIV, TIME_PER_DIV, DIVS_X, formatVolts, formatTime, formatFreq, formatRate, nearestStep } from './scales.js';
import { SAMPLE_RATES, CAPTURE_LENGTH, effectiveRate } from './protocol.js';
import { MIN_POINTS_PER_CYCLE } from './measurements.js';
import { Slider } from './slider.js';
import { pickCursor, moveCursor, cursorReadout, placeVoltCursors } from './cursors.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sliders = {};
const PINCH_STEP_RATIO = 1.4;   // fingers 40% further apart = one zoom step
const PINCH_MIN_PX = 30;        // ignore tiny finger spans (avoids huge jumps)
const WHEEL_PX_PER_STEP = 40;   // trackpad pinch / Ctrl + scroll distance per zoom step

/**
 * @param {{onModeChange, onRunToggle, onAutoSet, onTriggerMode, onHoldReset, onSavePng, onSaveCsv,
 *          getMeasurement: () => object|null, plot}} hooks
 */
export function initControls(hooks) {
  const { onModeChange, onRunToggle, onAutoSet, plot } = hooks;
  const ch = state.channels.CH1;
  const d = state.demo;
  const set = (fn) => (v) => { fn(v); changed(); };

  // Mode + acquisition
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => onModeChange(b.dataset.mode)));
  $('runBtn').addEventListener('click', onRunToggle);
  $('autoBtn').addEventListener('click', onAutoSet);

  // Panel tabs
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { state.tab = b.dataset.tab; changed(); }));

  // Sliders. Stepped sliders (V/div, time/div) move through an index into the step table.
  sliders.vdiv = new Slider($('sVdiv'), {
    label: 'Volts/div', min: 0, max: VOLTS_PER_DIV.length - 1, step: 1, value: ch.voltsPerDivIndex,
    format: (i) => formatVolts(VOLTS_PER_DIV[i]), onChange: set((i) => { ch.voltsPerDivIndex = i; }), color: '#f5c518',
    fromReal: (v) => nearestStep(VOLTS_PER_DIV, v),
    tip: 'Volts/div|Vertical zoom: how many volts each grid square is tall. Smaller = taller wave.|Tap the number to type a value.',
  });
  sliders.pos = new Slider($('sPos'), {
    label: 'Position', min: -2.5, max: 2.5, step: 0.05, value: ch.offset,
    format: formatVolts, onChange: set((v) => { ch.offset = v; }), color: '#f5c518',
    tip: 'Position|Moves the wave up or down on screen. It does not change the signal. You can also drag the screen.',
  });
  sliders.tdiv = new Slider($('sTdiv'), {
    label: 'Time/div', min: 0, max: TIME_PER_DIV.length - 1, step: 1, value: state.timePerDivIndex,
    format: (i) => formatTime(TIME_PER_DIV[i]), onChange: set((i) => { state.timePerDivIndex = i; }), color: '#e7e7ec',
    fromReal: (v) => nearestStep(TIME_PER_DIV, v),
    tip: 'Time/div|Horizontal zoom: how much time each grid square covers. Smaller = see faster detail, bigger = see more cycles.',
  });
  sliders.trig = new Slider($('sTrig'), {
    label: 'Level', min: 0, max: 2.5, step: 0.05, value: state.trigger.level,
    format: formatVolts, onChange: set((v) => { state.trigger.level = v; }), color: '#ff6b35',
    tip: 'Trigger level|The voltage where the picture locks on, so the wave stands still. Keep it inside the wave (the dashed orange line).',
  });
  sliders.freq = new Slider($('sFreq'), {
    label: 'Frequency', min: 1, max: 5, step: 0.05, value: Math.log10(d.frequency),
    format: (v) => formatFreq(10 ** v), onChange: set((v) => { d.frequency = 10 ** v; }),
    fromReal: (hz) => Math.log10(hz), tip: 'Frequency|How many times per second the test wave repeats.',
  });
  sliders.amp = new Slider($('sAmp'), {
    label: 'Amplitude', min: 0, max: 1.25, step: 0.05, value: d.amplitude, format: formatVolts, onChange: set((v) => { d.amplitude = v; }),
    tip: 'Amplitude|How tall the test wave is, from its center to its peak.',
  });
  sliders.off = new Slider($('sOff'), {
    label: 'Offset', min: 0, max: 2.5, step: 0.05, value: d.offset, format: formatVolts, onChange: set((v) => { d.offset = v; }),
    tip: 'Offset|Shifts the whole test wave up or down by adding a steady (DC) voltage.',
  });
  sliders.noise = new Slider($('sNoise'), {
    label: 'Noise', min: 0, max: 0.5, step: 0.01, value: d.noise, format: formatVolts, onChange: set((v) => { d.noise = v; }),
    tip: 'Noise|Adds random fuzz, like real-world interference.',
  });

  // Sample rate: only the rates the FPGA supports.
  const rateSel = $('rateSel');
  // Labels show the FPGA setting; readings and the capture time below use the real rate (protocol.js).
  rateSel.innerHTML = SAMPLE_RATES.map((r) => `<option value="${r}">${formatRate(r)}</option>`).join('');
  rateSel.addEventListener('change', () => { state.sampleRate = Number(rateSel.value); changed(); });
  $('trigEnable').addEventListener('change', (e) => { state.trigger.enabled = e.target.checked; changed(); });
  $('glitchEnable').addEventListener('change', (e) => { state.glitchFilter = e.target.checked; changed(); });

  document.querySelectorAll('[data-edge]').forEach((b) =>
    b.addEventListener('click', () => { state.trigger.edge = b.dataset.edge; changed(); }));
  document.querySelectorAll('[data-tmode]').forEach((b) =>
    b.addEventListener('click', () => hooks.onTriggerMode(b.dataset.tmode)));
  document.querySelectorAll('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => { if (state.mode === 'demo') { d.shape = b.dataset.shape; changed(); } }));
  document.querySelectorAll('[data-cursor]').forEach((b) =>
    b.addEventListener('click', () => {
      const mode = b.dataset.cursor;
      if (mode === 'volts' && state.cursors.mode !== 'volts') placeVoltCursors(hooks.getMeasurement());
      state.cursors.mode = mode;
      changed();
    }));

  $('holdReset').addEventListener('click', hooks.onHoldReset);
  $('savePng').addEventListener('click', hooks.onSavePng);
  $('saveCsv').addEventListener('click', hooks.onSaveCsv);

  // Screen gestures:
  //   one finger / mouse drag — grab a cursor if one is under it, otherwise move the wave up/down
  //   two-finger pinch        — sideways = Time/div, up-down = Volts/div (spread = zoom in)
  //   trackpad pinch / Ctrl + scroll — Time/div
  const canvas = plot.canvas;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / plot.screenScale, y: (e.clientY - r.top) / plot.screenScale };
  };
  const fingers = new Map(); // pointerId → {x, y} in screen px
  let drag = null;
  let pinch = null;

  const pinchSpan = () => {
    const [a, b] = [...fingers.values()];
    return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y) };
  };
  const zoomStep = (axis, startIndex, steps) => {
    if (axis === 'time') state.timePerDivIndex = clamp(startIndex - steps, 0, TIME_PER_DIV.length - 1);
    else ch.voltsPerDivIndex = clamp(startIndex - steps, 0, VOLTS_PER_DIV.length - 1);
  };

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      const { dx, dy } = pinchSpan();
      const axis = dx >= dy ? 'time' : 'volts';
      pinch = { axis, start: Math.max(PINCH_MIN_PX, axis === 'time' ? dx : dy),
        index: axis === 'time' ? state.timePerDivIndex : ch.voltsPerDivIndex };
      drag = null;
      return;
    }
    if (fingers.size > 2) return;
    const p = local(e);
    drag = { cursor: pickCursor(plot, p.x, p.y), y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && fingers.size === 2) {
      const { dx, dy } = pinchSpan();
      const span = Math.max(PINCH_MIN_PX, pinch.axis === 'time' ? dx : dy);
      const steps = Math.round(Math.log(span / pinch.start) / Math.log(PINCH_STEP_RATIO));
      zoomStep(pinch.axis, pinch.index, steps);
      changed();
      return;
    }
    if (!drag) {
      const p = local(e);
      canvas.style.cursor = pickCursor(plot, p.x, p.y) ? (state.cursors.mode === 'time' ? 'ew-resize' : 'ns-resize') : '';
      return;
    }
    if (drag.cursor) {
      const p = local(e);
      moveCursor(plot, drag.cursor, p.x, p.y);
    } else {
      const divs = (drag.y - e.clientY) / plot.screenPxPerDivY; // screen px, so scaling doesn't matter
      ch.offset = clamp(ch.offset + divs * VOLTS_PER_DIV[ch.voltsPerDivIndex], -2.5, 2.5);
      drag.y = e.clientY;
    }
    changed();
  });
  const endDrag = (e) => {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
    drag = null; // lifting one finger of a pinch must not turn into a drag
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Laptop trackpad pinch arrives as Ctrl + wheel; Ctrl + mouse wheel works the same way.
  let wheelCarry = 0;
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); // stop the browser zooming the whole page
    wheelCarry += e.deltaY;
    const steps = Math.trunc(wheelCarry / WHEEL_PX_PER_STEP);
    if (!steps) return;
    wheelCarry -= steps * WHEEL_PX_PER_STEP;
    zoomStep('time', state.timePerDivIndex, -steps); // pinch out (deltaY < 0) = zoom in
    changed();
  }, { passive: false });
}

/** Reflect state in the controls (after Auto Set, drag, mode change...). */
export function renderControls() {
  const ch = state.channels.CH1;
  sliders.vdiv.set(ch.voltsPerDivIndex);
  sliders.pos.set(ch.offset);
  sliders.tdiv.set(state.timePerDivIndex);
  sliders.trig.set(state.trigger.level);

  const toggle = (sel, attr, value) => document.querySelectorAll(sel).forEach((b) => b.classList.toggle('active', b.dataset[attr] === value));
  toggle('[data-edge]', 'edge', state.trigger.edge);
  $('rateSel').value = String(state.sampleRate);
  $('acqLen').textContent = `${CAPTURE_LENGTH} samples (fixed)`;
  $('acqDur').textContent = `${formatTime(CAPTURE_LENGTH / effectiveRate(state.sampleRate))} per capture`;
  $('trigEnable').checked = state.trigger.enabled;
  $('glitchEnable').checked = state.glitchFilter;
  $('glitchSwitch').hidden = state.mode !== 'live';
  document.querySelectorAll('[data-edge], [data-tmode]').forEach((b) => { b.disabled = !state.trigger.enabled && !b.dataset.tmode; });
  toggle('[data-tmode]', 'tmode', state.trigger.mode);
  toggle('[data-mode]', 'mode', state.mode);
  toggle('[data-cursor]', 'cursor', state.cursors.mode);

  renderShapes();
  toggle('[data-tab]', 'tab', state.tab);
  document.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== state.tab; });

  const run = $('runBtn');
  const single = state.trigger.mode === 'single';
  run.textContent = state.running ? 'Stop' : single ? 'Arm' : 'Run';
  run.classList.toggle('stopped', !state.running);
}

let liveShape = null; // shape detected in the live signal

/**
 * Waveform buttons. Demo: you pick the test wave. Live: WebScope lights up the shape it detects
 * (buttons are read-only, test-wave sliders hidden).
 */
function renderShapes() {
  const live = state.mode !== 'demo';
  const active = live ? liveShape : state.demo.shape;
  document.querySelectorAll('[data-shape]').forEach((b) => {
    b.classList.toggle('active', b.dataset.shape === active);
    b.classList.toggle('readonly', live);
  });
  $('shapeTitle').textContent = live ? 'Wave shape' : 'Test waveform';
  $('shapeTag').textContent = live ? 'DETECTED' : 'DEMO';
  $('shapeNote').hidden = !live;
  $('demoSliders').hidden = live;
}

/** Live mode: show the detected shape ('sine' | 'square' | 'triangle' | 'pulse' | null). */
export function showShape(shape) {
  if (shape === liveShape) return;
  liveShape = shape;
  renderShapes();
}

export function showStatus(status) {
  $('runBtn').disabled = !status.simulated && status.state !== 'connected';
  $('autoBtn').disabled = $('runBtn').disabled;
}

/**
 * Horizontal note: when one capture covers less time than the screen, say so plainly.
 * @param {number|null} captureSeconds time covered by one capture (null = fills the screen)
 */
export function showCaptureNote(captureSeconds) {
  const note = $('captureNote');
  const windowSeconds = TIME_PER_DIV[state.timePerDivIndex] * DIVS_X;
  const short = captureSeconds != null && windowSeconds > captureSeconds * 1.05;
  note.hidden = !short;
  if (short) {
    note.textContent = `One capture = ${formatTime(captureSeconds)}. To see more time, pick a lower sample rate.`;
  }
}

const FPGA_STATES = {
  idle: 'idle', armed: 'armed, waiting for trigger', reading: 'reading samples', done: 'capture done',
  waiting: 'waiting for trigger', timeout: 'capture timed out', error: 'error',
};

/** Connection state + FPGA capture status line (Horizontal group). */
export function showAcquisition(status, block, error, glitches = null) {
  const el = $('acqStatus');
  let text, cls = '';
  if (status.simulated) text = `Demo · simulated ${CAPTURE_LENGTH}-sample captures`;
  else if (status.state !== 'connected') { text = status.label; cls = 'bad'; }
  else if (status.fpga === false) { text = 'Connected · FPGA not responding'; cls = 'bad'; }
  else {
    text = `Connected · FPGA ${FPGA_STATES[status.fpgaState] ?? 'ready'}`;
    if (block && !error) text += ` · ${block.sampleCount} samples @ ${formatRate(block.sampleRate)}`;
    if (glitches?.perSecond) text += ` · ${glitches.perSecond} glitch${glitches.perSecond === 1 ? '' : 'es'}/s ${glitches.filtering ? 'removed' : 'shown'}`;
    cls = status.fpgaState === 'timeout' || status.fpgaState === 'error' ? 'bad' : 'ok';
  }
  if (error) { text = error; cls = 'bad'; }
  el.textContent = text;
  el.className = `acq-info ${cls}`;
}

/** Measurement strip, Measure tab and plain-English summary. Never shows fake numbers in Live Mode. */
export function showMeasurements(m, simulated, hold, roll) {
  const set = (id, text) => { $(id).textContent = text; };
  const v = (x) => (m && x != null ? formatVolts(x) : '—');
  const t = (x) => (m?.[x] ? formatTime(m[x]) : '—');
  set('m-vpp', v(m?.vpp)); set('m-rms', v(m?.rms)); set('m-max', v(m?.max));
  set('m-min', v(m?.min)); set('m-mean', v(m?.mean));
  set('m-freq', m?.frequency ? formatFreq(m.frequency) : '—');
  set('m-period', t('period'));
  set('m-duty', m?.duty != null ? `${(m.duty * 100).toFixed(1)} %` : '—');
  set('m-width', t('widthHigh'));
  set('m-rise', t('rise'));
  set('m-fall', t('fall'));
  set('m-hmax', hold ? formatVolts(hold.max) : '—');
  set('m-hmin', hold ? formatVolts(hold.min) : '—');

  const c = cursorReadout(roll);
  $('cursorReadout').hidden = !c;
  if (c) {
    set('c-l1', c.l1); set('c-1', c.v1); set('c-l2', c.l2); set('c-2', c.v2); set('c-d', c.d);
    $('c-frow').hidden = c.f == null;
    if (c.f != null) set('c-f', c.f);
  }

  let text;
  if (!m) text = simulated ? 'Waiting for signal…' : 'No live data yet.';
  else if (m.kind === 'roll') text = `Roll mode: ${formatVolts(m.min)} to ${formatVolts(m.max)} over the last ${formatTime(TIME_PER_DIV[state.timePerDivIndex] * DIVS_X)}.`;
  else if (m.kind === 'dc') text = `Steady DC level of ${formatVolts(m.mean)}.`;
  else if (m.frequency) {
    text = `About ${formatFreq(m.frequency)}, ${formatVolts(m.vpp)} peak-to-peak.`;
    if (m.pointsPerCycle < MIN_POINTS_PER_CYCLE) {
      text += ` Only ${Math.round(m.pointsPerCycle)} samples per cycle: raise the sample rate for accurate Pk-Pk, duty and rise time.`;
    }
  }
  else if (m.kind === 'unstable') text = `Signal of ${formatVolts(m.vpp)} peak-to-peak, but no steady frequency.`;
  else text = `Signal of ${formatVolts(m.vpp)} peak-to-peak. Press Auto Set to find the frequency.`;
  set('summary', text);
}
