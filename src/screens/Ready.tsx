// The pre-turn focus screen (DESIGN.md §5, "Ready") — port of
// client/src/screens/Ready.jsx. One depth.high card carries the whole moment:
// whose turn it is, who's describing, and — when that's you — the single
// giant Start button that also unlocks audio (§2.5, first tap).
//
// Behaviour is 1:1 with the web screen:
//   - `starting` disarms the button the instant it's tapped, re-arms on each
//     new turn index, and un-sticks after 3s if the server never flipped the
//     phase (the tap raced a reconnect — useGame queues and retries it).
//   - The host sees a skip control only while the describer is disconnected.
//
// Visuals re-expressed per the mobile overrides: the web's glow chip and
// text-shadow become an accentSurface wash + hairline ring on the focus card;
// every emoji is a lucide icon; the Start pulse is a transform-only heartbeat
// that collapses to nothing under reduced motion.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Eye, Keyboard, Mic, Play, SkipForward } from 'lucide-react-native';
import Screen from '../components/Screen';
import Card from '../components/Card';
import Chip from '../components/Chip';
import Button from '../components/Button';
import ScoreStrip from '../components/ScoreStrip';
import { initSound } from '../lib/sound';
import type { ScreenProps } from '../lib/useGame';
import {
  accentSurface,
  color,
  depth,
  duration,
  easing,
  inkOn,
  radius,
  space,
  STAGGER_MS,
  teamColor,
  type,
} from '../theme';

/** Web parity: a stuck "Starting…" re-arms itself after this long. */
const START_UNSTICK_MS = 3000;

/** The Start button's heartbeat ceiling — a nudge, never a throb. */
const START_PULSE_SCALE = 1.02;

/** How far the waiting line breathes down from full opacity. */
const WAIT_FADE = 0.45;

/** Arabic team/player names read right-to-left inside the LTR layout (§7). */
const ARABIC = /[؀-ۿ]/;

/**
 * §2.4 list reveal: fade + small lift, STAGGER_MS per block. The builder's
 * default ReduceMotion.System drops the whole entrance under reduced motion —
 * blocks simply appear, which is the sanctioned collapse.
 */
const reveal = (step: number) =>
  FadeInDown.duration(duration.standard).easing(easing.out).delay(step * STAGGER_MS);

export default function Ready({ state, actions }: ScreenProps) {
  const { turn, youId, players, isHost, teams, settings } = state;
  const reduceMotion = useReducedMotion();

  const [starting, setStarting] = useState(false);
  const youAreDescriber = !!turn && turn.describerId === youId;

  // Re-arm the button for each new turn, and un-stick it if the server didn't
  // flip the phase (e.g. the tap raced a reconnect — it's queued and retried).
  const turnIndex = turn?.index;
  useEffect(() => setStarting(false), [turnIndex]);
  useEffect(() => {
    if (!starting) return;
    const t = setTimeout(() => setStarting(false), START_UNSTICK_MS);
    return () => clearTimeout(t);
  }, [starting]);

  // Gentle 1 → 1.02 heartbeat on the Start button. Pure transform on the
  // compositor; paused while "Starting…" and skipped under reduced motion.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || !youAreDescriber || starting) {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: duration.standard, easing: easing.out });
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: duration.celebratory, easing: easing.out }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion, youAreDescriber, starting, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * (START_PULSE_SCALE - 1) }],
  }));

  // The waiting line breathes — an opacity-only pulse (the web's pulseGlow,
  // minus the glow). Static under reduced motion.
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || youAreDescriber) {
      cancelAnimation(breathe);
      breathe.value = 0;
      return;
    }
    breathe.value = withRepeat(
      withTiming(1, { duration: duration.celebratory, easing: easing.out }),
      -1,
      true,
    );
    return () => cancelAnimation(breathe);
  }, [reduceMotion, youAreDescriber, breathe]);
  const breatheStyle = useAnimatedStyle(() => ({ opacity: 1 - breathe.value * WAIT_FADE }));

  if (!turn) return null;

  const tint = teamColor(turn.teamColor);
  // The card is washed in the team colour: a solid pastel over the white
  // card + tinted ring — the glow-free way an accent marks "this is the
  // moment".
  const wash = accentSurface(tint);

  const role = turn.role;
  const roleAccent = youAreDescriber ? color.mint : role === 'guesser' ? color.violet : tint;
  const RoleIcon = youAreDescriber ? Mic : role === 'guesser' ? Keyboard : Eye;
  const roleLabel = youAreDescriber ? 'Your turn' : role === 'guesser' ? 'Get ready to guess' : 'Up next';

  const describer = players.find((p) => p.id === turn.describerId);
  const describerOffline = !describer || !describer.connected;

  return (
    <Screen chrome contentStyle={styles.centerColumn}>
      <Animated.View entering={reveal(0)}>
        <Card
          style={[
            styles.focusCard,
            depth.high,
            // A uniform accent ring replaces the card's default hairlines.
            { borderColor: wash.borderColor, borderTopColor: wash.borderColor },
          ]}
        >
          {/* Team-colour pastel over the white surface, clipped to the card. */}
          <View pointerEvents="none" style={[styles.washFill, { backgroundColor: wash.backgroundColor }]} />

          <Chip label={roleLabel} accent={roleAccent} icon={RoleIcon} style={styles.roleChip} />

          <Text style={styles.overline}>Next up</Text>
          <Text
            style={[styles.teamName, { color: tint }, ARABIC.test(turn.teamName) && styles.rtl]}
            numberOfLines={2}
          >
            {turn.teamName}
          </Text>
          <Text style={styles.headline}>
            {youAreDescriber
              ? `${turn.describerName}, you are describing`
              : `${turn.describerName} is describing`}
          </Text>

          {youAreDescriber ? (
            <View style={styles.action}>
              <Animated.View style={[styles.startWrap, pulseStyle]}>
                <Button
                  title={starting ? 'Starting…' : 'Start my turn'}
                  icon={Play}
                  size="lg"
                  disabled={starting}
                  onPress={() => {
                    void initSound(); // the first tap unlocks audio (§2.5)
                    setStarting(true);
                    actions.startTurn();
                  }}
                />
              </Animated.View>
              <Text style={styles.hint}>
                You'll get {turn.total} words and {settings.turnSeconds} seconds. Describe them
                without saying the word — tap Start when your team's ready.
              </Text>
            </View>
          ) : (
            <View style={styles.action}>
              <Animated.Text style={[styles.waiting, breatheStyle]}>
                Waiting for {turn.describerName} to start…
              </Animated.Text>
              <Text style={styles.hint}>
                {role === 'guesser'
                  ? 'Get your fingers ready — type every word you can guess!'
                  : `Watch ${turn.teamName} take their turn.`}
              </Text>
            </View>
          )}
        </Card>
      </Animated.View>

      {!youAreDescriber && (
        <Animated.View entering={reveal(1)} style={styles.stripWrap}>
          <ScoreStrip teams={teams} activeTeamId={turn.teamId} />
        </Animated.View>
      )}

      {/* Web parity: the host can rescue a turn whose describer dropped. */}
      {!youAreDescriber && isHost && describerOffline && (
        <Animated.View entering={reveal(2)}>
          <Button
            variant="ghost"
            size="md"
            icon={SkipForward}
            title={`Skip turn — ${turn.describerName} looks offline`}
            onPress={actions.skipTurn}
            style={styles.skip}
          />
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerColumn: {
    justifyContent: 'center',
  },
  focusCard: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
  },
  washFill: {
    // RN 0.81: `absoluteFillObject` is the spreadable form (see Card.tsx).
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.card,
  },
  roleChip: {
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  overline: {
    ...type.overline,
    color: inkOn.tertiary,
    textAlign: 'center',
    marginBottom: space.xs,
  },
  teamName: {
    ...type.displayLg,
    textAlign: 'center',
  },
  headline: {
    ...type.title,
    color: color.ink,
    textAlign: 'center',
    marginTop: space.xs,
  },
  action: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: space.xl,
  },
  startWrap: {
    alignSelf: 'stretch',
  },
  waiting: {
    ...type.title,
    color: inkOn.secondary,
    textAlign: 'center',
  },
  hint: {
    ...type.body,
    color: inkOn.tertiary,
    textAlign: 'center',
    marginTop: space.lg,
  },
  stripWrap: {
    alignItems: 'center',
    marginTop: space.xl,
  },
  skip: {
    marginTop: space.lg,
  },
  rtl: {
    writingDirection: 'rtl',
  },
});
