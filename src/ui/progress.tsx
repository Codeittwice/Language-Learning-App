/**
 * Progress indicators: the daily goal ring, the streak flame, and the bar that fills
 * across a round.
 *
 * Hand-drawn with react-native-svg rather than a charting library -- three shapes do
 * not justify pulling in Skia.
 */
import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme/use-theme';
import { Text } from '@/ui/text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type ProgressRingProps = {
  /** 0 to 1; values above 1 are clamped so an overachieving day still reads as full. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  color,
  trackColor,
  children,
}: ProgressRingProps) {
  const theme = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const filled = useSharedValue(0);
  useEffect(() => {
    filled.value = withTiming(Math.min(1, Math.max(0, progress)), { duration: 600 });
  }, [filled, progress]);

  // Animating the dash offset is what makes the arc sweep rather than jump.
  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - filled.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor ?? theme.colors.track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? theme.colors.primary}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={arcProps}
          // Start the arc at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export type ProgressBarProps = {
  progress: number;
  height?: number;
  color?: string;
  style?: ViewStyle;
};

/** The bar that fills across a round. */
export function ProgressBar({ progress, height = 8, color, style }: ProgressBarProps) {
  const theme = useTheme();
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withSpring(Math.min(1, Math.max(0, progress)), {
      damping: 18,
      stiffness: 140,
    });
  }, [progress, width]);

  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: theme.colors.track,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          { height: '100%', borderRadius: height / 2, backgroundColor: color ?? theme.colors.primary },
          fill,
        ]}
      />
    </View>
  );
}

export type StreakFlameProps = {
  days: number;
  /** True when today has not been practised yet. */
  atRisk?: boolean;
  size?: number;
};

/**
 * The streak counter.
 *
 * Reads "0" plainly rather than hiding at zero: a streak you can see is one you can
 * start, and pretending it does not exist helps nobody.
 */
export function StreakFlame({ days, atRisk = false, size = 28 }: StreakFlameProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (days <= 0) return;
    scale.value = withSpring(1.18, { damping: 6, stiffness: 220 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 180 });
    });
  }, [days, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]}>
      <Text style={{ fontSize: size }}>{days > 0 && !atRisk ? '\u{1F525}' : '\u{1F56F}\u{FE0F}'}</Text>
      <View>
        <Text variant="h2" style={{ color: days > 0 ? theme.colors.streak : theme.colors.textFaint }}>
          {days}
        </Text>
        <Text variant="caption" tone="faint">
          {days === 1 ? 'day' : 'days'}
        </Text>
      </View>
    </Animated.View>
  );
}
