// Where the game server lives.
//
// The web client derives its socket URL from `location.host`; React Native has
// no such thing, so the origin is configured here. Precedence:
//
//   1. EXPO_PUBLIC_SERVER_URL         — set in .env for local / LAN testing
//   2. app.json → expo.extra.serverUrl — the shipped default
//
// For LAN development against `wrangler dev --ip 0.0.0.0`, put your machine's
// IP in .env (see .env.example) — `localhost` from a phone means the phone.

import Constants from 'expo-constants';

const fromExtra = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl;

const RAW_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || fromExtra || '';

if (!RAW_SERVER_URL) {
  console.warn(
    '[sahra] No server URL configured. Set EXPO_PUBLIC_SERVER_URL in .env ' +
      'or expo.extra.serverUrl in app.json.',
  );
}

/** Origin with any trailing slash removed, e.g. `https://sahra.example.workers.dev`. */
export const SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');

/** `wss://…` for https origins, `ws://…` for plain http (LAN dev). */
export const WS_ORIGIN = SERVER_URL.replace(/^http/, 'ws');

/** The Durable Object socket for one room — matches worker/index.js routing. */
export const roomSocketUrl = (code: string) =>
  `${WS_ORIGIN}/api/room/${encodeURIComponent(code.toUpperCase())}/ws`;

/** Mints a fresh room code (worker/index.js `/api/new`). */
export const newRoomUrl = () => `${SERVER_URL}/api/new`;

/** The link players tap or scan to join — served by the same Worker. */
export const joinLink = (code: string) => `${SERVER_URL}/?room=${code.toUpperCase()}`;
