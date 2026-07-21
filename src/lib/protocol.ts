// The wire contract with the Cloudflare Durable Object.
//
// Every type here is derived directly from the deployed server:
//   - inbound  → server/engine.js `redactStateFor()` + worker/gameRoom.js sends
//   - outbound → the `switch (msg.type)` in worker/gameRoom.js `webSocketMessage()`
//
// This file must not drift from that server. It is types only — no runtime
// behaviour — so the game logic stays authoritative on the server exactly as
// it is for the web client.

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export type Phase = 'lobby' | 'ready' | 'turn' | 'turnEnd' | 'gameOver';

/** Who the local player is during the current turn (engine.js `roleFor`). */
export type Role = 'describer' | 'guesser' | 'spectator' | 'none';

/** engine.js `applyGuess` / matching.js `scoreGuess` verdicts. */
export type GuessStatus =
  | 'exact' // +2 — normalized match of an accepted form
  | 'close' // +1 — right word, misspelled (length-scaled edit distance)
  | 'duplicate' // already solved this turn
  | 'none' // no match
  | 'inactive' // turn isn't running
  | 'describer' // the describer tried to guess
  | 'notyourteam'; // an opponent tried to guess

export interface Player {
  id: string;
  name: string;
  teamId: string | null;
  connected: boolean;
  isHost: boolean;
  /** Per-player points across the game — powers the Top guessers podium (§5). */
  points: number;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  playerIds: string[];
}

export interface Settings {
  targetScore: number;
  turnSeconds: number;
  wordsPerTurn: number;
}

/** A bilingual title. Franco is the headline, Arabic sits beneath it (§2.2). */
export interface WordDisplay {
  fr: string | null;
  ar: string | null;
}

/**
 * The server redacts words by role: the describer and spectators get the full
 * shape; the guessing team gets `{ solved }` only, so `display` is optional.
 */
export interface TurnWord {
  display?: WordDisplay;
  solved: boolean;
  points?: number;
  /** 'open' until solved — engine.js drawWords initializes every word open. */
  status?: 'open' | 'exact' | 'close';
  solvedByName?: string | null;
}

export interface Turn {
  index: number;
  teamId: string;
  teamName: string;
  teamColor: string;
  describerId: string;
  describerName: string;
  /** Epoch ms. Null until the describer taps Start. Correct with clockOffset. */
  deadline: number | null;
  total: number;
  solvedCount: number;
  role: Role;
  /** Absent during `ready` — words are only revealed once the turn is live. */
  words?: TurnWord[];
}

/** engine.js `peekNextDescriber` — shown on the reveal so the next describer
 *  is already reaching for their phone (§5, Turn end). */
export interface NextUp {
  teamId: string;
  teamName: string;
  teamColor: string;
  describerId: string;
  describerName: string;
}

export interface CanStart {
  ok: boolean;
  /** Why not — rendered verbatim on the disabled Start button (§5, Lobby). */
  reason?: string;
}

/** One player's redacted view of the room. */
export interface GameState {
  code: string;
  phase: Phase;
  /** Epoch ms on the server — lets the client correct for clock skew. */
  serverNow: number;
  hostId: string | null;
  youId: string;
  isHost: boolean;
  settings: Settings;
  players: Player[];
  teams: Team[];
  winnerTeamId: string | null;
  canStart: CanStart;
  /** Epoch ms the reveal ends (turnEnd only; `ready` has no clock). */
  phaseEndsAt: number | null;
  turn?: Turn;
  nextUp?: NextUp | null;
}

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; name: string }
  | { type: 'rejoin'; playerId: string }
  | { type: 'guess'; id: string; text: string }
  | { type: 'startTurn' }
  | { type: 'skipTurn' }
  | { type: 'leaveRoom' }
  | { type: 'kickPlayer'; playerId: string }
  | { type: 'addTeam' }
  | { type: 'removeTeam'; teamId: string }
  | { type: 'assignPlayer'; playerId: string; teamId: string | null }
  | { type: 'autoTeams' }
  | { type: 'renameTeam'; teamId: string; name: string }
  | { type: 'setSettings'; targetScore?: number; turnSeconds?: number }
  | { type: 'startGame' }
  | { type: 'restart' };

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export interface JoinedMessage {
  type: 'joined';
  code: string;
  playerId: string;
}

export interface StateMessage {
  type: 'state';
  state: GameState;
}

/**
 * A tiny delta broadcast on every hit, so a scoring event never costs a
 * full-state round trip (§8: "guess events patch state via deltas").
 */
export interface WordSolvedMessage {
  type: 'wordSolved';
  turnIndex: number;
  index: number;
  points: number;
  status: 'exact' | 'close';
  solvedByName: string | null;
  teamId: string;
  teamScore: number;
  solvedCount: number;
}

/** The private ack to whoever typed — sent before any persistence. */
export interface GuessResultMessage {
  type: 'guessResult';
  id: string;
  text: string;
  status: GuessStatus;
  index?: number;
  word?: string;
  points?: number;
  teamScore?: number;
  allSolved?: boolean;
  gameOver?: boolean;
}

export interface KickedMessage {
  type: 'kicked';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | JoinedMessage
  | StateMessage
  | WordSolvedMessage
  | GuessResultMessage
  | KickedMessage
  | ErrorMessage;
