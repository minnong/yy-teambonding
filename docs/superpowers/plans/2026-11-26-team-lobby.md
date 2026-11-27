# Team Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a phone-first, pixel-art virtual lobby for a 36-person in-person event. It decides the order 7 teams leave in, and a facilitator controls when each team goes.

**Architecture:** All game rules live in one pure TypeScript reducer, `src/shared/game/`, with no I/O, so they can be unit-tested. A Cloudflare Worker serves the built client and forwards WebSocket upgrades to a single `Room` Durable Object. The Room holds the sockets, runs the reducer, persists the durable parts of state to storage, and broadcasts. The client is a Phaser 3 scene for the room, with plain-DOM overlays for every menu, modal and the host page. Clients send *intents* (walk to X), and every client animates paths from the shared motion model.

**Tech Stack:** TypeScript, Vite, `@cloudflare/vite-plugin`, Wrangler, Cloudflare Workers + Durable Objects (SQLite-backed), Phaser 3 (latest 3.x), zod (message validation), `qrcode`, Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright. Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-11-26-team-lobby-design.md`

## Global Constraints

- 36 people, 7 teams (six of 5, one of 6). Exactly one team has `goesFirst`.
- Phones held upright are the main device: iOS Safari and Android Chrome on mid-range phones from about the last 5 years. Laptops are also supported.
- The page must never scroll, zoom or bounce during play. Every `<input>` has `font-size: 16px` or more, to stop iOS zooming in on focus. Tap targets are at least 44×44 CSS px.
- The free plan allows 100,000 requests/day. A full 35-minute session with 36 players must use **under 30,000 incoming WebSocket messages**. Clients send intents, never position streams.
- Persist on every score, call or phase change. Positions are never persisted.
- Host actions are accepted only on sockets that sent the correct `HOST_PIN` (a Wrangler secret; the dev default is `1234`, in `.dev.vars`).
- Starting point values (tunable constants in `src/shared/constants.ts`): icebreaker **+10 to each team**, collectible **+15**, riddle **+30**, quiz **up to +50**, scaled by the percentage of the team's eligible members who answered correctly.
- Collectibles spawn every **20–30 s**, with **at most 2** on the map. The quiz timer is **20 s**. Riddle skip lockout is **30 s**. The host timer turns amber at **4:30** and green at **5:00** since the last call.
- The emotes are exactly: wave 👋, high-five 🙌, laugh 😂, heart ❤️. Accessories are exactly: none, hat, glasses, cap, headphones, bow.
- User-facing copy, verbatim: "Is this you? Take over.", "I'm not on the list", "We answered it!", "already met! 🎉", "🎉 Team {name}, you're up! Head to the next activity.", "You're up!", "FINAL BOSS: escape the lobby!", "You escaped!", "Paused", "This will call TEAM {NAME} ({score} pts)".
- Table sign text: `★ {score}` while playing, `✅ WENT {ordinal}` after leaving (e.g. `✅ WENT 2ND`).
- Third-party art must keep its licence attribution in `CREDITS.md`, linked from the join screen.

## Review Focus

1. **Phone locks or the browser goes to the background mid-game.** Coming back must reconnect with the same token, get a fresh snapshot, and never show "Is this you? Take over." for your own earlier session. *(Test: Task 7, `reconnect with same token replaces old socket silently`.)*
2. **Two host devices press CALL NEXT TEAM at nearly the same moment.** Only one team may be called. *(Test: Task 6, `callNext with stale expectedTeamId is rejected`.)*
3. **A team departs, or a player disconnects, while an icebreaker or quiz involving them is open.** The icebreaker is cancelled with no points, and the quiz denominator counts only eligible members of teams still playing at the moment it closes. *(Test: Task 5, `departure cancels pending icebreakers` and `quiz denominator ignores departed teams`.)*
4. **The Durable Object restarts mid-competition.** Scores, departures, phase, met pairs and riddle progress come back. The tick alarm is re-armed, and clients reconnect on their own. *(Test: Task 7, `state survives object restart and alarm is re-armed`.)*
5. **iOS input quirks:** focusing a text field must not zoom, a double tap must not zoom, and the address bar showing or hiding must not leave the canvas the wrong size. *(Test: Task 12, `mobile: no zoom or scroll` Playwright test.)*

---

## File Structure

```
team-lobby/
  package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, vitest.config.ts, .dev.vars, playwright.config.ts
  content/event.json             # roster, prompts, riddles, quiz, boss (organiser edits via builder)
  assets/lpc-manifest.json       # which LPC files we use + author/licence per file
  public/assets/lpc/...          # downloaded sprite layers (committed)
  CREDITS.md                     # generated from manifest
  README.md                      # organiser + facilitator guide, deploy steps
  scripts/fetch-lpc.ts           # downloads manifest files, writes CREDITS.md
  scripts/bots.ts                # 35-bot load test + message count report
  src/shared/
    constants.ts                 # points, timings, sizes
    types.ts                     # all state + content types (below)
    protocol.ts                  # zod schemas for client→server, ServerMsg types
    content.ts                   # loadContent + validateContent
    layout.ts                    # room grid, tables, spawns, walkability
    path.ts                      # A* on grid
    motion.ts                    # positionAt, pathPassesNear
    answers.ts                   # riddle answer matching
    game/
      index.ts                   # apply(state, action, ctx) dispatcher + createState + publicSnapshot
      players.ts                 # connect/disconnect/addSelf/look/move/walk/stop/emote + roster host actions
      phase.ts                   # startCompetition, pause/resume, reset
      scoring.ts                 # addPoints, icebreakers, collectibles, riddles, quiz, adjust, tick
      calls.ts                   # leader, callNext, undoCall, boss
  src/server/
    worker.ts                    # fetch: /ws → Room, else static assets
    room.ts                      # Room Durable Object
  src/client/
    index.html, host.html, styles.css
    main.ts                      # join flow → game
    net.ts                       # socket + reconnect + clock offset
    join/namePicker.ts, join/avatarBuilder.ts
    avatar/layers.ts             # AvatarLook → layer keys/tints; preload
    room/RoomScene.ts            # Phaser scene
    room/roomArt.ts              # procedural A+ textures (floor, wall, window, tables, plants, lamp)
    room/avatarSprite.ts         # layered sprite container
    room/camera.ts               # follow / zoom-out
    room/input.ts                # tap-to-walk, WASD
    ui/hud.ts, ui/modals.ts, ui/banners.ts, ui/confetti.ts
    host/host.ts
  tests/unit/*.test.ts           # Node env
  tests/worker/*.test.ts         # workers pool
  tests/e2e/*.spec.ts            # Playwright
```

## Central types (`src/shared/types.ts`, owned by Task 2 and used by everything)

```ts
export type TeamId = string; export type PlayerId = string;
export interface Vec { x: number; y: number }                       // world px
export interface AvatarLook { skin: number; hair: number; hairColor: number; top: number;
  topColor: number; bottomsColor: number; accessory: number }      // indexes into AVATAR_OPTIONS
export interface Motion { path: Vec[]; startedAt: number }          // path[0] = start; speed WALK_SPEED
export type Phase = 'warmup' | 'competition';
export interface Team { id: TeamId; name: string; color: string; goesFirst: boolean;
  score: number; scoreChangedAt: number; status: 'playing' | 'departed';
  departedOrder: number | null; riddleIndex: number; riddleLockedUntil: number;
  bossIndex: number; bossDone: boolean }
export interface Player { id: PlayerId; name: string; teamId: TeamId; look: AvatarLook | null;
  addedOnDay: boolean; removed: boolean }
export interface Icebreaker { id: string; a: PlayerId; b: PlayerId; prompt: number;
  answeredBy: PlayerId | null }
export interface Quiz { questionIndex: number; endsAt: number;
  answers: Record<PlayerId, number> }
export interface Collectible { id: string; pos: Vec }
export interface GameState {
  phase: Phase; paused: boolean; pausedAt: number | null;
  teamOrder: TeamId[]; teams: Record<TeamId, Team>; players: Record<PlayerId, Player>;
  metPairs: string[];                     // `${minId}|${maxId}`
  icebreakers: Record<string, Icebreaker>;
  collectibles: Collectible[]; nextCollectibleAt: number | null;
  quiz: Quiz | null; nextQuizIndex: number; promptCursor: number;
  departures: TeamId[]; lastCallAt: number | null; competitionStartedAt: number | null;
  msgCount: { day: string; count: number };
  // runtime only, never persisted:
  motions: Record<PlayerId, Motion>; online: Record<PlayerId, boolean>; lastTickAt: number;
}
export interface Content { teams: { id: TeamId; name: string; color: string; goesFirst?: boolean }[];
  players: { id: PlayerId; name: string; teamId: TeamId }[];
  icebreakers: string[]; riddles: { q: string; answers: string[] }[];
  quiz: { q: string; choices: string[]; correct: number }[];
  boss: { intro: string; steps: { q: string; answers: string[] }[] } }
```

## Reducer contract (`src/shared/game/index.ts`, owned by Task 4, extended by 5 and 6)

```ts
export interface Ctx { now: number; rng: () => number; content: Content }
export type To = 'all' | 'host' | { player: PlayerId } | { team: TeamId };
export interface Outbound { to: To; msg: ServerMsg }
export interface Result { out: Outbound[]; persist: boolean; snapshot: boolean; error?: string }
export function createState(content: Content, now: number): GameState;
export function apply(state: GameState, action: Action, ctx: Ctx): Result;   // mutates state
export function publicSnapshot(state: GameState, ctx: Ctx): PublicSnapshot;  // no answers/secrets
export function persistable(state: GameState): Omit<GameState, 'motions'|'online'|'lastTickAt'>;
export function restore(saved: ReturnType<typeof persistable>, now: number): GameState;
```
`snapshot: true` means the Room broadcasts a fresh `PublicSnapshot` to everyone after the action. `error` is sent only to the sender, as `{type:'error', message}`, and the state is left unchanged.

`Action` is a union with a `type` field. Player actions carry `playerId`. Host actions start with `host.`. The full list is in `protocol.ts` (Task 7 validates the wire format into these):

- **Player actions:** `connect` `disconnect` `addSelf{name,teamId}` `setLook{look}` `move{to}` `walk{dir}` `stop` `emote{kind,target?}` `icebreakerStart{target}` `icebreakerAnswered{id}` `icebreakerConfirm{id}` `icebreakerCancel{id}` `riddleAnswer{text}` `riddleSkip` `bossAnswer{text}` `quizAnswer{choice}`
- **Host actions:** `host.startCompetition` `host.callNext{expectedTeamId}` `host.undoCall` `host.quizStart` `host.adjustScore{teamId,delta}` `host.pause` `host.resume` `host.reset` `host.movePlayer{playerId,teamId}` `host.removePlayer{playerId}` `host.setGoesFirst{teamId}`
- **Other:** `tick`

`ServerMsg` (in `protocol.ts`):

- **Session:** `welcome{you, token, serverNow, snapshot}` `snapshot{snapshot}` `nameTaken{playerId}` `kicked` `error{message}`
- **Room events:** `motion{playerId, motion}` `emote{from, kind, target?}` `float{teamId, text}` `banner{text}`
- **Activities:** `icebreaker{card: {id, a, b, prompt: string, answeredBy}|null, closedReason?}` `riddle{index, q|null, lockedUntil}` `boss{index, q|null, done}` `quiz{q, choices, endsAt}` `quizResult{correct, perTeam: Record<TeamId, number>}`
- **Team status:** `youreUp{teamId}` `celebrate{teamId}`
- **Host only:** `hostState{snapshot, connectedPerTeam, msgCount, nextLeader, lastCallAt}`

---

### Task 1: Project scaffold, Worker and Durable Object skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars`, `.gitignore`, `src/server/worker.ts`, `src/server/room.ts`, `src/client/index.html`, `src/client/main.ts`
- Test: `tests/worker/echo.test.ts`

**Interfaces:**
- Produces: `npm run dev` (Vite + Worker on one port), `npm test` (unit + worker projects), `npm run build`, `npm run deploy`. The `ROOM` Durable Object binding. All sockets go to `env.ROOM.idFromName('main')`.

- [ ] **Step 1:** `git init`. Add `.gitignore` with `node_modules`, `dist`, `.wrangler`, `.dev.vars` and `.superpowers/`. Install the stack listed in the header.
- [ ] **Step 2:** Set up `wrangler.jsonc`:
  - `main: src/server/worker.ts`
  - `assets: { directory: "./dist/client", not_found_handling: "single-page-application" }`
  - `durable_objects.bindings: [{ name: "ROOM", class_name: "Room" }]`
  - `migrations: [{ tag: "v1", new_sqlite_classes: ["Room"] }]` (required on the free plan)

  Set up `vite.config.ts` with the `cloudflare()` plugin, and Vite multi-page inputs `index.html` and `host.html`.
- [ ] **Step 3: Write the failing test** `tests/worker/echo.test.ts`: `it('upgrades /ws and the Room echoes a message')`. Open a WebSocket via `SELF.fetch('http://x/ws', {headers:{Upgrade:'websocket'}})`, send `"ping"`, and expect `"echo:ping"`.
- [ ] **Step 4:** Run `npm test -- tests/worker/echo.test.ts`. Expected: FAIL (no route).
- [ ] **Step 5:** Implement `worker.ts`: route `/ws` to `env.ROOM.get(env.ROOM.idFromName('main')).fetch(req)`, and serve everything else from assets. `room.ts` is a `Room extends DurableObject` that accepts the socket with `this.ctx.acceptWebSocket(server)` and echoes in `webSocketMessage`.
- [ ] **Step 6:** Run `npm test`. Expected: PASS. Then run `npm run dev` and check that `/` serves the placeholder page.
- [ ] **Step 7:** Commit: `chore: scaffold worker, durable object and vite client`.

### Task 2: Types, constants, content file and validation

**Files:**
- Create: `src/shared/types.ts` (exactly as in Central types), `src/shared/constants.ts`, `src/shared/content.ts`, `content/event.json`
- Test: `tests/unit/content.test.ts`

**Interfaces:**
- Produces: `loadContent(): Content`, which imports `content/event.json` and runs `validateContent`. `validateContent(c: Content): string[]` returns a list of problems, empty if valid. It also produces the constants:
  - Points: `POINTS = { icebreaker: 10, collectible: 15, riddle: 30, quizMax: 50 }`
  - Timings (ms): `COLLECTIBLE_MIN_MS = 20000`, `COLLECTIBLE_MAX_MS = 30000`, `MAX_COLLECTIBLES = 2`, `QUIZ_MS = 20000`, `RIDDLE_SKIP_LOCK_MS = 30000`, `TICK_MS = 1000`, `CALL_AMBER_MS = 270000`, `CALL_GREEN_MS = 300000`
  - Sizes: `TILE = 32`, `WALK_SPEED = 128` (px/s), `PROXIMITY = 80` (px), `TABLE_REACH = 48` (px from the table rect)
  - Options: `EMOTES = ['wave','highfive','laugh','heart']`, `ACCESSORIES = ['none','hat','glasses','cap','headphones','bow']`
  - `MESSAGE_BUDGET = 30000`

- [ ] **Step 1: Write the failing tests**, each asserting `validateContent(c)` returns a message containing the quoted text:
  - `default content is valid`: `validateContent(loadContent())` equals `[]`.
  - `default content has 36 players in 7 teams of 5,5,5,5,5,5,6`.
  - `rejects zero or two goesFirst teams`: "exactly one team must have goesFirst".
  - `rejects a player whose teamId is unknown`: "unknown team".
  - `rejects duplicate player ids`.
  - `rejects too little content`: "at least" when there are fewer than 60 icebreakers, 15 riddles or 12 quiz questions, or a boss chain outside 4–5 steps.
  - `rejects quiz correct index out of range`.
- [ ] **Step 2:** Run `npm test -- tests/unit/content.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `content.ts`. Write `content/event.json`:
  - 7 placeholder teams: Otter, Pixel, Comet, Mango, Koala, Nova, Maple. Each gets a distinct colour. Otter has `goesFirst`.
  - 36 placeholder players named "Player 01" to "Player 36", with ids `p01`–`p36`. The 6-person team is Maple.
  - 60 light, workplace-safe icebreaker prompts.
  - 15 riddles, each with alternative answers (e.g. `["a piano","piano"]`).
  - 12 fun multiple-choice questions, 4 choices each.
  - A 4–5 step "escape the lobby" boss chain whose answers build on each other.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: content model, default event content and validation`.

### Task 3: Room layout, pathfinding and motion

**Files:**
- Create: `src/shared/layout.ts`, `src/shared/path.ts`, `src/shared/motion.ts`
- Test: `tests/unit/layout.test.ts`, `tests/unit/motion.test.ts`

**Interfaces:**
- Produces:
  - `LAYOUT: { cols: 24; rows: 36; wallRows: 4; tables: Record<number, {x:number,y:number,w:number,h:number}> }`. World px are `cols*TILE` × `rows*TILE` = 768 × 1152. There are 7 table slots in staggered rows of 2/2/2/1 below the wall, each 3×2 tiles. Slot index *i* goes to `content.teams[i]`.
  - `isWalkable(tx:number, ty:number): boolean`
  - `toTile(p:Vec)`, `toWorld(tx,ty): Vec` (the tile centre)
  - `spawnFor(slot:number, n:number): Vec`: a walkable spot near the table, varied by `n`
  - `nearTable(p:Vec, slot:number): boolean`: within `TABLE_REACH` of the table rect
  - `randomOpenSpot(rng): Vec`
  - `findPath(from:Vec, to:Vec): Vec[]`: 8-direction A* that doesn't cut corners. If `to` is blocked it targets the nearest walkable tile. The result starts at `from` and ends at the snapped target, or is `[from]` if no route exists.
  - `positionAt(m:Motion, now:number): Vec`
  - `isMoving(m, now): boolean`
  - `truncateAt(m:Motion, now:number): Motion`: a stationary motion at the current position
  - `pathPassesNear(m:Motion, t0:number, t1:number, p:Vec, r:number): boolean`

- [ ] **Step 1: Write the failing tests:**
  - `wall rows and table tiles are not walkable; aisles are`.
  - `every spawn is walkable and distinct for n=0..5`.
  - `findPath around a table never steps on a blocked tile`.
  - `findPath to a blocked target ends next to it`.
  - `findPath with no route returns [from]`.
  - `positionAt is start at startedAt, end after length/WALK_SPEED, and linear between`. Use a 2-point path 128 px long: at +0.5 s the position is 64 px along.
  - `truncateAt mid-path freezes position`.
  - `pathPassesNear detects a pass-through between ticks, but not a near-miss beyond r`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Hard-code the blocked tiles from the wall rows and the table rects. Leave a 1-tile gap around every table, and walls on all edges.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: room layout, A* pathfinding and shared motion model`.

### Task 4: Game reducer core (players, movement, phases, roster)

**Files:**
- Create: `src/shared/game/index.ts`, `src/shared/game/players.ts`, `src/shared/game/phase.ts`, `src/shared/protocol.ts` (the `Action` and `ServerMsg` TypeScript types only; zod schemas come in Task 7)
- Test: `tests/unit/game-core.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: everything in the Reducer contract. It also defines `PublicSnapshot` in `protocol.ts`: `{ phase, paused, teamOrder, teams (without riddle/boss answers), players, motions, online, collectibles, departures, lastCallAt, quizActive: {q, choices, endsAt} | null, serverNow }`. Plus `slotOf(state, teamId): number`, `isPlayingTeam(state, teamId): boolean`, and `activePlayers(state, teamId): PlayerId[]` (online, not removed).

Rules to implement:
- **`connect`:** sets `online`. A player with no motion gets a stationary motion at `spawnFor`. Produces `snapshot`.
- **`disconnect`:** clears `online` and cancels that player's open icebreakers (`icebreaker{card:null, closedReason:'left'}` to the other person).
- **`addSelf`:** only in warm-up, only for a known team, and the trimmed name must be 1–24 characters. If the name matches an existing player in that team (case-insensitive), it returns `error:"That name is already on the list"`. Otherwise it creates the id `x-<slug>-<n>` with `addedOnDay:true`.
- **`move`:** `findPath(positionAt(current, now), to)` gives a new motion and a `motion` message to everyone. It's rejected silently if paused, or if the player's team has departed (they're greyed and parked).
- **`walk{dir}`:** a path to the furthest walkable tile in a straight line in that direction.
- **`stop`:** `truncateAt`.
- **`setLook`:** validates every index against `AVATAR_OPTIONS` sizes (exported from `constants.ts`: skin 6, hair 6, hairColor 8, top 3, topColor 8, bottomsColor 6, accessory 6).
- **`emote`:** the kind must be in `EMOTES`. With a `target`, both players must be within `PROXIMITY`. The `emote` message goes to everyone. Emotes work in any phase but not while paused.
- **`host.startCompetition`:** only from warm-up. Sets `phase='competition'` and `competitionStartedAt=lastCallAt=now`. The `goesFirst` team gets `status='departed'` and `departedOrder=1`, and is pushed to `departures`. All scores are set to 0 with `scoreChangedAt=now`. Sends `youreUp` for that team and `banner` with the exact "🎉 Team {name}, you're up! Head to the next activity." copy, and sets `persist:true`.
- **`host.pause`/`host.resume`:**
  - Pause truncates every motion and sets `pausedAt`.
  - Resume shifts `nextCollectibleAt`, `quiz.endsAt` and every `riddleLockedUntil` forward by `now - pausedAt`.
  - Both send `banner` ("Paused" / "") and set persist.
- **`host.reset`:** returns to a fresh `createState(content)`, so the roster goes back to the content file, and on-day additions, moves and removals are dropped. It keeps the `look` of roster players, plus `online` and motions for players who still exist, and `msgCount`. Sets persist. The Room (Task 7) then closes every player socket with code 4002 so clients re-hello.
- **`host.movePlayer` / `host.removePlayer` / `host.setGoesFirst`:** warm-up only. Otherwise `error:"Only before the competition starts"`.

- [ ] **Step 1: Write the failing tests:**
  - `connect spawns at own table`.
  - `addSelf creates a player in warm-up and refuses during competition`.
  - `addSelf refuses a duplicate name in the same team`.
  - `move produces a motion message whose path starts at the current interpolated position`.
  - `move while paused is ignored`.
  - `setLook rejects out-of-range indexes`.
  - `emote with far target is rejected`.
  - `startCompetition departs the goesFirst team as 1st, zeroes scores, emits youreUp and exact banner`.
  - `startCompetition twice errors`.
  - `pause freezes motions; resume shifts deadlines by paused duration`.
  - `reset restores the content roster, drops on-day additions, keeps roster looks, clears scores and departures`.
  - `roster host actions only in warm-up`.
  - `persistable+restore round-trips everything except motions/online`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `index.ts` (dispatcher, `createState`, `publicSnapshot`, `persistable`, `restore`), `players.ts` and `phase.ts`. `publicSnapshot` leaves out riddle and boss answers, `quiz.answers`, and the prompt text of other people's icebreakers.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: core game reducer for players, movement, phases and roster`.

### Task 5: Scoring activities and tick

**Files:**
- Create: `src/shared/game/scoring.ts`, `src/shared/answers.ts`
- Modify: `src/shared/game/index.ts` (dispatch the new actions and `tick`)
- Test: `tests/unit/scoring.test.ts`, `tests/unit/answers.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `addPoints(state, teamId, n, reason:string, now): Outbound[]`. It's a no-op unless the phase is competition, the game isn't paused, and the team is playing. It updates `score` and `scoreChangedAt`, and returns `float{teamId, text:`+${n} ${reason}`}`.
  - `matchesAnswer(input:string, accepted:string[]): boolean`. It lowercases, trims, collapses whitespace, drops punctuation and a leading "a "/"an "/"the ", then compares exactly against each accepted answer normalised the same way.

Rules to implement:
- **Icebreakers:**
  - `icebreakerStart` needs the two players within `PROXIMITY`, on different teams, both online, and neither already in an open icebreaker. During competition, both teams must also be playing; otherwise it returns `error:"They've headed out!"`.
  - If the pair key is in `metPairs` (only recorded while competing), the starter gets `error:"already met! 🎉"`.
  - The prompt is `content.icebreakers[promptCursor++ % len]`, and the card goes to both players.
  - `icebreakerAnswered` sets `answeredBy`, and the updated card goes to both.
  - `icebreakerConfirm` must come from the *other* person. It closes the icebreaker. If competing and both teams are playing, it adds `POINTS.icebreaker` to each team with the reason "icebreaker" and records the pair in `metPairs`.
  - In warm-up it just closes, with no points and no pair recorded.
  - `icebreakerCancel` comes from either person.
- **Collectibles (on `tick`):**
  - In competition, when not paused: if `nextCollectibleAt` is null or past, and there are fewer than `MAX_COLLECTIBLES`, push one at `randomOpenSpot`. Then set the next spawn time 20–30 s later using `ctx.rng`.
  - For each online player on a playing team, a collectible is collected if `pathPassesNear(motion, lastTickAt, now, item, TILE*0.75)`. It's removed and scores `POINTS.collectible` with the reason "sparkle". Only the first player (by the sorted player id) collects it. Then set `lastTickAt=now`. Snapshot when anything changed.
- **Riddles:**
  - `riddleAnswer` requires competition, a playing team, `nearTable(own slot)`, and `now >= riddleLockedUntil`.
  - A correct answer scores `POINTS.riddle` with the reason "riddle" and increments `riddleIndex`.
  - The new `riddle` message (`q` null when the pool is exhausted) goes to the team. A wrong answer returns `error:"Not quite, try again!"`.
  - `riddleSkip` increments the index and sets `riddleLockedUntil = now + RIDDLE_SKIP_LOCK_MS`.
- **Quiz:**
  - `host.quizStart` errors if a quiz is active or it's not the competition phase. It takes `nextQuizIndex++ % len` and sets `endsAt = now + QUIZ_MS`. The question (without the answer) goes to everyone.
  - `quizAnswer` records the *first* answer per player, before `endsAt`, from players on playing teams only.
  - On `tick` after `endsAt`, for each playing team: `round(POINTS.quizMax * correctCount / max(1, activePlayers(team).length))`, computed at close time. Add the points with the reason "quiz". Send `quizResult` to everyone and set `quiz=null`.
- **`host.adjustScore`:** an integer delta within ±500. It bypasses the competition check but still updates `scoreChangedAt` and sends a float with the reason "adjusted".
- **Departure hook:** export `onTeamDeparted(state, teamId): Outbound[]` to close any open icebreaker involving that team (`closedReason:'departed'`). Task 6 calls it.

- [ ] **Step 1: Write the failing tests:**
  - `answers`: `"  The Piano! "` matches `["piano"]`; `"pianos"` doesn't.
  - `icebreaker needs proximity and different teams`.
  - `icebreaker confirm by other person gives +10 to both teams and records pair`.
  - `confirm by the answerer themselves is rejected`.
  - `same pair a second time gets "already met! 🎉"`.
  - `warm-up icebreaker gives no points and does not record pair`.
  - `departure cancels pending icebreakers`.
  - `icebreaker with a departed team's player is refused during competition`.
  - `departed team cannot score`.
  - `tick spawns at most 2 collectibles with 20–30 s spacing` (fake rng).
  - `walking through a collectible between ticks collects it once`.
  - `riddle needs to be near own table`.
  - `correct riddle +30 and next riddle sent to team only`.
  - `skip locks for 30 s`.
  - `quiz: second answer ignored; late answer ignored`.
  - `quiz points use percentage: 3 of 6 correct and 3 of 5 correct give 25 and 30`.
  - `quiz denominator ignores departed teams` (a team departing mid-quiz gets nothing).
  - `quizStart while active errors`.
  - `adjustScore updates scoreChangedAt`.
  - `addPoints is a no-op while paused`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: icebreakers, collectibles, riddles, quiz and scoring`.

### Task 6: Calling teams, undo and final boss

**Files:**
- Create: `src/shared/game/calls.ts`
- Modify: `src/shared/game/index.ts`
- Test: `tests/unit/calls.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 5 (`onTeamDeparted`, `matchesAnswer`).
- Produces: `nextLeader(state): TeamId | null`. This is the highest score among playing teams; ties go to the earliest `scoreChangedAt`, then the lowest `teamOrder` index. It also produces `ordinal(n): string` (`1ST`, `2ND`, `3RD`, `4TH` … `7TH`).

Rules to implement:
- **`host.callNext{expectedTeamId}`:**
  - It's competition-only. If `expectedTeamId !== nextLeader(state)` it returns `error:"The leader changed, check again"`.
  - The team departs with the next `departedOrder` and `lastCallAt=now`. Call `onTeamDeparted`, then send `youreUp`, the exact banner, and persist.
  - If exactly one team is then playing, also send `banner{text:"FINAL BOSS: escape the lobby!"}` and that team's `boss{index:0,q}`.
- **`host.undoCall`:** reverts the latest departure *unless* it's the `goesFirst` team. It restores `status='playing'` and `departedOrder=null`, pops `departures`, and sets `lastCallAt` to the previous call time, or `competitionStartedAt` if there is none. It sends a snapshot and a banner naming the team as "back in the game". It never touches scores.
- **`bossAnswer`:** only for the sole playing team, near its own table. A correct answer advances `bossIndex`. After the last step it sets `bossDone`, sends `celebrate{teamId}` to everyone and `boss{done:true}`. A wrong answer returns the same error as riddles. Boss progress survives an undo.

- [ ] **Step 1: Write the failing tests:**
  - `nextLeader picks highest score`.
  - `tie goes to team that reached the score first`.
  - `callNext departs the leader as 2ND with exact banner and youreUp`.
  - `callNext with stale expectedTeamId is rejected`.
  - `ordinal 1..7`.
  - `undo restores last called team but never the goesFirst team`.
  - `undo resets lastCallAt to previous call`.
  - `last team standing gets FINAL BOSS banner and step 0`.
  - `boss chain completes with celebrate`.
  - `bossAnswer from a team when 2+ are playing is rejected`.
  - `scores of departed teams are frozen` (an `addPoints` attempt leaves them unchanged).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: call next team, undo and final boss`.

### Task 7: Room Durable Object, protocol validation, persistence and host auth

**Files:**
- Modify: `src/server/room.ts`, `src/server/worker.ts`, `src/shared/protocol.ts` (add zod schemas)
- Test: `tests/worker/room.test.ts` (delete `echo.test.ts`)

**Interfaces:**
- Consumes: the reducer contract.
- Produces the wire protocol. Every client message is JSON, and the first one must be one of these:
  - `{t:'hello', playerId, token, takeover?:boolean}`
  - `{t:'addSelf', name, teamId, token}`, which on success behaves like a hello for the new id
  - `{t:'hostHello', pin}`

  After that, `{t:'act', a:<player action minus playerId>}`, or `{t:'host', a:<host action>}` on host sockets. Socket attachments (`serializeAttachment`) hold `{kind:'player', playerId, token} | {kind:'host'}`. These survive hibernation.

Rules to implement:
- **The constructor** uses `blockConcurrencyWhile` to load `storage.get('state')` → `restore`, or `createState(loadContent())`. It re-arms the alarm if the phase is competition.
- **Every incoming message:**
  1. Bump `msgCount` (reset when the UTC day changes).
  2. Validate it with zod. Invalid messages get `error:"bad message"`.
  3. Run `apply` with `{now: Date.now(), rng: Math.random, content}`.
  4. Route the `out` messages: `'all'` goes to every socket; `{team}` goes to sockets whose player is on that team; `'host'` goes to host sockets.
  5. If `snapshot`, broadcast `snapshot` to players and `hostState` to hosts.
  6. If `persist`, `await storage.put('state', persistable(state))`.
- **`msgCount`** is written to storage at most every 10 s (a separate key, `msgCount`).
- **Hello:**
  - An unknown playerId gets `error:"unknown player"`.
  - If another *open* socket holds that player with a **different** token and there's no `takeover`, reply `nameTaken`.
  - Otherwise close the older sockets for that player. Send them `kicked` only when the token differs; the same token is a silent replace. Then `connect`, and send `welcome`.
- **Host:** a wrong PIN closes the socket with code 4001. A correct PIN sends `hostState`.
- **`webSocketClose`:** `disconnect` happens only if no other open socket holds that player.
- **After `host.reset`:** close every player socket with code 4002 (host sockets stay open).
- **`alarm`:** `apply(tick)`. Re-arm `TICK_MS` later while in competition, or while a quiz is active.
- **`hostState`** includes `connectedPerTeam`, `msgCount.count`, `nextLeader` (id, name, score) and `lastCallAt`.

- [ ] **Step 1: Write the failing tests** in the workers pool, using a small `connect(…)` helper that returns a message queue:
  - `hello with roster id gets welcome with snapshot`.
  - `second device with different token gets nameTaken; takeover kicks the first`.
  - `reconnect with same token replaces old socket silently`.
  - `invalid JSON returns bad message`.
  - `host with wrong pin is closed 4001`.
  - `player cannot send host actions`.
  - `move broadcasts motion to other sockets`.
  - `team-addressed riddle message only reaches that team`.
  - `state survives object restart and alarm is re-armed`. Start the competition and score, then use `runInDurableObject` to read storage. Abort the instance (`ctx.abort()`), reconnect, and expect the same scores and departures and `getAlarm()` not null.
  - `msgCount increments per incoming message`.
  - `host reset closes player sockets with 4002`.
- [ ] **Step 2:** Run `npm test -- tests/worker`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: room durable object with protocol, persistence and host auth`.

### Task 8: Avatar art pipeline and avatar builder

**Files:**
- Create: `assets/lpc-manifest.json`, `scripts/fetch-lpc.ts`, `public/assets/lpc/**`, `CREDITS.md`, `src/client/avatar/layers.ts`, `src/client/join/avatarBuilder.ts`
- Test: `tests/unit/layers.test.ts`

**Interfaces:**
- Consumes: `AvatarLook` and `AVATAR_OPTIONS`.
- Produces:
  - `LAYER_ORDER = ['body','bottoms','shoes','top','hair','accessory']`
  - `layersFor(look): {key:string; tint:number|null}[]`: texture keys in draw order, with tints for hair, top and bottoms. `accessory:0` (none) produces no layer.
  - `preloadAvatarLayers(scene: Phaser.Scene)`
  - `randomLook(rng): AvatarLook`
  - `openAvatarBuilder(initial: AvatarLook, onDone:(look)=>void): void`: a DOM modal

Art rules: use the Universal LPC Spritesheet Character Generator repo (github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) at a pinned commit, and only its **walk** animation: 64×64 frames, 4 rows (up, left, down, right) × 9 frames. The manifest lists each file's repo path, local path, authors and licence. You need:
- 6 body skin tones
- 6 hairstyles in a light or white variant (tinted at runtime with 8 hair colours)
- 3 tops in white (tinted with 8 colours)
- 1 trousers in white (tinted with 6 colours)
- 1 shoes
- 5 accessories (hat, glasses, cap, headphones, bow)

If an accessory isn't available, substitute the closest one and note it in the manifest. `fetch-lpc.ts` downloads the files and writes `CREDITS.md` (title, author(s), licence, source URL per file). The downloaded files are committed.

- [ ] **Step 1: Write the failing tests:**
  - `layersFor puts layers in LAYER_ORDER`.
  - `accessory none adds no layer`.
  - `every key in layersFor for all option combinations exists in the manifest`. Iterate over each option dimension independently.
  - `randomLook stays in range`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Write the manifest, run `npx tsx scripts/fetch-lpc.ts`, and implement `layers.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Implement `avatarBuilder.ts`:
  - It's one full-screen modal: a live preview (an animated Phaser mini-canvas facing down, or a stack of `<canvas>` layers) and one row per option with ‹ › buttons and colour swatches.
  - It has **Randomise** and **Enter room** buttons. The look is pre-filled with `randomLook`.
  - At 390×844, every control is at least 44 px and nothing scrolls.
  - The join screen footer has a "Credits" link to `CREDITS.md`.
- [ ] **Step 6:** Check by eye at 390×844 in the dev server: every option changes the preview.
- [ ] **Step 7:** Commit: `feat: LPC avatar layers, credits and avatar builder`.

### Task 9: Client networking and join flow

**Files:**
- Create: `src/client/net.ts`, `src/client/join/namePicker.ts`
- Modify: `src/client/main.ts`, `src/client/index.html`, `src/client/styles.css`
- Test: `tests/unit/net.test.ts`

**Interfaces:**
- Consumes: the protocol (Task 7) and the avatar builder (Task 8).
- Produces:
  - `class Net { connect(hello); send(a); on(type, fn); serverNow(): number; state: 'connecting'|'open'|'reconnecting' }`
  - `clockOffset(samples: {sent:number; server:number; received:number}[]): number`, the median of `server - (sent+received)/2`
  - `main.ts` stores `{playerId, token}` in `localStorage['lobby.me']`. The token is a `crypto.randomUUID()` per browser.

Rules to implement:
- **Reconnect** with backoff of 0.5 s, 1 s, 2 s, then capped at 5 s.
- **On `visibilitychange` → visible**, if the socket isn't open, reconnect immediately. Every reconnect re-sends the stored hello, so the same token is reused.
- **`kicked`** shows "You opened the lobby somewhere else" with a "Use this device" button (sends hello with `takeover:true`).
- **Clock:** the offset comes from `welcome.serverNow` and from a `serverNow` field on every `snapshot` message (add it to `protocol.ts`). Don't add pings, because they cost message budget.
- **Unknown player:** `error:"unknown player"` in reply to a hello (e.g. after a host reset dropped an on-day addition) clears `lobby.me` and shows the name picker. Close code 4002 (reset) means reconnect immediately.
- **Name picker:**
  - Roster grouped by team in team colours, from the snapshot fetched by connecting with a read-only `{t:'peek'}` message. Add `peek` to the protocol: it replies with `snapshot` only and doesn't count as a player.
  - The "I'm not on the list" button opens a name field and a team picker, then sends `addSelf`.
  - `nameTaken` shows "Is this you? Take over.", which sends hello with `takeover:true`.
  - Removed players are hidden.
- **Flow:**
  - Stored identity → hello → room. If the player has no look, open the builder first, then `setLook` → room.
  - No stored identity → picker → builder → `setLook` → room.
- **CSS:**
  - Viewport meta: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`.
  - `html,body{height:100dvh; overflow:hidden; overscroll-behavior:none; touch-action:none}`; inputs and buttons `touch-action:manipulation`.
  - Inputs at `16px` or more.

- [ ] **Step 1: Write the failing tests:**
  - `clockOffset median of 3 samples`.
  - `Net reconnect delays follow 0.5,1,2,5,5`. Use fake timers and a fake WebSocket.
  - `reconnect re-sends the same hello`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `net.ts`, add `peek` and `serverNow` to the protocol and Room (and extend `room.test.ts` with `peek returns snapshot without connecting a player`), then implement the picker and flow.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Manually: two browser profiles can join as different people. The same person on a second profile sees "Is this you? Take over."
- [ ] **Step 5:** Commit: `feat: client networking, name picker and join flow`.

### Task 10: Room scene (A+ art, avatars, camera, movement)

**Files:**
- Create: `src/client/room/RoomScene.ts`, `roomArt.ts`, `avatarSprite.ts`, `camera.ts`, `input.ts`
- Modify: `src/client/main.ts`
- Test: `tests/unit/camera.test.ts`

**Interfaces:**
- Consumes: `LAYOUT`, `positionAt`, `layersFor`, `Net`, `PublicSnapshot`.
- Produces:
  - `startRoom(net, me): RoomApi`, where `RoomApi = { scene; onTapAvatar(fn); onNearChange(fn: (others: PlayerId[], nearOwnTable: boolean)=>void); setZoomedOut(b) }`
  - `fitZoom(viewW, viewH, worldW, worldH): number`
  - `followZoom(viewW): number`, which shows about 12 tiles across on phones and is capped at 2 on laptops
  - `isPhoneLayout(viewW, viewH): boolean` (portrait, width under 600)

Rules to implement:
- **`roomArt.ts`** draws the A+ look procedurally into generated textures, matching the first card of `.superpowers/brainstorm/*/content/room-style-v2.html`:
  - Plank floor, striped wallpaper wall with baseboard, a window with a light beam, plants, a lamp, a soft vignette and a lamp glow.
  - Tables 3×2 tiles with a top, highlight, front face, legs, shadow and a name card.
  - A greyed variant of each table.
  - Use `pixelArt: true` and `roundPixels`.
- **The wall leaderboard** is a framed chalkboard texture redrawn from the snapshot. Playing teams are ranked with scores and the leader is highlighted. Departed teams are listed below as `✅ {ordinal} {name}`.
- **Each table** has a floating sign above it: `★ {score}` or `✅ WENT {ordinal}`, in a pixel-style bitmap or monospace font, readable at follow zoom.
- **Avatars** are a container of layer sprites playing `walk-{dir}` while moving, or frame 0 of the last direction while still. The direction comes from the current path segment.
  - Position: `positionAt(motion, net.serverNow())` every frame. Depth = y.
  - A name label shows when within `PROXIMITY` of me. My own avatar has a small bobbing arrow.
  - Avatars of departed teams get a grey tint and a ✅. Offline players fade out over 1 s.
- **Input:**
  - Tap or click on the floor sends `move{to}` (one message per tap) and shows a small target marker. A tap on an avatar calls `onTapAvatar` instead.
  - On laptops, WASD/arrow keydown sends `walk{dir}` and keyup sends `stop`. Key repeat is ignored.
- **Camera:** on phone layouts, follow me at `followZoom`. On other layouts, show the whole room at `fitZoom` if that's at least 0.75, and follow otherwise. `setZoomedOut(true)` tweens to `fitZoom` centred on the room. It resizes on `resize` and `visualViewport.resize`.

- [ ] **Step 1: Write the failing tests:**
  - `fitZoom fits 768x1152 in 390x700 → ≈0.338`.
  - `followZoom(390) shows ~12 tiles`.
  - `followZoom(1440) is capped at 2`.
  - `isPhoneLayout(390,844) true, (1440,900) false`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Manually: with three browser windows, movement is smooth on all three, people can walk behind tables, zoom-out shows all 7 tables, and the wall board updates.
- [ ] **Step 5:** Commit: `feat: A+ room scene with layered avatars, camera and movement`.

### Task 11: In-room interactions UI

**Files:**
- Create: `src/client/ui/hud.ts`, `ui/modals.ts`, `ui/banners.ts`, `ui/confetti.ts`
- Modify: `src/client/room/RoomScene.ts` (collectible sprites, emote bubbles, float texts, table flash)

**Interfaces:**
- Consumes: `RoomApi`, `Net` messages from Tasks 5–7.
- Produces: no exports used later.

Rules to implement (DOM overlays, 44 px or larger, safe-area padding):
- **HUD:** three corner buttons: zoom-out toggle, leaderboard (opens an overlay listing the same ranking as the wall board), and "Edit avatar" (reopens the builder, then `setLook`). A **Riddle** button appears only when `nearOwnTable` and the phase is competition. While the boss is active it becomes **Final boss**.
- **Proximity prompt:** when exactly one or more others are near, show a bottom sheet with the nearest person's name and team, the four emote buttons, and **Icebreaker** if they're on another team. Tapping an avatar selects that person.
- **Icebreaker card:** shown to both players, with the prompt text and **"We answered it!"**. After one person taps it, the other sees **Confirm** and the answerer sees "Waiting for {name}…". Both see **Cancel**. Close it on `card:null`. Show `error` text such as "already met! 🎉" as a toast.
- **Riddle and boss modal:** the question, an answer field, Submit and **Skip** (riddles only; it shows a 30 s countdown from `lockedUntil`). Show "All riddles solved!" when `q` is null.
- **Quiz modal:** pops up for everyone on a playing team with 4 large choice buttons and a 20 s countdown. It closes when you answer ("Answer locked in") or when time runs out. `quizResult` shows a 3 s toast with the correct answer.
- **Scene:** collectibles are a sparkle sprite with a twinkle tween. `emote` shows an emoji bubble over the sender (and the target for a high-five, plus a small jump). `float` shows a rising "+30 riddle" text over that team's table.
- **Banners:**
  - `banner` shows a full-width top banner for 6 s ("Paused" stays until it's cleared).
  - `youreUp` for my team makes the table flash and shows a full-screen "You're up!" overlay with the banner text.
  - `celebrate` shows confetti and "You escaped!" for that team, and a smaller banner for everyone else.

- [ ] **Step 1:** Implement the HUD and proximity prompt. Manually: two windows near each other see the prompt, and emotes show on both.
- [ ] **Step 2:** Implement the icebreaker card. Manually: start, answer and confirm across two windows. During competition both table signs go up by 10. Doing it again shows "already met! 🎉".
- [ ] **Step 3:** Implement the riddle/boss and quiz modals. Manually: a correct riddle at your own table gives +30 with a float; triggering a quiz from the host page (Task 12) shows the modal.
- [ ] **Step 4:** Implement collectibles, floats, banners, the "You're up!" overlay and confetti. Manually: walking over a sparkle gives +15.
- [ ] **Step 5:** Run `npm test`. Expected: still PASS.
- [ ] **Step 6:** Commit: `feat: proximity, icebreakers, riddles, quiz, collectibles and banners UI`.

(Tasks 11 and 12 can be built in either order. Do Step 3's quiz check once Task 12 exists.)

### Task 12: Host page, bots, mobile end-to-end checks

**Files:**
- Create: `src/client/host.html`, `src/client/host/host.ts`, `scripts/bots.ts`, `playwright.config.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/host.spec.ts`
- Test: `tests/unit/host-format.test.ts`

**Interfaces:**
- Consumes: the protocol and `hostState`.
- Produces:
  - `callTimerState(lastCallAt, now): 'normal'|'amber'|'green'`, which is amber from `CALL_AMBER_MS` and green from `CALL_GREEN_MS`
  - `formatElapsed(ms): string` (`m:ss`)
  - `npm run bots -- --url <base> --bots 35 --minutes 5 --pin <pin>`

Host page rules (a single column, phone-friendly, large buttons):
- A PIN screen, stored in `sessionStorage`.
- The live leaderboard and a connected count per team (e.g. "Pixel 5/5").
- A big "time since last call" timer coloured by `callTimerState`.
- The buttons:
  - **START COMPETITION** (warm-up only)
  - **CALL NEXT TEAM**, which opens a confirm showing "This will call TEAM {NAME} ({score} pts)" and sends `callNext{expectedTeamId}`
  - **QUICK-FIRE QUIZ** (disabled while a quiz is active)
  - **Undo last call**
  - Per-team **±** buttons (±5 and ±10)
  - **Pause / Resume**
  - **Reset event**, with two confirms, the second needing the word RESET typed in
- A **People** panel (warm-up only) to move a player to a team, remove them, or set which team goes first.
- A **QR** panel: a large QR code (`qrcode`) of the join URL plus the plain URL, suitable for projecting.
- A footer: "Messages today: N / 30,000 budget", red above 80%.
- Errors from the server show as toasts.

Bots rules: each bot joins with an `addSelf` name `Bot NN` spread across teams. Before running, the script sends `host.reset` only if `--reset` is passed. With `--start`, it sends `host.startCompetition` once all bots have joined, so scoring paths get exercised. It sends `host.reset` again at the end if `--reset` was passed, which removes the bots. Each bot taps a random walkable spot every 3–6 s, sometimes starts or answers icebreakers with nearby bots, attempts riddles at its table with a wrong answer then skips, and answers quizzes randomly. The script prints the server `msgCount` from a host socket at the start and end, and extrapolates to 35 minutes.

- [ ] **Step 1: Write the failing tests:**
  - `callTimerState: 4:29 normal, 4:30 amber, 5:00 green`.
  - `formatElapsed(65000) = "1:05"`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `host.ts`. Run the tests. Expected: PASS.
- [ ] **Step 4: Write the Playwright tests** against `npm run dev`, using iPhone 13 and Pixel 7 device profiles:
  - `mobile: join, build avatar, enter room`: the canvas is visible.
  - `mobile: no zoom or scroll`: after tapping the floor 5 times, double-tapping, and focusing the "I'm not on the list" name input, `window.visualViewport.scale === 1` and `document.scrollingElement.scrollTop === 0`; every `input` has a computed font-size of at least 16 px.
  - `mobile: tap moves my avatar`: read `window.__lobbyDebug.me()` position (expose this debug hook only when `import.meta.env.DEV`).
  - `host: start, call next shows confirm with exact copy, undo`.
- [ ] **Step 5:** Run `npx playwright test`. Expected: PASS.
- [ ] **Step 6:** Implement `bots.ts`. Run it locally: `npm run bots -- --url http://localhost:5173 --bots 35 --minutes 5 --pin 1234 --reset --start`. Expected output includes `projected 35-min messages:` with a value under 30000, and the dev room visibly fills with moving bots. If it's over, reduce client-side chatter (never server-side validation) and re-run.
- [ ] **Step 7:** Commit: `feat: host page, bot load test and mobile e2e checks`.

### Task 13: Deploy and organiser guide

**Files:**
- Create: `README.md`
- Modify: `package.json` (scripts `deploy`, `bots`)

- [ ] **Step 1:** Write `README.md`. Keep it short, in plain language, with sections:
  1. **Set up Cloudflare once:** create a free account, run `npx wrangler login`, run `npx wrangler secret put HOST_PIN`, then `npm run deploy`. The URL is printed.
  2. **Update the roster:** edit `content/event.json`, run `npm test`, then `npm run deploy`.
  3. **Optional own domain.**
  4. **Day-of checklist:** open `/host` about 15 minutes early; press Reset if you did a dry run today; project the QR code; and check "Messages today" after each dry run.
  5. **Facilitator cheat sheet:** which button, and when.
  6. **Fallback:** if Cloudflare limits are hit, deploy to a paid Node host. Note that this is not built and would need work, so the bot check matters.
- [ ] **Step 2:** The user creates the Cloudflare account and runs `npx wrangler login` themselves (suggest `! npx wrangler login`). Then run `npx wrangler secret put HOST_PIN` and `npm run deploy`. Expected: a `https://team-lobby.<account>.workers.dev` URL.
- [ ] **Step 3:** Run `npm run bots -- --url <deployed> --bots 35 --minutes 5 --pin <pin> --reset --start` against production. Expected: projected messages under 30000, no errors in `npx wrangler tail`, and the room back to a clean warm-up afterwards.
- [ ] **Step 4:** Do a real-device smoke test with the user: at least one iPhone and one Android join via the QR code, walk, do an icebreaker and a riddle, and receive a call.
- [ ] **Step 5:** Commit: `docs: organiser guide and deployment`.
