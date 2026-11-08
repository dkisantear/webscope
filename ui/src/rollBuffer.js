// Roll mode history: one {time, min, max} point per incoming block.
// Used when the screen spans much more time than a single block (slow events like a button press).

export class RollBuffer {
  constructor(capacity = 6000) {
    this.capacity = capacity;
    this.t = new Float64Array(capacity);
    this.lo = new Float32Array(capacity);
    this.hi = new Float32Array(capacity);
    this.clear();
  }

  clear() { this.start = 0; this.length = 0; this.lastTime = 0; }

  push(time, min, max) {
    const i = (this.start + this.length) % this.capacity;
    this.t[i] = time; this.lo[i] = min; this.hi[i] = max;
    if (this.length < this.capacity) this.length++;
    else this.start = (this.start + 1) % this.capacity; // drop the oldest
    this.lastTime = time;
  }

  /** Points newer than `since`, oldest first. */
  window(since) {
    const out = [];
    for (let k = 0; k < this.length; k++) {
      const i = (this.start + k) % this.capacity;
      if (this.t[i] >= since) out.push({ t: this.t[i], lo: this.lo[i], hi: this.hi[i] });
    }
    return out;
  }
}

/** Max / min / peak-to-peak / mean over the visible roll window (no frequency). */
export function measureRoll(points) {
  if (points.length < 2) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const p of points) {
    if (p.lo < min) min = p.lo;
    if (p.hi > max) max = p.hi;
    sum += (p.lo + p.hi) / 2;
  }
  const mean = sum / points.length;
  return { min, max, vpp: max - min, mean, rms: null, frequency: null, period: null, kind: 'roll' };
}
