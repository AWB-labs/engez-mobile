// Synthesized SFX — the native port of client/src/lib/sound.js.
//
// The web client synthesizes its seven cues live through WebAudio. React
// Native has no AudioContext, so we run the same synth exactly once, up
// front: each cue's notes (frequencies, delays, durations, gains, wave
// types) are rendered by a tiny pure-TS oscillator into one mono 16-bit
// 22.05 kHz PCM buffer, wrapped in a 44-byte RIFF/WAVE header, parked in the
// OS cache directory, and handed to a long-lived expo-audio player. After
// init, playing a cue costs a rewind + play on a preloaded local file.
//
// Same contract as the web synth: zero bundled assets, mute persists across
// sessions under the same storage key, and every play*() is a safe no-op
// before init, while muted, or when anything at all has gone wrong — sound
// is never load-bearing (DESIGN.md §7: every cue has a visual twin).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

/** Same key the web client uses, so muscle memory carries over conceptually. */
const STORAGE_KEY = 'teamtaboo:muted';

// ---------------------------------------------------------------------------
// Cue recipes — note-for-note from the web tone() calls
// ---------------------------------------------------------------------------

type Wave = 'sine' | 'triangle' | 'square';

/** One tone() call from the web synth. Defaults mirror its signature. */
interface Note {
  freq: number;
  /** Oscillator shape. @default 'triangle' */
  type?: Wave;
  /** Note length in seconds. @default 0.14 */
  duration?: number;
  /** Offset from cue start in seconds. @default 0 */
  delay?: number;
  /** Peak amplitude — carries the relative loudness between cues. @default 0.14 */
  gain?: number;
  /** Exponential pitch sweep target across the note (web `glideTo`). */
  glideTo?: number;
}

/**
 * The seven cues. Gains are honored exactly so relative loudness matches the
 * web build: the tick is nearly subliminal, "wrong" is soft and low, "exact"
 * is the brightest thing in the room.
 */
const CUES = {
  /** Rising two-note: the table goes quiet, the round is on. */
  turnStart: [
    { freq: 440, duration: 0.11, gain: 0.12 },
    { freq: 660, delay: 0.1, duration: 0.16, gain: 0.14 },
  ],
  /** +2 — bright ascending pair. */
  exact: [
    { freq: 660, duration: 0.1, gain: 0.16 },
    { freq: 880, delay: 0.09, duration: 0.18, gain: 0.18 },
  ],
  /** +1 — single mid tone, "right word, almost spelled it". */
  close: [{ freq: 520, duration: 0.16, gain: 0.14 }],
  /** Miss — low soft sine, deliberately undramatic. */
  wrong: [{ freq: 170, type: 'sine' as const, duration: 0.12, gain: 0.08 }],
  /** Last-10-seconds metronome — very quiet, very short. */
  tick: [{ freq: 880, type: 'square' as const, duration: 0.045, gain: 0.05 }],
  /** Falling two-note — the mirror of turnStart. */
  turnEnd: [
    { freq: 660, duration: 0.11, gain: 0.13 },
    { freq: 440, delay: 0.1, duration: 0.2, gain: 0.13 },
  ],
  /** C5–E5–G5–C6 fanfare arpeggio for the winning team. */
  win: [
    { freq: 523.25, duration: 0.22, gain: 0.16 },
    { freq: 659.25, delay: 0.11, duration: 0.22, gain: 0.16 },
    { freq: 783.99, delay: 0.22, duration: 0.22, gain: 0.16 },
    { freq: 1046.5, delay: 0.33, duration: 0.22, gain: 0.16 },
  ],
} satisfies Record<string, readonly Note[]>;

type CueName = keyof typeof CUES;

// ---------------------------------------------------------------------------
// Renderer — a WebAudio graph reduced to one additive loop
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 22050; // plenty for UI blips, keeps the files tiny
const ATTACK = 0.012; // linear attack — web: linearRampToValueAtTime(gain, +12ms)
const FLOOR = 0.0001; // decay target — web: exponentialRampToValueAtTime(0.0001)
const TAIL = 0.02; // the web stops each osc 20ms after its envelope floors

/** One oscillator sample at `phase` (measured in cycles, wraps internally). */
function oscSample(type: Wave, phase: number): number {
  const x = phase - Math.floor(phase); // wrap to [0, 1)
  switch (type) {
    case 'sine':
      return Math.sin(2 * Math.PI * x);
    case 'square':
      return x < 0.5 ? 1 : -1;
    case 'triangle':
      // Sine-phased like WebAudio's: 0 → +1 → 0 → −1 → 0 across one cycle.
      return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
  }
}

/**
 * Render every note of a cue (with its delay) into one mono float buffer.
 * Notes sum additively; the encoder clamps to [-1, 1] on the way to PCM.
 */
function renderCue(notes: readonly Note[]): Float32Array {
  let totalSeconds = 0;
  for (const n of notes) {
    totalSeconds = Math.max(totalSeconds, (n.delay ?? 0) + (n.duration ?? 0.14));
  }
  const buf = new Float32Array(Math.ceil((totalSeconds + TAIL) * SAMPLE_RATE));

  for (const n of notes) {
    const type = n.type ?? 'triangle';
    const dur = n.duration ?? 0.14;
    const gain = n.gain ?? 0.14;
    const start = Math.round((n.delay ?? 0) * SAMPLE_RATE);
    const count = Math.min(Math.round(dur * SAMPLE_RATE), buf.length - start);
    const attack = Math.min(ATTACK, dur);
    const decay = Math.max(dur - attack, 1 / SAMPLE_RATE);
    // glideTo is an exponential sweep across the whole note, so the momentary
    // frequency is f0·ratio^(t/dur). Phase accumulates sample-by-sample so
    // the sweep stays click-free. (No current cue glides — parity with the
    // web synth's capability, kept for future cues.)
    const ratio = n.glideTo ? n.glideTo / n.freq : 1;
    let phase = 0;

    for (let i = 0; i < count; i++) {
      const t = i / SAMPLE_RATE;
      const f = ratio === 1 ? n.freq : n.freq * Math.pow(ratio, t / dur);
      // 12ms linear attack, then an exponential-style decay that lands on
      // FLOOR exactly at note end — the same envelope the web gain node runs.
      const env =
        t < attack
          ? (t / attack) * gain
          : gain * Math.pow(FLOOR / gain, (t - attack) / decay);
      buf[start + i] += oscSample(type, phase) * env;
      phase += f / SAMPLE_RATE;
    }
  }
  return buf;
}

/** Wrap float samples in a canonical 44-byte RIFF header as 16-bit PCM. */
function encodeWav(samples: Float32Array): Uint8Array {
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** One persistent player per cue — created at init, never released. */
const players: Partial<Record<CueName, AudioPlayer>> = {};

let muted = false;
/** A user toggle always beats a late AsyncStorage read racing in behind it. */
let mutedTouched = false;
let initPromise: Promise<void> | null = null;

async function doInit(): Promise<void> {
  // Restore the persisted mute switch before any cue can fire.
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!mutedTouched) muted = stored === '1';
  } catch {
    // Storage unavailable — default to unmuted, same as the web fallback.
  }

  // Short UI cues should play through the iOS ring/silent switch and mix
  // over whatever music the table has on, rather than ducking it.
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
  });

  for (const name of Object.keys(CUES) as CueName[]) {
    if (players[name]) continue; // a previous partial init already got here
    const file = new File(Paths.cache, `sahra-${name}.wav`);
    // create({ overwrite }) tolerates leftovers from an earlier session; the
    // render is cheap enough (~1s of audio total) to just redo every launch.
    file.create({ overwrite: true, intermediates: true });
    file.write(encodeWav(renderCue(CUES[name])));
    players[name] = createAudioPlayer({ uri: file.uri });
  }
}

/**
 * Render, persist and load all seven cues. Idempotent: concurrent and repeat
 * calls share one in-flight promise. Never rejects — on failure the promise
 * resolves, play*() stays a silent no-op, and the next call retries.
 */
export function initSound(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch(() => {
      initPromise = null; // allow a later attempt (for example, disk hiccup)
    });
  }
  return initPromise;
}

// ---------------------------------------------------------------------------
// Mute
// ---------------------------------------------------------------------------

export function isMuted(): boolean {
  return muted;
}

/** Flip the switch, persist fire-and-forget, return the new muted state. */
export function toggleMuted(): boolean {
  muted = !muted;
  mutedTouched = true;
  AsyncStorage.setItem(STORAGE_KEY, muted ? '1' : '0').catch(() => {
    // Private-mode / storage-full — the in-memory switch still works.
  });
  return muted;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function play(name: CueName): void {
  if (muted) return;
  const player = players[name];
  if (!player) return; // not initialized yet (or init failed) — silent no-op
  try {
    // Rewind-and-play so rapid retriggers (the once-a-second tick, back-to-
    // back exacts) restart the cue instead of silently overlapping a no-op.
    player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Player released or native module unhappy — sound stays best-effort.
  }
}

export const playTurnStart = (): void => play('turnStart');
export const playExact = (): void => play('exact');
export const playClose = (): void => play('close');
export const playWrong = (): void => play('wrong');
export const playTick = (): void => play('tick');
export const playTurnEnd = (): void => play('turnEnd');
export const playWin = (): void => play('win');
