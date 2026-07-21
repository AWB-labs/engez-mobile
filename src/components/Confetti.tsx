// Confetti overlay — the mobile stand-in for canvas-confetti on the web
// (guess hits in Turn, the win celebration in GameOver).
//
// Bursts are dealt round-robin across a small set of particle pools, each
// with its own spec array and its own 0→1 progress clock — so overlapping
// showers coexist exactly like canvas-confetti's additive bursts (GameOver
// fires three 350ms apart against ~600–900ms flights, and back-to-back guess
// hits can land inside one flight). One shared pool would rewind and re-spec
// the previous shower mid-air with a visible pop.
//
// Within a pool the per-particle physics is baked into plain numbers at burst
// time (JS randomness is fine here — this is decoration, not game state), so
// each worklet is pure arithmetic and the whole shower renders as transform +
// opacity on the UI thread.
//
// Reduced motion: burst() is a complete no-op (§7 — confetti included).

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing as ReEasing,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { color, duration } from '../theme';

export type ConfettiHandle = {
  burst(opts?: {
    count?: number;
    colors?: string[];
    /** Fractions of the overlay (0..1), canvas-confetti style. Default centre-low. */
    origin?: { x: number; y: number };
  }): void;
};

/** Hard cap — a burst never allocates beyond one pool. */
const MAX_PARTICLES = 30;
const DEFAULT_COUNT = 24;
// Celebration brights — white pops hardest on the violet stage.
const DEFAULT_COLORS = [color.mintBright, color.cta, color.rose, color.card];

/**
 * How many showers can be airborne at once. Three covers every shipped
 * caller: GameOver's staggered trio and any humanly-possible run of guess
 * hits — a fourth burst only ever recycles a pool whose flight has ended.
 */
const POOL_COUNT = 3;

/** Everything a particle needs, precomputed to plain numbers. */
interface ParticleSpec {
  x0: number; // launch point, px
  y0: number;
  driftX: number; // horizontal travel across the full flight, px
  rise: number; // upward impulse across the full flight, px
  gravity: number; // downward pull at t=1, px (quadratic term)
  spin: number; // total rotation, deg
  scale: number; // static size variance
  color: string;
}

/** One pool's committed state; `burstId` bumps to trigger the post-commit launch. */
interface Pool {
  specs: ParticleSpec[];
  burstId: number;
}

function Particle({ spec, progress }: { spec: ParticleSpec; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: interpolate(t, [0, 0.72, 1], [1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: spec.driftX * t },
        // Ballistic: linear rise fighting a quadratic fall.
        { translateY: -spec.rise * t + spec.gravity * t * t },
        { rotate: `${spec.spin * t}deg` },
        { scale: spec.scale },
      ],
    };
  });
  return (
    <Animated.View
      style={[styles.particle, { left: spec.x0, top: spec.y0, backgroundColor: spec.color }, style]}
    />
  );
}
const MemoParticle = memo(Particle);

const ConfettiOverlay = forwardRef<ConfettiHandle>(function ConfettiOverlay(_props, ref) {
  const [pools, setPools] = useState<Pool[]>(() =>
    Array.from({ length: POOL_COUNT }, () => ({ specs: [], burstId: 0 })),
  );
  // One clock per pool. Each starts spent (1) so its particles sit at
  // opacity 0 until that pool's first burst rewinds it. Fixed count, so the
  // hook order is stable.
  const progress0 = useSharedValue(1);
  const progress1 = useSharedValue(1);
  const progress2 = useSharedValue(1);
  const progressRef = useRef([progress0, progress1, progress2]);
  const flightMsRef = useRef<number[]>(Array(POOL_COUNT).fill(0));
  /** Which pool the next burst claims — plain rotation. */
  const nextPoolRef = useRef(0);
  /** burstIds already launched, so the effect below only starts new showers. */
  const launchedRef = useRef<number[]>(Array(POOL_COUNT).fill(0));

  // Launch after commit: a pool whose burstId advanced gets its clock rewound
  // and restarted, so recycled particles never replay a frame of stale arcs —
  // and the other pools' in-flight clocks are left completely alone.
  useEffect(() => {
    pools.forEach((pool, i) => {
      if (pool.burstId === launchedRef.current[i]) return;
      launchedRef.current[i] = pool.burstId;
      const progress = progressRef.current[i];
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: flightMsRef.current[i],
        easing: ReEasing.linear, // linear clock — the physics is in the arc
      });
    });
  }, [pools]);

  // burst() is imperative, so the latest layout / reduced-motion values are
  // read through refs rather than re-minting the handle every render.
  const layoutRef = useRef({ width: 0, height: 0 });
  const reducedRef = useRef(false);
  reducedRef.current = useReducedMotion();

  useImperativeHandle(
    ref,
    () => ({
      burst(opts) {
        const { width, height } = layoutRef.current;
        if (reducedRef.current || width === 0 || height === 0) return;

        const count = Math.max(1, Math.min(opts?.count ?? DEFAULT_COUNT, MAX_PARTICLES));
        const palette = opts?.colors?.length ? opts.colors : DEFAULT_COLORS;
        const origin = opts?.origin ?? { x: 0.5, y: 0.75 };
        const ox = origin.x * width;
        const oy = origin.y * height;

        // Flight time in seconds — randomized per burst within the
        // celebratory band so overlapping showers don't move in lockstep.
        const flight = (duration.celebratory + Math.random() * 300) / 1000;
        const G = 2200; // px/s² — reads as real gravity at phone scale

        const next: ParticleSpec[] = [];
        for (let i = 0; i < count; i++) {
          // Upward cone: within ~30° either side of vertical (spread 60,
          // matching the web's canvas-confetti call).
          const angle = (Math.random() - 0.5) * (Math.PI / 3);
          const speed = 500 + Math.random() * 400; // px/s
          next.push({
            x0: ox + (Math.random() - 0.5) * 12,
            y0: oy + (Math.random() - 0.5) * 12,
            driftX: Math.sin(angle) * speed * flight,
            rise: Math.cos(angle) * speed * flight,
            gravity: 0.5 * G * flight * flight,
            spin: (Math.random() - 0.5) * 1440,
            scale: 0.8 + Math.random() * 0.35,
            color: palette[i % palette.length],
          });
        }

        const pi = nextPoolRef.current;
        nextPoolRef.current = (pi + 1) % POOL_COUNT;
        flightMsRef.current[pi] = flight * 1000;
        // Only the claimed pool changes; launch happens in the effect,
        // post-commit.
        setPools((prev) =>
          prev.map((p, i) => (i === pi ? { specs: next, burstId: p.burstId + 1 } : p)),
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        layoutRef.current = {
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        };
      }}
    >
      {pools.map((pool, pi) =>
        pool.specs.map((spec, i) => (
          <MemoParticle key={`${pi}:${i}`} spec={spec} progress={progressRef.current[pi]} />
        )),
      )}
    </View>
  );
});

export default ConfettiOverlay;

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    width: 8,
    height: 12,
    borderRadius: 2,
  },
});
