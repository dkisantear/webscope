// Slider control: label + value on top, − / slider / + below.
// Drag the slider, tap −/+, use arrow keys, or tap the value to type one ("2.5", "500u", "2 ms", "1k").
// Double-tap the label to go back to the starting value.

import { parseQuantity } from './scales.js';

export class Slider {
  /**
   * @param {HTMLElement} el
   * @param {{label:string, min:number, max:number, step:number, value:number,
   *          format:(v:number)=>string, onChange:(v:number)=>void, color?:string,
   *          fromReal?:(x:number)=>number, tip?:string}} opts
   * fromReal converts a typed real value (V, s, Hz) into the slider's own value (e.g. a step index).
   */
  constructor(el, opts) {
    Object.assign(this, opts);
    this.defaultValue = opts.value;
    el.classList.add('slider');
    if (opts.tip) el.dataset.tip = opts.tip;
    if (opts.color) el.style.setProperty('--c', opts.color);

    el.innerHTML = `
      <div class="slider-head">
        <span class="slider-label" title="Double-tap to reset">${this.label}</span>
        <output class="slider-value" tabindex="0" title="Tap to type a value"></output>
      </div>
      <div class="slider-row">
        <button type="button" class="sbtn" data-d="-1" aria-label="Decrease ${this.label}">−</button>
        <input type="range" min="${this.min}" max="${this.max}" step="${this.step}" aria-label="${this.label}">
        <button type="button" class="sbtn" data-d="1" aria-label="Increase ${this.label}">+</button>
      </div>`;

    this.input = el.querySelector('input');
    this.output = el.querySelector('.slider-value');
    el.querySelectorAll('.sbtn').forEach((b) => b.addEventListener('click', () => this.nudge(Number(b.dataset.d))));
    this.input.addEventListener('input', () => this.commit(Number(this.input.value)));
    el.querySelector('.slider-label').addEventListener('dblclick', () => this.commit(this.defaultValue));
    this.output.addEventListener('click', () => this.edit());
    this.output.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.edit(); });
    this.set(this.value);
  }

  /** Swap the value for a text field that looks the same; Enter/blur applies, Esc cancels. */
  edit() {
    const shown = this.output.textContent;
    const input = document.createElement('input');
    input.className = 'slider-input';
    input.value = shown;
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', `${this.label} value`);
    this.output.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply) {
        const real = parseQuantity(input.value, shown);
        if (Number.isFinite(real)) this.commit(this.fromReal ? this.fromReal(real) : real);
      }
      input.replaceWith(this.output);
      this.set(this.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  nudge(steps) { this.commit(this.value + steps * this.step); }

  commit(v) {
    const before = this.value;
    this.set(v);
    if (this.value !== before) this.onChange(this.value);
  }

  /** Update the slider without firing onChange (used when state changes elsewhere). */
  set(v) {
    const snapped = this.min + Math.round((v - this.min) / this.step) * this.step;
    this.value = Math.min(this.max, Math.max(this.min, Number(snapped.toFixed(6))));
    this.input.value = this.value;
    const frac = (this.value - this.min) / (this.max - this.min || 1);
    this.input.style.setProperty('--fill', `${frac * 100}%`);
    this.output.textContent = this.format(this.value);
    this.input.setAttribute('aria-valuetext', this.output.textContent);
  }
}
