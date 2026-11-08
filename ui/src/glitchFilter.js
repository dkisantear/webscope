// Glitch filter for Live data: removes single-sample spikes, the signature of a sample read wrong on the
// FPGA → ESP32 parallel bus (one flipped bit), while leaving real signal changes alone.
// A sample counts as a glitch only when its two neighbours agree with each other and it jumps away from both.
// A real edge (button press) changes level and stays there, so it is never touched.

const JUMP_V = 0.1;   // a glitch sticks out at least this far from its neighbours (~160 ADC codes)
const AGREE_V = 0.05; // ...while the two neighbours are within this of each other

/**
 * Fix glitches in place.
 * @param {Float32Array} s volts
 * @returns {number[]} indices that were replaced
 */
export function removeGlitches(s) {
  const fixed = [];
  const n = s.length;
  if (n < 3) return fixed;
  const isGlitch = (v, a, b) => Math.abs(a - b) <= AGREE_V && Math.abs(v - (a + b) / 2) >= JUMP_V;

  // Ends: compare with the next two samples.
  if (isGlitch(s[0], s[1], s[2])) { s[0] = s[1]; fixed.push(0); }
  for (let i = 1; i < n - 1; i++) {
    if (isGlitch(s[i], s[i - 1], s[i + 1])) { s[i] = (s[i - 1] + s[i + 1]) / 2; fixed.push(i); }
  }
  if (isGlitch(s[n - 1], s[n - 2], s[n - 3])) { s[n - 1] = s[n - 2]; fixed.push(n - 1); }
  return fixed;
}
