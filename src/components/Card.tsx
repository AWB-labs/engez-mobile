// The card surface: white paper on the violet stage, a whisper of an ink
// hairline for definition, and the soft indigo directional shadow.
//
// `soft` drops to the grey `soft` surface + depth.low for dense list rows
// nested inside (or alongside) full cards.
//
// `spine` is the team identity mark: a solid 3px colour strip flush at the
// top — an identity, not a light source. It lives in its own clipped overlay
// (radius + overflow hidden) so it follows the top corners without putting
// overflow-hidden on the card itself, which would eat the iOS shadow.

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { color, depth, inkOn, radius } from '../theme';

interface CardProps {
  children: ReactNode;
  /** Grey variant for dense lists — `soft` surface, barely lifted. */
  soft?: boolean;
  /** Accent colour for the 3px identity strip along the top edge. */
  spine?: string;
  style?: StyleProp<ViewStyle>;
}

/** The identity strip's height — thick enough to read, never a bar. */
const SPINE_HEIGHT = 3;

export default function Card({ children, soft = false, spine, style }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        soft ? styles.soft : null,
        soft ? depth.low : depth.medium,
        style,
      ]}
    >
      {spine ? (
        // Clipped to the card's radius so the strip hugs the top corners.
        <View pointerEvents="none" style={styles.spineClip}>
          <View style={[styles.spine, { backgroundColor: spine }]} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: inkOn.hairline,
  },
  soft: {
    backgroundColor: color.soft,
  },
  spineClip: {
    // RN 0.81 types `absoluteFill` as an opaque registered style — the
    // spreadable plain object is `absoluteFillObject`.
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  spine: {
    height: SPINE_HEIGHT,
    width: '100%',
  },
});
