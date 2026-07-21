// The three buttons, glow-free, straight from the Khamen reference:
//
//   primary — amber candy gradient (bright → cta → deep, 135° feel), ink
//             label. The one loud control on any screen.
//   accent  — the same construction in the brand violet, white label; its
//             light/deep stops are computed from the token via mix().
//   ghost   — the reference's quiet grey: solid `soft` surface, ink label.
//             Reads on white cards and straight on the violet stage alike.
//
// Depth is the soft indigo directional shadow + a glossy top-light on the
// gradients — never a bloom. Press feedback is the spring scale to
// PRESS_SCALE; under reduced motion it collapses to a small opacity dip.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import {
  color,
  depth,
  displayLine,
  duration,
  easing,
  icon,
  ICON_STROKE,
  inkOn,
  MIN_TOUCH,
  mix,
  PRESS_SCALE,
  radius,
  space,
  stageOn,
  topLightBorder,
  type,
} from '../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'accent' | 'ghost';
  size?: 'md' | 'lg';
  /** Optional lucide icon rendered left of the label, in the label colour. */
  icon?: LucideIcon;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The hero button height; md drops to the 44px minimum touch target. */
const LG_HEIGHT = 52;

// Three stops give each gradient a candy body rather than a flat blend.
const GRADIENT = {
  primary: [color.ctaBright, color.cta, color.ctaDeep] as const,
  accent: [mix(color.violet, 0.22), color.violet, mix(color.violet, -0.18)] as const,
} as const;

// Solid base under each gradient — gives iOS a cheap rect shadowPath.
const GRADIENT_BASE = { primary: color.cta, accent: color.violet } as const;

/** md steps the poster type down from the title token — still Lalezar. */
const TYPE_STEP = 4;
const LABEL_SIZE: Record<'md' | 'lg', TextStyle> = {
  lg: type.title,
  md: {
    ...type.title,
    fontSize: type.title.fontSize - TYPE_STEP,
    // Scaled off the size, never the token's lineHeight — stepping both down
    // by 4 would drop the ratio under Lalezar's line box and clip the label.
    lineHeight: displayLine(type.title.fontSize - TYPE_STEP),
  },
};

/** Arabic titles read right-to-left even inside an LTR layout. */
const ARABIC = /[؀-ۿ]/;

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon: Icon,
  disabled = false,
  style,
}: ButtonProps) {
  const reduceMotion = useReducedMotion();

  // Spring press: only the compositor moves; the JS thread never re-renders.
  const pressed = useSharedValue(0);
  const pressIn = () => {
    pressed.value = withTiming(1, { duration: duration.micro, easing: easing.spring });
  };
  const pressOut = () => {
    pressed.value = withTiming(0, { duration: duration.micro, easing: easing.spring });
  };

  const pressStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: 1 - pressed.value * 0.1 }
      : { transform: [{ scale: 1 + pressed.value * (PRESS_SCALE - 1) }] },
  );

  // Ink on amber (8.9:1) and on grey; white only on the violet accent.
  const labelColor = disabled
    ? inkOn.disabled
    : variant === 'accent'
      ? stageOn.primary
      : color.ink;

  const label = (
    <>
      {Icon ? <Icon size={icon.md} color={labelColor} strokeWidth={ICON_STROKE} /> : null}
      <Text
        style={[
          LABEL_SIZE[size],
          { color: labelColor },
          ARABIC.test(title) && styles.rtl,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </>
  );

  const sizeStyle = size === 'lg' ? styles.lg : styles.md;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={style}
    >
      <Animated.View style={pressStyle}>
        {disabled ? (
          <View style={[styles.surface, sizeStyle, styles.ghost]}>{label}</View>
        ) : variant === 'ghost' ? (
          <View style={[styles.surface, sizeStyle, styles.ghost, depth.low]}>{label}</View>
        ) : (
          <LinearGradient
            colors={GRADIENT[variant]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }} // the web's 135deg
            style={[
              styles.surface,
              sizeStyle,
              { backgroundColor: GRADIENT_BASE[variant] },
              depth.medium,
              topLightBorder,
            ]}
          >
            {label}
          </LinearGradient>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.button,
  },
  lg: { minHeight: LG_HEIGHT, paddingHorizontal: space.xl },
  md: { minHeight: MIN_TOUCH, paddingHorizontal: space.lg },
  // The reference's grey button — solid, borderless, ink text. Disabled
  // reuses the surface with the label dimmed to inkOn.disabled.
  ghost: {
    backgroundColor: color.soft,
  },
  rtl: { writingDirection: 'rtl' },
});
