/**
 * Progress.
 *
 * The screen the level system was built for: until now a month of practice left no
 * visible trace, because `daily_activity.xp` reset every morning.
 *
 * Same rule as Today -- no stack of identical cards. There is no action to take here,
 * so there is no raised card at all: section labels, one hero, and hairline rows.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { readProgress } from '@/db/repo/progress';
import { ACHIEVEMENTS } from '@/gamification/achievements';
import { nextTier } from '@/gamification/levels';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/theme/use-theme';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { LevelRing } from '@/ui/progress';
import { MasteryBar, StatTile } from '@/ui/stats';
import { Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

const EVENTS = ['gamification:changed', 'reviews:changed', 'challenges:changed', 'phrases:changed'] as const;

const RECALL_LABELS = {
  independent: 'Said with no help',
  prompted: 'Needed a hint',
  missed: 'Missed',
  not_tested: 'Skipped',
} as const;

const CHART_WIDTH = 280;
const CHART_HEIGHT = 96;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <Row>
        <Text variant="caption" tone="faint" style={{ flex: 1 }}>
          {title.toUpperCase()}
        </Text>
        {hint ? (
          <Text variant="caption" tone="muted" style={{ letterSpacing: 0 }}>
            {hint}
          </Text>
        ) : null}
      </Row>
      {children}
    </View>
  );
}

export default function ProgressScreen() {
  const theme = useTheme();
  const { data, error, refresh } = useDbQuery(readProgress, { events: EVENTS });

  if (!data) {
    return (
      <ScreenScroll>
        <Text variant="title">Progress</Text>
        <Text tone={error ? 'danger' : 'muted'}>
          {error ? 'Could not read your progress.' : 'Loading…'}
        </Text>
        {error && <Button title="Try again" onPress={refresh} />}
      </ScreenScroll>
    );
  }

  const { level, streak } = data;
  const upcoming = nextTier(level.level);

  // Scale the chart to the goal rather than to the best day ever: the question this
  // chart answers is "did I clear the bar", and rescaling to a personal record makes
  // every ordinary good day look like a failure.
  const ceiling = Math.max(data.goalXp, ...data.xp.map((point) => point.xp), 1);
  const barFor = (xp: number) => (xp / ceiling) * (CHART_HEIGHT - 12);
  const goalY = CHART_HEIGHT - 2 - barFor(data.goalXp);

  const latestConfidence = data.confidence.at(-1);
  const confidenceGap = (CHART_WIDTH - 16) / Math.max(1, data.confidence.length - 1);
  const confidenceY = (value: number) =>
    CHART_HEIGHT - 8 - ((value - 1) * (CHART_HEIGHT - 16)) / 4;

  const metCount = data.xp.filter((point) => point.goalMet).length;

  return (
    <ScreenScroll>
      {/* The hero: where the lifetime total has got to. */}
      <Row gap={theme.space.lg}>
        <LevelRing level={level.level} progress={level.progress} size={92} />
        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Text variant="caption" tone="faint">
            {`TIER ${level.tierIndex} OF ${level.tierCount}`}
          </Text>
          <Text variant="title" style={{ fontSize: 26, lineHeight: 30 }}>
            {level.tier.name}
          </Text>
          <Text variant="small" tone="muted">
            {`${level.intoLevel} of ${level.levelCost} XP towards level ${level.level + 1} · ${level.totalXp.toLocaleString()} all time`}
          </Text>
        </View>
      </Row>

      <Row gap={theme.space.sm}>
        <StatTile value={String(data.sessions)} label={'sessions\nfinished'} />
        <StatTile value={String(streak.longest)} label={'longest\nstreak'} tone="streak" />
        <StatTile
          value={
            data.independentRate === null ? '—' : `${Math.round(data.independentRate * 100)}%`
          }
          label={'said with\nno help'}
          tone="accent"
        />
      </Row>

      <Section title="Last 14 days" hint={`goal met ${metCount}×`}>
        <Svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          accessibilityLabel={`Daily XP for the last 14 days. The goal was met on ${metCount} of them.`}
        >
          {/* The goal line is the only reference that matters here. */}
          <Line
            x1={0}
            x2={CHART_WIDTH}
            y1={goalY}
            y2={goalY}
            stroke={theme.colors.borderStrong}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <Line
            x1={0}
            x2={CHART_WIDTH}
            y1={CHART_HEIGHT - 1}
            y2={CHART_HEIGHT - 1}
            stroke={theme.colors.border}
          />
          {data.xp.map(({ dayKey, xp, goalMet }, index) => {
            const height = barFor(xp);
            return (
              <Rect
                key={dayKey}
                x={index * 20 + 3}
                y={CHART_HEIGHT - 2 - height}
                width={14}
                height={Math.max(xp > 0 ? 2 : 0, height)}
                rx={3}
                // Same hue at lower chroma for a short day, rather than a second
                // colour: the comparison should be about height.
                fill={goalMet ? theme.colors.primary : theme.colors.borderStrong}
              />
            );
          })}
        </Svg>
        <Text variant="small" tone="muted">
          {`The dashed line is your ${data.goalXp} XP goal. Faint bars fell short of it.`}
        </Text>
      </Section>

      <Section
        title={`Your ${Object.values(data.mastery).reduce((sum, count) => sum + count, 0)} phrases`}
        hint={`${data.mastery.solid + data.mastery.mastered} solid or better`}
      >
        <MasteryBar counts={data.mastery} />
        <Text variant="small" tone="muted">
          Mastery reflects how long the review schedule expects you to remember an item,
          not how many times you have seen it.
        </Text>
      </Section>

      {upcoming ? (
        <Section title="Next tier">
          <View>
            <ListRow
              first
              icon="trophy-outline"
              tone="streak"
              title={`Level ${upcoming.from} · ${upcoming.name}`}
              detail={upcoming.opens.join(' · ')}
            />
          </View>
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0 }}>
            A tier only ever adds an extra mode. Nothing in the course is behind a level.
          </Text>
        </Section>
      ) : null}

      <Section title="Recall attempts">
        <View>
          {(Object.keys(RECALL_LABELS) as (keyof typeof RECALL_LABELS)[]).map((status, index) => (
            <ListRow
              key={status}
              first={index === 0}
              title={RECALL_LABELS[status]}
              value={String(data.recall.find((item) => item.status === status)?.count ?? 0)}
            />
          ))}
        </View>
      </Section>

      <Section title="Your confidence">
        {latestConfidence ? (
          <>
            <Svg
              width="100%"
              height={CHART_HEIGHT}
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              accessibilityLabel={`Self-reported confidence from 1 to 5. Latest: ${latestConfidence.value} out of 5.`}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <Line
                  key={value}
                  x1={8}
                  x2={CHART_WIDTH - 8}
                  y1={confidenceY(value)}
                  y2={confidenceY(value)}
                  stroke={theme.colors.border}
                />
              ))}
              {data.confidence.map((point, index) => {
                const previous = data.confidence[index - 1];
                return previous ? (
                  <Line
                    key={point.session}
                    x1={8 + (index - 1) * confidenceGap}
                    x2={8 + index * confidenceGap}
                    y1={confidenceY(previous.value)}
                    y2={confidenceY(point.value)}
                    stroke={theme.colors.accent}
                    strokeWidth={2}
                  />
                ) : null;
              })}
              {data.confidence.map((point, index) => (
                <Circle
                  key={point.session}
                  cx={8 + index * confidenceGap}
                  cy={confidenceY(point.value)}
                  r={4}
                  fill={theme.colors.accent}
                />
              ))}
            </Svg>
            <Text variant="small" tone="muted">
              {`Latest self-rating · ${latestConfidence.value}/5 in session ${latestConfidence.session}`}
            </Text>
          </>
        ) : (
          <Text variant="small" tone="muted">
            Rate your confidence at wrap-up to start a trend.
          </Text>
        )}
      </Section>

      {data.corrections.length ? (
        <Section title="Correction patterns" hint="most frequent first">
          <View>
            {data.corrections.map(({ category, count }, index) => (
              <ListRow
                key={category}
                first={index === 0}
                title={category.replaceAll('_', ' ')}
                value={String(count)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {data.listening.length ? (
        <Section title="Recent comprehension practice">
          <View>
            {data.listening.map((item, index) => (
              <ListRow
                key={item.id}
                first={index === 0}
                title={item.audio_source === 'text_only' ? 'Text-based' : 'Listening'}
                detail={item.gist_answer}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {data.challenges.length ? (
        <Section title="Real-world challenges">
          <View>
            {data.challenges.map((challenge, index) => (
              <ListRow
                key={challenge.id}
                first={index === 0}
                title={challenge.action}
                detail={challenge.status.replaceAll('_', ' ')}
              />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Milestones">
        <View>
          {Object.entries(ACHIEVEMENTS).map(([key, label], index) => {
            const reached = data.achievements.some((item) => item.key === key);
            return (
              <ListRow
                key={key}
                first={index === 0}
                icon={reached ? 'checkmark-circle' : 'ellipse-outline'}
                tone={reached ? 'success' : 'neutral'}
                title={label}
                value={reached ? 'Reached' : 'In progress'}
              />
            );
          })}
        </View>
      </Section>
    </ScreenScroll>
  );
}
