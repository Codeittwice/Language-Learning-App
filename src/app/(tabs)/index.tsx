/**
 * Today.
 *
 * Everything on this screen is read from the database, including the honest bits:
 * which stages this session actually contains, how far through it you are, and
 * whether reminders can really reach you.
 *
 * The layout follows one rule: **one raised card, one orange button.** The screen used
 * to be five identically bordered white cards stacked on top of each other, which made
 * everything equally important and so nothing important. Now the session is the only
 * card and the only action; the streak, the phrases due and the challenge are hairline
 * rows on the page background. Depth and colour both mean "act on this".
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { isAiReady } from '@/ai/config';
import { countPhrases } from '@/db/repo/phrases';
import { currentDayKey, getProfile, type LearnerProfile } from '@/db/repo/profile';
import { reportChallenge } from '@/db/repo/sessions';
import { readStreak, streakDisplay, type StreakDisplay, type StreakState } from '@/gamification/streak';
import { getDailyProgress, readLevel, xpHistory } from '@/gamification/xp';
import type { LevelState } from '@/gamification/levels';
import { useDbQuery } from '@/hooks/use-db-query';
import { getTodayState, startOrResume, type TodayState } from '@/session/engine';
import { stagesFor } from '@/session/plan';
import { addDays, type DayKey } from '@/time/day';
import { DURATION_MINUTES, type DurationMode, STAGE_LABELS } from '@/types';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip, tapFeedback } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { MediaStrip } from '@/ui/media-strip';
import { Onboarding } from '@/ui/onboarding';
import { ProgressBar, StreakBadge } from '@/ui/progress';
import { SegmentedControl } from '@/ui/segmented';
import { WeekStrip, type DayXp } from '@/ui/stats';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

type Snapshot = {
  today: TodayState;
  streak: StreakState;
  streakState: StreakDisplay;
  xp: number;
  goalXp: number;
  goalMet: boolean;
  level: LevelState;
  week: DayXp[];
  dayKey: DayKey;
  dateLabel: string;
  phraseCount: number;
  aiReady: boolean;
  defaultMode: DurationMode;
  profile: LearnerProfile;
};

/**
 * `gamification:changed` is deliberately NOT in this list.
 *
 * Every XP award emits it, and the tab navigator keeps this screen mounted while a
 * session runs -- so it was re-running all six of these queries after every single
 * recall card. The screen refreshes on focus, which is the only moment its numbers are
 * actually being looked at.
 */
const TODAY_EVENTS = ['session:changed', 'settings:changed', 'challenges:changed'] as const;

const DURATIONS: readonly { value: DurationMode; label: string }[] = [
  { value: 'quick', label: `${DURATION_MINUTES.quick} min` },
  { value: 'short', label: `${DURATION_MINUTES.short} min` },
  { value: 'standard', label: `${DURATION_MINUTES.standard} min` },
];

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const db = useSQLiteContext();

  const [mode, setMode] = useState<DurationMode | null>(null);
  const [starting, setStarting] = useState(false);

  const snapshot = useDbQuery<Snapshot>(
    async (database) => {
      const dayKey = await currentDayKey(database);
      const [today, streak, progress, level, week, phraseCount, aiReady, profile] =
        await Promise.all([
          getTodayState(database),
          readStreak(database, dayKey),
          getDailyProgress(database, dayKey),
          readLevel(database),
          xpHistory(database, addDays(dayKey, -6), dayKey),
          countPhrases(database),
          isAiReady(database),
          getProfile(database),
        ]);

      // The clock is read here rather than in render: a date string built during
      // render is impure, and the screen re-reads on focus anyway.
      const now = new Date();

      // xpHistory only returns days that have a row, so fill the gaps.
      const byDay = new Map(week.map((entry) => [entry.dayKey, entry]));
      const filled: DayXp[] = Array.from({ length: 7 }, (_, index) => {
        const key = addDays(dayKey, index - 6);
        const entry = byDay.get(key);
        return { dayKey: key, xp: entry?.xp ?? 0, goalMet: entry?.goalMet ?? false };
      });

      return {
        today,
        streak,
        streakState: streakDisplay(streak, now.getHours()),
        xp: progress.xp,
        goalXp: progress.goalXp,
        goalMet: progress.goalMet,
        level,
        week: filled,
        dayKey,
        dateLabel: now.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        }),
        phraseCount,
        aiReady,
        defaultMode: profile.defaultDurationMode,
        profile,
      };
    },
    { events: TODAY_EVENTS }
  );

  const data = snapshot.data;
  const active = data?.today.active ?? null;
  const chosenMode = active?.durationMode ?? mode ?? data?.defaultMode ?? 'standard';

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

  if (!data) {
    return (
      <ScreenScroll>
        <Text variant="title">Today</Text>
        <Text variant="small" tone="muted">
          {snapshot.error ? snapshot.error.message : 'Loading…'}
        </Text>
      </ScreenScroll>
    );
  }

  const { today, streak, level } = data;
  const stages = stagesFor(chosenMode);
  const resuming = Boolean(active);
  const remaining = Math.max(0, data.goalXp - data.xp);

  const goalLine = data.goalMet
    ? "Today's goal is done. Anything else is a bonus."
    : data.streakState === 'at_risk'
      ? `${remaining} XP left today to keep the streak.`
      : streak.current > 0
        ? `${remaining} XP to keep the streak going.`
        : `${remaining} XP to start a streak. One short session covers it.`;

  return (
    <ScreenScroll>
      {!data.profile.onboardedAt && <Onboarding profile={data.profile} />}

      {/* Date, streak, level. No card: this is status, not an action. */}
      <Row>
        <Text variant="caption" tone="faint" style={{ flex: 1, textTransform: 'uppercase' }}>
          {data.dateLabel}
        </Text>
        <StreakBadge
          days={streak.current}
          state={data.streakState}
          freezes={streak.freezesAvailable}
        />
        <View
          style={{
            paddingHorizontal: theme.space.sm + 2,
            paddingVertical: 6,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text variant="caption">{`LV ${level.level}`}</Text>
        </View>
      </Row>

      {/* The hero: what you are about to practise, in the serif voice. */}
      <View style={{ gap: theme.space.xs }}>
        <Text variant="caption" tone="faint">
          {`SESSION ${today.sessionNumber}  ·  WEEK ${today.week}`}
        </Text>
        <Text variant="title">{today.topicLabel}</Text>
        <Text variant="small" tone="muted">
          {today.weekFocus}
        </Text>
      </View>

      {/* Today's goal. */}
      <View style={{ gap: theme.space.sm }}>
        <Row gap={theme.space.sm}>
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            TODAY
          </Text>
          <Text variant="numeral">{data.xp}</Text>
          <Text variant="smallStrong" tone="muted">{`/ ${data.goalXp} XP`}</Text>
        </Row>
        <ProgressBar
          progress={data.goalXp > 0 ? data.xp / data.goalXp : 0}
          height={10}
          color={data.goalMet ? theme.colors.success : theme.colors.primary}
        />
        <Text variant="small" tone="muted">
          {goalLine}
        </Text>
      </View>

      {/* The one card, and the one orange button. */}
      <Card>
        {resuming && today.progress ? (
          <Row>
            <Ionicons name="play-forward" size={18} color={theme.colors.accentText} />
            <Text variant="small" tone="accent" style={{ flex: 1 }}>
              {`Stage ${today.progress.completed + 1} of ${today.progress.total} · ${
                today.progress.nextStage
                  ? STAGE_LABELS[today.progress.nextStage]
                  : 'wrap up'
              } next`}
            </Text>
          </Row>
        ) : (
          <SegmentedControl
            accessibilityLabel="Session length"
            options={DURATIONS}
            value={chosenMode}
            onChange={setMode}
            disabled={starting}
          />
        )}

        <Button
          title={resuming ? 'Continue' : today.finishedToday ? 'Extra practice' : 'Start session'}
          loading={starting}
          onPress={() => void start(!resuming && today.finishedToday)}
          leading={
            <Ionicons
              name={resuming ? 'play-forward' : 'play'}
              size={17}
              color={theme.colors.onAccent}
            />
          }
        />

        {!resuming ? (
          <Text variant="caption" tone="faint" center style={{ letterSpacing: 0 }}>
            {stages.map((stage) => STAGE_LABELS[stage]).join('  ·  ')}
          </Text>
        ) : null}

        {today.finishedToday && !resuming ? (
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0 }}>
            Today&apos;s session is already counted. Extra practice does not advance the
            schedule.
          </Text>
        ) : null}
      </Card>

      {/* Hairline rows, in place of a card each. */}
      <View>
        <ListRow
          first
          icon="repeat"
          tone="accent"
          title={
            today.dueCount === 0
              ? 'Nothing due right now'
              : `${today.dueCount} phrase${today.dueCount === 1 ? '' : 's'} due`
          }
          detail={`${data.phraseCount} in your bank`}
        />

        <ListRow
          icon="trending-up"
          tone="streak"
          title={`Level ${level.level} · ${level.tier.name}`}
          detail={`${level.toNextLevel} XP to level ${level.level + 1}`}
          onPress={() => router.push('/progress')}
        />

        {today.challenge ? (
          <ListRow icon="star-outline" tone="primary" title="Today's challenge">
            <Text variant="small" tone="muted">
              {today.challenge.action}
            </Text>
          </ListRow>
        ) : null}
      </View>

      {today.challenge ? (
        <View style={{ gap: theme.space.sm }}>
          <Text variant="caption" tone="faint">
            HOW DID IT GO? ANY ANSWER IS FINE
          </Text>
          <Row style={{ flexWrap: 'wrap', rowGap: theme.space.sm }} gap={theme.space.sm}>
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
        </View>
      ) : null}

      {/* The week, so a streak is something you can see rather than a number. */}
      <View style={{ gap: theme.space.md }}>
        <Row>
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            THIS WEEK
          </Text>
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0 }}>
            {`${data.week.filter((day) => day.goalMet).length} of 7 goals met`}
          </Text>
        </Row>
        <WeekStrip days={data.week} goalXp={data.goalXp} todayKey={data.dayKey} />
      </View>

      {/* Honest setup warnings, only when something is actually wrong. */}
      {!data.aiReady ? (
        <View>
          <ListRow
            first
            icon="key-outline"
            tone="neutral"
            title="No AI connected"
            detail="Recall still works; conversation and feedback need a provider key."
            onPress={() => router.push('/settings/ai')}
          />
        </View>
      ) : null}

      <MediaStrip />
    </ScreenScroll>
  );
}
