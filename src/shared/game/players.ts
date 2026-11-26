// Player actions (connect, disconnect, addSelf, looks, movement, emotes) and roster host actions.
import type { AvatarLook, GameState, Motion, PlayerId, Vec } from '../types';
import type { WalkDir } from '../protocol';
import { AVATAR_OPTIONS, EMOTES, PROXIMITY } from '../constants';
import { isWalkable, toTile, toWorld } from '../layout';
import { findPath } from '../path';
import { positionAt, truncateAt } from '../motion';
import { type Handler, type HandlerMap, type Result, ok, err, ignored, ONLY_WARMUP } from './result';
import { closeIcebreakers, hasTeam, isPlayingTeam, livePlayer, spawnPoint } from './state';

const UNKNOWN_PLAYER = 'unknown player';
const UNKNOWN_TEAM = 'unknown team';
const MAX_NAME = 24;

const connect: Handler<'connect'> = (state, a, ctx) => {
  if (!livePlayer(state, a.playerId)) return err(UNKNOWN_PLAYER);
  state.online[a.playerId] = true;
  if (!state.motions[a.playerId]) state.motions[a.playerId] = { path: [spawnPoint(state, a.playerId)], startedAt: ctx.now };
  return ok([], { snapshot: true });
};

const disconnect: Handler<'disconnect'> = (state, a) => {
  if (!Object.hasOwn(state.players, a.playerId)) return err(UNKNOWN_PLAYER);
  delete state.online[a.playerId];
  const out = closeIcebreakers(state, (ib) => ib.a === a.playerId || ib.b === a.playerId, 'left');
  return ok(out, { snapshot: true });
};

function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '');
  return s || 'player';
}

const addSelf: Handler<'addSelf'> = (state, a) => {
  if (state.phase !== 'warmup') return err(ONLY_WARMUP);
  if (!hasTeam(state, a.teamId)) return err(UNKNOWN_TEAM);
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (name.length < 1 || name.length > MAX_NAME) return err(`Name must be 1–${MAX_NAME} characters`);
  const lower = name.toLowerCase();
  const taken = Object.values(state.players)
    .some((p) => p.teamId === a.teamId && !p.removed && p.name.trim().toLowerCase() === lower);
  if (taken) return err('That name is already on the list');
  const slug = slugify(name);
  let n = 1;
  while (Object.hasOwn(state.players, `x-${slug}-${n}`)) n++;
  const id = `x-${slug}-${n}`;
  state.players[id] = { id, name, teamId: a.teamId, look: null, addedOnDay: true, removed: false };
  return { ...ok([], { persist: true, snapshot: true }), addedPlayerId: id };
};

const LOOK_KEYS = Object.keys(AVATAR_OPTIONS) as (keyof AvatarLook)[];

const setLook: Handler<'setLook'> = (state, a) => {
  const p = livePlayer(state, a.playerId);
  if (!p) return err(UNKNOWN_PLAYER);
  const src = a.look as Partial<Record<keyof AvatarLook, unknown>> | null;
  if (!src || typeof src !== 'object') return err('Invalid look');
  const look = {} as AvatarLook;
  for (const k of LOOK_KEYS) {
    const v = src[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= AVATAR_OPTIONS[k]) return err('Invalid look');
    look[k] = v;
  }
  p.look = look;
  return ok([], { persist: true, snapshot: true });
};

/**
 * Shared gate for move/walk/stop. Returns a Result to return early (error or silent ignore),
 * or the player's current motion (a stationary one at spawn if they have none yet).
 */
function movable(state: GameState, id: PlayerId, now: number): Result | Motion {
  const p = livePlayer(state, id);
  if (!p) return err(UNKNOWN_PLAYER);
  if (state.paused || !isPlayingTeam(state, p.teamId)) return ignored();
  return state.motions[id] ?? { path: [spawnPoint(state, id)], startedAt: now };
}
const isResult = (x: Result | Motion): x is Result => 'out' in x;

function setMotion(state: GameState, id: PlayerId, motion: Motion): Result {
  state.motions[id] = motion;
  return ok([{ to: 'all', msg: { type: 'motion', playerId: id, motion } }]);
}

const validVec = (v: Vec | undefined): v is Vec =>
  !!v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y);

const move: Handler<'move'> = (state, a, ctx) => {
  if (!validVec(a.to)) return err('bad target');
  const cur = movable(state, a.playerId, ctx.now);
  if (isResult(cur)) return cur;
  const from = positionAt(cur, ctx.now);
  return setMotion(state, a.playerId, { path: findPath(from, { x: a.to.x, y: a.to.y }), startedAt: ctx.now });
};

const DIR: Record<WalkDir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const walk: Handler<'walk'> = (state, a, ctx) => {
  const d = DIR[a.dir];
  if (!d) return err('bad direction');
  const cur = movable(state, a.playerId, ctx.now);
  if (isResult(cur)) return cur;
  const from = positionAt(cur, ctx.now);
  const t = toTile(from);
  while (isWalkable(t.x + d[0], t.y + d[1])) { t.x += d[0]; t.y += d[1]; }
  return setMotion(state, a.playerId, { path: findPath(from, toWorld(t.x, t.y)), startedAt: ctx.now });
};

const stop: Handler<'stop'> = (state, a, ctx) => {
  const cur = movable(state, a.playerId, ctx.now);
  if (isResult(cur)) return cur;
  return setMotion(state, a.playerId, truncateAt(cur, ctx.now));
};

const emote: Handler<'emote'> = (state, a, ctx) => {
  if (!livePlayer(state, a.playerId)) return err(UNKNOWN_PLAYER);
  if (!(EMOTES as readonly string[]).includes(a.kind)) return err('Unknown emote');
  if (state.paused) return ignored();
  if (a.target !== undefined) {
    if (!livePlayer(state, a.target) || a.target === a.playerId) return err(UNKNOWN_PLAYER);
    const ma = state.motions[a.playerId], mb = state.motions[a.target];
    if (!ma || !mb) return err('Too far away');
    const pa = positionAt(ma, ctx.now), pb = positionAt(mb, ctx.now);
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > PROXIMITY) return err('Too far away');
    return ok([{ to: 'all', msg: { type: 'emote', from: a.playerId, kind: a.kind, target: a.target } }]);
  }
  return ok([{ to: 'all', msg: { type: 'emote', from: a.playerId, kind: a.kind } }]);
};

// ---------- roster host actions (warm-up only) ----------

const movePlayer: Handler<'host.movePlayer'> = (state, a) => {
  if (state.phase !== 'warmup') return err(ONLY_WARMUP);
  const p = livePlayer(state, a.playerId);
  if (!p) return err(UNKNOWN_PLAYER);
  if (!hasTeam(state, a.teamId)) return err(UNKNOWN_TEAM);
  p.teamId = a.teamId;
  return ok([], { persist: true, snapshot: true });
};

const removePlayer: Handler<'host.removePlayer'> = (state, a) => {
  if (state.phase !== 'warmup') return err(ONLY_WARMUP);
  const p = livePlayer(state, a.playerId);
  if (!p) return err(UNKNOWN_PLAYER);
  p.removed = true;
  delete state.online[p.id];
  delete state.motions[p.id];
  const out = closeIcebreakers(state, (ib) => ib.a === p.id || ib.b === p.id, 'left');
  return ok(out, { persist: true, snapshot: true });
};

const setGoesFirst: Handler<'host.setGoesFirst'> = (state, a) => {
  if (state.phase !== 'warmup') return err(ONLY_WARMUP);
  if (!hasTeam(state, a.teamId)) return err(UNKNOWN_TEAM);
  for (const t of Object.values(state.teams)) t.goesFirst = t.id === a.teamId;
  return ok([], { persist: true, snapshot: true });
};

export const playerHandlers = {
  connect, disconnect, addSelf, setLook, move, walk, stop, emote,
  'host.movePlayer': movePlayer, 'host.removePlayer': removePlayer, 'host.setGoesFirst': setGoesFirst,
} satisfies HandlerMap;
