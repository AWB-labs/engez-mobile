// The live round — one screen, three faces, switched on `state.turn.role`:
//
//   describer — sees the 5 words and watches them get crossed off,
//   guesser   — a scratchpad: type, send, watch the server rule on each try,
//   spectator — the opposing team, watching the same word list live.
//
// Behaviour is a straight port of client/src/screens/Turn.jsx: optimistic
// guess entries reconciled by id when the server's verdict lands, accidental
// double-submits of the same word swallowed inside 700ms, the scratchpad
// auto-scrolled on append, a full-screen flash + confetti + haptic on hits,
// and entries reset whenever a new turn begins.
//
// Visually it follows the Khamen reskin with the app-wide overrides: every
// pictograph is a lucide icon, and the web's edge *glow* in the last ten
// seconds becomes a pulsing 3px amber border — depth and urgency without a
// single accent shadow.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { EntryExitAnimationFunction } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Check, Clock, Ellipsis, Eye, Keyboard, Mic, Send, SpellCheck, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  accentSurface,
  accentText,
  color,
  depth,
  duration,
  easing,
  font,
  HIT_SLOP,
  icon,
  ICON_STROKE,
  inkOn,
  radius,
  space,
  STAGGER_MS,
  stageOn,
  tabularNums,
  teamColor,
  topLightBorder,
  type,
} from '../theme';
import type { GameActions, ScreenProps } from '../lib/useGame';
import type { GameState, GuessStatus, Turn as TurnInfo, TurnWord } from '../lib/protocol';
import { playClose, playExact, playWrong } from '../lib/sound';
import { hapticClose, hapticExact } from '../lib/haptics';
import Screen from '../components/Screen';
import Card from '../components/Card';
import Chip from '../components/Chip';
import Timer from '../components/Timer';
import ScoreStrip from '../components/ScoreStrip';
import PointsBadge from '../components/PointsBadge';
import TitleCard from '../components/TitleCard';
import ConfettiOverlay from '../components/Confetti';
import type { ConfettiHandle } from '../components/Confetti';

export default function Turn({ state, actions, clockOffset }: ScreenProps) {
  // The server only omits `turn` outside the turn phase; the guard exists for
  // the one render where a state update and a phase change cross mid-flight.
  const turn = state.turn;
  if (!turn) return null;
  if (turn.role === 'describer') {
    return <DescriberView state={state} turn={turn} clockOffset={clockOffset} />;
  }
  if (turn.role === 'guesser') {
    return <GuesserView state={state} turn={turn} clockOffset={clockOffset} actions={actions} />;
  }
  // 'spectator' and 'none' both just watch, exactly like the web client.
  return <SpectatorView state={state} turn={turn} clockOffset={clockOffset} />;
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

interface RoleViewProps {
  state: GameState;
  turn: TurnInfo;
  clockOffset: number;
}

/** Same script-detection the other components use for §7 RTL handling. */
const ARABIC = /[؀-ۿ]/;

/**
 * Whole seconds left on the turn clock — the same server-time math as
 * <Timer/> (deadline is server-epoch ms, corrected by the clock offset), on a
 * coarser 1s tick. Drives the last-10-seconds treatment; the Timer keeps its
 * own private 250ms tick so the two never fight over renders.
 */
function useRemaining(deadline: number | null, offset: number): number | null {
  const calc = useCallback(
    () =>
      deadline == null ? null : Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)),
    [deadline, offset],
  );
  const [remaining, setRemaining] = useState<number | null>(calc);

  useEffect(() => {
    setRemaining(calc());
    if (deadline == null) return;
    // Same value → React bails out, so this costs at most one render per second.
    const id = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(id);
  }, [calc, deadline]);

  return remaining;
}

// The web's `animate-pulseEdge` breathes between these opacities.
const EDGE_MIN = 0.35;
const EDGE_MAX = 0.85;

/**
 * The visual half of the last-10-seconds cue (the audible half lives in
 * <Timer/>): a 3px amber border hugging the screen edge, opacity breathing
 * once a second — amber is the hue that carries on the violet stage, and the
 * Timer's red disc + ticks complete the cue, so colour is never the only
 * signal. Reduced motion: it holds at EDGE_MIN, static.
 */
function EdgePulse({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (active && !reduceMotion) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duration.pulseHalf, easing: easing.out }),
          withTiming(0, { duration: duration.pulseHalf, easing: easing.out }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  }, [active, reduceMotion, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: EDGE_MIN + pulse.value * (EDGE_MAX - EDGE_MIN),
  }));

  if (!active) return null;
  return <Animated.View pointerEvents="none" style={[styles.edge, style]} />;
}

// ---------------------------------------------------------------------------
// Entering animations (transform + opacity only)
// ---------------------------------------------------------------------------

/** The web's `animate-popIn` (scale 0.85 → 1 over duration.pop on the spring). */
const entryPop: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.85 }] },
    animations: {
      opacity: withTiming(1, { duration: duration.pop, easing: easing.spring }),
      transform: [{ scale: withTiming(1, { duration: duration.pop, easing: easing.spring }) }],
    },
  };
};

/**
 * §5: "Solved cards shrink, dim, strike through". A solved word card remounts
 * with this pop — landing at SOLVED_SCALE, which its static style then holds,
 * so the card visibly recedes and stays receded.
 */
const SOLVED_SCALE = 0.98;

const solvedPop: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1.03 }] },
    animations: {
      opacity: withTiming(1, { duration: duration.standard, easing: easing.out }),
      transform: [
        { scale: withTiming(SOLVED_SCALE, { duration: duration.pop, easing: easing.spring }) },
      ],
    },
  };
};

// ---------------------------------------------------------------------------
// The word list (describer + spectator share it verbatim)
// ---------------------------------------------------------------------------

// The solved card recedes into the mint pastel — solid, ring included.
const SOLVED_SURFACE = accentSurface(color.mint);

function WordCard({ word }: { word: TurnWord }) {
  const solvedBy = word.solvedByName ?? null;
  return (
    <Card style={[styles.wordCard, word.solved && SOLVED_SURFACE]}>
      <TitleCard display={word.display} solved={word.solved} dim={word.solved} />
      {word.solved ? (
        <View style={styles.wordRight}>
          <PointsBadge points={word.points ?? 2} />
          {solvedBy != null && (
            <Text
              style={[styles.solvedBy, ARABIC.test(solvedBy) && styles.rtl]}
              numberOfLines={1}
            >
              {solvedBy}
            </Text>
          )}
        </View>
      ) : (
        // The unsolved marker is the Arabic question mark the web uses — a
        // plain glyph in poster type, not an emoji.
        <Text style={styles.unknownMark}>؟</Text>
      )}
    </Card>
  );
}

function WordList({ words }: { words: TurnWord[] }) {
  const reduceMotion = useReducedMotion();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.wordListContent}
      showsVerticalScrollIndicator={false}
    >
      {words.map((w, i) => (
        // Keying on solved-ness remounts the card the moment it's guessed, so
        // the pop replays exactly like the web's `animate-popIn` class swap.
        <Animated.View
          key={`${i}-${w.solved ? 's' : 'u'}`}
          entering={
            reduceMotion
              ? undefined
              : w.solved
                ? solvedPop
                : FadeInDown.delay(i * STAGGER_MS).duration(duration.standard).easing(easing.out)
          }
          style={w.solved ? styles.solvedShrink : undefined}
        >
          <WordCard word={w} />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Describer: sees the 5 words, watches them get crossed off
// ---------------------------------------------------------------------------

function DescriberView({ state, turn, clockOffset }: RoleViewProps) {
  const words = turn.words ?? [];
  const solved = words.filter((w) => w.solved).length;
  const remaining = useRemaining(turn.deadline, clockOffset);
  const danger = remaining != null && remaining <= 10;

  return (
    <Screen chrome>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Chip label="You are describing" accent={color.mint} icon={Mic} />
          <Text style={[styles.headerCaption, tabularNums]}>
            {solved}/{turn.total} guessed
          </Text>
        </View>
        <Timer deadline={turn.deadline} total={state.settings.turnSeconds} offset={clockOffset} size={78} />
      </View>

      <ScoreStrip teams={state.teams} activeTeamId={turn.teamId} />

      <Card soft style={styles.instruction}>
        <Text style={styles.instructionText}>
          Describe these to your team — <Text style={styles.instructionStrong}>do not say the word!</Text>
        </Text>
      </Card>

      <WordList words={words} />

      <EdgePulse active={danger} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Guesser: the scratchpad — type a word, send it, unlimited tries
// ---------------------------------------------------------------------------

/** One scratchpad row: `pending` until the server's verdict reconciles it. */
interface Entry {
  id: string;
  text: string;
  status: GuessStatus | 'pending';
}

interface Verdict {
  Icon: LucideIcon | null;
  label: string;
  tint: string;
  surface: 'exact' | 'close' | null;
}

/** The web's statusStyle()/statusLabel() pair, emoji swapped for icons.
 *  Hit tints wear the deepened accent shade — small type on a pastel. */
function verdictFor(status: Entry['status']): Verdict {
  switch (status) {
    case 'exact':
      return { Icon: Check, label: '+2', tint: accentText(color.mint), surface: 'exact' };
    case 'close':
      return { Icon: SpellCheck, label: '+1 spelling', tint: accentText(color.warn), surface: 'close' };
    case 'duplicate':
      return { Icon: null, label: 'already got', tint: inkOn.tertiary, surface: null };
    case 'pending':
      return { Icon: Ellipsis, label: '', tint: inkOn.tertiary, surface: null };
    case 'inactive':
      return { Icon: Clock, label: 'turn over', tint: inkOn.tertiary, surface: null };
    // 'none', 'describer', 'notyourteam' — a plain miss mark, like the web's X.
    default:
      return { Icon: X, label: '', tint: inkOn.tertiary, surface: null };
  }
}

const ENTRY_SURFACE: Record<'exact' | 'close', ReturnType<typeof accentSurface>> = {
  exact: accentSurface(color.mint),
  close: accentSurface(color.warn),
};

/**
 * Icon-only square send control. Button always renders a title Text, so this
 * is the same amber-gradient construction (stops, depth, top-light, spring
 * press) at input height, wrapped around a single Send glyph.
 */
function SendButton({ onPress }: { onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: 1 - pressed.value * 0.1 }
      : { transform: [{ scale: 1 - pressed.value * 0.03 }] },
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: duration.micro, easing: easing.spring });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.micro, easing: easing.spring });
      }}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel="Send guess"
    >
      <Animated.View style={pressStyle}>
        <LinearGradient
          colors={[color.ctaBright, color.cta, color.ctaDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.send, { backgroundColor: color.cta }, depth.medium, topLightBorder]}
        >
          <Send size={icon.lg} color={color.ink} strokeWidth={ICON_STROKE} />
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

function ProgressDots({ total, solved }: { total: number; solved: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dotBar, i < solved && styles.dotBarSolved]} />
      ))}
    </View>
  );
}

// SVG gradient ids are document-global; a screen-transition overlap must not
// let two flashes fight over one (same trick as <Timer/>).
let flashSeq = 0;

function GuesserView({
  state,
  turn,
  clockOffset,
  actions,
}: RoleViewProps & { actions: GameActions }) {
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [flash, setFlash] = useState<'exact' | 'close' | null>(null);

  const listRef = useRef<FlatList<Entry>>(null);
  const inputRef = useRef<TextInput>(null);
  const confettiRef = useRef<ConfettiHandle>(null);
  const lastSubmitRef = useRef({ t: '', at: 0 });
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashIdRef = useRef(`sahra-turn-flash-${++flashSeq}`);
  const flashOpacity = useSharedValue(0);
  const [focused, setFocused] = useState(false);

  const remaining = useRemaining(turn.deadline, clockOffset);
  const danger = remaining != null && remaining <= 10;
  const solved = turn.solvedCount || 0;

  // A fresh turn is a fresh scratchpad.
  useEffect(() => {
    setEntries([]);
    setText('');
  }, [turn.index]);

  useEffect(() => () => {
    if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
  }, []);

  // The server's private verdict: reconcile the optimistic entry by id (or
  // append if we've never seen it — e.g. a result landing after a reset),
  // then fire the celebration battery on hits.
  useEffect(() => {
    return actions.onGuessResult((payload) => {
      setEntries((prev) => {
        const i = prev.findIndex((e) => e.id === payload.id && e.status === 'pending');
        if (i === -1) {
          return [
            ...prev,
            { id: payload.id || `srv${prev.length}`, text: payload.text, status: payload.status },
          ];
        }
        const copy = [...prev];
        copy[i] = { ...copy[i], status: payload.status };
        return copy;
      });

      if (payload.status === 'exact' || payload.status === 'close') {
        const isExact = payload.status === 'exact';
        // Bright celebration hues — the deep text accents vanish on violet.

        // Full-screen radial wash — opacity-only, gone after duration.flash
        // (mirroring the web's radial flash + timeout).
        setFlash(payload.status);
        flashOpacity.value = 0;
        flashOpacity.value = withSequence(
          withTiming(1, { duration: duration.micro }),
          withTiming(0, { duration: duration.flash - duration.micro, easing: easing.out }),
        );
        if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlash(null), duration.flash);

        if (isExact) {
          hapticExact();
          playExact();
        } else {
          hapticClose();
          playClose();
        }
        confettiRef.current?.burst({
          count: isExact ? 28 : 12,
          colors: isExact ? [color.mintBright, color.cta, color.card] : [color.ctaBright],
          origin: { x: 0.5, y: 0.8 },
        });
      } else if (payload.status === 'none') {
        playWrong(); // typer only — the rest of the room never hears misses
      }
    });
  }, [actions, flashOpacity]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    // Swallow accidental double-submits of the same word (double send taps).
    const now = Date.now();
    if (lastSubmitRef.current.t === t.toLowerCase() && now - lastSubmitRef.current.at < 700) {
      setText('');
      return;
    }
    lastSubmitRef.current = { t: t.toLowerCase(), at: now };
    // Optimistic echo: show it instantly, reconcile when the server answers.
    const id = actions.submitGuess(t);
    setEntries((prev) => [...prev, { id, text: t, status: 'pending' }]);
    setText('');
    // blurOnSubmit={false} should already hold focus; this covers the odd
    // Android IME that blurs anyway. The input never loses focus mid-round.
    inputRef.current?.focus();
  };

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  const flashTint = flash === 'exact' ? color.mintBright : color.ctaBright;

  const renderEntry = ({ item }: ListRenderItemInfo<Entry>) => {
    const v = verdictFor(item.status);
    return (
      <Animated.View
        entering={reduceMotion ? undefined : entryPop}
        style={[styles.entry, v.surface ? ENTRY_SURFACE[v.surface] : styles.entryNeutral]}
      >
        <Text
          style={[styles.entryText, { color: v.tint }, ARABIC.test(item.text) && styles.rtl]}
          numberOfLines={1}
        >
          {item.text}
        </Text>
        <View style={styles.entryVerdict}>
          {v.Icon && <v.Icon size={icon.sm} color={v.tint} strokeWidth={ICON_STROKE} />}
          {v.label !== '' && (
            <Text style={[styles.entryVerdictLabel, tabularNums, { color: v.tint }]}>{v.label}</Text>
          )}
        </View>
      </Animated.View>
    );
  };

  return (
    <Screen chrome>
      {/* Behind everything, like the web's -z-0 fixed wash. */}
      {flash && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flashStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id={flashIdRef.current} cx="50%" cy="70%" r="60%">
                <Stop offset="0%" stopColor={flashTint} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={flashTint} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${flashIdRef.current})`} />
          </Svg>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        style={styles.fill}
        // Android resizes via the manifest (§3); only iOS needs help here.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Chip label="Guess the words" accent={color.violet} icon={Keyboard} />
            <Text style={[styles.headerCaption, tabularNums]}>
              <Text
                style={[styles.headerCaptionStrong, ARABIC.test(turn.describerName) && styles.rtl]}
              >
                {turn.describerName}
              </Text>
              {' is describing · '}
              {solved}/{turn.total} found
            </Text>
          </View>
          <Timer deadline={turn.deadline} total={state.settings.turnSeconds} offset={clockOffset} size={76} />
        </View>

        <ScoreStrip teams={state.teams} activeTeamId={turn.teamId} />

        <ProgressDots total={turn.total} solved={solved} />

        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={renderEntry}
          style={styles.fill}
          contentContainerStyle={styles.scratchpadContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Newest guess always lands in view — scroll once the append has
          // actually resized the content, exactly like the web's scrollTop.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: !reduceMotion })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Shout out guesses as single words — type each one and send it.
              </Text>
              <Text style={styles.emptyText}>
                <Text style={styles.emptyStrong}>
                  franco or <Text style={styles.rtl}>عربي</Text> — both count!
                </Text>
                {' '}Unlimited tries.
              </Text>
            </View>
          }
        />

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Type a guess..."
            placeholderTextColor={inkOn.tertiary}
            style={[styles.input, focused && accentSurface(color.violet)]}
            autoFocus
            autoComplete="off"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            blurOnSubmit={false}
            returnKeyType="send"
          />
          <SendButton onPress={submit} />
        </View>
      </KeyboardAvoidingView>

      <ConfettiOverlay ref={confettiRef} />
      <EdgePulse active={danger} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Spectator (opposing team): watches the words + how each gets marked
// ---------------------------------------------------------------------------

function SpectatorView({ state, turn, clockOffset }: RoleViewProps) {
  const words = turn.words ?? [];
  const solved = turn.solvedCount || 0;
  const remaining = useRemaining(turn.deadline, clockOffset);
  const danger = remaining != null && remaining <= 10;

  return (
    <Screen chrome>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Chip
            label={`Watching ${turn.teamName}`}
            accent={teamColor(turn.teamColor)}
            icon={Eye}
          />
          <Text style={[styles.headerCaption, tabularNums]}>
            <Text
              style={[styles.headerCaptionStrong, ARABIC.test(turn.describerName) && styles.rtl]}
            >
              {turn.describerName}
            </Text>
            {' is describing · '}
            {solved}/{turn.total} found
          </Text>
        </View>
        <Timer deadline={turn.deadline} total={state.settings.turnSeconds} offset={clockOffset} size={66} />
      </View>

      <ScoreStrip teams={state.teams} activeTeamId={turn.teamId} />

      <WordList words={words} />

      <EdgePulse active={danger} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Matches the input's minHeight so the pair reads as one control. */
const INPUT_HEIGHT = 52;

const styles = StyleSheet.create({
  fill: { flex: 1 },

  // -- shared header ---------------------------------------------------------
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.sm,
  },
  headerLeft: {
    flexShrink: 1,
    gap: space.xs,
  },
  headerCaption: {
    ...type.caption,
    color: stageOn.secondary,
    paddingLeft: space.xs,
  },
  headerCaptionStrong: {
    fontFamily: font.bodyMedium,
    color: stageOn.primary,
  },

  // -- last-10s edge ---------------------------------------------------------
  edge: {
    // RN 0.81 types `absoluteFill` as an opaque registered style — the
    // spreadable plain object is `absoluteFillObject`.
    ...StyleSheet.absoluteFillObject,
    borderWidth: 3,
    borderColor: color.cta,
    borderRadius: radius.card,
  },

  // -- describer -------------------------------------------------------------
  instruction: {
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  instructionText: {
    ...type.caption,
    color: inkOn.secondary,
    textAlign: 'center',
  },
  instructionStrong: {
    fontFamily: font.bodyBold,
    color: color.ink,
  },

  // -- word list (describer + spectator) -------------------------------------
  wordListContent: {
    gap: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  wordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  solvedShrink: {
    transform: [{ scale: SOLVED_SCALE }],
  },
  wordRight: {
    alignItems: 'flex-end',
    gap: space.xs,
    flexShrink: 0,
  },
  solvedBy: {
    ...type.caption,
    color: inkOn.tertiary,
    maxWidth: 120,
  },
  unknownMark: {
    ...type.title,
    color: inkOn.disabled,
  },

  // -- guesser ---------------------------------------------------------------
  dotsRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  // The progress track lives on the stage — white wash base, amber fills
  // (paired with the "N/M found" count, so colour is never the only signal).
  dotBar: {
    flex: 1,
    height: 8,
    borderRadius: radius.chip,
    backgroundColor: stageOn.wash,
  },
  dotBarSolved: {
    backgroundColor: color.cta,
  },
  scratchpadContent: {
    gap: space.sm,
    paddingVertical: space.sm,
    flexGrow: 1,
  },
  empty: {
    marginTop: space.xxl + space.xl,
    paddingHorizontal: space.xxl,
    gap: space.sm,
  },
  emptyText: {
    ...type.caption,
    color: stageOn.secondary,
    textAlign: 'center',
  },
  emptyStrong: {
    fontFamily: font.bodyMedium,
    color: stageOn.primary,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderRadius: radius.button,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // Solid white rows on the stage; the transparent border keeps neutral rows
  // the same height as accent rows, which carry accentSurface's 1px ring.
  entryNeutral: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  entryText: {
    ...type.bodyMedium,
    flexShrink: 1,
  },
  entryVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexShrink: 0,
  },
  entryVerdictLabel: {
    fontFamily: font.bodyMedium,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
  },
  input: {
    flex: 1,
    minHeight: INPUT_HEIGHT,
    backgroundColor: color.card,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: inkOn.hairlineStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: font.body,
    // Inputs ≥ 16px so nothing zooms or squints; body token qualifies.
    fontSize: type.body.fontSize,
    color: color.ink,
    textAlignVertical: 'center',
  },
  send: {
    width: INPUT_HEIGHT,
    height: INPUT_HEIGHT,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rtl: { writingDirection: 'rtl' },
});
