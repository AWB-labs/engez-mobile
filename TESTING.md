# Smoke test — multi-device play session

A practical checklist, ordered as one real play session. You need **4
players**: 2 phones running Expo Go + 2 more devices — extra phones, or
browsers pointed at the same Worker URL (web and mobile share rooms, so mixing
is fine and worth testing). All devices on the same server
(`EXPO_PUBLIC_SERVER_URL`); for LAN dev, same Wi-Fi as the machine running
`wrangler dev --ip 0.0.0.0`.

## 1. Host + join

- [ ] Phone A: enter name → Host → lands in lobby with a room code + share panel.
- [ ] Share panel: copy button copies the code; QR renders; WhatsApp/share opens.
- [ ] Phone B + 2 others: enter name + code → Join → appear in everyone's lobby live.
- [ ] Wrong code → inline error (no crash, no native alert).

## 2. Lobby (host = Phone A)

- [ ] Rename a team → new name appears on all devices.
- [ ] Add team / remove team works; removing returns its players to unassigned.
- [ ] **Auto teams** shuffles all 4 into balanced teams in one tap.
- [ ] Kick a player → confirm prompt → they're removed and see a "kicked" state; they can rejoin.
- [ ] Settings steppers (target score / turn seconds) change values and sync to every device.
- [ ] Disabled Start explains itself (e.g. "Need at least 4 players", team-size reasons) and updates live as conditions change.
- [ ] Non-hosts see no host controls, just their team status + waiting pulse.
- [ ] Start game (with valid teams) → everyone moves to Ready together.

## 3. Ready + turn, per role

- [ ] Ready: describer sees the big "Start my turn" button; everyone else a waiting state + score strip with team name/color.
- [ ] Describer taps Start → all devices flip to the turn simultaneously; turn-start sound + light haptic fire.
- [ ] **Describer:** 5 word cards, franco headline + Arabic beneath; solved cards shrink/dim/strike and show who got them; solved counter increments.
- [ ] **Guesser:** guess appears instantly as pending (optimistic), then resolves to a verdict:
  - [ ] exact → +2 badge (mint), confetti, heavy haptic
  - [ ] misspelled-but-right → +1 badge (amber), light haptic
  - [ ] already-solved word → "already got" (no points)
  - [ ] wrong → greyed miss row, soft buzz (typer only)
- [ ] Guesser input keeps focus after every send; rapid double-send doesn't duplicate.
- [ ] **Spectator (opposing team):** sees the same word cards live, watching-chip in the playing team's color; words strike as they're solved in realtime.
- [ ] Score strip is visible and correct for all three roles; active team marked.

## 4. Bilingual guessing

- [ ] Pick one word: guess it in **franco** → scores. Next turn (or a second word), guess in **Arabic script** → scores too.
- [ ] Same word guessed in franco then Arabic (either order) → second is "already got", not a second score.
- [ ] Minor Arabic variations (أ/ا, ة/ه, ى/ي) still match.

## 5. Timer

- [ ] Ring counts down smoothly from the full turn length; number is tabular (no jitter).
- [ ] At **≤10s**: ring turns chili + pulses; whole describer screen shows the danger edge.
- [ ] At **≤5s**: audible tick each second (sound on).
- [ ] Timer stays correct after a brief background/foreground (server-deadline derived, not client-counted).

## 6. Turn end + rotation

- [ ] Reveal shows "+N this turn" in team color, all 5 words with per-word outcome + who solved them (staggered), full scoreboard.
- [ ] "Up next: <player> — <team>" names the correct next describer; next Ready screen matches.
- [ ] Rotation alternates teams and cycles each team's own roster (uneven teams OK).

## 7. Game over

- [ ] Winning point crosses target mid-turn → game ends for everyone; trophy, fanfare, confetti.
- [ ] Final scoreboard correct; **Top guessers podium** shows per-player points.
- [ ] Host taps **Play again** → same teams, scores reset, and dealt words are **fresh** (no repeats of words already seen this session).
- [ ] Non-hosts see the winner screen with Leave only.

## 8. Resilience

- [ ] **Lock mid-turn:** lock Phone B during a turn for ~20s → unlock → reconnect banner appears briefly → state restored (current words, score, timer all correct).
- [ ] **Kill app:** swipe Sahra away mid-game → reopen → brief restoring splash → auto-rejoins the same room as the same player via the stored session.
- [ ] Guesses queued while offline are either sent on reconnect or cleanly dropped — no crash, no phantom scores.
- [ ] **Leave room** → back at Home; other devices see the player gone; reopening the app does **not** rejoin the left room.
- [ ] Host leaving doesn't strand the room (players can still leave/finish; rejoin works).

## 9. Toggles

- [ ] **Mute:** tap the mute control → no cues fire on the next scoring event → kill and relaunch the app → still muted (persisted). Unmute restores cues.
- [ ] **Reduced motion** (OS setting — iOS: Settings → Accessibility → Motion → Reduce Motion; Android: Remove animations): confetti bursts are no-ops, timer danger pulse stops, screen transitions collapse to fade-only, backdrop wash holds still. Nothing functional is lost — every cue keeps its visual twin.
