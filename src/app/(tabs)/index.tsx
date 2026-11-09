/**
 * Today.
 *
 * Everything on this screen is read from the database, including the honest bits:
 * which stages this session actually contains, how far through it you are, and
 * whether reminders can really reach you.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { isAiReady } from '@/ai/config';
import { countPhrases, importSeedPhrases } from '@/db/repo/phrases';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import { reportChallenge } from '@/db/repo/sessions';
import { readStreak, type StreakState } from '@/gamification/streak';
import { getDailyProgress } from '@/gamification/xp';
import { useDbQuery } from '@/hooks/use-db-query';
import { getPermissionState, requestReminderPermission } from '@/notifications';
import { healIfCleared, reconcileReminders } from '@/notifications/schedule';
import { getTodayState, startOrResume, type TodayState } from '@/session/engine';
import { DURATION_MINUTES, type DurationMode, STAGE_LABELS } from '@/types';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip, tapFeedback } from '@/ui/button';
import { ProgressRing, StreakFlame } from '@/ui/progress';
import { Card, Row, ScreenScroll, Separator } from '@/ui/surface';
import { Text } from '@/ui/text';
import { stagesFor } from '@/session/plan';

type Snapshot = {
  today: TodayState;
  streak: StreakState;
  xp: number;
  goalXp: number;
  goalMet: boolean;
  phraseCount: number;
  aiReady: boolean;
  defaultMode: DurationMode;
};

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const db = useSQLiteContext();

  const [mode, setMode] = useState<DurationMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState<boolean | null>(null);

  const snapshot = useDbQuery<Snapshot>(
    async (database) => {
      // Ship with something to practise: an empty bank makes the first recall round
      // fall flat, so the seed is imported on first run.
      if ((await countPhrases(database)) === 0) {
        await importSeedPhrases(database);
      }

      const dayKey = await currentDayKey(database);
      const [today, streak, progress, phraseCount, aiReady, profile] = await Promise.all([
        getTodayState(database),
        readStreak(database, dayKey),
        getDailyProgress(database, dayKey),
        countPhrases(database),
        isAiReady(database),
        getProfile(database),
      ]);

      return {
        today,
        streak,
        xp: progress.xp,
        goalXp: progress.goalXp,
        goalMet: progress.goalMet,
        phraseCount,
        aiReady,
        defaultMode: profile.defaultDurationMode,
      };
    },
    { events: ['session:changed', 'gamification:changed', 'settings:changed', 'challenges:changed'] }
  );

  // Keep reminders healthy on every visit: repairs the schedule if a force-stop or an
  // OEM battery saver wiped it, and refreshes the fourteen-day horizon.
  useEffect(() => {
    void getPermissionState().then((state) => setNotificationsGranted(state.granted));
    void healIfCleared(db).catch(() => undefined);
    void reconcileReminders(db, 'foreground').catch(() => undefined);
  }, [db]);

  const data = snapshot.data;
  const active = data?.today.active ?? null;
  const chosenMode = mode ?? active?.durationMode ?? data?.defaultMode ?? 'standard';

  const start = useCallback(
    async (extra = false) => {
      if (starting) return;
      setStarting(true);
      try {
        const session = await startOrResume(db, { mode: chosenMode, extra });
        router.push(`/session/${session.id}`);
      } finally {
        setStarting(false);
      }
    },
    [chosenMode, db, router, starting]
  );

  const allowReminders = useCallback(async () => {
    const granted = await requestReminderPermission();
    setNotificationsGranted(granted);
    if (granted) await reconcileReminders(db, 'permission-granted');
  }, [db]);

  if (!data) {
    return (
      <ScreenScroll>
        <Text variant="h1">Today</Text>
        <Text variant="small" tone="muted">
          {snapshot.error ? snapshot.error.message : 'Loading…'}
        </Text>
      </ScreenScroll>
    );
  }

  const { today, streak } = data;
  const stages = stagesFor(chosenMode);
  const resuming = Boolean(active);

  return (
    <ScreenScroll>
      {/* Streak and daily goal */}
      <Card>
        <Row>
          <StreakFlame days={streak.current} atRisk={streak.atRisk} />
          <View style={{ flex: 1 }} />
          <ProgressRing
            progress={data.goalXp > 0 ? data.xp / data.goalXp : 0}
            size={76}
            strokeWidth={8}
          >
            <View style={{ alignItems: 'center' }}>
              <Text variant="bodyStrong">{data.xp}</Text>
              <Text variant="caption" tone="faint">
                /{data.goalXp}
              </Text>
            </View>
          </ProgressRing>
        </Row>
        <Text variant="caption" tone="faint">
          {data.goalMet
            ? "Today's goal is done. Anything else is a bonus."
            : `${Math.max(0, data.goalXp - data.xp)} XP to keep the streak.`}
        </Text>
      </Card>

      {/* The session */}
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="faint">
              SESSION {today.sessionNumber} · WEEK {today.week}
            </Text>
            <Text variant="h2">{today.topicLabel}</Text>
          </View>
        </Row>

        <Text variant="small" tone="muted">
          {today.weekFocus}
        </Text>

        {resuming && today.progress ? (
          <Text variant="small" tone="accent">
            Stage {today.progress.completed + 1} of {today.progress.total} ·{' '}
            {today.progress.nextStage ? STAGE_LABELS[today.progress.nextStage] : 'wrap up'} next
          </Text>
        ) : (
          <Row style={{ gap: theme.space.sm }}>
            {(['quick', 'short', 'standard'] as DurationMode[]).map((option) => (
              <Chip
                key={option}
                label={`~${DURATION_MINUTES[option]} min`}
                selected={chosenMode === option}
                onPress={() => setMode(option)}
              />
            ))}
          </Row>
        )}

        {!resuming ? (
          <Text variant="caption" tone="faint">
            {stages.map((stage) => STAGE_LABELS[stage]).join(' → ')}
          </Text>
        ) : null}

        <Button
          title={resuming ? 'Continue' : today.finishedToday ? 'Extra practice' : 'Start'}
          loading={starting}
          onPress={() => void start(!resuming && today.finishedToday)}
          leading={
            <Ionicons
              name={resuming ? 'play-forward' : 'play'}
              size={18}
              color={theme.colors.onAccent}
            />
          }
        />

        {today.finishedToday && !resuming ? (
          <Text variant="caption" tone="faint">
            Today&apos;s session is already counted. Extra practice does not advance the
            schedule.
          </Text>
        ) : null}
      </Card>

      {/* Due now */}
      <Card>
        <Row>
          <Ionicons name="repeat" size={20} color={theme.colors.accentText} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">
              {today.dueCount === 0
                ? 'Nothing due right now'
                : `${today.dueCount} phrase${today.dueCount === 1 ? '' : 's'} due`}
            </Text>
            <Text variant="caption" tone="faint">
              {data.phraseCount} in your bank
            </Text>
          </View>
        </Row>
      </Card>

      {/* Real-world challenge */}
      {today.challenge ? (
        <Card>
          <Text variant="caption" tone="faint">
            YOUR CHALLENGE
          </Text>
          <Text variant="body">{today.challenge.action}</Text>
          <Separator />
          <Text variant="caption" tone="faint">
            How did it go? Any answer is fine.
          </Text>
          <Row style={{ flexWrap: 'wrap', gap: theme.space.sm }}>
            {(
              [
                ['completed', 'Did it'],
                ['attempted', 'Tried'],
                ['not_attempted', 'Not yet'],
                ['declined', 'Skip this'],
              ] as const
            ).map(([status, label]) => (
              <Chip
                key={status}
                label={label}
                tone={status === 'completed' ? 'success' : 'neutral'}
                onPress={() => {
                  tapFeedback();
                  void reportChallenge(db, today.challenge!.id, status);
                }}
              />
            ))}
          </Row>
        </Card>
      ) : null}

      {/* Honest setup warnings, only when something is actually wrong */}
      {!data.aiReady ? (
        <Card>
          <Row>
            <Ionicons name="key-outline" size={20} color={theme.colors.warning} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              No AI connected
            </Text>
          </Row>
          <Text variant="small" tone="muted">
            Recall still works: answers are checked against the phrase itself and you can
            grade yourself. Conversation and feedback need a provider key.
          </Text>
          <Button
            title="Connect a provider"
            variant="secondary"
            size="medium"
            onPress={() => router.push('/settings/ai')}
          />
        </Card>
      ) : null}

      {notificationsGranted === false ? (
        <Card>
          <Row>
            <Ionicons name="notifications-off-outline" size={20} color={theme.colors.warning} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Reminders are off
            </Text>
          </Row>
          <Text variant="small" tone="muted">
            This is the part that actually keeps the habit going. One a day, around
            19:30, and it stops once you have practised.
          </Text>
          <Button
            title="Allow reminders"
            variant="secondary"
            size="medium"
            onPress={() => void allowReminders()}
          />
        </Card>
      ) : null}
    </ScreenScroll>
  );
}
