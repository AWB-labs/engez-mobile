// A player token. Tapping the body runs the main action (assign / select);
// the host also gets a small ✕ affordance to kick that player out of the
// room. Port of client/src/components/PlayerPill.jsx, restyled glow-free:
// "you" and team identity are tinted rings + solid pastels, never blooms.
// Every state is solid, so a pill reads the same inside a white team card
// and loose on the violet stage (the unassigned row).

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import {
  accentSurface,
  color,
  HIT_SLOP,
  ICON_STROKE,
  icon,
  inkOn,
  MIN_TOUCH,
  mix,
  PRESS_SCALE,
  radius,
  space,
  teamColor,
  type,
} from '../theme';

/** Arabic names read right-to-left inside the LTR layout. */
const ARABIC = /[؀-ۿ]/;

/** The pill's visual height: a 34px body plus the 1px borders. */
const PILL_HEIGHT = 36;

/**
 * The 36px pill alone misses the 44px touch minimum, and the body is the
 * lobby's core interaction (the host's tap-to-select / unassign flow).
 * Vertical-only slop closes the gap without ever overlapping the kick ✕'s
 * own HIT_SLOP beside it.
 */
const BODY_SLOP = {
  top: (MIN_TOUCH - PILL_HEIGHT) / 2,
  bottom: (MIN_TOUCH - PILL_HEIGHT) / 2,
} as const;

export interface PlayerPillProps {
  label: string;
  /** The local player — gets a " (you)" suffix and an amber tinted ring. */
  you?: boolean;
  /** Fully lit (amber pastel) — e.g. the player being assigned in the lobby. */
  selected?: boolean;
  disabled?: boolean;
  /** Host affordance: show the trailing kick ✕. */
  canKick?: boolean;
  onPress?: () => void;
  onKick?: () => void;
  /** Team identity ring — server-sent colours are remapped via teamColor(). */
  accent?: string;
}

export default function PlayerPill({
  label,
  you,
  selected,
  disabled,
  canKick,
  onPress,
  onKick,
  accent,
}: PlayerPillProps) {
  // One state ring at a time: selection beats identity beats team accent.
  const surface = selected
    ? accentSurface(color.cta)
    : you
      ? { ...accentSurface(color.cta), backgroundColor: mix(color.cta, 0.94) }
      : accent
        ? { ...styles.pillIdle, borderColor: mix(teamColor(accent), 0.5) }
        : styles.pillIdle;

  const pressable = !!onPress && !disabled;

  return (
    <View style={[styles.pill, surface]}>
      <Pressable
        onPress={pressable ? onPress : undefined}
        disabled={!pressable}
        hitSlop={BODY_SLOP}
        style={({ pressed }) => [
          styles.body,
          canKick && styles.bodyTightEnd,
          pressed && pressable && { transform: [{ scale: PRESS_SCALE }] },
        ]}
        accessibilityRole={pressable ? 'button' : 'text'}
        accessibilityLabel={you ? `${label} (you)` : label}
      >
        <Text style={[styles.label, ARABIC.test(label) && styles.rtl]} numberOfLines={1}>
          {label}
          {you ? <Text style={styles.youSuffix}> (you)</Text> : null}
        </Text>
      </Pressable>
      {canKick && (
        <Pressable
          onPress={onKick}
          hitSlop={HIT_SLOP}
          style={({ pressed }) => [styles.kick, pressed && { transform: [{ scale: PRESS_SCALE }] }]}
          accessibilityRole="button"
          accessibilityLabel={`Kick ${label} from the room`}
        >
          <X size={icon.sm} color={inkOn.tertiary} strokeWidth={ICON_STROKE} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.chip,
    minHeight: PILL_HEIGHT,
  },
  // Constant border width across all states so the pill never shifts size.
  pillIdle: {
    backgroundColor: color.soft,
    borderWidth: 1,
    borderColor: inkOn.hairlineStrong,
  },
  body: {
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: PILL_HEIGHT - 2, // + the 1px borders = the full pill
    paddingHorizontal: space.lg,
  },
  bodyTightEnd: {
    paddingEnd: space.xs, // the kick button supplies the trailing space
  },
  label: {
    ...type.bodyMedium,
    color: color.ink,
  },
  youSuffix: {
    color: inkOn.tertiary,
  },
  kick: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: PILL_HEIGHT - 2,
    paddingStart: space.xs,
    paddingEnd: space.md,
  },
  rtl: {
    writingDirection: 'rtl',
  },
});
