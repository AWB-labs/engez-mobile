// Scoring badge: mint "+2" for an exact hit, burnt-amber "+1" for a
// right-but-misspelled one. Port of the PointsBadge inside screens/Turn.jsx.
// Symbol + number, never color alone: the check / spell-check icon
// carries the meaning even for colorblind players.

import { StyleSheet, Text, View } from 'react-native';
import { Check, SpellCheck } from 'lucide-react-native';
import {
  accentSurface,
  accentText,
  color,
  displayLine,
  font,
  ICON_STROKE,
  icon,
  radius,
  space,
  tabularNums,
  type,
} from '../theme';

export interface PointsBadgeProps {
  points: number;
}

export default function PointsBadge({ points }: PointsBadgeProps) {
  const exact = points >= 2;
  const accent = exact ? color.mint : color.warn;
  // Small type on the pastel wears the deepened accent shade.
  const tint = accentText(accent);
  const Icon = exact ? Check : SpellCheck;

  return (
    <View style={[styles.badge, accentSurface(accent)]}>
      <Icon size={icon.sm} color={tint} strokeWidth={ICON_STROKE} />
      <Text style={[styles.points, tabularNums, { color: tint }]}>+{exact ? 2 : 1}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.chip,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  points: {
    // Display numerals at body scale — the badge sits inline with body text.
    fontFamily: font.display,
    fontSize: type.body.fontSize,
    lineHeight: displayLine(type.body.fontSize),
  },
});
