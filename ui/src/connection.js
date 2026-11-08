// WebSocketAcquisitionSource: Live Mode. Connects to the ESP32, sends capture settings, receives sample blocks.
// Address: ?esp=<ip> if given; otherwise the host that served this page. A page served from the
// laptop itself (localhost) talks to the ESP32's own network address. Reconnects automatically.
// Messages: docs/PROTOCOL.md ("ESP32 ↔ Browser").

import { WS_PORT } from './protocol.js';
import { decodeBlock, decodeJsonSamples } from './frameDecoder.js';

const RETRY_MS = 2000;
const ESP32_AP_ADDRESS = '192.168.4.1';                  // ESP32's own "WebScope" Wi-Fi network
const LAPTOP_HOSTS = ['', 'localhost', '127.0.0.1', '[::1]'];

export class WebSocketAcquisitionSource {
  constructor() {
    this.callback = null;
    this.statusCallback = null;
    this.ws = null;
    this.state = 'disconnected';  // disconnected | connecting | connected | unavailable
    this.fpga = null;             // true/false once the ESP32 reports it
    this.fpgaState = null;        // idle | armed | reading | done | waiting | timeout | error
    this.config = null;           // last "configure" message, re-sent on every (re)connect and start
    this.meta = null;             // last capture_meta (for headerless binary samples)
    this.active = false;
    this.wantRun = false;
    this.retryTimer = null;
  }

  url() {
    const params = new URLSearchParams(location.search);
    const h = location.hostname;
    // Page from the laptop (localhost, or the laptop's address on the WebScope Wi-Fi) → the ESP32 is 192.168.4.1.
    const onLaptop = LAPTOP_HOSTS.includes(h) || h.startsWith('192.168.4.');
    const host = params.get('esp') || (onLaptop ? ESP32_AP_ADDRESS : h);
    return `ws://${host}:${WS_PORT}/`;
  }

  async connect() {
    this.active = true;
    this.open();
    return true;
  }

  open() {
    clearTimeout(this.retryTimer);
    this.setState('connecting');
    let ws;
    try { ws = new WebSocket(this.url()); } catch { this.retry(); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.setState('connected');
      if (this.config) this.send(this.config);           // settings first, then start
      this.send({ type: this.wantRun ? 'capture_start' : 'capture_abort' });
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => {
      this.ws = null;
      this.fpga = null;
      this.fpgaState = null;
      if (this.active) { this.setState('unavailable'); this.retry(); }
    };
    this.ws = ws;
  }

  retry() { this.retryTimer = setTimeout(() => this.active && this.open(), RETRY_MS); }

  async disconnect() {
    this.active = false;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  /** Capture settings (PROTOCOL.md "configure"). Sent now and again before every start. */
  configure(config) {
    this.config = { type: 'configure', ...config };
    this.send(this.config);
  }

  start() {
    this.wantRun = true;
    if (this.config) this.send(this.config);
    this.send({ type: 'capture_start' });
  }

  stop() { this.wantRun = false; this.send({ type: 'capture_abort' }); }
  send(obj) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

  onSamples(callback) { this.callback = callback; }
  onStatus(callback) { this.statusCallback = callback; }

  setState(state) { this.state = state; this.statusCallback?.(); }

  receive(data) {
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; } // ignore malformed text
      if (msg.evt === 'status' || msg.type === 'status') {
        this.fpga = msg.fpga ?? this.fpga;
        this.fpgaState = msg.state ?? this.fpgaState;
        this.statusCallback?.();
      } else if (msg.type === 'capture_meta') {
        this.meta = { sampleRate: msg.sampleRate, sampleCount: msg.sampleCount };
      } else if (msg.type === 'samples') {
        const block = decodeJsonSamples(msg);
        if (block) this.callback?.(block);
      }
      return;
    }
    const block = decodeBlock(data, this.meta);
    if (block) this.callback?.(block);
  }

  getStatus() {
    const labels = {
      connected: this.fpga === false ? 'Live · FPGA not responding' : 'Live · connected',
      connecting: 'Live · connecting…',
      unavailable: 'Live · no hardware connected',
      disconnected: 'Live · disconnected',
    };
    return { state: this.state, simulated: false, fpga: this.fpga, fpgaState: this.fpgaState, label: labels[this.state] };
  }
}
