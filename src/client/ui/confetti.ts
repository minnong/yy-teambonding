// A short burst of DOM-canvas confetti over the whole screen. Ignores pointers; removes itself.
const COLORS = ['#ffe066', '#ff7a3d', '#9be89b', '#6ac8ff', '#ff6fa8', '#ffffff'];

export function confetti(parent: HTMLElement, ms = 3500): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'lb-confetti';
  parent.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = parent.clientWidth || window.innerWidth, h = parent.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * w, y: -20 - Math.random() * h * 0.6,
    vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 220,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 10,
    s: 6 + Math.random() * 6, c: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }));
  const start = performance.now();
  let last = start, raf = 0, done = false;
  const stop = () => { if (done) return; done = true; cancelAnimationFrame(raf); canvas.remove(); };
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!ctx || t - start > ms) { stop(); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (ms - (t - start)) / 600);
    for (const b of bits) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt; b.vy += 60 * dt;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
