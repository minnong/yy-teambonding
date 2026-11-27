# Team Lobby: Design

*Date: 2026-11-26. Status: ready for approval. Event around 2026-12-10.*

## 1. What this is, and why

A browser-based virtual room for a one-off, in-person team-bonding session. Everyone in the room joins from **their own phone**, by scanning a QR code. Laptops work too. Each person makes a quick pixel-art avatar and walks around a shared lobby. The lobby has one table per team, showing the team name and live score, and a leaderboard on the wall.

**The real job of the game is to stagger the teams** for the activity that follows it. The next activity takes one team at a time, about every 5 minutes. The lobby game decides the order teams leave in and keeps the teams still waiting entertained and mixing until their turn.

- Team 1 is **pre-decided** and leaves first. The organiser goes with them to run the next activity.
- Every following team is the **current leader at the moment the facilitator presses "Call next team"**.
- After the organiser leaves, a **facilitator** runs the rest of the session from a host page.

## 2. Event facts (constraints)

| Fact | Value |
|---|---|
| People | 36 |
| Teams | 7: six teams of 5, one team of 6. The organiser assigns teams beforehand. |
| Setting | Everyone is in the same physical room. **They use their own phones, held upright (portrait), as the main device.** Laptops are also supported. People talk face to face, so the site needs no voice or video. |
| Date | **The event is about 2 weeks away (around 2026-12-10).** The organiser wants it finished early: build complete in roughly week 1, dry runs and fixes in week 2. |
| Duration | Aim for 30 minutes; about 35 is acceptable (see timeline). |
| Network | Internet access is available, via venue Wi-Fi or mobile data. Devices can open outside websites. |
| Hosting | Hosted online on **Cloudflare's free plan** (decided): Workers plus Durable Objects. The free `*.workers.dev` address is the default; the organiser's own domain is optional and needs its settings moved to Cloudflare. |
| People who run it | The organiser for the first ~5 minutes, then a facilitator who may not be technical. |

## 3. Run of show

```
 Before   Organiser fills in the roster (names → teams, team names, which team goes first).
          Shows a QR code (plus a short link) on a screen or slide. Opening it in advance is optional; most people won't.
 0–5 min  WARM-UP. Everyone scans the QR code, picks their name, builds an avatar (1–2 min,
          randomise button), spawns at their team's table, wanders, uses emotes and
          icebreaker prompts. No points.
 ~5 min   Organiser presses START COMPETITION on the host page:
            • Team 1 is marked "went 1st" and its table greys out.
            • Scores for the other 6 teams start at 0 and all scoring activities unlock.
          Organiser leaves with Team 1. The facilitator takes over the host page.
 ~10–30   Facilitator presses CALL NEXT TEAM about every 5 min. The current leader is
          called: their table flashes "You're up!", they're marked "went Nth", their score
          freezes, and they head out. Everyone else keeps playing.
 ~30–35   Once only one team remains, it gets the FINAL BOSS puzzle. The facilitator calls
          them whenever the next activity is ready (puzzle finished or not).
```

## 4. Goals, non-goals, anti-goals

**Goals**
- Everyone is in the room with an avatar within ~2 minutes of opening the link.
- Teams leave in a clear, fair, visible order, and the facilitator controls the timing.
- The teams still waiting stay engaged right up to their call, including the last team.
- Cross-team mixing: the scoring should reward talking to people from other teams.
- A non-technical facilitator can run it with no training.

**Non-goals**
- Voice, video or text chat (everyone is in the same physical room).
- Accounts, passwords or email sign-up.
- Native app or app-store install. It's a website only.
- Tablet-specific layouts. Tablets get the phone or laptop layout, whichever fits.
- Reuse as a product. It's a one-off event, but driven by config so it can be re-run.
- Keeping data after the event.

**Anti-goals (failure even if it "works")**
- The site freezes, lags or loses scores mid-event.
- People stuck on an avatar screen while the room has already started.
- On a phone: text too small to read, buttons too small to tap, or the page zooming or scrolling when people try to walk.
- The facilitator unsure which button to press or who's been called.
- The order feeling rigged or confusing (e.g. ties, or a score jumping without explanation).
- The last team or two sitting in an empty room with nothing to do.

*Being called early is the prize. Teams want to go first, so the design needs no mechanic to stop teams deliberately losing.*

## 5. The experience

### 5.1 Joining
1. Scan the QR code (or open the short link) → a **name picker**: the roster grouped by team. Click your name.
   - If someone already took that name (wrong tap, or a device switch): "Is this you? Take over." The old session is disconnected.
   - The browser remembers who you are, so a refresh puts you straight back in the room.
2. **Avatar builder**, one screen:
   - Options: skin tone, hairstyle, hair colour, top (style and colour), bottoms colour, and one accessory (none / hat / glasses / cap / headphones / bow).
   - A live preview, a **Randomise** button, and an **Enter room** button.
   - Avatar parts are pre-filled randomly so "Enter room" works immediately.
   - People can re-open the builder from inside the room at any time.
3. You spawn next to your team's table.

### 5.2 The room (visual style "A+": detailed pixel art with depth)
- A top-down, three-quarter-view pixel-art room: back wall with a window, light beam, plants and lamps; wooden plank floor; soft shadows; a gentle vignette. Tables have tops, front faces and legs. Avatars are depth-sorted, so people can walk behind tables and each other.
- **Phone layout (main), upright:** the view **follows your own avatar**, zoomed in so names, scores and buttons are easy to read and tap. A **zoom-out button** shows the whole room at once (tap again to zoom back in), so people can still see every team. A **leaderboard button** is always in a corner and opens the full ranking as an overlay. The room can be taller than it is wide to suit upright phones: the leaderboard on the back wall at the top, and the 7 tables in staggered rows below with walking space around them.
- **Laptop layout:** the same room. The whole room fits on one screen if it can, and the follow-camera is used if not.
- **Each table** shows the team name on a card on the tabletop and a floating score sign above it: `★ 240`, or after leaving, `✅ WENT 2ND`. Tables of teams that have left are greyed out.
- **The leaderboard** on the wall lists the teams still playing, ranked with their scores, and teams that have left in departure order. The current leader is highlighted. The wall board is visible in the zoomed-out view; the leaderboard button (see above) gives the readable version on phones.
- Every avatar shows a small name label (first name) when nearby. Your own avatar has a subtle marker.
- Movement on phones: **tap a spot to walk there**. An optional on-screen joystick can be added. The page must not scroll, zoom or bounce when people tap or drag. Movement on laptops: arrow keys or WASD, plus click-to-walk.
- The game must still work on mid-range phones from the last ~5 years (iOS Safari and Android Chrome), and recover cleanly after the screen locks or the browser goes to the background.

### 5.3 Near another avatar (proximity)
Walking within about 2 avatar-widths of someone shows their name and team, plus a small action prompt. On a phone, tap their avatar or the prompt.
- **Emotes** (any phase): wave 👋, high-five 🙌, laugh 😂, heart ❤️. These show as a speech-bubble emoji over both avatars, and the high-five plays a little animation.
- **Icebreaker** (with someone from **another team**): both people see the same prompt card ("What's the best meal you've had this year?"). Either person can press "We answered it!" and the other confirms. During the competition this gives **both teams points**. During the warm-up it's just for fun.
  - Each pair of people can score from an icebreaker **once**, which stops point farming. After that they get "already met! 🎉".
  - It works on the honour system; nobody checks answers.

### 5.4 Scoring activities (competition phase only)

| Activity | How it works | Points (starting values, tune in a dry run) |
|---|---|---|
| Cross-team icebreaker | As in 5.3. Each pair scores once. | +10 to each of the two teams |
| Collectibles | A sparkle item appears at a random open spot every ~20–30 s and stays until someone walks over it. 1–2 are on the map at once. | +15 to the collector's team |
| Table riddles | Walk to your own table and tap the riddle button (on a laptop, press E) to open your team's riddle. Anyone on the team can type an answer. A correct answer (forgiving match: case, spaces, accepted alternatives) earns points and loads the next riddle. A "skip" option has a 30 s lockout. | +30 per riddle |
| Quick-fire quiz | The facilitator triggers it. Everyone gets the same multiple-choice question with a 20 s timer and keeps playing afterwards. | Up to +50 per team, scaled by the **percentage** of the team that answered correctly, so the team of 6 isn't advantaged |

Every score change briefly floats above the table that earned it ("+30 riddle!"), so jumps are never unexplained.

### 5.5 Calling teams
- **Who gets called:** the highest score among teams still playing. **Ties:** whichever team reached that score first.
- When called, the team's table flashes, a room-wide banner says "🎉 Team Otter, you're up! Head to the next activity.", and their screens show a "You're up!" overlay. Their score freezes and they drop off the live ranking into the "went Nth" list.
- The called team's avatars stay in the room, greyed with a ✅, until their devices disconnect. Then they fade out.
- Teams that have left can't earn or give points. Icebreakers with them don't score.

### 5.6 Final boss (last team standing)
When only one team remains, a room-wide banner announces "FINAL BOSS: escape the lobby!" The last team's table opens a short chain of 4–5 linked puzzles, roughly 4–5 minutes in total. Completing it triggers a celebration (confetti, "You escaped!"). It's for fun and doesn't decide anything. The facilitator calls them whenever the next activity is ready.

### 5.7 Host page (organiser, then facilitator)
A separate page (`/host`) protected by a PIN, designed for someone non-technical. It has a few large buttons and big, clear status text:

- **Live view:** the leaderboard, how many people are connected (per team), and a **"time since last call"** timer that turns amber at 4:30 and green at 5:00.
- **START COMPETITION:** ends the warm-up, marks Team 1 as gone, starts scoring.
- **CALL NEXT TEAM:** shows *who* will be called ("This will call TEAM PIXEL (210 pts)"), then asks for confirmation.
- **QUICK-FIRE QUIZ:** sends the next quiz question. It's disabled while one is already running.
- **Undo last call:** for mistakes.
- **Adjust score (±):** per team, for disputes.
- **Pause / resume:** freezes scoring and movement, and shows "Paused" to everyone.
- **Reset event:** for a dry run. It needs a double confirmation.

The host page can be open on more than one device at once, phone or laptop, so the organiser and facilitator can both have it, and stays in sync. It must be easy to use on a phone too.

## 6. Content

**How content is edited** (*builder's call*): before the event, everything lives in one content file in the project. The organiser sends their changes and the builder updates and redeploys. There's no content editor on the live site. The roster is the one exception, because it can go wrong on the day:
- The name picker has an **"I'm not on the list"** option: type your name and pick your team.
- The host page has a small **People** panel to move someone to another team or remove a no-show, and to change which team goes first, but only before START COMPETITION.

A content file pre-filled by the builder:
- **Roster:** team names, members, which team goes first. The organiser supplies the real names and teams.
- **Icebreaker prompts:** about 60, light and workplace-safe.
- **Table riddles:** about 15 per team, enough that a fast team won't run out in 25 minutes. All teams can share one pool in the same order.
- **Quick-fire quiz questions:** about 12, multiple choice, general knowledge and fun.
- **Final boss puzzle chain:** one chain of 4–5 linked puzzles.

## 7. Approaches considered

**Hosting** (where the live "brain" runs):
1. **Hosted online.** **Chosen.** It works on any network, and it keeps running after the organiser leaves the room at minute 5 with their laptop. Three hosting options were compared:
   - **Cloudflare Workers + Durable Objects, free plan.** **Chosen.** It costs nothing, doesn't sleep, and its built-in storage saves state, so it survives restarts.
   - **Render free.** Rejected. It sleeps after 15 minutes idle, takes about a minute to wake, may restart at any time, and has no disk, so scores could be lost.
   - **Render or Railway paid** (about $5–7 a month). Kept as the fallback.
   - Vercel was ruled out: it can't hold the long-lived connections the game needs.
2. **The organiser's own laptop on the venue Wi-Fi.** Rejected. The laptop leaves the room with Team 1, and venue Wi-Fi often blocks laptop-to-laptop connections.
3. **A managed live-database service and no server.** Rejected. It handles 36 avatars moving at once poorly, so movement would be laggy or jumpy.

**Device:** laptop-only was the first plan. **Changed to phone-first** so people don't need a laptop. Two phone layouts were considered: upright with a follow-camera and a zoom-out button, or sideways with the whole room always on screen. **Upright was chosen**, because sideways makes names and scores too small and is awkward to hold.

**Visual style:** retro pixel art, flat cartoon, and isometric were shown first. Then three ways to make the pixel art more 3D: A+ (detailed pixel art with depth), voxel 3D, and smooth 3D. **The organiser picked A+.** Mockups are in `.superpowers/brainstorm/` (`room-style-v2.html`, first card).

**Event format:** host-run rounds vs. self-serve stations. **Chosen:** self-serve stations with the facilitator controlling *when* teams leave. This splits "who's next" (the game) from "when" (the next activity's pace).

## 8. Technical direction (builder's calls, recorded so they can be revisited)

- **Client:** a browser game built on a 2D game framework suited to pixel art (Phaser 3 is the suggestion), in TypeScript.
- **Server:** a **Cloudflare Worker** serves the site and sends each player's connection on to a **single Durable Object** that represents the room. The Durable Object holds the live state, keeps everyone's live connections open, and is the authority on scores, calls, collectibles and phase, so clients can't award themselves points.
- **Message budget:** the free plan allows 100,000 requests a day, and incoming live-connection messages count toward it. To stay well under, clients send **intents, not streams**: one message per tap-to-walk destination or key press/release, plus actions. Each client animates walking along the path locally. Bot mode must measure the total message count for a full 35-minute session, and the design should keep it under about 30% of the limit, which leaves room for dry runs on the same day. If it can't, fall back to paid hosting.
- **State:** in memory in the Durable Object, written to its built-in SQLite storage on every score, call or phase change (positions don't need saving), so a restart mid-event restores scores, departures and phase.
- **Hosting:** deployed with Cloudflare's command-line tool (`wrangler`) from the project. The organiser creates a free Cloudflare account, and the builder walks them through it. Optionally add a custom domain later.
- **Art** (*builder's call, because of the 2-week timeline*): start from an openly licensed set of layered pixel-art character sprites (body, hair, top, bottoms, accessory) so customisation is a matter of swapping layers, plus a matching room tileset. Include the attribution the licence requires, and add a few small original touches where needed. The look should match the A+ mockup. Sprites and text must be large enough to read at phone size.
- **Testing:** a **bot mode** that fills the room with 35 simulated players who walk around and score, for load testing and a solo dry run. There should also be at least one full dry run before the day, with a handful of real phones (both iPhone and Android) plus one laptop as the host page.

## 9. Left to the builder
- Exact room dimensions, table placement, tile and sprite sizes, and camera zoom levels.
- Exact point values and collectible timing, tuned in the bot-mode dry run.
- The proximity radius, emote set and animations.
- The answer-matching rules for riddles.
- Writing the default content (prompts, riddles, quiz, final boss).
- The hosting provider and deployment details.
