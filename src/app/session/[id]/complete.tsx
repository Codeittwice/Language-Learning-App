/**
 * The session celebration.
 *
 * Also the place today's reminder is cancelled, the moment the goal is met: nothing
 * should nag someone who has already done the work.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { currentDayKey } from '@/db/repo/profile';
import { completedSessionCount } from '@/db/repo/sessions';
import { sessionById } from '@/session/engine';
import { readStreak, streakDisplay, type StreakState } from '@/gamification/streak';
import { getDailyProgress } from '@/gamification/xp';
import { cancelToday, reconcileReminders } from '@/notifications/schedule';
import { useTheme } from '@/theme/use-theme';
import { Button, successFeedback } from '@/ui/button';
import { Confetti, CountUp } from '@/ui/celebrate';
import { ProgressRing, StreakBadge } from '@/ui/progress';
import { Card, Row } from '@/ui/surface';
import { Text } from '@/ui/text';

export default function SessionCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [xp, setXp] = useState(0);
  const [goalXp, setGoalXp] = useState(30);
  const [goalMet, setGoalMet] = useState(false);
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [completed, setCompleted] = useState(0);
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const dayKey = await currentDayKey(db);
      const [progress, streakState, total] = await Promise.all([
        getDailyProgress(db, dayKey),
        readStreak(db, dayKey),
        completedSessionCount(db),
      ]);
      const session = id ? await sessionById(db, id) : null;
      if (cancelled) return;

      setXp(progress.xp);
      setGoalXp(progress.goalXp);
      setGoalMet(progress.goalMet);
      setStreak(streakState);
      setCompleted(total);
      setSessionNumber(session?.sessionNumber ?? null);
      setLoading(false);
      successFeedback();

      // Drop today's reminder now the goal is met, then rebuild the horizon so
      // tomorrow's copy reflects what just happened.
      try {
        if (progress.goalMet) await cancelToday(db);
        await reconcileReminders(db, 'goal-met');
      } catch (error) {
        console.warn('[complete] could not update reminders', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: theme.space.xl, justifyContent: 'center', gap: theme.space.xl }}>
      <Confetti run={goalMet} count={64} />

      <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: theme.space.sm }}>
        <Text variant="h1" center>
          {goalMet ? 'Daily goal done' : 'Session finished'}
        </Text>
        {sessionNumber !== null ? (
          <Text variant="small" tone="muted">
            Session {sessionNumber} · {completed} completed in total
          </Text>
        ) : null}
      </Animated.View>

      <Animated.View entering={FadeIn.delay(150)} style={{ alignItems: 'center' }}>
        <ProgressRing progress={goalXp > 0 ? xp / goalXp : 0} size={168} strokeWidth={14}>
          <View style={{ alignItems: 'center' }}>
            <CountUp value={xp} />
            <Text variant="small" tone="muted">
              of {goalXp} XP today
            </Text>
          </View>
        </ProgressRing>
      </Animated.View>

      {streak ? (
        <Animated.View entering={FadeIn.delay(320)}>
          <Card>
            <Row>
              <StreakBadge
                days={streak.current}
                state={streakDisplay(streak, new Date().getHours())}
                freezes={streak.freezesAvailable}
              />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">
                  {streak.current === 0
                    ? 'Start a streak tomorrow'
                    : streak.current >= streak.longest
                      ? 'Your longest run yet'
                      : `Longest: ${streak.longest} days`}
                </Text>
                {streak.freezesAvailable > 0 ? (
                  <Text variant="caption" tone="faint">
                    {streak.freezesAvailable} streak freeze
                    {streak.freezesAvailable === 1 ? '' : 's'} banked for a bad day
                  </Text>
                ) : null}
              </View>
            </Row>
          </Card>
        </Animated.View>
      ) : null}

      {!goalMet ? (
        <Text variant="small" tone="muted" center>
          {goalXp - xp} XP short of today&apos;s goal. A quick round would finish it.
        </Text>
      ) : null}

      <Button title="Done" onPress={() => router.replace('/')} />
    </View>
  );
}
