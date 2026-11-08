// Setup guide: how to hook WebScope up (steps 1–4), then practice circuits with what you should see.
// Illustrations come from guideArt.js. Step 3 shows a live "signal found" check.
// Software can tell a signal is present; it can't tell where the probe is placed.

import { drawGuideArt } from './guideArt.js';

const SEEN_KEY = 'webscope.guideSeen';

export function initProbeGuide(openButton) {
  const dialog = document.getElementById('guide');
  const title = document.getElementById('guideTitle');
  const steps = [...dialog.querySelectorAll('.step')];
  const dots = dialog.querySelector('.dots');
  const prev = dialog.querySelector('[data-prev]');
  const next = dialog.querySelector('[data-next]');
  const check = document.getElementById('signalCheck');
  let index = 0;

  drawGuideArt(dialog);
  dots.innerHTML = steps.map(() => '<span></span>').join('');

  function show(i) {
    index = Math.min(steps.length - 1, Math.max(0, i));
    steps.forEach((s, n) => s.classList.toggle('active', n === index));
    [...dots.children].forEach((d, n) => d.classList.toggle('active', n === index));
    title.textContent = steps[index].dataset.part ?? 'Setup guide';
    prev.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
  }

  function open() { show(0); dialog.showModal(); }
  function close() {
    dialog.close();
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ }
  }

  openButton.addEventListener('click', open);
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => (index === steps.length - 1 ? close() : show(index + 1)));
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ } });

  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
  if (!seen) open();

  /** Called with the latest measurements so step 3 can go green. */
  return {
    update(m, simulated) {
      const found = !!m && (m.vpp > 0.05 || Math.abs(m.mean) > 0.05);
      check.classList.toggle('ok', found);
      check.querySelector('.text').textContent = found
        ? `Signal found${simulated ? ' (demo)' : ''} ✓`
        : 'Waiting for signal…';
    },
  };
}
