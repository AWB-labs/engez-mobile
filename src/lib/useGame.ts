// The game connection: one WebSocket to the room's Durable Object, plus all
// the glue that keeps it honest on a phone — reconnection with backoff, a
// heartbeat that detects half-open sockets, an offline send queue, session
// restore, and a server-clock offset for the timer.
//
// This is a line-for-line port of the web client's useGame.js with three
// mobile adaptations:
//   - localStorage            -> AsyncStorage (async, hence the "restoring"
//                                status while the saved session loads)
//   - visibility/online/focus -> a single AppState "active" listener
//   - location-derived URLs   -> roomSocketUrl() / newRoomUrl() from config
// and one addition: onWordSolved(), fired after each scoring delta lands, so
// the app shell can hang sound/haptic cues on hits without threading them
// through every screen.
//
// All callbacks are bundled into one stable `actions` object — screens take
// it as a prop and never re-render because a function identity changed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { newRoomUrl, roomSocketUrl } from '../config';
import type {
  ClientMessage,
  GameState,
  GuessResultMessage,
  ServerMessage,
  Turn,
  WordSolvedMessage,
} from './protocol';

const STORAGE_KEY = 'teamtaboo:session';
const RECONNECT_BASE_MS = 350;
const RECONNECT_MAX_MS = 5000;
const HEARTBEAT_MS = 20000;
const STALE_CONN_MS = 50000;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** `restoring` = reading AsyncStorage on launch — render a splash, not Home. */
export type GameStatus = 'restoring' | 'idle' | 'joining' | 'inroom';

export interface GameActions {
  createGame(name: string): void;
  joinGame(name: string, code: string): void;
  leave(): void;
  addTeam(): void;
  removeTeam(teamId: string): void;
  assignPlayer(playerId: string, teamId: string | null): void;
  autoTeams(): void;
  kickPlayer(playerId: string): void;
  renameTeam(teamId: string, name: string): void;
  setSettings(s: { targetScore?: number; turnSeconds?: number }): void;
  startGame(): void;
  startTurn(): void;
  skipTurn(): void;
  restart(): void;
  submitGuess(text: string): string;
  onGuessResult(fn: (msg: GuessResultMessage) => void): () => void;
  onWordSolved(fn: (msg: WordSolvedMessage) => void): () => void;
  setError(msg: string): void;
}

/** What every in-room screen receives (Lobby, Ready, Turn, TurnEnd, GameOver). */
export interface ScreenProps {
  state: GameState;
  actions: GameActions;
  clockOffset: number;
}

// ---------------------------------------------------------------------------
// Session persistence (AsyncStorage; the web client used localStorage)
// ---------------------------------------------------------------------------

interface StoredSession {
  code: string;
  playerId: string;
}

async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    return s && typeof s.code === 'string' && typeof s.playerId === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Fire-and-forget: nothing ever needs to wait on persistence. */
function saveSession(s: StoredSession | null): void {
  if (s) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s)).catch(() => {});
  else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

// ---------------------------------------------------------------------------
// State deltas
// ---------------------------------------------------------------------------

// Apply a tiny `wordSolved` delta to local state (no full-state round trip).
function applyWordSolved(prev: GameState | null, msg: WordSolvedMessage): GameState | null {
  if (!prev || !prev.turn || prev.turn.index !== msg.turnIndex) return prev;
  const turn: Turn = { ...prev.turn, solvedCount: msg.solvedCount };
  if (Array.isArray(turn.words) && turn.words.length) {
    turn.words = turn.words.map((w, i) =>
      i === msg.index
        ? { ...w, solved: true, points: msg.points, status: msg.status, solvedByName: msg.solvedByName }
        : w,
    );
  }
  const teams = prev.teams.map((t) => (t.id === msg.teamId ? { ...t, score: msg.teamScore } : t));
  return { ...prev, turn, teams };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useGame(): {
  connected: boolean;
  state: GameState | null;
  error: string;
  status: GameStatus;
  clockOffset: number;
  actions: GameActions;
} {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<GameStatus>('restoring');
  const [clockOffset, setClockOffset] = useState(0); // serverNow - clientNow

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const helloRef = useRef<ClientMessage | null>(null); // first message to send on open
  const leftRef = useRef(false); // intentional leave -> no reconnect
  const statusRef = useRef<GameStatus>('restoring');
  const queueRef = useRef<ClientMessage[]>([]); // messages typed while offline
  const retryRef = useRef(0);
  // ReturnType keeps this portable across RN versions (Timeout vs number).
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongRef = useRef(Date.now());
  const guessSeqRef = useRef(0);
  const guessListeners = useRef(new Set<(msg: GuessResultMessage) => void>());
  const wordSolvedListeners = useRef(new Set<(msg: WordSolvedMessage) => void>());
  const offsetRef = useRef(0);

  // `open` (below) and `tryReconnect` are mutually recursive through the
  // reconnect timer; the ref breaks the declaration cycle for TypeScript.
  const tryReconnectRef = useRef<() => void>(() => {});

  const setStatusBoth = useCallback((s: GameStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // Queue-aware send: taps made while the socket is down are delivered the
  // moment we reconnect instead of being silently dropped.
  const send = useCallback((obj: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
        return;
      } catch {}
    }
    if (queueRef.current.length < 30) queueRef.current.push(obj);
  }, []);

  const resetToHome = useCallback(
    (message?: string) => {
      leftRef.current = true;
      sessionRef.current = null;
      helloRef.current = null;
      queueRef.current = [];
      saveSession(null);
      try {
        wsRef.current?.close();
      } catch {}
      setState(null);
      setStatusBoth('idle');
      if (message !== undefined) setError(message);
    },
    [setStatusBoth],
  );

  const scheduleReconnect = useCallback(() => {
    if (leftRef.current || !sessionRef.current) return;
    if (reconnectTimerRef.current !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.6, retryRef.current++));
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      tryReconnectRef.current();
    }, delay);
  }, []);

  // Open (or reopen) the socket for a room, sending `hello` once connected.
  const open = useCallback(
    (code: string, hello: ClientMessage) => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      leftRef.current = false;
      helloRef.current = hello;
      try {
        if (wsRef.current) {
          wsRef.current.onclose = null; // an old socket must not schedule reconnects
          wsRef.current.close();
        }
      } catch {}
      const ws = new WebSocket(roomSocketUrl(code));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
        lastPongRef.current = Date.now();
        if (helloRef.current) {
          try {
            ws.send(JSON.stringify(helloRef.current));
          } catch {}
        }
        // Flush anything typed while offline.
        const q = queueRef.current;
        queueRef.current = [];
        for (const m of q) {
          try {
            ws.send(JSON.stringify(m));
          } catch {}
        }
      };

      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };

      ws.onmessage = (ev: { data?: unknown }) => {
        const data = ev.data;
        if (typeof data !== 'string') return; // the server only sends text frames
        if (data === 'pong') {
          lastPongRef.current = Date.now();
          return;
        }
        let msg: ServerMessage;
        try {
          msg = JSON.parse(data) as ServerMessage;
        } catch {
          return;
        }
        lastPongRef.current = Date.now(); // any traffic proves liveness

        if (msg.type === 'joined') {
          sessionRef.current = { code: msg.code, playerId: msg.playerId };
          saveSession(sessionRef.current);
          setStatusBoth('inroom');
        } else if (msg.type === 'state') {
          if (typeof msg.state.serverNow === 'number') {
            const off = msg.state.serverNow - Date.now();
            if (Math.abs(off - offsetRef.current) > 300) {
              offsetRef.current = off;
              setClockOffset(off);
            }
          }
          // No sound here — the hook stays pure transport. The app shell's
          // phase effect (App.tsx) is the single owner of turn-start/turn-end
          // cues; playing them here too made every transition an audible flam.
          setState(msg.state);
          setStatusBoth('inroom');
        } else if (msg.type === 'wordSolved') {
          const solved = msg;
          setState((prev) => applyWordSolved(prev, solved));
          // Listeners fire after the delta is queued so their cues never race
          // ahead of the score they announce.
          for (const fn of wordSolvedListeners.current) fn(solved);
        } else if (msg.type === 'guessResult') {
          for (const fn of guessListeners.current) fn(msg);
        } else if (msg.type === 'kicked') {
          resetToHome('You were removed from the room by the host.');
        } else if (msg.type === 'error') {
          if (statusRef.current !== 'inroom') {
            resetToHome(msg.message || 'Something went wrong');
          } else {
            setError(msg.message || 'Something went wrong');
          }
        }
      };
    },
    [resetToHome, scheduleReconnect, setStatusBoth],
  );

  const tryReconnect = useCallback(() => {
    if (leftRef.current || !sessionRef.current) return;
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    open(sessionRef.current.code, { type: 'rejoin', playerId: sessionRef.current.playerId });
  }, [open]);

  useEffect(() => {
    tryReconnectRef.current = tryReconnect;
  }, [tryReconnect]);

  // Restore a prior session on first mount. AsyncStorage is async, so the app
  // sits in `restoring` until we know whether there is a room to rejoin.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await loadSession();
      if (cancelled) return;
      if (s) {
        sessionRef.current = s;
        setStatusBoth('joining');
        open(s.code, { type: 'rejoin', playerId: s.playerId });
      } else {
        setStatusBoth('idle');
      }
    })();
    return () => {
      cancelled = true;
      leftRef.current = true;
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [open, setStatusBoth]);

  // Reconnect the instant the app foregrounds — iOS and Android both kill
  // sockets when the screen locks or the app backgrounds. This one listener
  // replaces the web client's visibilitychange + online + focus trio.
  useEffect(() => {
    const wake = (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (leftRef.current || !sessionRef.current) return;
      retryRef.current = 0;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Timers are frozen in the background, so a socket the OS quietly
        // dropped can still read OPEN here. A stale pong outs it; closing
        // triggers the normal reconnect path.
        if (Date.now() - lastPongRef.current > STALE_CONN_MS) {
          try {
            ws.close();
          } catch {}
        }
        return;
      }
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        tryReconnect();
      }
    };
    const sub = AppState.addEventListener('change', wake);
    return () => sub.remove();
  }, [tryReconnect]);

  // Heartbeat: keeps NATs from dropping idle sockets and detects half-open
  // connections (send succeeds but nothing comes back) so we reconnect fast.
  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (!sessionRef.current || leftRef.current) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send('ping');
        } catch {}
        if (AppState.currentState === 'active' && Date.now() - lastPongRef.current > STALE_CONN_MS) {
          try {
            ws.close(); // triggers reconnect
          } catch {}
        }
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  const createGame = useCallback(
    (name: string) => {
      setError('');
      setStatusBoth('joining');
      void (async () => {
        try {
          const res = await fetch(newRoomUrl());
          const { code } = (await res.json()) as { code: string };
          queueRef.current = [];
          open(code, { type: 'createRoom', name });
        } catch {
          setStatusBoth('idle');
          setError('Could not reach the server');
        }
      })();
    },
    [open, setStatusBoth],
  );

  const joinGame = useCallback(
    (name: string, code: string) => {
      setError('');
      setStatusBoth('joining');
      queueRef.current = [];
      open((code || '').toUpperCase(), { type: 'joinRoom', name });
    },
    [open, setStatusBoth],
  );

  const leave = useCallback(() => {
    const ws = wsRef.current;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leaveRoom' } satisfies ClientMessage));
      }
    } catch {}
    leftRef.current = true;
    sessionRef.current = null;
    helloRef.current = null;
    queueRef.current = [];
    saveSession(null);
    // Give the leave frame a beat to flush before closing.
    setTimeout(() => {
      try {
        ws?.close();
      } catch {}
    }, 80);
    setState(null);
    setStatusBoth('idle');
    setError('');
  }, [setStatusBoth]);

  // Host / gameplay actions.
  const addTeam = useCallback(() => send({ type: 'addTeam' }), [send]);
  const removeTeam = useCallback((teamId: string) => send({ type: 'removeTeam', teamId }), [send]);
  const assignPlayer = useCallback(
    (playerId: string, teamId: string | null) => send({ type: 'assignPlayer', playerId, teamId }),
    [send],
  );
  const autoTeams = useCallback(() => send({ type: 'autoTeams' }), [send]);
  const kickPlayer = useCallback((playerId: string) => send({ type: 'kickPlayer', playerId }), [send]);
  const renameTeam = useCallback(
    (teamId: string, name: string) => send({ type: 'renameTeam', teamId, name }),
    [send],
  );
  const setSettings = useCallback(
    (s: { targetScore?: number; turnSeconds?: number }) => send({ type: 'setSettings', ...s }),
    [send],
  );
  const startGame = useCallback(() => send({ type: 'startGame' }), [send]);
  const startTurn = useCallback(() => send({ type: 'startTurn' }), [send]);
  const skipTurn = useCallback(() => send({ type: 'skipTurn' }), [send]);
  const restart = useCallback(() => send({ type: 'restart' }), [send]);

  // Returns a client id so the UI can show the guess optimistically and
  // reconcile when the server's verdict arrives.
  const submitGuess = useCallback(
    (text: string) => {
      const id = `g${++guessSeqRef.current}-${Date.now() % 100000}`;
      send({ type: 'guess', id, text });
      return id;
    },
    [send],
  );

  const onGuessResult = useCallback((fn: (msg: GuessResultMessage) => void) => {
    guessListeners.current.add(fn);
    return () => {
      guessListeners.current.delete(fn);
    };
  }, []);

  const onWordSolved = useCallback((fn: (msg: WordSolvedMessage) => void) => {
    wordSolvedListeners.current.add(fn);
    return () => {
      wordSolvedListeners.current.delete(fn);
    };
  }, []);

  // One stable object: every callback above has stable identity, so screens
  // can take `actions` as a prop without ever re-rendering for it.
  const actions = useMemo<GameActions>(
    () => ({
      createGame,
      joinGame,
      leave,
      addTeam,
      removeTeam,
      assignPlayer,
      autoTeams,
      kickPlayer,
      renameTeam,
      setSettings,
      startGame,
      startTurn,
      skipTurn,
      restart,
      submitGuess,
      onGuessResult,
      onWordSolved,
      setError,
    }),
    [
      createGame,
      joinGame,
      leave,
      addTeam,
      removeTeam,
      assignPlayer,
      autoTeams,
      kickPlayer,
      renameTeam,
      setSettings,
      startGame,
      startTurn,
      skipTurn,
      restart,
      submitGuess,
      onGuessResult,
      onWordSolved,
    ],
  );

  return { connected, state, error, status, clockOffset, actions };
}
