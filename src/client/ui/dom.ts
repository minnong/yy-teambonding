// Tiny DOM helpers for the HUD. Text always goes through textContent: names, prompts, riddles and
// quiz text are user/organiser content and must never be parsed as HTML.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(cls: string, text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) { b.setAttribute('aria-label', label); b.title = label; }
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

/** appendChild for several nodes (the workers types shadow the DOM's `append`). */
export function add<P extends Node>(parent: P, ...kids: Node[]): P {
  for (const k of kids) parent.appendChild(k);
  return parent;
}
