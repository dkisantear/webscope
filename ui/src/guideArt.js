// Illustrations for the setup guide (inline SVG, so they scale and need no image files).
// Based on the WebScope enclosure render: pink box, breadboard on the lid, two parts bins behind it,
// CH1 / CH2 / GND lead holes on the front right, DE10-Lite USB-B on the left wall, ESP32 USB on the right wall.
// Practice circuits are drawn top-down on that breadboard, with every wire going to a real, logical hole.

const C = {
  front: '#ec4899', top: '#f472b6', side: '#be185d', emboss: '#b0206e', bin: '#db2777',
  board: '#ebe8e2', hole: '#9a968d', gap: '#cfcac0', red: '#dc2626', blue: '#2563eb',
  ch1: '#facc15', gnd: '#1f1f24', text: '#e7e7ec', muted: '#8d8d99', hi: '#f5a524', note: '#1d1b17',
};

const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg"
  font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const text = (x, y, s, { size = 10, fill = C.text, anchor = 'start', weight = 600 } = {}) =>
  `<text x="${x}" y="${y}" fill="${fill}" stroke="none" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${s}</text>`;
const callout = (x1, y1, x2, y2, label, anchor = 'start') =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${C.text}" stroke-width="0.8" opacity="0.7"/><circle cx="${x1}" cy="${y1}" r="2" fill="${C.text}"/>`
  + text(x2 + (anchor === 'end' ? -3 : 3), y2 + 3, label, { anchor, size: 9.5 });

// ---------------------------------------------------------------------------------------------
// 1) The whole box, front three-quarter view (oblique). P(u, v): u = left→right, v = front→back.
// ---------------------------------------------------------------------------------------------
const P = (u, v) => [50 + 240 * u + 44 * v, 140 - 92 * v];
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
const quad = (u0, v0, u1, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
const HOLES = { CH1: 220, CH2: 244, GND: 268 }; // x of the front-panel holes, y = 174

function boxBase({ highlight } = {}) {
  let s = '';
  // Body: right side, top, front
  s += poly([[290, 140], [334, 48], [334, 113], [290, 205]], C.side);
  s += poly(quad(0, 0, 1, 1), C.top);
  s += `<rect x="50" y="140" width="240" height="65" fill="${C.front}"/>`;
  s += `<path d="M50 152H290L334 60" stroke="${C.side}" stroke-width="1.2"/>`; // lid split line
  // Bins behind the breadboard
  s += poly(quad(0.02, 0.58, 0.49, 0.96), C.bin) + poly(quad(0.51, 0.58, 0.98, 0.96), C.bin);
  // Breadboard flush in the lid
  s += poly(quad(0.02, 0.04, 0.98, 0.52), C.board);
  const line = (v, color, w = 1) => { const [a, b] = [P(0.04, v), P(0.96, v)]; return `<path d="M${a}L${b}" stroke="${color}" stroke-width="${w}"/>`; };
  s += line(0.08, C.blue) + line(0.13, C.red) + line(0.43, C.red) + line(0.48, C.blue) + line(0.285, C.gap, 2.5);
  for (const v of [0.17, 0.21, 0.25, 0.32, 0.36, 0.4]) {
    for (let u = 0.05; u < 0.96; u += 0.03) { const [x, y] = P(u, v); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.8" fill="${C.hole}"/>`; }
  }
  // Front: embossed logo + name
  s += `<g transform="translate(60 162) scale(1.4)"><path d="M1 11.2h7.6L11.2 1.5l2.4 21 2.1-10.6H23" stroke="${C.emboss}" stroke-width="1.3"/></g>`;
  s += `<text x="98" y="186" font-size="17" font-weight="800" fill="none" stroke="${C.emboss}" stroke-width="0.9">WebScope</text>`;
  // Lead panel: CH1 · CH2 · GND
  s += `<rect x="206" y="158" width="76" height="40" rx="4" stroke="${C.emboss}" stroke-width="1"/>`;
  for (const [name, x] of Object.entries(HOLES)) {
    const ring = highlight === name ? `stroke="${C.hi}" stroke-width="2.5"` : `stroke="${C.emboss}" stroke-width="1"`;
    s += `<rect x="${x - 4}" y="170" width="8" height="8" transform="rotate(45 ${x} 174)" fill="#5b1236" ${ring}/>`;
    s += `<path d="M${x} 163V167" stroke="#5b1236" stroke-width="1.6"/>`; // grip slot
    s += text(x, 193, name, { size: 8, fill: '#5b1236', anchor: 'middle', weight: 800 });
  }
  // ESP32 USB hole on the right wall
  s += poly([[307, 139], [317, 118], [317, 129], [307, 150]], '#3b0a22');
  return s;
}

// A lead from a front hole, up through the lid's comb notch, to a breadboard hole at P(u, v).
function boxLead(hole, u, v, color, opacity = 1) {
  const hx = HOLES[hole];
  const [tx, ty] = P(u, v);
  return `<g opacity="${opacity}">
    <path d="M${hx} 172C${hx - 26} 166 ${hx - 24} 144 ${hx - 2} 139L${tx} ${ty + 6}" stroke="${color}" stroke-width="3.2"/>
    <path d="M${hx} 172C${hx - 26} 166 ${hx - 24} 144 ${hx - 2} 139L${tx} ${ty + 6}" stroke="#000" stroke-width="0.6" opacity="0.35"/>
    <rect x="${tx - 2.5}" y="${ty - 3}" width="5" height="9" rx="1" fill="${color}" stroke="#000" stroke-width="0.5"/></g>`;
}

// ---------------------------------------------------------------------------------------------
// 2) Breadboard close-up, seen from above. Front edge (with the lead holes) at the bottom.
// ---------------------------------------------------------------------------------------------
const X = (c) => 92 + c * 9;                       // 29 columns: 0..28
const ROW = { J: 48, I: 57, H: 66, G: 75, F: 84, E: 112, D: 121, C: 130, B: 139, A: 148, '+': 166, '-': 175 };
const H = (c, r) => [X(c), ROW[r]];
const NOTCH = { CH1: 21, CH2: 24, GND: 27 };       // lead notches line up with these columns

function boardBase() {
  let s = `<rect x="70" y="6" width="288" height="198" rx="10" fill="${C.top}"/>`;
  s += `<rect x="78" y="14" width="272" height="178" rx="3" fill="${C.board}"/>`;
  s += `<rect x="82" y="94" width="264" height="8" fill="${C.gap}"/>`;
  const rail = (y, color) => `<path d="M84 ${y}H344" stroke="${color}" stroke-width="1.2"/>`;
  s += rail(20, C.blue) + rail(40, C.red) + rail(160, C.red) + rail(181, C.blue);
  s += text(74, 169, '+', { size: 9, fill: C.red, weight: 800 }) + text(74, 178, '−', { size: 9, fill: C.blue, weight: 800 });
  for (let c = 0; c <= 28; c++) {
    for (const r of Object.keys(ROW)) {
      if ((r === '+' || r === '-') && c % 6 === 5) continue; // rail holes come in groups of five
      const [x, y] = H(c, r);
      s += `<rect x="${x - 1.3}" y="${y - 1.3}" width="2.6" height="2.6" fill="${C.hole}"/>`;
    }
  }
  for (const r of ['J', 'F', 'E', 'A']) s += text(84, ROW[r] + 3, r, { size: 6, fill: C.muted, anchor: 'end' });
  // Front edge: lead comb notches + hole labels
  for (const [name, c] of Object.entries(NOTCH)) {
    s += `<rect x="${X(c) - 3}" y="197" width="6" height="7" rx="1" fill="#9d174d"/>`;
    s += text(X(c) + 5, 236, name, { size: 8, fill: C.muted, weight: 800 });
  }
  return s;
}

const plug = (x, y, color) => `<rect x="${x - 2.6}" y="${y - 1.5}" width="5.2" height="9" rx="1" fill="${color}" stroke="#000" stroke-width="0.5"/>`;

/** Scope lead from below the front edge, through its notch, into hole (c, r). */
function lead(name, c, r, color) {
  const xn = X(NOTCH[name]);
  const [x, y] = H(c, r);
  return `<path d="M${xn} 242V204C${xn} 190 ${x} ${y + 30} ${x} ${y + 6}" stroke="${color}" stroke-width="3.4"/>${plug(x, y, color)}`;
}

/** Breadboard jumper wire between two holes. */
function jumper(c1, r1, c2, r2, color) {
  const [x1, y1] = H(c1, r1), [x2, y2] = H(c2, r2);
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="3"/>`
    + `<circle cx="${x1}" cy="${y1}" r="1.8" fill="#555"/><circle cx="${x2}" cy="${y2}" r="1.8" fill="#555"/>`;
}

/** Wire coming in from an outside source (ADALM2000) on the left, into hole (c, r). */
function source(label, sub, ty, c, r, color) {
  const [x, y] = H(c, r);
  return `<rect x="2" y="${ty - 11}" width="64" height="22" rx="4" fill="#2a2a32"/>`
    + `<circle cx="11" cy="${ty}" r="3" fill="${color}"/>`
    + text(17, ty - 1, label, { size: 8, weight: 800 }) + text(17, ty + 8, sub, { size: 6, fill: C.muted })
    + `<path d="M64 ${ty}C78 ${ty} ${x - 14} ${y} ${x} ${y}" stroke="${color}" stroke-width="2.6"/>${plug(x, y - 3, color).replace('height="9"', 'height="6"')}`;
}

/** Resistor lying along row r from column c1 to c2. */
function resistor(c1, c2, r, label) {
  const [x1, y] = H(c1, r), [x2] = H(c2, r);
  const a = x1 + 6, b = x2 - 6, mid = (x1 + x2) / 2;
  return `<path d="M${x1} ${y}H${x2}" stroke="#8a8a8a" stroke-width="1.4"/>`
    + `<rect x="${a}" y="${y - 3.5}" width="${b - a}" height="7" rx="3" fill="#d6b48a" stroke="#8a6a44" stroke-width="0.6"/>`
    + [0.25, 0.42, 0.58].map((f, i) => `<rect x="${a + (b - a) * f - 1}" y="${y - 3.5}" width="2" height="7" fill="${['#8b4513', '#111', '#f97316'][i]}"/>`).join('')
    + text(mid, y + 12, label, { size: 7.5, fill: C.note, anchor: 'middle', weight: 800 });
}

/** Pushbutton straddling the centre gap: legs in columns c and c+2, rows E and F. */
function button(c) {
  const x1 = X(c) - 4, x2 = X(c + 2) + 4;
  return `<rect x="${x1}" y="${ROW.F - 4}" width="${x2 - x1}" height="${ROW.E - ROW.F + 8}" rx="2" fill="#2b2b31"/>`
    + `<circle cx="${(x1 + x2) / 2}" cy="${(ROW.E + ROW.F) / 2}" r="7" fill="#3b82f6" stroke="#1e40af"/>`
    + text((x1 + x2) / 2, ROW.F - 7, 'button', { size: 7.5, fill: C.note, anchor: 'middle', weight: 800 });
}

/** Highlight ring + label for the node being measured. */
const node = (c, r, label) => { const [x, y] = H(c, r); return `<circle cx="${x}" cy="${y}" r="6" stroke="${C.hi}" stroke-width="2"/>` + text(x + 9, y + 3, label, { size: 8, fill: '#9a5b00', weight: 800 }); };

export const ART = {
  power: svg(360, 230, `${boxBase()}
    <path d="M312 134C332 138 344 156 358 160" stroke="#9ca3af" stroke-width="4"/>
    <path d="M50 172C36 174 24 182 2 186" stroke="#9ca3af" stroke-width="4"/>
    ${callout(340, 154, 340, 222, 'ESP32 USB (right side)', 'end')}
    ${callout(20, 181, 8, 222, 'DE10-Lite USB-B (left side)')}
    ${text(180, 18, 'Plug in both USB cables', { size: 12, fill: C.hi, anchor: 'middle', weight: 800 })}`),

  // Both leads out of the box: GND to the − rail, CH1 to the point being measured.
  leads: svg(360, 230, `${boxBase({ highlight: 'CH1' })}
    ${boxLead('GND', 0.9, 0.08, C.gnd)}
    ${boxLead('CH1', 0.55, 0.21, C.ch1)}
    ${callout(...P(0.9, 0.08), 350, 34, '① GND → − rail', 'end')}
    ${callout(...P(0.55, 0.21), 150, 34, '② CH1 → resistor middle', 'end')}`),

  // Pushbutton + two 10 kΩ resistors → 0 V / 1.65 V.
  exButton: svg(360, 244, `${boardBase()}
    ${source('V+ 3.3 V', 'ADALM2000', 166, 2, '+', C.red)}
    ${source('GND', 'ADALM2000', 196, 3, '-', C.gnd)}
    ${jumper(8, '+', 8, 'A', C.red)}
    ${button(8)}
    ${resistor(10, 15, 'C', '10 kΩ')}
    ${resistor(15, 20, 'B', '10 kΩ')}
    ${jumper(20, 'A', 20, '-', C.gnd)}
    ${lead('CH1', 15, 'A', C.ch1)}
    ${lead('GND', 27, '-', C.gnd)}
    ${node(15, 'D', '0 V ↔ 1.65 V')}`),
};

/** Fill every <figure data-art="name"> inside root with its illustration. */
export function drawGuideArt(root) {
  root.querySelectorAll('[data-art]').forEach((fig) => { fig.innerHTML = ART[fig.dataset.art] ?? ''; });
}
