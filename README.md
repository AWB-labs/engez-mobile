# Khammen — Team Taboo mobile

The native mobile client for **Team Taboo**, built with Expo (SDK 54, React
Native, TypeScript). It speaks the same WebSocket protocol to the same
Cloudflare Worker + Durable Object rooms as the web app — a phone on Khammen and
a laptop on the web client can play in the same room. The server lives in the
separate `team-taboo` repo and is **not** part of this one.

## How the game plays

- One person **hosts** → gets a room **code** to share (copy / WhatsApp / QR).
- The host assigns players to **teams** (2+ teams, min 4 players, 2+ per team).
- Turns rotate automatically across teams. On your turn you get **5 words**
  and **40 seconds**; you describe, your teammates type guesses into a
  scratchpad (unlimited guesses).
- **Exact word → +2**, right word but misspelled → **+1** (fuzzy match).
- **Bilingual:** every word is accepted in franco/Latin *and* Arabic script,
  with Arabic normalization — guess in either, both count.
- First team to **40 points** wins (target score + turn length adjustable in
  the lobby).

## Architecture

This is a deliberately **thin client**. All game logic — rooms, teams, turn
rotation, timing, scoring, bilingual matching, word dealing — runs on the
server (a Cloudflare Worker routing WebSockets into one Durable Object per
room). The app renders redacted per-player state the server sends and posts
player intents back. It never scores a guess or advances a phase locally.

```
App.tsx                Screen router + app shell (sound/haptic hooks, mute)
src/
  config.ts            Server origin wiring (env → app.json fallback), WS/room URLs
  theme.ts             "Khamen" design tokens — colors, type, depth, motion, spacing
  lib/
    protocol.ts        Typed wire contract with the Durable Object (types only)
    useGame.ts         The connection: WebSocket + reconnect/backoff, heartbeat,
                       offline send queue, AsyncStorage session restore, clock offset
    sound.ts           Synthesized SFX — cues rendered once to WAV by a pure-TS
                       oscillator, played via expo-audio; zero bundled audio assets
    haptics.ts         Feedback-matrix cues mapped onto expo-haptics primitives
  components/          Button, Card, Chip, Timer, ScoreStrip, PointsBadge,
                       PlayerPill, SharePanel, TitleCard, Confetti, Backdrop, Screen
  screens/             Home, Lobby, Ready, Turn (per role), TurnEnd, GameOver
```

## Setup

```bash
npm install
cp .env.example .env    # then set EXPO_PUBLIC_SERVER_URL (see below)
npx expo start          # scan the QR with Expo Go (Android) / Camera (iOS)
```

**Server URL** — the web client derives its socket URL from `location.host`;
a native app has no such thing, so it's configured explicitly
(`src/config.ts`): `EXPO_PUBLIC_SERVER_URL` in `.env` wins, falling back to
`expo.extra.serverUrl` in `app.json`.

- **Deployed server:** `EXPO_PUBLIC_SERVER_URL=https://<your-worker>.workers.dev`
- **LAN development:** run `wrangler dev --ip 0.0.0.0` in the server repo,
  then point at your computer's LAN IP, e.g.
  `EXPO_PUBLIC_SERVER_URL=http://192.168.1.20:8787`. Do **not** use
  `localhost` — on the phone that resolves to the phone itself. Phone and
  computer must be on the same Wi-Fi.

Restart `npx expo start` after editing `.env` (env vars are inlined by the
bundler).

## Design system

The visual language is **"Khamen"**: a vivid violet stage, white paper cards
and one amber CTA. All tokens live in `src/theme.ts`, ported from the web
repo's `DESIGN.md` with **two deliberate amendments**:

1. **No emoji.** Every pictograph in the spec is a `lucide-react-native` icon
   at a fixed stroke weight.
2. **No glow/neon.** The spec's accent blooms are replaced by layered depth:
   a soft indigo-tinted directional shadow, a 1px top-light, and accent
   washes/rings (`accentSurface`) — accents render as solid pastels, never a
   bloom.

Nothing outside `theme.ts` hardcodes a color, radius, duration or size.

## Fonts

**Lalezar** (display) and **Rubik** (body) are bundled via
`@expo-google-fonts` — no network fetch at runtime. Both have first-class
Arabic; Arabic strings render RTL, set per line, so bilingual word cards show
franco as the headline with Arabic beneath it.
