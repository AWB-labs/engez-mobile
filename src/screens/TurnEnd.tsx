// The between-turn reveal (DESIGN.md §5, "Turn end") — port of
// client/src/screens/TurnEnd.jsx. Three beats, top to bottom:
//
//   1. "+N this turn" headline in the team's colour, with the words-found tally.
//   2. All five words, revealed with the §2.4 STAGGER_MS cascade — solved rows
//      wear the mint wash + PointsBadge + who got them; missed rows sit dim
//      behind a neutral Minus slot.
//   3. The full scoreboard (bars grow toward the target score, transform-only,
//      like the web Scoreboard and the GameOver bars), then
//      the "Up next" card so the next describer is already reaching for their
//      phone — plus the server's auto-advance countdown when it's running.
//
// The web's glows (team text-shadow, bar box-shadow, dot bloom) are re-expressed
// as flat tints and accentSurface washes per the mobile overrides.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { ArrowRight, Crown, Minus } from 'lucide-react-native';
import Screen from '../components/Screen';
import Card from '../components/Card';
import TitleCard from '../components/TitleCard';
import PointsBadge from '../components/PointsBadge';
import type { ScreenProps } from '../lib/useGame';
import {
  accentSurface,
  color,
  displayLine,
  duration,
  easing,
  font,
  icon,
  ICON_STROKE,
  inkOn,
  medal,
  radius,
  space,
  STAGGER_MS,
  stageOn,
  tabularNums,
  teamColor,
  type,
} from '../theme';

/** Score bar geometry — a thin rounded meter, never a slab. */
const BAR_HEIGHT = 8;

/** Arabic team/player names read right-to-left inside the LTR layout (§7). */
const ARABIC = /[؀-ۿ]/;

/**
 * §2.4 list reveal: fade + small lift, STAGGER_MS per row. The builder's
 * default ReduceMotion.System drops the whole entrance under reduced motion —
 * rows simply appear, which is the sanctioned collapse.
 */
const reveal = (step: number) =>
  FadeInDown.duration(duration.standard).easing(easing.out).delay(step * STAGGER_MS);

// ---------------------------------------------------------------------------
// Countdown — "next turn in Ns" off the server's phase clock
// ---------------------------------------------------------------------------

/** Whole seconds until `deadline` on the server's clock, clamped at zero. */
const secondsUntil = (deadline: number | null, offset: number): number | null =>
  deadline == null ? null : Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));

/**
 * Self-ticking countdown. Polls at 4Hz but only the once-a-second value lands
 * in state (React bails on identical sets), so re-renders stay per-second.
 */
function useCountdown(deadline: number | null, offset: number): number | null {
  const [left, setLeft] = useState<number | null>(() => secondsUntil(deadline, offset));
  useEffect(() => {
    setLeft(secondsUntil(deadline, offset));
    if (deadline == null) return;
    const id = setInterval(() => setLeft(secondsUntil(deadline, offset)), 250);
    return () => clearInterval(id);
  }, [deadline, offset]);
  return left;
}

// ---------------------------------------------------------------------------
// Score bar — grows 0 → score/target, transform-only
// ---------------------------------------------------------------------------

interface ScoreBarProps {
  tint: string;
  /** This team's progress toward the win target, in [0, 1]. */
  frac: number;
  /** Wait for the row's own entrance before growing. */
  delay: number;
}

function ScoreBar({ tint, frac, delay }: ScoreBarProps) {
  const reduceMotion = useReducedMotion();

  // scaleX with a left origin is the transform-only stand-in for the web's
  // animated width — the layout never changes, only the compositor works.
  const grow = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      grow.value = frac; // no sweep — the bar just is its final length
      return;
    }
    grow.value = 0;
    grow.value = withDelay(
      delay,
      withTiming(frac, { duration: duration.celebratory, easing: easing.out }),
    );
    return () => cancelAnimation(grow);
  }, [frac, delay, reduceMotion, grow]);

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));

  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { backgroundColor: tint }, fill]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TurnEnd({ state, clockOffset }: ScreenProps) {
  const { turn, teams, settings, nextUp, phaseEndsAt } = state;
  const secondsLeft = useCountdown(phaseEndsAt, clockOffset);

  if (!turn) return null;
  const words = turn.words ?? [];
  const tint = teamColor(turn.teamColor);
  const gained = words.reduce((sum, w) => sum + (w.points || 0), 0);
  const gotCount = words.filter((w) => w.solved).length;

  const sorted = [...teams].sort((a, b) => b.score - a.score);
  const top = sorted.length ? sorted[0].score : 0;

  // Reveal order: words first, then scoreboard rows, then the up-next card.
  const scoreStep = (i: number) => words.length + i;
  const nextStep = words.length + sorted.length;

  return (
    <Screen scroll chrome>
      {/* ---- 1 · headline — a hero card so the team colour reads on white -- */}
      <Card spine={tint} style={styles.header}>
        <Text style={styles.overline}>Time's up</Text>
        <Text
          style={[styles.teamName, { color: tint }, ARABIC.test(turn.teamName) && styles.rtl]}
          numberOfLines={2}
        >
          {turn.teamName}
        </Text>
        <Text style={[styles.gained, tabularNums, { color: tint }]}>+{gained} this turn</Text>
        <Text style={[styles.tally, tabularNums]}>
          {gotCount}/{turn.total} words
        </Text>
      </Card>

      {/* ---- 2 · the five words -------------------------------------------- */}
      <View style={styles.words}>
        {words.map((w, i) => (
          <Animated.View
            key={i}
            entering={reveal(i)}
            style={[styles.wordRow, w.solved ? accentSurface(color.mint) : styles.wordRowMissed]}
          >
            <TitleCard display={w.display} solved={false} dim={!w.solved} size="md" />
            {w.solved ? (
              <View style={styles.outcome}>
                <PointsBadge points={w.points ?? 1} />
                {w.solvedByName ? <Text style={styles.byline}>by {w.solvedByName}</Text> : null}
              </View>
            ) : (
              <View style={styles.outcome}>
                <Minus size={icon.md} color={inkOn.tertiary} strokeWidth={ICON_STROKE} />
                <Text style={styles.missed}>missed</Text>
              </View>
            )}
          </Animated.View>
        ))}
      </View>

      {/* Push the scoreboard to the bottom on tall screens (web's mt-auto). */}
      <View style={styles.spacer} />

      {/* ---- 3 · scoreboard + up next -------------------------------------- */}
      <Text style={styles.sectionLabel}>Scores</Text>
      {sorted.map((t, i) => {
        const rowTint = teamColor(t.color);
        const active = t.id === turn.teamId;
        const leading = t.score === top && top > 0;
        return (
          <Animated.View
            key={t.id}
            entering={reveal(scoreStep(i))}
            style={[styles.teamRow, active ? accentSurface(rowTint) : styles.teamRowIdle]}
            accessible
            accessibilityLabel={`${t.name}: ${t.score} of ${settings.targetScore} points`}
          >
            <View style={styles.teamRowHead}>
              <View style={styles.teamRowIdentity}>
                <View style={[styles.dot, { backgroundColor: rowTint }]} />
                <Text
                  style={[styles.teamRowName, ARABIC.test(t.name) && styles.rtl]}
                  numberOfLines={1}
                >
                  {t.name}
                </Text>
                {leading && <Crown size={icon.sm} color={medal.gold} strokeWidth={ICON_STROKE} />}
              </View>
              <Text style={[styles.score, tabularNums]}>
                {t.score}
                <Text style={styles.scoreTarget}>/{settings.targetScore}</Text>
              </Text>
            </View>
            {/* Bars fill toward the win target — the same normalization as
                the row's own score/target figure; each waits for its row to
                land. */}
            <ScoreBar
              tint={rowTint}
              frac={settings.targetScore > 0 ? Math.min(1, t.score / settings.targetScore) : 0}
              delay={scoreStep(i) * STAGGER_MS + duration.standard}
            />
          </Animated.View>
        );
      })}

      {/* `nextUp` is null when the reveal outlives the roster (e.g. teams
          emptied mid-game) — the card simply doesn't render. */}
      {nextUp && (
        <Animated.View entering={reveal(nextStep)}>
          <Card soft style={styles.nextCard}>
            <ArrowRight size={icon.md} color={inkOn.secondary} strokeWidth={ICON_STROKE} />
            <Text style={styles.nextLabel}>Up next</Text>
            <Text
              style={[styles.nextName, ARABIC.test(nextUp.describerName) && styles.rtl]}
              numberOfLines={1}
            >
              {nextUp.describerName}
            </Text>
            <Text style={styles.nextSep}>—</Text>
            <Text
              style={[
                styles.nextTeam,
                { color: teamColor(nextUp.teamColor) },
                ARABIC.test(nextUp.teamName) && styles.rtl,
              ]}
              numberOfLines={1}
            >
              {nextUp.teamName}
            </Text>
          </Card>
        </Animated.View>
      )}

      {secondsLeft != null && (
        <Text style={[styles.countdown, tabularNums]}>next turn in {secondsLeft}s</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // ---- headline ----
  header: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  overline: {
    ...type.overline,
    color: inkOn.tertiary,
    marginBottom: space.xs,
  },
  teamName: {
    ...type.title,
    textAlign: 'center',
  },
  gained: {
    ...type.displayLg,
    textAlign: 'center',
  },
  tally: {
    ...type.caption,
    color: inkOn.secondary,
    marginTop: space.xs,
  },

  // ---- word rows ----
  words: {
    marginBottom: space.lg,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.sm,
  },
  // Solid white rows on the stage, like the guesser's scratchpad.
  wordRowMissed: {
    backgroundColor: color.card,
    borderColor: inkOn.hairline,
  },
  outcome: {
    alignItems: 'flex-end',
    gap: space.xs,
  },
  byline: {
    ...type.caption,
    color: inkOn.tertiary,
  },
  missed: {
    ...type.caption,
    color: inkOn.tertiary,
  },

  spacer: {
    flexGrow: 1,
  },

  // ---- scoreboard ----
  sectionLabel: {
    ...type.overline,
    color: stageOn.primary,
    marginBottom: space.sm,
  },
  teamRow: {
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.sm,
  },
  teamRowIdle: {
    backgroundColor: color.card,
    borderColor: inkOn.hairline,
  },
  teamRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  teamRowIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  // Poster type at body scale — display family, token sizes only.
  teamRowName: {
    fontFamily: font.display,
    fontSize: type.body.fontSize,
    lineHeight: displayLine(type.body.fontSize),
    color: color.ink,
    flexShrink: 1,
  },
  score: {
    fontFamily: font.display,
    fontSize: type.body.fontSize,
    lineHeight: displayLine(type.body.fontSize),
    color: color.ink,
  },
  scoreTarget: {
    ...type.caption,
    color: inkOn.tertiary,
  },
  barTrack: {
    height: BAR_HEIGHT,
    borderRadius: radius.chip,
    backgroundColor: color.line,
    overflow: 'hidden',
    marginTop: space.sm,
  },
  barFill: {
    // RN 0.81: `absoluteFillObject` is the spreadable form (see Card.tsx).
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.chip,
    // scaleX grows from the left edge — the transform-only width animation.
    transformOrigin: 'left',
  },

  // ---- up next ----
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.md,
  },
  nextLabel: {
    ...type.overline,
    color: inkOn.tertiary,
  },
  nextName: {
    fontFamily: font.display,
    fontSize: type.body.fontSize,
    lineHeight: displayLine(type.body.fontSize),
    color: color.ink,
    flexShrink: 1,
  },
  nextSep: {
    ...type.body,
    color: inkOn.tertiary,
  },
  nextTeam: {
    fontFamily: font.display,
    fontSize: type.body.fontSize,
    lineHeight: displayLine(type.body.fontSize),
    flexShrink: 1,
  },

  countdown: {
    ...type.caption,
    color: stageOn.secondary,
    textAlign: 'center',
    marginTop: space.md,
  },
  rtl: {
    writingDirection: 'rtl',
  },
});
