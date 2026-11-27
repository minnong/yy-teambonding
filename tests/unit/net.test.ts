import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net, clockOffset, PROBE_DEADLINE_MS, RECONNECT_DELAYS } from '../../src/client/net';

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
  /** The page went hidden and is visible again (a phone unlock). */
  const show = () => vis.listeners.forEach((f) => f());
  const net = new Net({
    WebSocketCtor: FakeWS as unknown as typeof WebSocket,
    url: 'ws://x/ws',
    visibility: { get state() { return vis.state; }, onVisible: (f) => { vis.listeners.push(f); } },
  });
  return { net, vis, show };
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

  it('the remembered hello replays with its epoch, after a drop and after a 4002 reset', () => {
    const { net } = mk();
    net.connect({ t: 'peek' });
    net.remember({ ...hello, epoch: 'e-old-1' });
    last().drop(4002);
    last().open();
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([{ ...hello, epoch: 'e-old-1' }]);
    last().drop();
    vi.advanceTimersByTime(500);
    last().open();
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([{ ...hello, epoch: 'e-old-1' }]);
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

  it('visibility opens no new socket when open or closed for good', () => {
    const { net, vis } = mk();
    net.connect(hello); last().open();
    vis.listeners.forEach((f) => f());
    expect(FakeWS.all).toHaveLength(1);
    last().onmessage?.({ data: 'pong' }); // answer the unlock probe
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

  it('addSelf after a delay does not skew the clock (sample uses the addSelf send time)', () => {
    const { net } = mk();
    net.connect({ t: 'peek' }); last().open();
    vi.advanceTimersByTime(60_000); // user types for a minute
    net.send({ t: 'addSelf', name: 'Zed', teamId: 'otter', token: 'tok-12345678' });
    vi.advanceTimersByTime(100);
    last().recv({ type: 'welcome', you: 'x-zed-1', token: 't', serverNow: Date.now() + 1_000_000 - 50, snapshot: {} });
    expect(net.serverNow()).toBe(Date.now() + 1_000_000);
  });

  it('peek alone yields no welcome sample; a peek snapshot still does', () => {
    const { net } = mk();
    net.connect({ t: 'peek' }); last().open();
    last().recv({ type: 'snapshot', snapshot: { serverNow: Date.now() + 500 } });
    expect(net.serverNow()).toBe(Date.now() + 500);
  });

  it('a takeover hello is not replayed on reconnect', () => {
    const { net } = mk();
    net.connect({ ...hello, takeover: true });
    last().open();
    expect(JSON.parse(last().sent[0]!)).toEqual({ ...hello, takeover: true });
    last().drop();
    vi.advanceTimersByTime(500);
    last().open();
    expect(JSON.parse(last().sent[0]!)).toEqual(hello);
  });

  it('emits close events and re-hello with takeover via connect()', () => {
    const { net } = mk();
    const fn = vi.fn();
    net.on('close', fn);
    net.connect(hello); last().open(); last().drop(4003);
    expect(fn).toHaveBeenCalledWith({ code: 4003, reason: '' });
  });
});

describe('Net heartbeat frames (fix round 1)', () => {
  it('ping() sends the raw runtime auto-response frame and a raw pong emits "pong"', () => {
    const { net } = mk();
    expect(net.ping()).toBe(false); // nothing open yet
    net.connect({ t: 'hostHello', pin: '1234' });
    last().open();
    let pongs = 0;
    net.on('pong', () => { pongs++; });
    expect(net.ping()).toBe(true);
    expect(last().sent.at(-1)).toBe('ping');
    last().onmessage?.({ data: 'pong' });
    expect(pongs).toBe(1);
  });
});

describe('Net act budget (R28)', () => {
  const look = { skin: 0, hair: 0, hairColor: 0, top: 0, topColor: 0, bottomsColor: 0, accessory: 0 };
  it('every act goes through the cap, including raw send({t:"act"}); over the cap nothing is sent', () => {
    const { net } = mk();
    net.connect(hello);
    last().open();
    const throttled: string[] = [];
    net.on('throttled', (m) => throttled.push(m.type));
    let ok = 0;
    for (let i = 0; i < 30; i++) if (net.act({ type: 'emote', kind: 'wave' })) ok++;
    expect(ok).toBe(17);
    const before = last().sent.length;
    expect(net.send({ t: 'act', a: { type: 'setLook', look } })).toBe(false);
    expect(last().sent.length).toBe(before);
    expect(throttled.length).toBe(14);
    expect(net.act({ type: 'quizAnswer', choice: 1 })).toBe(true); // reserved slice
  });
  it('hello and host frames are outside the cap; a closed socket charges nothing', () => {
    const { net } = mk();
    expect(net.act({ type: 'emote', kind: 'wave' })).toBe(false); // not open: not charged
    net.connect(hello);
    last().open();
    for (let i = 0; i < 17; i++) expect(net.act({ type: 'emote', kind: 'wave' })).toBe(true);
    expect(net.send(hello)).toBe(true);
    expect(net.host({ type: 'host.pause' })).toBe(true);
  });
});

describe('Net join look (I1)', () => {
  const look = { skin: 0, hair: 0, hairColor: 0, top: 0, topColor: 0, bottomsColor: 0, accessory: 0 };
  it('sendJoinLook goes out even when the act cap is spent; false when not open', () => {
    const { net } = mk();
    expect(net.sendJoinLook(look)).toBe(false);
    net.connect(hello);
    last().open();
    for (let i = 0; i < 30; i++) net.act({ type: 'quizAnswer', choice: 0 });
    expect(net.act({ type: 'setLook', look })).toBe(false);
    expect(net.sendJoinLook(look)).toBe(true);
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({ t: 'act', a: { type: 'setLook', look } });
  });
});

describe('Net unlock probe (I3)', () => {
  it('on visible with an open socket, sends the raw ping (no act, no budget) and keeps the socket on pong', () => {
    const { net, show } = mk();
    net.connect(hello); last().open();
    show();
    expect(last().sent.at(-1)).toBe('ping');
    expect(PROBE_DEADLINE_MS).toBe(5000);
    vi.advanceTimersByTime(PROBE_DEADLINE_MS - 1);
    last().onmessage?.({ data: 'pong' });
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(net.state).toBe('open');
  });

  it('no pong within 5 s: the half-open socket is dropped and the hello replayed on a new one', () => {
    const { net, show } = mk();
    net.connect(hello); last().open();
    const dead = last();
    show();
    vi.advanceTimersByTime(PROBE_DEADLINE_MS - 1);
    expect(FakeWS.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.all).toHaveLength(2);
    expect(net.state).toBe('reconnecting');
    expect(dead.onmessage).toBeNull(); // detached: a late frame from it is ignored
    last().open();
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([hello]);
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all).toHaveLength(2);
  });

  it('repeated unlocks send one probe at a time; a socket replaced meanwhile cancels the deadline', () => {
    const { net, show } = mk();
    net.connect(hello); last().open();
    show(); show(); show();
    expect(last().sent.filter((s) => s === 'ping')).toHaveLength(1);
    last().drop(); // the browser noticed on its own: normal reconnect
    vi.advanceTimersByTime(500);
    last().open();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all).toHaveLength(2);
  });

  it('a probe is not refused by, or charged to, the act cap', () => {
    const { net, show } = mk();
    net.connect(hello); last().open();
    for (let i = 0; i < 30; i++) net.act({ type: 'quizAnswer', choice: 0 });
    show();
    expect(last().sent.at(-1)).toBe('ping');
    last().onmessage?.({ data: 'pong' });
    expect(net.state).toBe('open');
  });
});

