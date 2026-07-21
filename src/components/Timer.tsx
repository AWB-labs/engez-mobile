// Circular countdown ring on a white disc — violet→amber while there's time,
// solid danger red with a subtle scale pulse in the last 10s, and a quiet
// tick each second in the last 5. Port of client/src/components/Timer.jsx.
// The disc is what keeps the track, arc and digits readable straight on the
// violet stage.
//
// Self-ticking: the remaining time derives from the server's `deadline`
// (epoch ms, corrected by `offset`) on a private 250ms interval, so only THIS
// component re-renders each tick — the rest of the tree stays untouched
// (DESIGN.md §8: "steady-state re-renders during a turn: timer ring only").
//
// The arc itself doesn't step per-second: a single linear withTiming drives
// `strokeDashoffset` from the current fraction down to zero over the whole
// remaining span, so it glides on the UI thread with zero JS involvement.
// This is the one sanctioned non-transform/opacity animation in the app,
// mirroring the web Timer's `transition: stroke-dashoffset 1s linear`.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing as ReEasing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { color, depth, displayLine, duration, easing, font, tabularNums } from '../theme';
import { playTick } from '../lib/sound';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// SVG gradient ids are document-global; two timers on screen (e.g. a screen
// transition overlap) must not fight over one.
let gradSeq = 0;

export interface TimerProps {
  /** Server epoch ms the turn ends, or null before the describer starts. */
  deadline: number | null;
  /** Full turn length in seconds — sizes the arc and the idle display. */
  total: number;
  /** Client→server clock correction (serverNow - Date.now()). */
  offset: number;
  size?: number;
}

export default function Timer({ deadline, total, offset, size = 96 }: TimerProps) {
  const reducedMotion = useReducedMotion();

  // Whole seconds left — null while there's no deadline (pre-start idle).
  const calc = () =>
    deadline == null ? null : Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
  const [r, setR] = useState<number | null>(calc);
  const lastTickRef = useRef<number | null>(null);

  // 1 = full ring, 0 = empty. Drives the arc on the UI thread.
  const fraction = useSharedValue(1);
  // The ≤10s pulse — scale only, per the no-glow depth rules.
  const pulse = useSharedValue(1);

  useEffect(() => {
    lastTickRef.current = null;
    const totalMs = total > 0 ? total * 1000 : 0;

    if (deadline == null) {
      // Idle: full ring, no clock running.
      cancelAnimation(fraction);
      fraction.value = 1;
      setR(null);
      return;
    }

    // Launch the arc: jump to the true current fraction, then glide to zero
    // over exactly the remaining span. Under reduced motion the glide is
    // dropped and the 250ms interval below steps the arc instead.
    const remMs = Math.max(0, deadline - (Date.now() + offset));
    const frac0 = totalMs > 0 ? Math.min(1, remMs / totalMs) : 0;
    cancelAnimation(fraction);
    fraction.value = frac0;
    if (!reducedMotion && remMs > 0) {
      fraction.value = withTiming(0, { duration: remMs, easing: ReEasing.linear });
    }

    const tick = () => {
      const v = calc();
      setR(v); // same value → React bails out, so this costs ~1 render/sec
      if (reducedMotion) {
        const ms = Math.max(0, deadline - (Date.now() + offset));
        fraction.value = totalMs > 0 ? Math.min(1, ms / totalMs) : 0;
      }
      // Quiet tick once per elapsed second in the last 5 — the ref guards
      // against a re-render double-firing the same second.
      if (v != null && v > 0 && v <= 5 && lastTickRef.current !== v) {
        lastTickRef.current = v;
        playTick();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, offset, total, reducedMotion]);

  const shown = r == null ? total : r;
  const danger = r != null && r <= 10;

  // Subtle 1 → 1.03 breathing loop while in danger; none under reduced motion.
  // duration.pulseHalf keeps it beating in time with Turn's EdgePulse — the
  // two are one last-10-seconds cue split across two components.
  useEffect(() => {
    if (danger && !reducedMotion) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: duration.pulseHalf, easing: easing.out }),
          withTiming(1, { duration: duration.pulseHalf, easing: easing.out }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: duration.micro });
    }
    return () => {
      cancelAnimation(pulse);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [danger, reducedMotion]);

  const stroke = Math.max(6, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const gidRef = useRef(`sahra-timer-grad-${++gradSeq}`);
  const gid = gidRef.current;

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circ * (1 - fraction.value),
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2 }, styles.disc, depth.low, pulseStyle]}
    >
      {/* Rotate only the SVG so the arc starts at 12 o'clock; the number
          overlay below stays upright. */}
      <Svg width={size} height={size} style={styles.rotated}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color.violet} />
            <Stop offset="1" stopColor={color.cta} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color.line}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={danger ? color.danger : `url(#${gid})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`}
          animatedProps={arcProps}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text
          style={[
            styles.seconds,
            tabularNums,
            { fontSize: size * 0.36, lineHeight: displayLine(size * 0.36) },
            danger && { color: color.danger },
          ]}
        >
          {shown}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The white disc that grounds the ring on the violet stage.
  disc: {
    backgroundColor: color.card,
  },
  rotated: {
    transform: [{ rotate: '-90deg' }],
  },
  center: {
    // RN 0.81 types `absoluteFill` as an opaque registered style — the
    // spreadable plain object is `absoluteFillObject`.
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: {
    fontFamily: font.display,
    color: color.ink,
    textAlign: 'center',
  },
});
