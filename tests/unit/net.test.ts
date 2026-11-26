import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net, clockOffset, RECONNECT_DELAYS } from '../../src/client/net';

class FakeWS {
  static all: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}

const hello = { t: 'hello', playerId: 'p01', token: 'tok-12345678' } as const;
const last = () => FakeWS.all[FakeWS.all.length - 1]!;
function mk() {
  const vis = { listeners: [] as (() => void)[], state: 'visible' };
  const net = new Net({
    WebSocketCtor: FakeWS as unknown as typeof WebSocket,
    url: 'ws://x/ws',
    visibility: { get state() { return vis.state; }, onVisible: (f) => { vis.listeners.push(f); } },
  });
  return { net, vis };
}

beforeEach(() => { FakeWS.all = []; vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe('clockOffset', () => {
  it('median of 3 samples', () => {
    const s = [
      { sent: 100, server: 1000, received: 120 },  // 1000-110 = 890
      { sent: 200, server: 1100, received: 300 },  // 1100-250 = 850
      { sent: 300, server: 1500, received: 320 },  // 1500-310 = 1190
    ];
    expect(clockOffset(s)).toBe(890);
  });
  it('0 for no samples, mean of middle two for even', () => {
    expect(clockOffset([])).toBe(0);
    expect(clockOffset([{ sent: 0, server: 10, received: 0 }, { sent: 0, server: 20, received: 0 }])).toBe(15);
  });
});

describe('Net', () => {
  it('reconnect delays follow 0.5,1,2,5,5', () => {
    expect(RECONNECT_DELAYS).toEqual([500, 1000, 2000, 5000]);
    const { net } = mk();
    net.connect(hello);
    expect(FakeWS.all).toHaveLength(1);
    for (const [i, d] of [500, 1000, 2000, 5000, 5000, 5000].entries()) {
      last().drop();
      expect(net.state).toBe('reconnecting');
      vi.advanceTimersByTime(d - 1);
      expect(FakeWS.all).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWS.all).toHaveLength(i + 2);
    }
  });

  it('reconnect re-sends the same hello; backoff resets after open', () => {
    const { net } = mk();
    net.connect(hello);
    last().open();
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([hello]);
    last().drop();
    vi.advanceTimersByTime(500);
    last().open();
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([hello]);
    last().drop();
    vi.advanceTimersByTime(499);
    expect(FakeWS.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWS.all).toHaveLength(3);
  });

  it('never reconnects after 4000, 4001, 4003', () => {
    for (const code of [4000, 4001, 4003]) {
      FakeWS.all = [];
      const { net } = mk();
      net.connect(hello);
      last().open();
      last().drop(code);
      vi.advanceTimersByTime(60_000);
      expect(FakeWS.all).toHaveLength(1);
      expect(net.state).toBe('closed');
    }
  });

  it('reconnects immediately after 4002', () => {
    const { net } = mk();
    net.connect(hello);
    last().open();
    last().drop(4002);
    expect(FakeWS.all).toHaveLength(2);
  });

  it('visibility change reconnects immediately and resets backoff', () => {
    const { net, vis } = mk();
    net.connect(hello);
    last().drop();
    vi.advanceTimersByTime(500); last().drop();
    expect(FakeWS.all).toHaveLength(2);
    vis.listeners.forEach((f) => f());
    expect(FakeWS.all).toHaveLength(3);
    last().drop();
    vi.advanceTimersByTime(500); // backoff was reset
    expect(FakeWS.all).toHaveLength(4);
  });

  it('visibility does nothing when open or closed for good', () => {
    const { net, vis } = mk();
    net.connect(hello); last().open();
    vis.listeners.forEach((f) => f());
    expect(FakeWS.all).toHaveLength(1);
    last().drop(4000);
    vis.listeners.forEach((f) => f());
    expect(FakeWS.all).toHaveLength(1);
  });

  it('takes clock samples from welcome and snapshot; serverNow adds offset', () => {
    const { net } = mk();
    net.connect(hello); last().open();
    vi.advanceTimersByTime(100); // sent at 1_000_000, received at 1_000_100
    last().recv({ type: 'welcome', you: 'p01', token: 't', serverNow: 2_000_050, snapshot: {} });
    expect(net.serverNow()).toBe(Date.now() + 1_000_000);
    last().recv({ type: 'snapshot', snapshot: { serverNow: 2_000_100 } }); // offset 1_000_000 at received==sent
    last().recv({ type: 'snapshot', snapshot: { serverNow: 2_000_100 } });
    expect(net.serverNow()).toBe(Date.now() + 1_000_000);
  });

  it('on() dispatches by type and unsubscribes; act/host wrap', () => {
    const { net } = mk();
    const fn = vi.fn();
    const off = net.on('kicked', fn);
    net.connect(hello); last().open();
    last().recv({ type: 'kicked' });
    off();
    last().recv({ type: 'kicked' });
    expect(fn).toHaveBeenCalledTimes(1);
    net.act({ type: 'stop' });
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({ t: 'act', a: { type: 'stop' } });
    net.host({ type: 'host.pause' });
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({ t: 'host', a: { type: 'host.pause' } });
  });

  it('emits close events and re-hello with takeover via connect()', () => {
    const { net } = mk();
    const fn = vi.fn();
    net.on('close', fn);
    net.connect(hello); last().open(); last().drop(4003);
    expect(fn).toHaveBeenCalledWith({ code: 4003, reason: '' });
  });
});
