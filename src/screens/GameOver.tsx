// Game over — the night's final tableau.
//
// Port of client/src/screens/GameOver.jsx with the app-wide overrides applied:
//   - 🏆 / 🥇🥈🥉 / ↺ / ✕ → lucide Trophy / Medal / RotateCcw / LogOut.
//   - The web's winner text-glow and scoreboard box-glows are gone; the winner
//     headline is plain team colour on a white hero card and the winner's
//     scoreboard row is marked with accentSurface() — a solid pastel plus a
//     tinted ring, never a bloom.
//   - canvas-confetti's three bursts become three staggered ConfettiOverlay
//     bursts in the winner's colour (lifted for the violet stage) + amber +
//     white.
//
// The scoreboard here is the same animated-bar construction as the turn-end
// reveal (web components/Scoreboard.jsx): one soft row per team, colour dot,
// tabular score over target, and a progress bar that sweeps in. The web bar
// animates `width`; layout never animates here, so the bar is a full-width
// fill scaled on X from its left edge — transform-only, compositor-only.

import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Crown, LogOut, Medal, RotateCcw, Trophy } from 'lucide-react-native';
import Screen from '../components/Screen';
import Card from '../components/Card';
import Button from '../components/Button';
import ConfettiOverlay, { type ConfettiHandle } from '../components/Confetti';
import type { ScreenProps } from '../lib/useGame';
import type { Team } from '../lib/protocol';
import {
  accentSurface,
  color,
  duration,
  easing,
  icon,
  ICON_STROKE,
  inkOn,
  medal,
  mix,
  radius,
  space,
  STAGGER_MS,
  stageOn,
  tabularNums,
  teamColor,
  type,
} from '../theme';

/** Arabic team/player names read right-to-left inside the LTR layout. */
const ARABIC = /[؀-ۿ]/;

/** Win row: confetti ×3 — the web fires at 0 / 200 / 350ms; ~350ms apart
 *  reads better at phone scale and lets each shower breathe. */
const BURST_STAGGER_MS = 350;

/** The first burst waits one beat for the overlay's onLayout to land —
 *  a burst into a 0×0 overlay is a silent no-op. */
const BURST_LEAD_MS = duration.micro;

/** Medal tints for 1st / 2nd / 3rd — the theme's podium metals. */
const MEDAL_TINTS = [medal.gold, medal.silver, medal.bronze] as const;

/** How far the winner's colour lifts toward white for confetti on violet. */
const CONFETTI_LIFT = 0.4;

// ---------------------------------------------------------------------------
// Scoreboard row — the turn-end reveal's animated-bar construction
// ---------------------------------------------------------------------------

interface ScoreRowProps {
  team: Team;
  target: number;
  /** The winner's row gets the accentSurface ring in its own colour. */
  ringed: boolean;
  /** Position in the whole reveal cascade — drives entrance + bar delays. */
  step: number;
}

function ScoreRow({ team, target, ringed, step }: ScoreRowProps) {
  const reduceMotion = useReducedMotion();
  const tint = teamColor(team.color);
  const frac = Math.min(1, target > 0 ? team.score / target : 0);

  // The bar sweeps to its final fill once the row itself has landed. Under
  // reduced motion it simply starts full — no sweep, no pop.
  const fill = useSharedValue(reduceMotion ? frac : 0);
  useEffect(() => {
    if (reduceMotion) {
      fill.value = frac;
      return;
    }
    fill.value = withDelay(
      step * STAGGER_MS + duration.standard,
      withTiming(frac, { duration: duration.celebratory, easing: easing.out }),
    );
  }, [fill, frac, reduceMotion, step]);

  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  const ring = accentSurface(tint);

  return (
    <Animated.View
      entering={
        reduceMotion
          ? FadeIn.duration(duration.standard)
          : FadeInDown.duration(duration.standard).delay(step * STAGGER_MS).easing(easing.out)
      }
    >
      <Card style={[styles.scoreRow, ringed && ring]}>
        <View style={styles.scoreHead}>
          <View style={styles.scoreIdentity}>
            <View style={[styles.dot, { backgroundColor: tint }]} />
            <Text
              style={[type.title, styles.teamName, ARABIC.test(team.name) && styles.rtl]}
              numberOfLines={1}
            >
              {team.name}
            </Text>
            {/* The web crowns the leader; at game over that is the winner. */}
            {ringed && <Crown size={icon.sm} color={medal.gold} strokeWidth={ICON_STROKE} />}
          </View>
          <Text style={[type.title, tabularNums, styles.score]}>
            {team.score}
            <Text style={[type.caption, styles.target]}>/{target}</Text>
          </Text>
        </View>
        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, { backgroundColor: tint }, barStyle]} />
        </View>
      </Card>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function GameOver({ state, actions }: ScreenProps) {
  const { teams, settings, winnerTeamId, isHost, players } = state;
  const reduceMotion = useReducedMotion();

  const winner = teams.find((t) => t.id === winnerTeamId);
  const winnerTint = winner ? teamColor(winner.color) : color.ink;

  // Final standings, best first; podium = top 3 scorers who actually scored.
  // Array.sort is stable, and `players` arrives in join order, so tied
  // guessers keep their join order — same as the web.
  const standings = [...teams].sort((a, b) => b.score - a.score);
  const podium = [...players]
    .filter((p) => (p.points || 0) > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  // -- Celebration: confetti ×3, once per visit. The fanfare + §6 haptic
  //    pattern fire once app-wide from the Shell's phase watcher (App.tsx) —
  //    haptics are additive, so a second call here would double the pattern. --
  const confettiRef = useRef<ConfettiHandle>(null);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Winner colour (lifted so it pops on violet) + amber + white; amber +
    // white when nobody won (host restarted mid-game).
    const palette = winner
      ? [mix(winnerTint, CONFETTI_LIFT), color.cta, color.card]
      : [color.cta, color.card];
    // Centre fountain, then a left and a right burst — the web's trio.
    const bursts = [
      { count: 30, origin: { x: 0.5, y: 0.6 } },
      { count: 22, origin: { x: 0.12, y: 0.72 } },
      { count: 22, origin: { x: 0.88, y: 0.72 } },
    ];
    const timers = bursts.map((b, i) =>
      setTimeout(
        () => confettiRef.current?.burst({ ...b, colors: palette }),
        BURST_LEAD_MS + i * BURST_STAGGER_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
    // Mount-only by design: `fired` keeps state churn from re-celebrating,
    // and a re-run's cleanup must never cancel bursts already in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Trophy pop: scale 0.4 → 1.12 → 1 on the §2.4 spring, opacity-only
  //    under reduced motion --
  const trophyIn = useSharedValue(0);
  const trophyScale = useSharedValue(reduceMotion ? 1 : 0.4);
  useEffect(() => {
    trophyIn.value = withTiming(1, { duration: duration.standard, easing: easing.out });
    if (!reduceMotion) {
      trophyScale.value = withSequence(
        withTiming(1.12, { duration: duration.celebratory * 0.65, easing: easing.spring }),
        withTiming(1, { duration: duration.celebratory * 0.35, easing: easing.out }),
      );
    }
  }, [reduceMotion, trophyIn, trophyScale]);
  const trophyStyle = useAnimatedStyle(() => ({
    opacity: trophyIn.value,
    transform: reduceMotion ? [] : [{ scale: trophyScale.value }],
  }));

  // -- Non-hosts wait for the rematch with a slow breath (static under RM) --
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isHost || reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(0.55, { duration: duration.celebratory, easing: easing.out }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [isHost, pulse, reduceMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  // One reveal cascade top to bottom: podium rows first, then the standings.
  const scoreStepBase = podium.length;

  const enteringAt = (step: number) =>
    reduceMotion
      ? FadeIn.duration(duration.standard)
      : FadeInDown.duration(duration.standard).delay(step * STAGGER_MS).easing(easing.out);

  return (
    <View style={styles.root}>
      <Screen scroll chrome>
        {/* ---- Winner header — a hero card so the team colour reads ---- */}
        <Card spine={winner ? winnerTint : undefined} style={styles.header}>
          <Animated.View style={trophyStyle}>
            <Trophy size={icon.hero} color={medal.gold} strokeWidth={ICON_STROKE} />
          </Animated.View>
          <Text style={[type.overline, styles.overline]}>Winner</Text>
          <Text
            style={[
              type.displayXl,
              styles.headline,
              { color: winnerTint },
              winner && ARABIC.test(winner.name) && styles.rtl,
            ]}
          >
            {winner ? `${winner.name} wins` : 'Game over'}
          </Text>
          <Text style={[type.body, styles.subline]}>first to {settings.targetScore} points</Text>
        </Card>

        {/* ---- Top guessers podium (server-tracked per-player points) ---- */}
        {podium.length > 0 && (
          <Card style={styles.podium}>
            <Text style={[type.overline, styles.podiumLabel]}>Top guessers</Text>
            {podium.map((p, i) => (
              <Animated.View key={p.id} entering={enteringAt(i)} style={styles.podiumRow}>
                <Medal size={icon.md} color={MEDAL_TINTS[i]} strokeWidth={ICON_STROKE} />
                <Text
                  style={[type.bodyMedium, styles.podiumName, ARABIC.test(p.name) && styles.rtl]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
                <Text style={[type.bodyMedium, tabularNums, styles.podiumPoints]}>
                  {p.points} pts
                </Text>
              </Animated.View>
            ))}
          </Card>
        )}

        {/* ---- Final scoreboard ---- */}
        <Text style={[type.overline, styles.scoresLabel]}>Final scores</Text>
        <View style={styles.scoreList}>
          {standings.map((t, i) => (
            <ScoreRow
              key={t.id}
              team={t}
              target={settings.targetScore}
              ringed={t.id === winnerTeamId}
              step={scoreStepBase + i}
            />
          ))}
        </View>

        {/* ---- Actions ---- */}
        <View style={styles.actions}>
          {isHost ? (
            <View>
              <Button title="Play again — same teams" icon={RotateCcw} onPress={actions.restart} />
              {/* The server keeps dealing from the same deck on rematch. */}
              <Text style={[type.caption, styles.rematchNote]}>Fresh words, same teams</Text>
            </View>
          ) : (
            <Animated.Text style={[type.body, styles.waiting, pulseStyle]}>
              Waiting for the host to start a rematch…
            </Animated.Text>
          )}
          <Button title="Leave" icon={LogOut} variant="ghost" size="md" onPress={actions.leave} />
        </View>
      </Screen>

      {/* Full-screen shower, above everything, never catching a tap. */}
      <ConfettiOverlay ref={confettiRef} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** The scoreboard's colour dot — the web's h-3.5 identity mark. */
const DOT_SIZE = 14;

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    marginBottom: space.xl,
  },
  overline: { color: inkOn.tertiary, marginTop: space.sm },
  headline: { color: color.ink, textAlign: 'center' },
  subline: { color: inkOn.tertiary },

  podium: {
    padding: space.lg,
    marginBottom: space.xl,
    gap: space.sm,
  },
  podiumLabel: { color: inkOn.tertiary, textAlign: 'center', marginBottom: space.xs },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  podiumName: { color: color.ink, flex: 1 },
  podiumPoints: { color: color.violet },

  scoresLabel: { color: stageOn.primary, marginBottom: space.sm },
  scoreList: { gap: space.md },
  scoreRow: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  scoreHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  scoreIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radius.chip,
  },
  teamName: { color: color.ink, flexShrink: 1 },
  score: { color: color.ink },
  target: { color: inkOn.tertiary },
  track: {
    height: space.sm,
    marginTop: space.sm,
    borderRadius: radius.chip,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  trackFill: {
    width: '100%',
    height: '100%',
    borderRadius: radius.chip,
    transformOrigin: 'left',
  },

  actions: {
    marginTop: 'auto',
    paddingTop: space.xxl,
    gap: space.md,
  },
  rematchNote: { color: stageOn.tertiary, textAlign: 'center', marginTop: space.sm },
  waiting: { color: stageOn.secondary, textAlign: 'center' },

  rtl: { writingDirection: 'rtl' },
});
