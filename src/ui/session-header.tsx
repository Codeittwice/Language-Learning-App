/**
 * The header shown throughout a session.
 *
 * It reports rounds remaining and elapsed time, never a minutes-remaining countdown.
 * The spec forbids claiming a timer the app does not really have, and an estimate
 * that is wrong by ten minutes quietly undermines everything else the app says.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/use-theme';
import { tapFeedback } from '@/ui/button';
import { ProgressBar } from '@/ui/progress';
import { Text } from '@/ui/text';
import { STAGE_LABELS, type SessionStage } from '@/types';

export type SessionHeaderProps = {
  stage: SessionStage;
  stageIndex: number;
  stageCount: number;
  /** 0 to 1 across the current round. */
  progress: number;
  startedAt: number;
  onClose: () => void;
  /** Shown when the learner can skip ahead (the spec's Next control). */
  onSkip?: () => void;
};

function elapsedLabel(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'just started';
  return `${minutes} min so far`;
}

export function SessionHeader({
  stage,
  stageIndex,
  stageCount,
  progress,
  startedAt,
  onClose,
  onSkip,
}: SessionHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View
      style={{
        paddingTop: insets.top + theme.space.sm,
        paddingHorizontal: theme.space.lg,
        paddingBottom: theme.space.md,
        gap: theme.space.sm,
        backgroundColor: theme.colors.bg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save and close"
          hitSlop={10}
          onPress={() => {
            tapFeedback();
            onClose();
          }}
        >
          <Ionicons name="close" size={26} color={theme.colors.textMuted} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text variant="smallStrong">{STAGE_LABELS[stage]}</Text>
          <Text variant="caption" tone="faint">
            Stage {stageIndex + 1} of {stageCount} · {elapsedLabel(startedAt, now)}
          </Text>
        </View>

        {onSkip ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              tapFeedback();
              onSkip();
            }}
          >
            <Text variant="smallStrong" tone="muted">
              Next
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ProgressBar progress={progress} />
    </View>
  );
}
