// ESP32 sample data → sample block the UI understands (volts). See docs/PROTOCOL.md.
// Accepts: binary block with the 16-byte header, raw uint16 binary after a capture_meta message,
// or a JSON "samples" message. Does not judge the sample count; main.js rejects captures that aren't CAPTURE_LENGTH samples.

import {
  BLOCK_MAGIC, BLOCK_VERSION, BLOCK_TYPE_SAMPLES, BLOCK_HEADER_BYTES, FLAG_OVERFLOW, FLAG_HW_TRIGGERED,
  ADC_BITS, codeToVolts, effectiveRate,
} from './protocol.js';

let jsonSequence = 0;

// The ESP32 reports the SELECTED rate; the time axis needs the REAL one (see protocol.js).
function makeBlock(raw, selectedRate, bits, sequence, flags) {
  const sampleRate = effectiveRate(selectedRate);
  const samples = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) samples[i] = codeToVolts(raw[i], bits);
  return {
    channel: 'CH1',
    sampleRate,
    selectedRate,
    sampleCount: raw.length,
    sequence,
    timestamp: Date.now(),
    format: 'volts',
    simulated: false,
    overflow: (flags & FLAG_OVERFLOW) !== 0,
    hwTriggered: (flags & FLAG_HW_TRIGGERED) !== 0,
    raw,
    samples,
  };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{sampleRate:number, sampleCount:number}|null} meta from a preceding capture_meta message
 * @returns {object|null} null if the message isn't a valid block
 */
export function decodeBlock(buffer, meta = null) {
  if (!(buffer instanceof ArrayBuffer)) return null;
  const v = new DataView(buffer);

  const hasHeader = buffer.byteLength >= BLOCK_HEADER_BYTES && v.getUint8(0) === BLOCK_MAGIC
    && v.getUint8(1) === BLOCK_VERSION && v.getUint8(2) === BLOCK_TYPE_SAMPLES;
  if (hasHeader) {
    const bits = v.getUint8(3) || ADC_BITS;
    const sequence = v.getUint32(4, true);
    const sampleRate = v.getUint32(8, true);
    const count = v.getUint16(12, true) || (buffer.byteLength - BLOCK_HEADER_BYTES) / 2; // fits in 16 bits
    const flags = v.getUint8(14);
    if (buffer.byteLength < BLOCK_HEADER_BYTES + count * 2 || !sampleRate) return null;
    const raw = new Uint16Array(count);
    for (let i = 0; i < count; i++) raw[i] = v.getUint16(BLOCK_HEADER_BYTES + i * 2, true);
    return makeBlock(raw, sampleRate, bits, sequence, flags);
  }

  // Raw little-endian uint16 samples, described by the last capture_meta message.
  if (!meta?.sampleRate || buffer.byteLength % 2) return null;
  const raw = new Uint16Array(buffer.byteLength / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = v.getUint16(i * 2, true);
  return makeBlock(raw, meta.sampleRate, ADC_BITS, jsonSequence++, 0);
}

/** JSON {"type":"samples","sampleRate":…,"samples":[codes]} → block, or null. */
export function decodeJsonSamples(msg) {
  if (!msg?.sampleRate || !Array.isArray(msg.samples)) return null;
  return makeBlock(Uint16Array.from(msg.samples), msg.sampleRate, ADC_BITS, jsonSequence++, msg.triggered ? FLAG_HW_TRIGGERED : 0);
}
