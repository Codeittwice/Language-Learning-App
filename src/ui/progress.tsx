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
import Svg, { Circle, Path } from 'react-native-svg';

import type { StreakDisplay } from '@/gamification/streak';
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

/**
 * The flame, drawn.
 *
 * It used to be the 🔥 emoji, with 🕯 for an at-risk day. Emoji render differently on
 * every OS version, cannot take a theme colour, and were the single most dated thing
 * on the screen. Twelve lines of path data fix all three.
 */
export function Flame({ size = 16, color }: { size?: number; color?: string }) {
  const theme = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.5c2.9 3.6 1.4 5.4 0 6.7 1.9-.7 4 .2 4 2.5 0 1.8-1.4 3-1.4 4.7 0 2.1 1.8 3.6 1.8 3.6-1.2 1-2.8 1.5-4.4 1.5-3.8 0-6.9-2.7-6.9-6.3 0-4.9 4.6-6 6.9-12.7Z"
        stroke={color ?? theme.colors.streakText}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export type StreakBadgeProps = {
  days: number;
  state: StreakDisplay;
  /** Banked freezes, shown so they are not a surprise when one is spent. */
  freezes?: number;
};

/**
 * The streak, as a pill.
 *
 * Never shows a bare "0": a zero with the word "days" after it reads as a failure
 * report on a learner who may simply be new. At zero it becomes an invitation.
 */
export function StreakBadge({ days, state, freezes = 0 }: StreakBadgeProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (days <= 0) return;
    scale.value = withSpring(1.14, { damping: 6, stiffness: 220 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 180 });
    });
  }, [days, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const quiet = state === 'none';
  const warn = state === 'at_risk';

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingLeft: theme.space.sm,
          paddingRight: theme.space.md - 2,
          paddingVertical: 6,
          borderRadius: theme.radius.pill,
          backgroundColor: quiet ? 'transparent' : theme.colors.streakSoft,
          borderWidth: quiet || warn ? 1 : 0,
          borderColor: warn ? theme.colors.streak : theme.colors.border,
        },
        style,
      ]}
    >
      <Flame size={14} color={quiet ? theme.colors.textFaint : theme.colors.streakText} />
      <Text
        variant="smallStrong"
        style={{ color: quiet ? theme.colors.textMuted : theme.colors.streakText }}
      >
        {quiet ? 'Start a streak' : `${days}`}
      </Text>
      {freezes > 0 && !quiet ? (
        <Text variant="caption" style={{ color: theme.colors.streakText, letterSpacing: 0 }}>
          {`· ${freezes} freeze${freezes === 1 ? '' : 's'}`}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export type LevelRingProps = {
  level: number;
  /** 0 to 1 through the current level. */
  progress: number;
  size?: number;
};

/** The level, as a number inside the arc that fills towards the next one. */
export function LevelRing({ level, progress, size = 92 }: LevelRingProps) {
  return (
    <ProgressRing progress={progress} size={size} strokeWidth={Math.round(size / 13)}>
      <View style={{ alignItems: 'center' }}>
        <Text variant="caption" tone="faint" style={{ fontSize: 9 }}>
          LEVEL
        </Text>
        <Text variant="display" style={{ fontSize: Math.round(size * 0.39), lineHeight: Math.round(size * 0.41) }}>
          {level}
        </Text>
      </View>
    </ProgressRing>
  );
}
