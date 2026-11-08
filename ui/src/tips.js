// Optional "Tips" mode: when on, hovering (or tapping) anything with data-tip
// shows a short plain-English explanation.
// data-tip format: "Title|What it does|Ex: example" (example optional).

export function initTips(toggleButton) {
  const bubble = document.createElement('div');
  bubble.className = 'tip';
  bubble.hidden = true;
  document.body.append(bubble);
  let on = false;

  const hide = () => { bubble.hidden = true; };

  function show(target) {
    const [title, body, example] = target.dataset.tip.split('|');
    bubble.replaceChildren();
    const add = (cls, text) => { if (!text) return; const el = document.createElement('div'); el.className = cls; el.textContent = text; bubble.append(el); };
    add('tip-title', title);
    add('tip-body', body);
    add('tip-ex', example);
    bubble.hidden = false;
    const r = target.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const left = Math.min(innerWidth - b.width - 8, Math.max(8, r.left + r.width / 2 - b.width / 2));
    const below = r.bottom + 8 + b.height < innerHeight;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${below ? r.bottom + 8 : r.top - b.height - 8}px`;
  }

  toggleButton.addEventListener('click', () => {
    on = !on;
    toggleButton.classList.toggle('active', on);
    toggleButton.setAttribute('aria-pressed', on);
    toggleButton.querySelector('span').textContent = on ? 'Tips on' : 'Tips';
    if (!on) hide();
  });

  document.addEventListener('pointerover', (e) => {
    if (!on) return;
    const target = e.target.closest('[data-tip]');
    target ? show(target) : hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (on && !e.target.closest('[data-tip]')) hide();
  });
}
