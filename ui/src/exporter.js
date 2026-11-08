// Save buttons: screen picture (PNG) and raw samples (CSV).

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function savePicture(canvas) {
  canvas.toBlob((blob) => blob && download(blob, `webscope-${stamp()}.png`), 'image/png');
}

/** @param {{samples: Float32Array, sampleRate: number, simulated?: boolean}|null} block */
export function saveCsv(block) {
  if (!block) return false;
  const lines = [`# WebScope ${block.simulated ? 'demo' : 'live'} capture, ${block.sampleRate} samples/s`, 'time_s,volts'];
  for (let i = 0; i < block.samples.length; i++) {
    lines.push(`${(i / block.sampleRate).toExponential(6)},${block.samples[i].toFixed(5)}`);
  }
  download(new Blob([lines.join('\n')], { type: 'text/csv' }), `webscope-${stamp()}.csv`);
  return true;
}
