// Browser-side (software) trigger. Later the FPGA will do this in hardware.

/**
 * Find the first edge crossing `level` in samples[from..to).
 * Hysteresis stops noise from firing the trigger twice.
 * @returns {number} sample index, or -1 if no edge was found
 */
export function findTrigger(samples, level, edge, from, to, hysteresis) {
  let armed = false;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
    const v = samples[i];
    if (edge === 'rising') {
      if (v < level - hysteresis) armed = true;
      else if (armed && v >= level) return i;
    } else {
      if (v > level + hysteresis) armed = true;
      else if (armed && v <= level) return i;
    }
  }
  return -1;
}
