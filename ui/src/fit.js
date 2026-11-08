// Screen fit.
// Laptops, tablets and phones held sideways: the 960×650 instrument is scaled to fit, keeping its proportions.
// Phones held upright: switch to the stacked "compact" layout (styles.css) at normal size, which scrolls.

export const DESIGN_WIDTH = 960;
export const DESIGN_HEIGHT = 650;
const MARGIN = 0.98;
const COMPACT_MAX_WIDTH = 760; // narrower than this and taller than wide → compact layout

export function fitToScreen(onResize) {
  const root = document.documentElement;
  const fit = () => {
    const vw = window.visualViewport?.width ?? innerWidth;
    const vh = window.visualViewport?.height ?? innerHeight;
    const compact = vw < COMPACT_MAX_WIDTH && vh > vw;
    root.classList.toggle('compact', compact);
    const scale = compact ? 1 : MARGIN * Math.min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT);
    root.style.setProperty('--ui-scale', scale);
    onResize?.(scale);
  };
  addEventListener('resize', fit);
  addEventListener('orientationchange', fit);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
}
