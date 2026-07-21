// Pre-game lobby (DESIGN.md §5, "Lobby") — port of client/src/screens/Lobby.jsx.
//
// The host assigns players to teams, tweaks the two settings, and starts;
// everyone else watches the teams fill up in real time. Jobs in order:
//
//   1. The share card first — the code is the lobby's job #1.
//   2. Teams as cards: colour spine, editable name (host), member pills,
//      a Ready chip at 2+, add/remove team, and the one-tap Shuffle teams
//      re-deal (the web's "Auto teams" — same autoTeams message, renamed to
//      say what it does).
//   3. Unassigned players, with the host's two-tap placement flow:
//      tap a player (pill lights amber), then tap their team.
//   4. Host footer: win-score / seconds steppers + a Start button that
//      explains itself when disabled (the server's canStart.reason, verbatim).
//
// Mobile re-expressions of the web screen, per the app-wide overrides:
//   - number inputs → 44px minus/plus steppers (§7 touch targets, no keyboard);
//   - window.confirm on kick/leave → Alert.alert;
//   - every emoji/glyph (🎲 ✕ ✓ ＋) → a lucide icon;
//   - the team dot's glow and the team-name text-shadow are gone — identity
//     is the spine, the dot and plain colour, per the no-glow override.

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Check, LogOut, Minus, Play, Plus, Shuffle, Users, X } from 'lucide-react-native';
import Screen from '../components/Screen';
import Card from '../components/Card';
import Chip from '../components/Chip';
import Button from '../components/Button';
import PlayerPill from '../components/PlayerPill';
import SharePanel from '../components/SharePanel';
import { hapticShuffle } from '../lib/haptics';
import type { ScreenProps } from '../lib/useGame';
import {
  alpha,
  color,
  duration,
  easing,
  HIT_SLOP,
  ICON_STROKE,
  icon,
  inkOn,
  MIN_TOUCH,
  PRESS_SCALE,
  radius,
  space,
  STAGGER_MS,
  stageOn,
  tabularNums,
  teamColor,
  type,
} from '../theme';

/** Settings bounds — the same min/max/step the web number inputs enforced. */
const TARGET = { min: 10, max: 200, step: 2 } as const;
const SECONDS = { min: 15, max: 120, step: 5 } as const;

/** The engine serves at most 8 team colours; the web gates Add team the same way. */
const MAX_TEAMS = 8;

/** A team is playable at two members — the ✓-ready threshold (§5). */
const TEAM_READY_AT = 2;

/** How far the non-host waiting line breathes down from full opacity. */
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

// ---------------------------------------------------------------------------
// Settings stepper — the web's number inputs, rebuilt for thumbs
// ---------------------------------------------------------------------------

interface StepperProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(next: number): void;
}

function Stepper({ label, unit, value, min, max, step, onChange }: StepperProps) {
  const canDec = value - step >= min;
  const canInc = value + step <= max;

  const bump = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + dir * step));
    if (next !== value) onChange(next);
  };

  return (
    <Card soft style={styles.stepperCard}>
      <View style={styles.stepperText}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <View style={styles.stepperValueRow}>
          <Text style={[styles.stepperValue, tabularNums]}>{value}</Text>
          <Text style={styles.stepperUnit}>{unit}</Text>
        </View>
      </View>
      <View style={styles.stepperButtons}>
        <Pressable
          onPress={() => bump(-1)}
          disabled={!canDec}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        >
          <Minus
            size={icon.md}
            color={canDec ? inkOn.secondary : inkOn.disabled}
            strokeWidth={ICON_STROKE}
          />
        </Pressable>
        <Pressable
          onPress={() => bump(1)}
          disabled={!canInc}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        >
          <Plus
            size={icon.md}
            color={canInc ? inkOn.secondary : inkOn.disabled}
            strokeWidth={ICON_STROKE}
          />
        </Pressable>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function Lobby({ state, actions }: ScreenProps) {
  const { code, isHost, teams, players, settings, canStart, youId } = state;
  const reduceMotion = useReducedMotion();

  // The host's two-tap placement flow: the player currently being placed.
  const [selected, setSelected] = useState<string | null>(null);

  // Selection is only meaningful while that player exists and is unassigned —
  // it self-clears when they get placed, leave, or are kicked.
  useEffect(() => {
    if (selected && !players.some((p) => p.id === selected && !p.teamId)) {
      setSelected(null);
    }
  }, [players, selected]);

  // Settings are optimistic: the tap lands locally at once, the server echo
  // (settings.*) re-syncs us — so a slow round trip never makes taps "stick".
  const [target, setTarget] = useState(settings.targetScore);
  const [seconds, setSeconds] = useState(settings.turnSeconds);
  useEffect(() => setTarget(settings.targetScore), [settings.targetScore]);
  useEffect(() => setSeconds(settings.turnSeconds), [settings.turnSeconds]);

  const unassigned = players.filter((p) => !p.teamId);
  const you = players.find((p) => p.id === youId);
  const yourTeam = you && you.teamId ? teams.find((t) => t.id === you.teamId) : undefined;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  const confirmKick = (playerId: string) => {
    Alert.alert(`Kick ${nameOf(playerId)}?`, 'They can rejoin with the room code.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Kick', style: 'destructive', onPress: () => actions.kickPlayer(playerId) },
    ]);
  };

  const confirmLeave = () => {
    Alert.alert('Leave the game?', undefined, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => actions.leave() },
    ]);
  };

  // The non-host waiting line breathes — opacity only, static under reduced
  // motion (the same pattern as the Ready screen's waiting pulse).
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || isHost) {
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
  }, [reduceMotion, isHost, breathe]);
  const breatheStyle = useAnimatedStyle(() => ({ opacity: 1 - breathe.value * WAIT_FADE }));

  return (
    <Screen scroll chrome contentStyle={styles.content}>
      {/* Header: title, live player count, and the lobby's own leave chip. */}
      <Animated.View entering={reveal(0)} style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">
          Lobby
        </Text>
        <View style={styles.headerSide}>
          <Chip
            label={`${players.length} ${players.length === 1 ? 'player' : 'players'}`}
            icon={Users}
          />
          <Pressable
            onPress={confirmLeave}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Leave the room"
            style={({ pressed }) => [styles.leaveChip, pressed && styles.pressed]}
          >
            <LogOut size={icon.sm} color={stageOn.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.leaveLabel}>Leave</Text>
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View entering={reveal(1)}>
        <SharePanel code={code} />
      </Animated.View>

      {/* Non-hosts see where they stand while the host sorts the room. */}
      {!isHost && (
        <Animated.View entering={reveal(2)}>
          <Card soft style={styles.statusCard}>
            {yourTeam ? (
              <Text style={styles.statusText}>
                You're on{' '}
                <Text
                  style={[
                    styles.statusTeam,
                    { color: teamColor(yourTeam.color) },
                    ARABIC.test(yourTeam.name) && styles.rtl,
                  ]}
                >
                  {yourTeam.name}
                </Text>
              </Text>
            ) : (
              <Text style={styles.statusWaiting}>
                Waiting for the host to put you on a team…
              </Text>
            )}
          </Card>
        </Animated.View>
      )}

      {/* Teams */}
      <View style={styles.teamStack}>
        {teams.map((t, i) => {
          const tint = teamColor(t.color);
          const count = t.playerIds.length;
          const ready = count >= TEAM_READY_AT;
          return (
            <Animated.View key={t.id} entering={reveal(2 + i)}>
              <Card spine={tint} style={styles.teamCard}>
                <View style={styles.teamHeader}>
                  <View style={styles.teamIdentity}>
                    <View style={[styles.teamDot, { backgroundColor: tint }]} />
                    {isHost ? (
                      // Uncontrolled input keyed on the server name: external
                      // renames remount it fresh, local edits commit on blur.
                      <TextInput
                        key={`${t.id}:${t.name}`}
                        defaultValue={t.name}
                        maxLength={20}
                        autoCorrect={false}
                        returnKeyType="done"
                        selectionColor={tint}
                        onEndEditing={(e) => {
                          const next = e.nativeEvent.text.trim();
                          if (next && next !== t.name) actions.renameTeam(t.id, next);
                        }}
                        style={[styles.teamName, styles.teamNameInput, ARABIC.test(t.name) && styles.rtl]}
                        accessibilityLabel={`Rename ${t.name}`}
                      />
                    ) : (
                      <Text
                        style={[styles.teamName, ARABIC.test(t.name) && styles.rtl]}
                        numberOfLines={1}
                      >
                        {t.name}
                      </Text>
                    )}
                  </View>
                  <View style={styles.teamHeaderSide}>
                    {ready ? (
                      <Chip label="Ready" accent={color.mint} icon={Check} />
                    ) : (
                      <Chip label={`${count}/${TEAM_READY_AT}`} />
                    )}
                    {isHost && teams.length > 2 && (
                      // A destructive control (no confirm), so the box itself
                      // is MIN_TOUCH — hitSlop can't grow past the header
                      // row's bounds, which would leave it under the 44px rule.
                      <Pressable
                        onPress={() => actions.removeTeam(t.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${t.name}`}
                        style={({ pressed }) => [styles.removeTeam, pressed && styles.pressed]}
                      >
                        <X size={icon.sm} color={inkOn.tertiary} strokeWidth={ICON_STROKE} />
                      </Pressable>
                    )}
                  </View>
                </View>

                <View style={styles.pillRow}>
                  {t.playerIds.map((pid) => (
                    <PlayerPill
                      key={pid}
                      label={nameOf(pid)}
                      you={pid === youId}
                      accent={t.color}
                      disabled={!isHost}
                      canKick={isHost && pid !== youId}
                      // Host taps a member to bounce them back to unassigned.
                      onPress={isHost ? () => actions.assignPlayer(pid, null) : undefined}
                      onKick={() => confirmKick(pid)}
                    />
                  ))}
                  {isHost && selected && (
                    <Pressable
                      onPress={() => {
                        actions.assignPlayer(selected, t.id);
                        setSelected(null);
                      }}
                      hitSlop={HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel={`Place ${nameOf(selected)} on ${t.name}`}
                      style={({ pressed }) => [styles.placeButton, pressed && styles.pressed]}
                    >
                      <Plus size={icon.sm} color={inkOn.secondary} strokeWidth={ICON_STROKE} />
                      <Text style={styles.placeLabel} numberOfLines={1}>
                        Place {nameOf(selected)}
                      </Text>
                    </Pressable>
                  )}
                  {count === 0 && !selected && (
                    <Text style={styles.emptyTeam}>No players yet</Text>
                  )}
                </View>
              </Card>
            </Animated.View>
          );
        })}

        {/* Host: grow the bracket, or shuffle everyone in one tap. */}
        {isHost && (
          <Animated.View entering={reveal(2 + teams.length)} style={styles.teamTools}>
            {teams.length < MAX_TEAMS && (
              <Pressable
                onPress={actions.addTeam}
                accessibilityRole="button"
                style={({ pressed }) => [styles.dashed, pressed && styles.pressed]}
              >
                <Plus size={icon.md} color={stageOn.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.dashedLabel}>Add team</Text>
              </Pressable>
            )}
            {players.length >= 2 && (
              <Pressable
                onPress={() => {
                  hapticShuffle();
                  actions.autoTeams();
                }}
                accessibilityRole="button"
                accessibilityLabel="Shuffle everyone into random teams"
                style={({ pressed }) => [styles.dashed, styles.dashedAmber, pressed && styles.pressed]}
              >
                <Shuffle size={icon.md} color={color.ctaBright} strokeWidth={ICON_STROKE} />
                <Text style={styles.dashedLabel}>Shuffle teams</Text>
              </Pressable>
            )}
          </Animated.View>
        )}
      </View>

      {/* Unassigned players + the two-tap placement instructions. */}
      {unassigned.length > 0 && (
        <Animated.View entering={reveal(3 + teams.length)} style={styles.unassigned}>
          <Text style={styles.unassignedLabel}>
            {isHost ? 'Tap a player, then tap their team' : 'Not on a team yet'}
          </Text>
          <View style={styles.pillRow}>
            {unassigned.map((p) => (
              <PlayerPill
                key={p.id}
                label={p.name}
                you={p.id === youId}
                selected={selected === p.id}
                disabled={!isHost}
                canKick={isHost && p.id !== youId}
                onPress={
                  isHost ? () => setSelected(selected === p.id ? null : p.id) : undefined
                }
                onKick={() => confirmKick(p.id)}
              />
            ))}
          </View>
        </Animated.View>
      )}

      {/* Host footer: the two settings + Start. Everyone else: the calm pulse. */}
      {isHost ? (
        <Animated.View entering={reveal(4 + teams.length)} style={styles.footer}>
          <Stepper
            label="Win at"
            unit="pts"
            value={target}
            min={TARGET.min}
            max={TARGET.max}
            step={TARGET.step}
            onChange={(next) => {
              setTarget(next);
              actions.setSettings({ targetScore: next });
            }}
          />
          <Stepper
            label="Per turn"
            unit="sec"
            value={seconds}
            min={SECONDS.min}
            max={SECONDS.max}
            step={SECONDS.step}
            onChange={(next) => {
              setSeconds(next);
              actions.setSettings({ turnSeconds: next });
            }}
          />
          <Button
            title={canStart.ok ? 'Start game' : (canStart.reason ?? 'Waiting for players…')}
            icon={canStart.ok ? Play : undefined}
            disabled={!canStart.ok}
            onPress={actions.startGame}
            style={styles.start}
          />
        </Animated.View>
      ) : (
        <Animated.View entering={reveal(4 + teams.length)}>
          <Animated.Text style={[styles.waiting, breatheStyle]}>
            Waiting for the host to start…
          </Animated.Text>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.md,
  },
  title: {
    ...type.displayLg,
    color: stageOn.primary,
  },
  headerSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // A quiet pressable pill on the stage — white wash, same metrics as Chip.
  leaveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.chip,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    backgroundColor: stageOn.wash,
    borderWidth: 1,
    borderColor: stageOn.washBorder,
  },
  leaveLabel: {
    ...type.caption,
    color: stageOn.primary,
  },
  pressed: {
    transform: [{ scale: PRESS_SCALE }],
  },
  statusCard: {
    alignItems: 'center',
    padding: space.lg,
    marginTop: space.lg,
  },
  statusText: {
    ...type.body,
    color: color.ink,
    textAlign: 'center',
  },
  statusTeam: {
    ...type.title,
  },
  statusWaiting: {
    ...type.body,
    color: inkOn.tertiary,
    textAlign: 'center',
  },
  teamStack: {
    gap: space.md,
    marginTop: space.lg,
  },
  teamCard: {
    padding: space.lg,
    paddingTop: space.lg + space.xs, // breathing room under the 3px spine
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  teamIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexShrink: 1,
    flexGrow: 1,
  },
  teamDot: {
    width: 14,
    height: 14,
    borderRadius: radius.chip,
  },
  teamName: {
    ...type.title,
    color: color.ink,
    flexShrink: 1,
  },
  teamNameInput: {
    flexGrow: 1,
    paddingVertical: 0, // Android inputs pad vertically by default
  },
  teamHeaderSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // The full box is the touch target — no negative margins, since touches
  // outside an ancestor's bounds are clipped and would shrink it right back.
  removeTeam: {
    alignItems: 'center',
    justifyContent: 'center',
    width: MIN_TOUCH,
    height: MIN_TOUCH,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    minHeight: 36, // one pill row, even while empty
  },
  placeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: alpha(color.ink, 0.3),
  },
  placeLabel: {
    ...type.bodyMedium,
    color: inkOn.secondary,
  },
  emptyTeam: {
    ...type.caption,
    color: inkOn.tertiary,
  },
  teamTools: {
    flexDirection: 'row',
    gap: space.sm,
  },
  // Dashed affordances straight on the stage — white lines and labels.
  dashed: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
    borderRadius: radius.button,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: stageOn.hairline,
  },
  dashedAmber: {
    borderColor: alpha(color.cta, 0.55),
  },
  dashedLabel: {
    ...type.bodyMedium,
    color: stageOn.primary,
  },
  unassigned: {
    marginTop: space.lg,
  },
  unassignedLabel: {
    ...type.overline,
    color: stageOn.primary,
    marginBottom: space.sm,
  },
  footer: {
    gap: space.md,
    marginTop: space.xl,
  },
  stepperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: space.lg,
  },
  stepperText: {
    flexShrink: 1,
  },
  stepperLabel: {
    ...type.overline,
    color: inkOn.tertiary,
  },
  stepperValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
    marginTop: space.xs,
  },
  stepperValue: {
    ...type.displayLg,
    color: color.ink,
  },
  stepperUnit: {
    ...type.caption,
    color: inkOn.tertiary,
  },
  stepperButtons: {
    flexDirection: 'row',
    gap: space.sm,
  },
  // White circles on the grey stepper card.
  stepperButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: inkOn.hairlineStrong,
  },
  start: {
    marginTop: space.sm,
  },
  waiting: {
    ...type.title,
    color: stageOn.secondary,
    textAlign: 'center',
    marginTop: space.xxl,
  },
  rtl: {
    writingDirection: 'rtl',
  },
});
