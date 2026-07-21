// Renders a title in both scripts (whichever are present). Franco headline in
// display type, Arabic beneath in RTL — or Arabic solo, RTL, when that's all
// there is. Port of the TitleCard inside client/src/screens/Turn.jsx.

import { StyleSheet, Text, View } from 'react-native';
import { color, font, inkOn, type } from '../theme';
import type { WordDisplay } from '../lib/protocol';

export interface TitleCardProps {
  /** Absent for the guessing team — the server redacts unsolved words. */
  display?: WordDisplay;
  solved?: boolean;
  /** Half-opacity wrapper — e.g. solved cards receding in the describer list. */
  dim?: boolean;
  size?: 'lg' | 'md';
}

export default function TitleCard({ display, solved, dim = false, size = 'lg' }: TitleCardProps) {
  const fr = display?.fr ?? null;
  const ar = display?.ar ?? null;
  const main = fr || ar;
  const sub = fr && ar ? ar : null;
  const mainIsAr = !fr && !!ar;
  if (!main) return null;

  return (
    <View style={[styles.wrap, dim && styles.dim]}>
      <Text
        style={[
          styles.main,
          size === 'lg' ? styles.mainLg : styles.mainMd,
          mainIsAr && styles.rtl,
          solved && styles.mainSolved,
        ]}
      >
        {main}
      </Text>
      {sub != null && (
        <Text style={[styles.sub, styles.rtl, solved && styles.subSolved]}>{sub}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
    flexShrink: 1,
  },
  dim: {
    opacity: 0.5,
  },
  main: {
    fontFamily: font.display,
    color: color.ink,
  },
  // The two word-card display sizes are theme tokens (§2.2) — never local.
  mainLg: {
    ...type.wordLg,
  },
  mainMd: {
    ...type.wordMd,
  },
  mainSolved: {
    color: inkOn.disabled,
    textDecorationLine: 'line-through',
  },
  sub: {
    fontFamily: font.body,
    // Body size, but tight leading — the two scripts read as one card.
    fontSize: type.body.fontSize,
    lineHeight: type.body.fontSize + 4,
    color: inkOn.secondary,
    marginTop: 2,
  },
  subSolved: {
    color: inkOn.tertiary,
  },
  rtl: {
    writingDirection: 'rtl',
  },
});
