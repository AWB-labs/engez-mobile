// Khammen design tokens — the single source of truth for the whole app.
// Khamen reskin: the warm dark ahwa is gone; the game now plays on a vivid
// violet stage with white paper cards and one amber CTA. Three ground rules
// carried over from the original system:
//
//   1. NO GLOWS. Depth comes from layered surfaces and a soft indigo-tinted
//      directional shadow — see `depth` below. Accents mark things as active
//      via `accentSurface`: a solid pastel + a tinted ring, never a bloom.
//   2. NO EMOJI. Every pictograph is a lucide-react-native icon. Sizes live
//      in `icon`; stroke weight is fixed at `ICON_STROKE`.
//   3. TWO GROUNDS. Text sits either on the violet stage (use `stageOn`) or
//      on a white surface (use `inkOn`). Every colour here is contrast-tuned
//      for its ground: ink shades ≥4.5:1 on white, stage text ≥4.5:1 primary
//      and ≥3:1 secondary on the stage's lightest stop.
//
// Nothing outside this file may hardcode a colour, radius, duration or size.

import { Easing } from 'react-native-reanimated';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export const color = {
  // The stage — the violet room the whole game plays in. `stage` is the
  // gradient's top light, `stageDeep` its floor (and the pre-paint base).
  stage: '#6A5CFF',
  stageDeep: '#4A3ED9',

  // Shadow and scrim ink — a deep indigo, never pure black, so even the
  // darkness under a card stays in the stage's hue.
  shadowInk: '#1B1456',

  // Paper surfaces.
  card: '#FFFFFF', // cards, pills, the timer disc
  soft: '#F1F1F6', // inputs, ghost buttons, dense list rows
  line: '#E6E6F0', // timer track, bar tracks, quiet separators

  ink: '#1C1F26', // primary text on paper — never pure black

  // The amber CTA — the one loud surface colour. Ink text on it (8.9:1),
  // never white. Bright/deep are the gradient's ends and pressed floor.
  cta: '#FFB020',
  ctaBright: '#FFC24D',
  ctaDeep: '#F09600',

  // Brand accent for text and icons on paper — links, the guesser identity,
  // selection colour. Deeper than the stage so it holds 6:1 on white.
  violet: '#5646E0',

  // Semantic accents, contrast-tuned for white paper (each ≥4.5:1).
  mint: '#188544', // success, +2 exact
  warn: '#B45309', // +1 close (misspelled), warnings, reconnecting
  danger: '#D92D20', // errors, the last-10-seconds timer
  rose: '#E23D6F', // celebration accents

  // Celebration brights — confetti and hit-flash only, never text.
  mintBright: '#4ADE80',
} as const;

/** RN has no `color/15` syntax — compose alpha explicitly. */
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/**
 * Mix a token colour toward white (amt > 0) or black (amt < 0). The only
 * sanctioned way to derive lighter/darker steps — no invented hex constants.
 */
export const mix = (hex: string, amt: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
};

/**
 * Text hierarchy on white paper. Tuned so every step still reads: secondary
 * ≈8:1, tertiary ≈5:1 (safe for captions), disabled is intentionally quiet.
 */
export const inkOn = {
  primary: color.ink,
  secondary: alpha(color.ink, 0.78),
  tertiary: alpha(color.ink, 0.65),
  disabled: alpha(color.ink, 0.38),
  hairline: alpha(color.ink, 0.08), // card borders
  hairlineStrong: alpha(color.ink, 0.16), // input rings, quiet borders
} as const;

/**
 * Text and chrome directly on the violet stage. White is 4.55:1 on the
 * stage's lightest stop — keep body-size stage text at `primary`; secondary
 * and tertiary are for large or meta text only (≥3:1).
 */
export const stageOn = {
  primary: '#FFFFFF',
  secondary: 'rgba(255, 255, 255, 0.85)',
  tertiary: 'rgba(255, 255, 255, 0.75)',
  disabled: 'rgba(255, 255, 255, 0.5)',
  hairline: 'rgba(255, 255, 255, 0.3)', // dashed affordances, quiet rings
  wash: 'rgba(255, 255, 255, 0.16)', // floating-control fills
  washBorder: 'rgba(255, 255, 255, 0.28)',
} as const;

/**
 * Team colours — identity marks, deepened so they read as text and dots on
 * white paper (each ≥3:1; team names render in display type, so that holds).
 *
 * The deployed engine (server/engine.js TEAM_COLORS) still serves an older
 * palette, so we remap by index rather than patching the server.
 */
export const TEAM_COLORS = [
  '#D62F45', // red
  '#2F6FD0', // blue
  '#1F9D55', // green
  '#C77B05', // amber
  '#7440C9', // purple
  '#D6307A', // pink
  '#0D8F85', // teal
  '#D45A0E', // orange
] as const;

const LEGACY_TEAM_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

/** Map an engine-served team colour onto the Khamen palette. */
export function teamColor(served: string | null | undefined): string {
  if (!served) return TEAM_COLORS[0];
  const i = LEGACY_TEAM_COLORS.indexOf(served.toLowerCase());
  return i === -1 ? served : TEAM_COLORS[i];
}

/**
 * How an accent marks something as active WITHOUT glowing: a solid pastel
 * (the accent blended over white — solid, so it reads the same on paper and
 * straight on the violet stage) plus a tinted ring.
 */
export const accentSurface = (accent: string) => ({
  backgroundColor: mix(accent, 0.92),
  borderWidth: 1,
  borderColor: mix(accent, 0.5),
});

/**
 * The text shade of an accent for SMALL type sitting on that accent's pastel
 * (chip labels, badge points, verdict captions): the token pulled toward ink
 * far enough to clear 4.5:1 on its own accentSurface. Large display text
 * (team names) keeps the plain token.
 */
export const accentText = (accent: string) => mix(accent, -0.32);

/** Medal metals for the podium — tuned to hold ≥3:1 on white paper. */
export const medal = {
  gold: '#C8850A',
  silver: '#8A8F98',
  bronze: '#A85B22',
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Display = Lalezar (chunky poster type, first-class Arabic).
 * Body/UI = Rubik (rounded, friendly, full Arabic support).
 * Both bundled via @expo-google-fonts — no network fetch at runtime.
 */
export const font = {
  display: 'Lalezar_400Regular',
  body: 'Rubik_400Regular',
  bodyMedium: 'Rubik_500Medium',
  bodyBold: 'Rubik_700Bold',
} as const;

/**
 * Lalezar's own line box, read from the shipped TTF: ascent 0.979em +
 * descent 0.588em = 1.567em (hhea, OS/2 typo and win all agree). RN centres
 * the font's line box inside whatever `lineHeight` we set and CLIPS the
 * overflow, so any display text below this ratio loses the tops of its
 * ascenders — the 'bb' in Lobby, every Arabic form. Rounded up to
 * a flat 1.6 so the numbers stay legible and the margin is real.
 *
 * Rubik needs only 1.185em, which every body token already clears.
 */
export const LINE_DISPLAY = 1.6;

/** Safe `lineHeight` for display type at an arbitrary size (badges, timers). */
export const displayLine = (fontSize: number) => Math.ceil(fontSize * LINE_DISPLAY);

/** Mobile-first scale. */
export const type = {
  displayXl: { fontFamily: font.display, fontSize: 40, lineHeight: 64 },
  displayLg: { fontFamily: font.display, fontSize: 30, lineHeight: 48 },
  title: { fontFamily: font.display, fontSize: 22, lineHeight: 36 },
  /**
   * Word-card display sizes — a deliberate half-step between `title` and
   * `displayLg`, kept as tight as the round allows so the describer sees as
   * many of their five words at once as the phone permits (the list scrolls
   * when it can't fit them all). `wordLg` is the Turn word list headline;
   * `wordMd` is the turn-end reveal rows and the ScoreStrip's live score.
   */
  wordLg: { fontFamily: font.display, fontSize: 24, lineHeight: 39 },
  wordMd: { fontFamily: font.display, fontSize: 19, lineHeight: 31 },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  overline: {
    fontFamily: font.bodyMedium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 2.2, // ≈ +0.2em at 11px
    textTransform: 'uppercase' as const,
  },
} as const;

/**
 * "Numbers are always tabular-nums" — scores, timers, steppers.
 * `fontVariant` works on both platforms (Android since RN 0.64), so this is
 * unconditional — ticking digits must not wobble on either.
 */
export const tabularNums = {
  fontVariant: ['tabular-nums' as const],
};

// ---------------------------------------------------------------------------
// Shape & depth  (glow-free)
// ---------------------------------------------------------------------------

export const radius = {
  card: 24,
  button: 14,
  input: 14,
  chip: 999,
} as const;

/**
 * A three-step elevation scale for paper on the violet stage. Shadows are
 * indigo-tinted (`shadowInk`), soft and directional (offset down) — light
 * shadows read stronger on a bright ground, so opacities stay low.
 */
const paperShadow = (height: number, radiusPx: number, opacity: number) =>
  Platform.select({
    ios: {
      shadowColor: color.shadowInk,
      shadowOffset: { width: 0, height },
      shadowOpacity: opacity,
      shadowRadius: radiusPx,
    },
    android: { elevation: Math.round(height * 0.9) },
    default: {},
  });

export const depth = {
  /** Dense list rows, chips — barely lifted. */
  low: paperShadow(3, 8, 0.1),
  /** Cards, panels — the default surface lift. */
  medium: paperShadow(8, 20, 0.14),
  /** Focus cards, modals, the Ready screen hero. */
  high: paperShadow(14, 32, 0.2),
} as const;

/** The 1px glossy top edge that sells the amber CTA as candy, not plastic. */
export const topLightBorder = {
  borderTopWidth: 1,
  borderTopColor: 'rgba(255, 255, 255, 0.45)',
} as const;

// ---------------------------------------------------------------------------
// Iconography  (replaces every emoji in the design)
// ---------------------------------------------------------------------------

/** lucide-react-native sizes. Never render an icon smaller than `sm`. */
export const icon = {
  sm: 16, // inline with caption text
  md: 20, // inline with body text, chips
  lg: 24, // buttons, headers
  xl: 32, // screen-level affordances
  hero: 56, // trophy, empty states
} as const;

/** One stroke weight across the whole app keeps the icon set coherent. */
export const ICON_STROKE = 2;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const duration = {
  micro: 120,
  standard: 220,
  screen: 320,
  celebratory: 600,
  // The web centralizes its bespoke timings in tailwind.config.js; these are
  // their mobile homes, so no screen ever hardcodes a duration of its own.
  /** Half of the web's 1s `pulseEdge` breath — the shared last-10-seconds
   *  cue in <Timer/> and Turn's EdgePulse, which must stay in sync. */
  pulseHalf: 500,
  /** The web's 0.28s `popIn` (scale 0.85 → 1 on the spring curve). */
  pop: 280,
  /** The guesser's full-screen hit flash — web Turn.jsx's 500ms wash. */
  flash: 500,
} as const;

export const easing = {
  /** cubic-bezier(0.34, 1.56, 0.64, 1) — the spring pop. */
  spring: Easing.bezier(0.34, 1.56, 0.64, 1),
  out: Easing.out(Easing.quad),
} as const;

/** "List reveals stagger 50ms per item." */
export const STAGGER_MS = 50;

/** "active:scale-97" — the standard press response. */
export const PRESS_SCALE = 0.97;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Touch targets ≥ 44px. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;

/**
 * The band under the safe area that the app's floating controls own: leave
 * on the left, mute on the right, transient banners centred between them.
 * In-room screens reserve it via <Screen chrome> so nothing they draw can
 * ever land under a control — the corners of a phone screen are contested
 * space, and a header chip or a timer ring sharing them means mis-taps.
 */
export const CHROME_INSET = MIN_TOUCH + space.sm;

/** The web client caps content at max-w-md; mirror it for tablets. */
export const MAX_CONTENT_WIDTH = 448;
