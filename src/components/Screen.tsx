// The app shell every screen renders inside: safe-area padding, a centred
// content column capped at MAX_CONTENT_WIDTH (the web client's max-w-md), and
// the §2.4 screen entrance — fade + 10px lift, ease-out, duration.screen.
//
// `scroll` swaps the column for a ScrollView whose taps don't dismiss the
// keyboard mid-guess (keyboardShouldPersistTaps="handled") — the Turn screen's
// input must never lose focus to a stray tap.
//
// Under reduced motion the lift is skipped and only the fade remains.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CHROME_INSET, duration, easing, MAX_CONTENT_WIDTH, space } from '../theme';

interface ScreenProps {
  children: ReactNode;
  /** Long content (lobby, reveals) scrolls; focused screens stay fixed. */
  scroll?: boolean;
  /**
   * Reserve the app's floating-control band at the top (leave / mute /
   * banners). Every in-room screen sets this; Home, which has no controls,
   * does not. Without it a screen's own header draws under the controls.
   */
  chrome?: boolean;
  /** Extends the outer safe-area shell. */
  style?: StyleProp<ViewStyle>;
  /** Extends the inner content column. */
  contentStyle?: StyleProp<ViewStyle>;
}

/** §2.4 "Screen changes: fade + 10px lift". */
const ENTRANCE_LIFT = 10;

export default function Screen({
  children,
  scroll = false,
  chrome = false,
  style,
  contentStyle,
}: ScreenProps) {
  const reduceMotion = useReducedMotion();

  // One-shot entrance, driven on mount. The value is captured by the worklet
  // below, so only the compositor works while it runs — no re-renders.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: duration.screen, easing: easing.out });
  }, [progress]);

  const entrance = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduced motion: the lift collapses, the fade stays.
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * ENTRANCE_LIFT }],
  }));

  return (
    <SafeAreaView style={[styles.shell, style]}>
      <Animated.View style={[styles.fill, entrance]}>
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.scrollColumn, chrome && styles.chrome, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, styles.column, chrome && styles.chrome, contentStyle]}>
            {children}
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

// The column mirrors the web shell: full-width up to max-w-md, centred on
// tablets, space.lg gutters, a touch of breathing room top and bottom.
const columnBase = {
  width: '100%' as const,
  maxWidth: MAX_CONTENT_WIDTH,
  alignSelf: 'center' as const,
  paddingHorizontal: space.lg,
  paddingTop: space.sm,
  paddingBottom: space.md,
};

const styles = StyleSheet.create({
  shell: { flex: 1 },
  fill: { flex: 1 },
  column: columnBase,
  scrollColumn: { ...columnBase, flexGrow: 1 },
  chrome: { paddingTop: columnBase.paddingTop + CHROME_INSET },
});
