/**
 * The reward beat between rounds.
 *
 * This is where the "fun" budget is spent. A round ending with a count-up, a haptic
 * and some confetti is the entire difference between a drill and a game, and it costs
 * nothing pedagogically.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/use-theme';
import { Button, successFeedback } from '@/ui/button';
import { Text } from '@/ui/text';

/** Counts from zero to `value` so XP feels earned rather than assigned. */
export function CountUp({
  value,
  duration = 700,
  prefix = '',
}: {
  value: number;
  duration?: number;
  prefix?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // No early return that sets state synchronously: the loop below reaches 0 on its
    // first tick when `value` is 0, which is the same result without the cascade.
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const ratio = Math.min(1, elapsed / duration);
      // Ease out, so it decelerates into the final number.
      setShown(Math.round(value * (1 - (1 - ratio) ** 3)));
      if (ratio >= 1) clearInterval(timer);
    }, 32);
    return () => clearInterval(timer);
  }, [value, duration]);

  return (
    <Text variant="display" tone="primary">
      {prefix}
      {shown}
    </Text>
  );
}

/**
 * A deterministic stand-in for `Math.random`.
 *
 * Confetti needs to look scattered, not be unpredictable, and `Math.random` in render
 * is impure -- it would produce a different layout on every re-render, which the React
 * Compiler rightly rejects. Hashing the particle index gives the same scatter every
 * time for the same burst.
 */
function scatter(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type Particle = {
  id: number;
  x: number;
  delay: number;
  drift: number;
  color: string;
  size: number;
  rotation: number;
  duration: number;
};

/**
 * Confetti, hand-rolled.
 *
 * About eighty lines against an unmaintained dependency, and it lets the colours come
 * from the theme instead of clashing with it.
 */
export function Confetti({ count = 48, run = true }: { count?: number; run?: boolean }) {
  const theme = useTheme();

  const particles = useMemo<Particle[]>(() => {
    const palette = [
      theme.colors.primary,
      theme.colors.streak,
      theme.colors.accent,
      theme.colors.success,
    ];
    return Array.from({ length: count }, (_, id) => ({
      id,
      x: scatter(id, 1) * 100,
      delay: scatter(id, 2) * 260,
      drift: (scatter(id, 3) - 0.5) * 120,
      color: palette[id % palette.length] ?? theme.colors.primary,
      size: 6 + scatter(id, 4) * 7,
      rotation: scatter(id, 5) * 360,
      duration: 1400 + scatter(id, 6) * 600,
    }));
  }, [count, theme]);

  if (!run) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {particles.map((particle) => (
        <ConfettiPiece key={particle.id} particle={particle} />
      ))}
    </View>
  );
}

function ConfettiPiece({ particle }: { particle: Particle }) {
  const fall = useSharedValue(0);

  useEffect(() => {
    fall.value = withDelay(
      particle.delay,
      withTiming(1, { duration: particle.duration, easing: Easing.out(Easing.quad) })
    );
  }, [fall, particle.delay, particle.duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: fall.value * 560 },
      { translateX: fall.value * particle.drift },
      { rotate: `${particle.rotation + fall.value * 540}deg` },
    ],
    opacity: 1 - Math.max(0, fall.value - 0.75) * 4,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -20,
          left: `${particle.x}%`,
          width: particle.size,
          height: particle.size * 1.6,
          borderRadius: 2,
          backgroundColor: particle.color,
        },
        style,
      ]}
    />
  );
}

export type RoundCompleteProps = {
  xpEarned: number;
  correct: number;
  total: number;
  /** True when every item in the round was produced without help. */
  perfect: boolean;
  title?: string;
  continueLabel?: string;
  onContinue: () => void;
};

/** Shown between rounds, and after the last one before the stage ends. */
export function RoundComplete({
  xpEarned,
  correct,
  total,
  perfect,
  title,
  continueLabel = 'Keep going',
  onContinue,
}: RoundCompleteProps) {
  const theme = useTheme();
  const badge = useSharedValue(0);

  useEffect(() => {
    successFeedback();
    badge.value = withSequence(
      withSpring(1.1, { damping: 7, stiffness: 200 }),
      withSpring(1, { damping: 14, stiffness: 160 })
    );
  }, [badge]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  const heading = title ?? (perfect ? 'Perfect round' : 'Round done');

  return (
    <View style={{ flex: 1, padding: theme.space.xl, justifyContent: 'center', gap: theme.space.xl }}>
      <Confetti run={perfect} />

      <Animated.View style={[{ alignItems: 'center', gap: theme.space.md }, badgeStyle]}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: perfect ? theme.colors.streakSoft : theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 44 }}>{perfect ? '\u{1F31F}' : '\u{2705}'}</Text>
        </View>
        <Text variant="h1" center>
          {heading}
        </Text>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(180)} style={{ alignItems: 'center', gap: 4 }}>
        <CountUp value={xpEarned} prefix="+" />
        <Text variant="small" tone="muted">
          XP earned
        </Text>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(320)} style={{ alignItems: 'center' }}>
        <Text variant="bodyStrong">
          {correct} of {total} without help
        </Text>
        {!perfect && correct < total ? (
          <Text variant="small" tone="muted" center>
            The ones you missed come back shortly, and again next session.
          </Text>
        ) : null}
      </Animated.View>

      <Button title={continueLabel} onPress={onContinue} />
    </View>
  );
}
