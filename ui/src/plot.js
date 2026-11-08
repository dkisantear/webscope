// Canvas waveform display, laid out like a bench scope:
//   top bar    — run state, trigger state, trigger readout
//   graticule  — grid + trace only (no text inside, so the wave never covers labels)
//   edges      — 0 V reference marker (left), trigger level (right), trigger position (top)
//   margins    — volts on the left, time along the bottom
//   bottom bar — channel scale and timebase readouts

import { DIVS_X, DIVS_Y, formatVolts, formatTime } from './scales.js';

const COLORS = {
  bg: '#000000',
  grid: 'rgba(255,255,255,0.08)',
  axis: 'rgba(255,255,255,0.24)',
  label: 'rgba(255,255,255,0.45)',
  text: '#d7dde6',
  muted: '#8d8d99',
  trigger: '#ff6b35',
  cursor: '#7dd3fc',
  run: '#4ade80',
  stop: '#f87171',
};

const M = { top: 24, bottom: 44, left: 62, right: 14 }; // space around the graticule
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export class Plot {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // Draw in layout units (w × h) but at the real on-screen resolution,
  // so the trace stays sharp when the instrument is scaled up or down (fit.js).
  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = (window.devicePixelRatio || 1) * (w ? rect.width / w : 1);
    this.w = w; this.h = h;
    this.screenScale = w ? rect.width / w : 1;
    this.canvas.width = Math.max(1, Math.round(w * ratio));
    this.canvas.height = Math.max(1, Math.round(h * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Graticule rectangle
    this.gx = M.left; this.gy = M.top;
    this.gw = Math.max(1, w - M.left - M.right);
    this.gh = Math.max(1, h - M.top - M.bottom);
  }

  /** On-screen pixels per vertical division (used for drag-to-move). */
  get screenPxPerDivY() { return (this.gh / DIVS_Y) * this.screenScale; }

  y(v, view) { return this.gy + this.gh / 2 - ((v + view.offset) / view.voltsPerDiv) * (this.gh / DIVS_Y); }

  draw(view) {
    const { ctx, w, h } = this;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    this.drawGrid();
    this.drawAxisLabels(view);
    this.drawTriggerLine(view);
    if (view.roll) this.drawRoll(view);
    else if (view.samples) { this.drawCaptureEdges(view); this.drawTrace(view); }
    this.drawCursors(view);
    this.drawMarkers(view);
    this.drawBars(view);
    if (view.message) this.drawMessage(view.message, view.error);
  }

  drawGrid() {
    const { ctx, gx, gy, gw, gh } = this;
    const dx = gw / DIVS_X, dy = gh / DIVS_Y;
    const px = (v) => Math.round(v) + 0.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (let i = 0; i <= DIVS_X; i++) { ctx.moveTo(px(gx + i * dx), gy); ctx.lineTo(px(gx + i * dx), gy + gh); }
    for (let j = 0; j <= DIVS_Y; j++) { ctx.moveTo(gx, px(gy + j * dy)); ctx.lineTo(gx + gw, px(gy + j * dy)); }
    ctx.stroke();

    // Center axes with minor ticks.
    const cx = gx + gw / 2, cy = gy + gh / 2;
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath();
    ctx.moveTo(gx, px(cy)); ctx.lineTo(gx + gw, px(cy));
    ctx.moveTo(px(cx), gy); ctx.lineTo(px(cx), gy + gh);
    for (let i = 0; i <= DIVS_X * 5; i++) { const x = gx + (i * dx) / 5; ctx.moveTo(x, cy - 3); ctx.lineTo(x, cy + 3); }
    for (let j = 0; j <= DIVS_Y * 5; j++) { const y = gy + (j * dy) / 5; ctx.moveTo(cx - 3, y); ctx.lineTo(cx + 3, y); }
    ctx.stroke();
  }

  // Labels live in the margins, outside the graticule.
  drawAxisLabels(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const dx = gw / DIVS_X, dy = gh / DIVS_Y;
    ctx.fillStyle = COLORS.label;
    ctx.font = `10px ${FONT}`;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let j = 0; j <= DIVS_Y; j += 2) {
      const volts = (DIVS_Y / 2 - j) * view.voltsPerDiv - view.offset;
      ctx.fillText(formatVolts(volts), gx - 14, gy + j * dy);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= DIVS_X; i += 2) {
      const divs = view.roll ? i - DIVS_X : i - DIVS_X / 2; // roll: 0 = now, at the right edge
      ctx.fillText(formatTime(divs * view.timePerDiv), gx + i * dx, gy + gh + 4);
    }
  }

  drawTrace(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const { samples, start, windowSamples: W, color } = view;
    const n = samples.length;
    if (n < 2 || !(W > 0)) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, gw, gh);
    ctx.clip(); // the wave never leaves the graticule
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    // Sample i sits at x = gx + (i - start) / W * gw (start can be negative or fractional).
    const perPx = W / gw;
    if (perPx <= 2) {
      const first = Math.max(0, Math.floor(start)), last = Math.min(n - 1, Math.ceil(start + W));
      for (let i = first; i <= last; i++) {
        const x = gx + ((i - start) / W) * gw;
        const y = this.y(samples[i], view);
        i === first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    } else {
      // More samples than pixels: draw min/max per column so peaks aren't lost.
      let begun = false;
      for (let c = 0; c < gw; c++) {
        const a = Math.max(0, Math.floor(start + c * perPx));
        const b = Math.min(n, Math.floor(start + (c + 1) * perPx));
        if (b <= a) continue; // no data in this column
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b; i++) { const v = samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        begun ? ctx.lineTo(gx + c, this.y(hi, view)) : ctx.moveTo(gx + c, this.y(hi, view));
        ctx.lineTo(gx + c, this.y(lo, view));
        begun = true;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Roll mode: one min/max bar per block, scrolling right to left.
  drawRoll(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const { now, span, points } = view.roll;
    if (!points.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, gw, gh);
    ctx.clip();
    ctx.strokeStyle = view.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, k) => {
      const x = gx + gw * (1 - (now - p.t) / span);
      k === 0 ? ctx.moveTo(x, this.y(p.hi, view)) : ctx.lineTo(x, this.y(p.hi, view));
      ctx.lineTo(x, this.y(p.lo, view));
    });
    ctx.stroke();
    ctx.restore();
  }

  // Faint dashed line at the trigger level, so beginners can see where the wave "locks on".
  drawTriggerLine(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const y = this.y(view.triggerLevel, view);
    if (view.triggerEnabled === false || y < gy || y > gy + gh) return;
    ctx.save();
    ctx.strokeStyle = COLORS.trigger;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(gx, Math.round(y) + 0.5); ctx.lineTo(gx + gw, Math.round(y) + 0.5); ctx.stroke();
    ctx.restore();
  }

  // When one capture is shorter than the screen, shade where there is no data and say so.
  drawCaptureEdges(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const { samples, start, windowSamples: W } = view;
    if (!(W > samples.length)) return;
    const x0 = Math.max(gx, gx + ((0 - start) / W) * gw);
    const x1 = Math.min(gx + gw, gx + ((samples.length - 1 - start) / W) * gw);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(gx, gy, x0 - gx, gh);
    ctx.fillRect(x1, gy, gx + gw - x1, gh);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, gy); ctx.lineTo(Math.round(x0) + 0.5, gy + gh);
    ctx.moveTo(Math.round(x1) + 0.5, gy); ctx.lineTo(Math.round(x1) + 0.5, gy + gh);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    if (gx + gw - x1 > 70) ctx.fillText('no data past here', x1 + 6, gy + gh - 6);
    ctx.restore();
  }

  drawCursors(view) {
    const c = view.cursors;
    if (!c || c.mode === 'off') return;
    const { ctx, gx, gy, gw, gh } = this;
    ctx.save();
    ctx.strokeStyle = COLORS.cursor;
    ctx.fillStyle = COLORS.cursor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.font = `700 10px ${FONT}`;
    const pairs = c.mode === 'time' ? [['t1', '1'], ['t2', '2']] : [['v1', '1'], ['v2', '2']];
    for (const [key, label] of pairs) {
      ctx.beginPath();
      if (c.mode === 'time') {
        const x = Math.round(gx + (c[key] / DIVS_X) * gw) + 0.5;
        ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`C${label}`, x + 4, gy + 4);
      } else {
        const y = Math.round(this.y(c[key], view)) + 0.5;
        if (y < gy || y > gy + gh) continue;
        ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`C${label}`, gx + 4, y - 2);
      }
    }
    ctx.restore();
  }

  drawMarkers(view) {
    const { ctx, gx, gy, gw, gh } = this;
    const clampY = (y) => Math.min(gy + gh, Math.max(gy, y));

    // Channel reference (0 V) — in the left margin, pointing at the graticule.
    const y0 = clampY(this.y(0, view));
    ctx.fillStyle = view.color;
    ctx.beginPath(); ctx.moveTo(gx - 11, y0 - 6); ctx.lineTo(gx - 1, y0); ctx.lineTo(gx - 11, y0 + 6); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold 8px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('1', gx - 8, y0 + 0.5);

    // Trigger level — right margin. Trigger position — above the graticule.
    const yt = clampY(this.y(view.triggerLevel, view));
    ctx.fillStyle = COLORS.trigger;
    ctx.beginPath(); ctx.moveTo(gx + gw + 11, yt - 6); ctx.lineTo(gx + gw + 1, yt); ctx.lineTo(gx + gw + 11, yt + 6); ctx.fill();
    if (!view.roll) { // no trigger point in roll mode
      const cx = gx + gw / 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, gy - 9); ctx.lineTo(cx + 6, gy - 9); ctx.lineTo(cx, gy - 1); ctx.fill();
    }
  }

  drawBars(view) {
    const { ctx, w, h, gx, gw } = this;
    ctx.font = `600 11px ${FONT}`;
    ctx.textBaseline = 'middle';

    // Top bar: status + trigger readout.
    const ty = M.top / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = view.running ? COLORS.run : COLORS.stop;
    ctx.fillText(view.running ? 'RUN' : 'STOP', gx, ty);
    if (view.trigState) {
      ctx.fillStyle = view.trigState === 'WAIT' ? COLORS.trigger : COLORS.text;
      ctx.fillText(view.trigState, gx + 40, ty);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.trigger;
    ctx.fillText(view.triggerEnabled === false ? 'T  OFF (free run)'
      : `T  CH1 ${view.triggerEdge === 'falling' ? '↓' : '↑'} ${formatVolts(view.triggerLevel)}`, gx + gw, ty);
    if (view.acq) { // sample rate · sample count · capture duration
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(view.acq, gx + gw / 2, ty);
    }

    // Bottom bar: channel readout + timebase readout.
    const by = h - 10;
    ctx.textAlign = 'left';
    ctx.fillStyle = view.color;
    ctx.fillRect(gx, by - 7, 26, 14);
    ctx.fillStyle = '#000';
    ctx.fillText('CH1', gx + 3, by + 0.5);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${formatVolts(view.voltsPerDiv)}/div`, gx + 32, by);
    ctx.textAlign = 'right';
    ctx.fillText(`H  ${formatTime(view.timePerDiv)}/div`, w - M.right, by);
  }

  drawMessage(text, isError = false) {
    const { ctx, gx, gy, gw, gh } = this;
    ctx.font = `600 ${isError ? 13 : 15}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isError ? COLORS.stop : COLORS.text;
    // Wrap long messages onto two lines so they stay inside the screen.
    const words = text.split(' ');
    const lines = [''];
    for (const w of words) {
      const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
      if (ctx.measureText(next).width > gw - 40 && lines[lines.length - 1]) lines.push(w);
      else lines[lines.length - 1] = next;
    }
    lines.forEach((l, k) => ctx.fillText(l, gx + gw / 2, gy + gh / 2 - 22 + (k - (lines.length - 1) / 2) * 20));
  }

}
