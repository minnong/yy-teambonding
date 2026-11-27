// Top-of-screen messages: one full-width banner (timed, or sticky for "Paused") and a short stack
// of toasts under it. The whole stack ignores pointers so walking taps pass straight through.
// Timed banners queue (BannerQueue, M2): a new one waits until the current has had its moment.
import { add, el } from './dom';
import { BannerQueue, TOAST_MS, bannerPlan } from './uiState';

export interface Banners {
  /** Applies a server `banner` text: "" clears, "Paused" sticks, anything else shows for 6 s. */
  banner(text: string): void;
  /** Shows text for 6 s (after any timed banner already showing), then falls back to the sticky banner. */
  timed(text: string, ms?: number): void;
  setSticky(text: string | null): void;
  readonly sticky: string | null;
  toast(text: string, ms?: number): void;
  destroy(): void;
}

const MAX_TOASTS = 3;

export function createBanners(hud: HTMLElement): Banners {
  const bar = el('div', 'lb-banner');
  bar.setAttribute('role', 'status');
  bar.hidden = true;
  const toasts = el('div', 'lb-toasts');
  toasts.setAttribute('aria-live', 'polite');
  add(hud, bar, toasts);

  let sticky: string | null = null;
  const queue = new BannerQueue();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();

  const render = () => {
    const timedText = queue.current(Date.now());
    const text = timedText ?? sticky;
    bar.hidden = !text;
    bar.textContent = text ?? '';
    bar.classList.toggle('lb-banner-sticky', !timedText && !!sticky);
    toasts.style.top = text ? `${bar.offsetTop + bar.offsetHeight + 8}px` : '';
  };
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const clearTimed = () => { clearTimer(); queue.clear(); };
  /** Re-renders whenever the queue moves on. */
  const schedule = () => {
    clearTimer();
    const at = queue.nextChangeAt();
    if (at === null) return;
    timer = setTimeout(() => { timer = null; render(); schedule(); }, Math.max(0, at - Date.now()));
  };

  const api: Banners = {
    banner(text) {
      const p = bannerPlan(text);
      if (p.kind === 'clear') { clearTimed(); sticky = null; }
      else if (p.kind === 'sticky') { clearTimed(); sticky = p.text; }
      else { api.timed(p.text, p.ms); return; }
      render();
    },
    timed(text, ms = 6000) {
      queue.push(text, ms, Date.now());
      render();
      schedule();
    },
    setSticky(text) { if (sticky === text) return; sticky = text; render(); },
    get sticky() { return sticky; },
    toast(text, ms = TOAST_MS) {
      const t = el('div', 'lb-toast', text);
      toasts.appendChild(t);
      while (toasts.children.length > MAX_TOASTS) toasts.firstElementChild?.remove();
      const h = setTimeout(() => { toastTimers.delete(h); t.classList.add('lb-toast-out'); setTimeout(() => t.remove(), 250); }, ms);
      toastTimers.add(h);
    },
    destroy() {
      clearTimed();
      for (const h of toastTimers) clearTimeout(h);
      bar.remove();
      toasts.remove();
    },
  };
  return api;
}
