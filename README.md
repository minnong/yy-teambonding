# Team Lobby

Team Lobby is a phone-first pixel-art lobby for an in-person team event with 36 people in 7 teams. Everyone scans a QR code, picks their name, builds an avatar and wanders a shared room during a warm-up. When the competition starts, the facilitator calls the teams out one at a time, about 5 minutes apart, so they move on to the next activity staggered.

It runs on Cloudflare (free plan). Nothing is kept after the event.

## 1. Set up Cloudflare (once)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Log in from this folder: `npx wrangler login`. In Claude Code you can type `! npx wrangler login`. A browser window opens; approve it.
3. Set the host PIN: `npx wrangler secret put HOST_PIN`, then type the PIN when asked.
   - For the real event, use a long random PIN (12 or more characters). A 4-digit PIN can be guessed.
4. Deploy: `npm run deploy`. It prints the address, like `https://team-lobby.<account>.workers.dev`. That is the player link. The host page is the same address followed by `/host`.

## 2. Update the roster

Edit `content/event.json`:

- `teams`: each has an `id`, a `name` and a `color` (hex). Exactly one team must have `"goesFirst": true`.
- `players`: each has an `id` (unique), a `name` and a `teamId` that matches a team.

```json
{
  "teams": [
    { "id": "otter", "name": "Otter", "color": "#137A7F", "goesFirst": true },
    { "id": "pixel", "name": "Pixel", "color": "#6A3FB5" }
  ],
  "players": [
    { "id": "p01", "name": "Aisha", "teamId": "otter" },
    { "id": "p02", "name": "Ben", "teamId": "pixel" }
  ]
}
```

The same file also holds the icebreakers, riddles, quiz questions and the final boss puzzle. Then run `npm test` (it checks the file) and `npm run deploy`.

## 3. Optional: your own domain

The domain must already be on Cloudflare. In the Cloudflare dashboard, open Workers & Pages, then `team-lobby`, then Settings, then Domains & Routes, and add a custom domain (or route).

## 4. Dry run

Fill the room with 35 fake players:

```
npm run bots -- --url https://team-lobby.<account>.workers.dev --allow-remote --bots 35 --minutes 5 --pin <your pin> --reset --start
```

- It only works while the room is in warm-up. A room that is already in the competition is never reset by the bots.
- It wipes the room at the start and again at the end. Anyone real who joined during the run is wiped too.
- Afterwards, check the "Messages today" figure in the host page footer (see the checklist).
- Then join from 2 or 3 real phones (at least one iPhone and one Android). Walk around, do an icebreaker and a riddle.

## 5. On the day

- [ ] Open `/host` about 15 minutes early and enter the PIN.
- [ ] If you did a dry run today, press Reset (Scores tab, Danger zone).
- [ ] Open the QR tab, press "Show QR full-screen" and project it.
- [ ] Check "Messages today" in the footer. The free plan allows 100,000 requests a day; a 36-person session uses about 13,000. The app stops a session at about 26,000. So do no more than about 2 full dry runs on the same day as the event.
- [ ] Keep one laptop or phone on `/host` for the facilitator.

## 6. Running it (organiser, minutes 0 to 5)

1. Warm-up: everyone scans, picks a name, builds an avatar, wanders, uses emotes and icebreakers. No points yet. The host page shows each team's online count.
2. About minute 5, press START COMPETITION on the Run tab and confirm. The first team is marked as going first and its table greys out. Scoring opens for the other teams.
3. Leave with the first team. The facilitator takes over the host page.

## 7. Facilitator cheat sheet

All buttons are on the Run tab unless noted. Tabs: Run, Scores, People, QR.

| Button | When | What happens |
|---|---|---|
| CALL NEXT TEAM | When the next activity is ready (about every 5 minutes) | The confirm shows the team's name. Press "Yes, call them". Their table flashes "You're up!", their score freezes, they head out. The timer turns amber at 4:30 and green at 5:00. If it says "The leader changed, check again", the order moved just now; press again. |
| QUICK-FIRE QUIZ | When energy dips | Starts a short quiz for everyone still in the room. It reads QUIZ RUNNING... until it ends. |
| Undo last call | You called by mistake | Brings the last team back into the game. The button names the team. |
| Pause / Resume | You need everyone to stop for a moment | Freezes the room (the header shows PAUSED). Resume carries on. |
| Scores tab: +/- buttons | A dispute over points | Adjusts a team's score. |
| Scores tab: Reset event | Dry runs only | Clears everything and sends everyone back to the start. You must confirm twice and type RESET. |

Other things to know:

- "Reconnecting..." at the top of the host page means the connection dropped. The buttons are disabled until it is back (a few seconds). Nothing is lost.
- The last team left gets a "final boss" puzzle. Call them when the next activity is ready, whether or not they finished it.
- Each button ignores very quick double taps on purpose.

## 8. Troubleshooting

- A name is not on the list: the person taps "I'm not on the list" and types their name (warm-up only), or you move or add them in the People tab.
- Someone opened it on two devices: on the newer one they tap "Use this device".
- A phone was locked or went to sleep: it reconnects by itself.
- "Whoa, slow down a little!": they are tapping very fast. It is harmless and clears after a moment.
- Headphones and bow accessories currently show as headbands, because the free art pack has none.

## 9. Fallback

If Cloudflare's free limits are hit, the alternative is a paid Node host (about $5 to 7 a month). That version is not built and would need work, so the dry-run message check matters.

## 10. Credits

The art comes from the Liberated Pixel Cup (LPC) character generator. Full attribution is in `CREDITS.md`, which is linked from the app.

## For developers

- `npm run dev`: local dev server.
- `npm test`: unit and worker tests (builds first).
- `npx playwright test`: browser tests (local only).
- `npm run typecheck`: type check.
