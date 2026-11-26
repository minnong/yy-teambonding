import './styles.css';
import { Net } from './net';
import type { ClientHello } from './net';
import { openAvatarBuilder } from './join/avatarBuilder';
import { showNamePicker } from './join/namePicker';
import type { PickerView } from './join/namePicker';
import { browserToken, clearMe, loadMe, saveMe } from './identity';
import type { Me } from './identity';
import { startRoom } from './room/placeholder'; // Task 10 swaps this import for the real room scene
import type { PublicSnapshot } from '@shared/protocol';

const app = document.querySelector<HTMLElement>('#app')!;
const net = new Net();

let me: Me | null = loadMe();
let picker: PickerView | null = null;
let roster: PublicSnapshot | null = null;
let overlay: HTMLElement | null = null;
let entered = false;
let building = false;
let builder: { close(): void } | null = null;

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function hideOverlay(): void { overlay?.remove(); overlay = null; }
function showOverlay(...children: HTMLElement[]): void {
  hideOverlay();
  const screen = mk('div', 'lb-screen');
  screen.replaceChildren(...children);
  overlay = mk('div', 'lb-overlay');
  overlay.appendChild(screen);
  document.body.appendChild(overlay);
}

function showStatus(text: string): void {
  const p = mk('p', 'lb-center', text);
  app.replaceChildren(p);
}

function showPicker(): void {
  hideOverlay();
  picker?.destroy();
  net.connect({ t: 'peek' });
  picker = showNamePicker(app, net, {
    onPick: (playerId) => join({ t: 'hello', playerId, token: browserToken() }),
    onAddSelf: (name, teamId) => {
      if (!net.send({ t: 'addSelf', name, teamId, token: browserToken() })) picker?.showError('Not connected yet, try again');
    },
  });
}

function join(hello: ClientHello): void {
  if (hello.t === 'hello') me = { playerId: hello.playerId, token: hello.token };
  net.connect(hello);
}

function takeoverHello(): ClientHello | null {
  return me ? { t: 'hello', playerId: me.playerId, token: me.token, takeover: true } : null;
}

function showKicked(): void {
  if (building) { builder?.close(); builder = null; building = false; } // the takeover screen must not hide under the builder
  showOverlay(
    mk('h1', '', 'You opened the lobby somewhere else'),
    (() => {
      const b = mk('button', 'lb-add', 'Use this device');
      b.addEventListener('click', () => { const h = takeoverHello(); if (h) net.connect(h); });
      return b;
    })(),
  );
}

function showNameTaken(playerId: string): void {
  const name = roster?.players[playerId]?.name ?? 'This name';
  const take = mk('button', 'lb-add', 'Is this you? Take over.');
  take.addEventListener('click', () => net.connect({ t: 'hello', playerId, token: browserToken(), takeover: true }));
  const back = mk('button', 'lb-back', 'Back');
  back.addEventListener('click', () => showPicker());
  showOverlay(mk('p', '', `${name} is already in the lobby on another device.`), take, back);
}

/** The stored identity is stale (host reset or removed): forget it and start over. */
function forgetMe(): void {
  clearMe();
  me = null;
  if (entered || building) location.reload();
  else showPicker();
}

net.on('snapshot', (m) => { roster = m.snapshot; });
net.on('nameTaken', (m) => showNameTaken(m.playerId));
net.on('kicked', () => { if (entered || me) showKicked(); });
net.on('close', ({ code }) => {
  if (code === 4000) showKicked();
  else if (code === 4003) forgetMe();
});
net.on('error', (m) => {
  if (m.message === 'unknown player') forgetMe();
  else if (picker) picker.showError(m.message);
  else console.warn('server error:', m.message);
});

net.on('welcome', (m) => {
  const mine: Me = { playerId: m.you, token: m.token };
  me = mine;
  saveMe(mine);
  net.remember({ t: 'hello', playerId: mine.playerId, token: mine.token }); // reconnects never carry takeover
  hideOverlay();
  picker?.destroy();
  picker = null;
  if (entered || building) return; // a reconnect welcome: the room scene listens to the net itself
  const enter = (snap: PublicSnapshot) => { entered = true; startRoom(net, mine, snap); };
  if (m.snapshot.players[mine.playerId]?.look) { enter(m.snapshot); return; }
  building = true;
  builder = openAvatarBuilder(null, (look) => {
    building = false;
    builder = null;
    net.act({ type: 'setLook', look });
    const p = m.snapshot.players[mine.playerId];
    enter(p ? { ...m.snapshot, players: { ...m.snapshot.players, [p.id]: { ...p, look } } } : m.snapshot);
  });
});

if (me) {
  showStatus('Connecting…');
  net.connect({ t: 'hello', playerId: me.playerId, token: me.token });
} else {
  showPicker();
}
