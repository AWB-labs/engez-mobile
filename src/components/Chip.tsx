// The chip: a static pill of caption text with an optional icon.
//
// With an accent it wears `accentSurface` — the solid pastel + tinted ring
// that marks something as "on" without glowing — and tints its label to
// match. Without one it sits quietly on the grey `soft` surface in secondary
// ink. Both variants are solid, so a chip reads identically on white paper
// and straight on the violet stage.
//
// Chips are informational, never pressable, so there is no touch-target
// concern here; anything tappable belongs in Button or PlayerPill.

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  accentSurface,
  accentText,
  color,
  icon,
  ICON_STROKE,
  inkOn,
  radius,
  space,
  tabularNums,
  type,
} from '../theme';

interface ChipProps {
  label: string;
  /** Tint colour — pass server team colours through teamColor() first. */
  accent?: string;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}

/** Arabic labels read right-to-left even inside an LTR layout. */
const ARABIC = /[؀-ۿ]/;

export default function Chip({ label, accent, icon: Icon, style }: ChipProps) {
  // Caption-size type on a pastel needs the deepened accent shade.
  const tint = accent ? accentText(accent) : inkOn.secondary;

  return (
    <View
      style={[
        styles.pill,
        accent ? accentSurface(accent) : styles.neutral,
        style,
      ]}
    >
      {Icon ? <Icon size={icon.sm} color={tint} strokeWidth={ICON_STROKE} /> : null}
      <Text
        style={[
          styles.label,
          { color: tint },
          ARABIC.test(label) && styles.rtl,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // caption line-height 18 + 4px vertical padding + 1px ring ≈ a 28px pill.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    borderRadius: radius.chip,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  // The neutral pill keeps a hairline ring so both variants share metrics.
  neutral: {
    backgroundColor: color.soft,
    borderWidth: 1,
    borderColor: inkOn.hairline,
  },
  // Chips often carry counts ("3 words") — keep the digits from wobbling.
  label: {
    ...type.caption,
    ...tabularNums,
  },
  rtl: { writingDirection: 'rtl' },
});
