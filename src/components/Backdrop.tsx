// Fixed, GPU-cheap background — the violet stage the whole game plays on.
//
// Layers, bottom to top (glow-free interpretation of the Khamen theme):
//   1. The stage gradient — `stage` light falling to `stageDeep`, the same
//      160° violet fall the reference theme uses.
//   2. A faint khayamiya (tentmaker appliqué) 4-point-star tile in white.
//   3. ONE large soft radial wash that drifts on a slow transform-only loop
//      (no blur, no per-frame repaint). Idle it is white lantern-light;
//      mid-game it tints toward the active team's colour (brightened, so the
//      hue survives on violet). Tint changes crossfade between two layers.
//   4. A top vignette in the indigo scrim ink so the status bar and floating
//      chips stay legible over the bright stage.
//
// Under reduced motion the wash simply does not move; the tint crossfade is
// pure opacity, which is the sanctioned fallback, so it stays.

import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { alpha, color, duration, easing, mix, stageOn, teamColor } from '../theme';

interface BackdropProps {
  /** Server-sent team colour of the active turn, or null between games. */
  tint?: string | null;
}

/** "one large radial glow that slowly drifts … 36s loop". */
const DRIFT_MS = 36000;

/** How far the wash wanders: a few percent of the screen. */
const DRIFT_X = 0.03;
const DRIFT_Y = 0.02;
const DRIFT_SCALE = 0.12;

/** Wash opacity at its centre — a light on the stage, never a spotlight. */
const WASH_PEAK = 0.16;

/** How far a team colour is pulled toward white so its hue reads on violet. */
const WASH_LIFT = 0.55;

/** The stage gradient, top-left light to bottom floor (the web's ~160°). */
const STAGE_COLORS = [color.stage, color.stageDeep] as const;
const STAGE_START = { x: 0.15, y: 0 };
const STAGE_END = { x: 0.6, y: 1 };

/** Status-bar legibility scrim: indigo ink 25% → clear over ~120px. Never
 *  pure black — the scrim stays in the stage's own `shadowInk`. */
const VIGNETTE_HEIGHT = 120;
const VIGNETTE_COLORS = [alpha(color.shadowInk, 0.25), alpha(color.shadowInk, 0)] as const;

// One radial wash layer. Two of these stack so a tint change can crossfade
// (SVG gradient stops can't tween a colour; two opacities can).
function Wash({ id, washColor }: { id: string; washColor: string }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        {/* Centre sits ~1/3 down the screen; fully faded by 60% radius. */}
        <RadialGradient
          id={id}
          cx="50%"
          cy="36%"
          rx="55%"
          ry="42%"
          fx="50%"
          fy="36%"
          gradientUnits="objectBoundingBox"
        >
          <Stop offset="0" stopColor={washColor} stopOpacity={WASH_PEAK} />
          <Stop offset="0.6" stopColor={washColor} stopOpacity={0} />
          <Stop offset="1" stopColor={washColor} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export default function Backdrop({ tint }: BackdropProps) {
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();

  // The wash colour: the active team lifted toward white (a deep team hue
  // would vanish against violet), plain white lantern-light otherwise.
  const target = tint ? mix(teamColor(tint), WASH_LIFT) : stageOn.primary;

  // Crossfade bookkeeping — `from` fades out while `to` fades in.
  const [wash, setWash] = useState({ from: target, to: target });
  const blend = useSharedValue(1); // 1 = `to` fully shown

  useEffect(() => {
    if (target === wash.to) return;
    setWash({ from: wash.to, to: target });
    blend.value = 0;
    blend.value = withTiming(1, { duration: duration.celebratory, easing: easing.out });
  }, [target, wash.to, blend]);

  // The 36s drift: out-and-back translate + gentle swell, transforms only.
  // Reduced motion pins it at rest — the wash still shows, it just holds still.
  const drift = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(drift);
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(
      withTiming(1, { duration: DRIFT_MS / 2, easing: Easing.inOut(Easing.sin) }),
      -1,
      true, // reverse — one full there-and-back is the 36s loop
    );
    return () => cancelAnimation(drift);
  }, [reduceMotion, drift]);

  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.value * width * DRIFT_X },
      { translateY: drift.value * -height * DRIFT_Y },
      { scale: 1 + drift.value * DRIFT_SCALE },
    ],
  }));

  const fromStyle = useAnimatedStyle(() => ({ opacity: 1 - blend.value }));
  const toStyle = useAnimatedStyle(() => ({ opacity: blend.value }));

  return (
    <View pointerEvents="none" style={styles.root}>
      {/* the violet stage */}
      <LinearGradient
        colors={STAGE_COLORS}
        start={STAGE_START}
        end={STAGE_END}
        style={StyleSheet.absoluteFill}
      />

      {/* khayamiya star-and-lattice tile, ~6% white */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} opacity={0.06}>
        <Defs>
          <Pattern id="sahra-khayamiya" patternUnits="userSpaceOnUse" width="48" height="48">
            {/* concave 4-point star + corner chamfers that meet across tile
                seams as diamonds — one path, stroke only, no fills */}
            <Path
              d="M24 4 L29 19 L44 24 L29 29 L24 44 L19 29 L4 24 L19 19 Z M0 10 L10 0 M38 0 L48 10 M48 38 L38 48 M10 48 L0 38"
              stroke={stageOn.primary}
              strokeWidth={1}
              fill="none"
            />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sahra-khayamiya)" />
      </Svg>

      {/* drifting wash — oversized so the drift + swell never expose a seam */}
      <Animated.View style={[styles.washField, driftStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, fromStyle]}>
          <Wash id="sahra-wash-from" washColor={wash.from} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, toStyle]}>
          <Wash id="sahra-wash-to" washColor={wash.to} />
        </Animated.View>
      </Animated.View>

      {/* top vignette for status-bar legibility */}
      <LinearGradient colors={VIGNETTE_COLORS} style={styles.vignette} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // RN 0.81 types `absoluteFill` as an opaque registered style — the
    // spreadable plain object is `absoluteFillObject`.
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.stageDeep,
    overflow: 'hidden',
  },
  // 12% overdraw on every side keeps the translated/scaled wash edge-free.
  washField: {
    position: 'absolute',
    top: '-12%',
    left: '-12%',
    right: '-12%',
    bottom: '-12%',
  },
  vignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: VIGNETTE_HEIGHT,
  },
});
