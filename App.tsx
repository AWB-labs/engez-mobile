// App shell — the mobile counterpart of client/src/App.jsx. One component
// owns every cross-cutting concern so the screens stay pure:
//
//   - fonts (Lalezar + Rubik, bundled — no network fetch at runtime),
//   - the single useGame() connection,
//   - the phase → screen routing table over the shared Backdrop,
//   - the floating in-room controls (leave top-left, mute top-right),
//   - the reconnect / transient-error banners under the status bar,
//   - the app-wide half of the §6 feedback matrix (phase-transition cues and
//     the wordSolved / guessResult sound hooks).
//
// Timer ticks are self-contained in <Timer/>, and the guesser's celebration
// battery (flash + confetti + haptics) lives in the Turn scratchpad — this
// file only wires what must outlive any single screen.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
// Subpath imports bundle ONLY the weights we use — the package root re-exports
// every variant (15 Rubik files, ~2.5 MB of dead italics) into the app binary.
import { useFonts } from '@expo-google-fonts/lalezar/useFonts';
import { Lalezar_400Regular } from '@expo-google-fonts/lalezar/400Regular';
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { CircleAlert, LogOut, Volume2, VolumeX, WifiOff } from 'lucide-react-native';
import Backdrop from './src/components/Backdrop';
import Home from './src/screens/Home';
import Lobby from './src/screens/Lobby';
import Ready from './src/screens/Ready';
import Turn from './src/screens/Turn';
import TurnEnd from './src/screens/TurnEnd';
import GameOver from './src/screens/GameOver';
import { useGame } from './src/lib/useGame';
import {
  initSound,
  isMuted,
  toggleMuted,
  playTurnStart,
  playTurnEnd,
  playWin,
  playExact,
  playClose,
} from './src/lib/sound';
import { hapticTurnStart, hapticWin } from './src/lib/haptics';
import type { Phase } from './src/lib/protocol';
import {
  accentSurface,
  accentText,
  color,
  depth,
  duration,
  easing,
  font,
  HIT_SLOP,
  ICON_STROKE,
  icon,
  inkOn,
  MIN_TOUCH,
  PRESS_SCALE,
  radius,
  space,
  stageOn,
  type,
} from './src/theme';

/** Keyed by the theme's family names, so tokens and loader can never drift. */
const FONTS = {
  [font.display]: Lalezar_400Regular,
  [font.body]: Rubik_400Regular,
  [font.bodyMedium]: Rubik_500Medium,
  [font.bodyBold]: Rubik_700Bold,
};

/** How long a transient in-room error stays on screen before self-clearing. */
const ERROR_TTL_MS = 4000;

/** How far the reconnect banner breathes down from full opacity. */
const RECONNECT_FADE = 0.5;

// ---------------------------------------------------------------------------
// Root: providers + the violet stage the whole app plays on
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <Shell />
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// Shell: connection, routing, overlays, feedback wiring
// ---------------------------------------------------------------------------

function Shell() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts(FONTS);
  const { connected, state, error, status, clockOffset, actions } = useGame();

  // Warm the synth as soon as the app is usable; fire-and-forget (initSound
  // never rejects). The Ready screen re-calls it on the Start tap as the
  // guaranteed-gesture unlock, and repeat calls share one promise.
  useEffect(() => {
    if (fontsLoaded) void initSound();
  }, [fontsLoaded]);

  // Transient in-room errors self-clear after a beat — never an alert. (On
  // Home the same string renders as the form's inline danger card instead.)
  useEffect(() => {
    if (!error || status !== 'inroom') return;
    const t = setTimeout(() => actions.setError(''), ERROR_TTL_MS);
    return () => clearTimeout(t);
  }, [error, status, actions]);

  // --- Feedback matrix, phase half (§6) -----------------------------------
  //
  // One effect watches phase/turn transitions. useGame also fires the two
  // ambient phase cues (turn start / turn end) internally; that overlap lands
  // within the same frame, and play() is a rewind-and-play, so the double
  // trigger collapses into one audible cue. The win cue is different: haptics
  // are additive (a second hapticWin() stacks a second Success + Medium-tap
  // pattern on top of the first), so the §6 win pattern fires ONLY here —
  // GameOver's mount effect owns just the confetti.
  const prevPhaseRef = useRef<Phase | null>(null);
  const prevTurnRef = useRef<number | null>(null);
  // Word indexes the local player just solved, recorded from the private
  // guessResult ack. The wordSolved broadcast that follows a few ms later
  // must not replay the cue the typer already heard from the Turn scratchpad
  // — a cross-message double would flam the app's most frequent sound.
  const ownSolvesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!state) {
      // Left the room (or kicked): reset so the next game's first turn cues.
      prevPhaseRef.current = null;
      prevTurnRef.current = null;
      ownSolvesRef.current.clear();
      return;
    }
    const phase = state.phase;
    const turnIndex = state.turn ? state.turn.index : null;
    const prevPhase = prevPhaseRef.current;
    const prevTurn = prevTurnRef.current;
    prevPhaseRef.current = phase;
    prevTurnRef.current = turnIndex;
    if (turnIndex !== prevTurn) ownSolvesRef.current.clear();

    if (phase === 'turn' && (prevPhase !== 'turn' || turnIndex !== prevTurn)) {
      // Entering a live turn — from ready, or a new turn index mid-phase.
      playTurnStart();
      hapticTurnStart();
    } else if (phase === 'turnEnd' && prevPhase === 'turn') {
      playTurnEnd();
    } else if (phase === 'gameOver' && prevPhase !== 'gameOver') {
      playWin();
      hapticWin();
    }
  }, [state]);

  // --- Feedback matrix, guess half (§6) -----------------------------------
  useEffect(() => {
    // wordSolved is broadcast to the whole room on every non-final hit, so
    // this one hook gives every role — describer, guessers, spectators —
    // their chime exactly once.
    const offSolved = actions.onWordSolved((msg) => {
      if (ownSolvesRef.current.delete(msg.index)) return; // typer already heard it
      if (msg.status === 'exact') playExact();
      else playClose();
    });

    // guessResult is the typer-only ack, and ALL of the typer's audible
    // feedback (hit chime, miss buzz) lives with the scratchpad in Turn.tsx,
    // next to the confetti and haptics — one owner per cue, no flams. Here we
    // only note the typer's own non-final hits so the wordSolved broadcast
    // that follows doesn't replay the chime they already heard. Final hits
    // (allSolved / gameOver) never get a wordSolved broadcast, so there is
    // nothing to dedupe — Turn.tsx's chime is the only one.
    const offGuess = actions.onGuessResult((msg) => {
      if (msg.status !== 'exact' && msg.status !== 'close') return;
      if (!msg.allSolved && !msg.gameOver && typeof msg.index === 'number') {
        ownSolvesRef.current.add(msg.index);
      }
    });

    return () => {
      offSolved();
      offGuess();
    };
  }, [actions]);

  // --- Routing -------------------------------------------------------------

  // Splash covers the two boots (fonts, AsyncStorage session restore) and the
  // one-message gap between `joined` and the first `state` broadcast.
  if (!fontsLoaded || status === 'restoring' || (status === 'inroom' && !state)) {
    return <Splash />;
  }

  const room = status === 'inroom' && state ? state : null;

  // The backdrop tints toward the active team mid-game and the winner at the
  // end (Backdrop itself runs the colour through teamColor()).
  let tint: string | null = null;
  if (room) {
    const inGame = room.phase === 'ready' || room.phase === 'turn' || room.phase === 'turnEnd';
    if (inGame && room.turn) {
      tint = room.turn.teamColor;
    } else if (room.phase === 'gameOver' && room.winnerTeamId) {
      tint = room.teams.find((t) => t.id === room.winnerTeamId)?.color ?? null;
    }
  }

  let body: ReactElement;
  if (!room) {
    body = <Home status={status} error={error} actions={actions} />;
  } else {
    const screenProps = { state: room, actions, clockOffset };
    // Keyed on phase + turn so a same-phase turn change (e.g. a skipped
    // describer) remounts the screen and replays its entrance — web parity.
    const key = `${room.phase}:${room.turn ? room.turn.index : ''}`;
    switch (room.phase) {
      case 'lobby':
        body = <Lobby key={key} {...screenProps} />;
        break;
      case 'ready':
        body = <Ready key={key} {...screenProps} />;
        break;
      case 'turn':
        body = <Turn key={key} {...screenProps} />;
        break;
      case 'turnEnd':
        body = <TurnEnd key={key} {...screenProps} />;
        break;
      case 'gameOver':
        body = <GameOver key={key} {...screenProps} />;
        break;
      default:
        body = <Splash />; // an unknown future phase — stay calm
    }
  }

  return (
    <>
      <Backdrop tint={tint} />
      {body}

      {/* Status banners, stacked under the status bar, clear of the mute. */}
      {room && (
        <View pointerEvents="none" style={[styles.bannerStack, { top: insets.top + space.sm }]}>
          {!connected && <ReconnectBanner />}
          {!!error && <ErrorBanner message={error} />}
        </View>
      )}

      {/* The control band: leave top-left (where "back" lives on a phone),
          mute top-right, banners centred between them. Screens reserve the
          band via <Screen chrome>, so nothing is ever drawn under either
          control. Lobby and game over carry their own labelled Leave, so the
          icon one would only be a duplicate there. */}
      {room && <MuteButton style={{ top: insets.top + space.sm }} />}
      {room && room.phase !== 'lobby' && room.phase !== 'gameOver' && (
        <LeaveButton style={{ top: insets.top + space.sm }} onLeave={actions.leave} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Splash — violet, wordmark, nothing else
// ---------------------------------------------------------------------------

function Splash() {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashWordmark}>Khammen</Text>
      <Text style={styles.splashCaption}>Loading…</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Floating controls
// ---------------------------------------------------------------------------

function MuteButton({ style }: { style: StyleProp<ViewStyle> }) {
  const [muted, setMuted] = useState(isMuted);

  // isMuted() can be stale for the instant before initSound()'s AsyncStorage
  // read lands — re-sync once it has (idempotent, shares the init promise).
  useEffect(() => {
    let live = true;
    void initSound().then(() => {
      if (live) setMuted(isMuted());
    });
    return () => {
      live = false;
    };
  }, []);

  const Icon = muted ? VolumeX : Volume2;
  return (
    <Pressable
      onPress={() => setMuted(toggleMuted())}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={muted ? 'Unmute sound' : 'Mute sound'}
      style={({ pressed }) => [styles.floating, styles.muteAnchor, style, pressed && styles.pressed]}
    >
      <Icon size={icon.md} color={stageOn.primary} strokeWidth={ICON_STROKE} />
    </Pressable>
  );
}

function LeaveButton({ style, onLeave }: { style: StyleProp<ViewStyle>; onLeave: () => void }) {
  const confirm = () => {
    Alert.alert('Leave the game?', undefined, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: onLeave },
    ]);
  };
  return (
    <Pressable
      onPress={confirm}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel="Leave the game"
      style={({ pressed }) => [styles.floating, styles.leaveAnchor, style, pressed && styles.pressed]}
    >
      <LogOut size={icon.md} color={stageOn.primary} strokeWidth={ICON_STROKE} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

/**
 * The socket is down and useGame is retrying with backoff. A slim amber
 * pastel strip that breathes (opacity only) — static under reduced motion.
 * Solid pastel, so it stays readable over any screen on the stage.
 */
function ReconnectBanner() {
  const reduceMotion = useReducedMotion();

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: duration.celebratory, easing: easing.out }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: 1 - pulse.value * RECONNECT_FADE }));

  return (
    <Animated.View style={[styles.banner, accentSurface(color.warn), pulseStyle]}>
      <WifiOff size={icon.sm} color={color.warn} strokeWidth={ICON_STROKE} />
      <Text style={[styles.bannerText, styles.bannerTextWarn]}>Reconnecting…</Text>
    </Animated.View>
  );
}

/** A server error while in-room — inline danger pastel, self-clearing, never an alert. */
function ErrorBanner({ message }: { message: string }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(duration.standard).easing(easing.out)}
      style={[styles.banner, accentSurface(color.danger)]}
    >
      <CircleAlert size={icon.sm} color={color.danger} strokeWidth={ICON_STROKE} />
      <Text style={styles.bannerText} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.stageDeep,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  splashWordmark: {
    ...type.displayXl,
    color: stageOn.primary,
  },
  splashCaption: {
    ...type.caption,
    color: stageOn.tertiary,
  },
  // The 44px circular ghost both floating controls share: a white wash on
  // the stage, hairline ring — quiet enough to ignore mid-game.
  floating: {
    position: 'absolute',
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: stageOn.wash,
    borderWidth: 1,
    borderColor: stageOn.washBorder,
  },
  muteAnchor: { right: space.lg },
  leaveAnchor: { left: space.lg },
  pressed: {
    transform: [{ scale: PRESS_SCALE }],
  },
  // Centred in the control band; the side padding is exactly one control
  // (44 + its 16 margin) so a banner can never reach either circle.
  bannerStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: MIN_TOUCH + space.lg,
  },
  // Solid pastel pill (accentSurface supplies fill + ring per banner).
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.chip,
    paddingVertical: space.xs,
    paddingHorizontal: space.lg,
    ...depth.low,
  },
  bannerText: {
    ...type.caption,
    color: inkOn.primary,
    flexShrink: 1,
  },
  bannerTextWarn: {
    // Caption on the amber pastel — the deepened shade clears 4.5:1.
    color: accentText(color.warn),
  },
});
