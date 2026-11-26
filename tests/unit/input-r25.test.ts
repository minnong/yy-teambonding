import { describe, it, expect } from 'vitest';
import { attachKeyboard, isStaleDown, STALE_DOWN_MS } from '../../src/client/room/input';

describe('stale pointer down (R25a)', () => {
  it('a previous down is stale if its pointer is no longer held', () => {
    expect(isStaleDown(1000, 1100, false)).toBe(true);
  });
  it('a previous down is stale after ~2 s even if it still looks held', () => {
    expect(isStaleDown(1000, 1000 + STALE_DOWN_MS + 1, true)).toBe(true);
    expect(STALE_DOWN_MS).toBeGreaterThanOrEqual(1500);
    expect(STALE_DOWN_MS).toBeLessThanOrEqual(2500);
  });
  it('a recent, still-held down is a real second finger', () => {
    expect(isStaleDown(1000, 1200, true)).toBe(false);
  });
});

function fakeWindow() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', activeElement: null });
  const win = Object.assign(new EventTarget(), { document: doc });
  const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  const hide = () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); };
  return { win: win as unknown as Window, key, hide, doc };
}

describe('keyboard and hidden tabs (R25b)', () => {
  it('going hidden while a key is held clears it and sends stop', () => {
    const f = fakeWindow();
    const sent: string[] = [];
    const detach = attachKeyboard({ walk: (d) => sent.push(d), stop: () => sent.push('stop') }, f.win);
    f.key('keydown', 'KeyW');
    f.hide();
    expect(sent).toEqual(['up', 'stop']);
    f.key('keyup', 'KeyW'); // already cleared: nothing more
    expect(sent).toEqual(['up', 'stop']);
    detach();
  });
  it('going hidden with nothing held sends nothing, and detach removes the listener', () => {
    const f = fakeWindow();
    const sent: string[] = [];
    const detach = attachKeyboard({ walk: (d) => sent.push(d), stop: () => sent.push('stop') }, f.win);
    f.hide();
    expect(sent).toEqual([]);
    detach();
    f.doc.visibilityState = 'visible';
    f.key('keydown', 'KeyD');
    f.hide();
    expect(sent).toEqual([]);
  });
});
