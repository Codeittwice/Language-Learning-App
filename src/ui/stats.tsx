/**
 * The small read-only pieces that carry numbers: a stat tile, the week strip, and the
 * single bar that replaced five rows of mastery counts.
 *
 * All three follow the same rule as the rest of the redesign -- a number gets the
 * serif display face, its label gets small sans, and colour is only spent where it
 * means something.
 */
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { parseDayKey, type DayKey } from '@/time/day';
import { Row } from '@/ui/surface';
import { Text } from '@/ui/text';
import { MASTERY_LABELS, type MasteryBand } from '@/types';

/* Stat tile ---------------------------------------------------------------- */

export type StatTileProps = {
  value: string;
  /** Two short words, which wrap onto two lines by design. */
  label: string;
  tone?: 'default' | 'streak' | 'accent' | 'success';
  style?: ViewStyle;
};

export function StatTile({ value, label, tone = 'default', style }: StatTileProps) {
  const theme = useTheme();
  const color: Record<NonNullable<StatTileProps['tone']>, string> = {
    default: theme.colors.text,
    streak: theme.colors.streakText,
    accent: theme.colors.accentText,
    success: theme.colors.success,
  };

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.space.md,
          gap: 2,
        },
        style,
      ]}
    >
      <Text variant="numeral" style={{ color: color[tone] }}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" style={{ letterSpacing: 0 }}>
        {label}
      </Text>
    </View>
  );
}

/* Week strip --------------------------------------------------------------- */

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** The single-letter weekday for a day key, without pulling in a date library. */
function weekdayInitial(dayKey: DayKey): string {
  const { year, month, day } = parseDayKey(dayKey);
  return WEEKDAY_INITIALS[new Date(Date.UTC(year, month, day)).getUTCDay()] ?? '';
}

export type DayXp = { dayKey: DayKey; xp: number; goalMet: boolean };

export type WeekStripProps = {
  /** Oldest first. Any length; seven is the intended one. */
  days: readonly DayXp[];
  goalXp: number;
  /** The day key for today, drawn as an outline when it has no XP yet. */
  todayKey: DayKey;
  height?: number;
};

/**
 * Seven bars and seven letters.
 *
 * A day that met the goal is full-strength; one that fell short is drawn in the same
 * hue at lower chroma rather than a different colour, so the comparison is about
 * height and not about hunting for a legend.
 */
export function WeekStrip({ days, goalXp, todayKey, height = 44 }: WeekStripProps) {
  const theme = useTheme();
  // Scale to the goal, not to the best day: the point of the strip is "did I clear
  // the bar", and rescaling to a personal record makes an ordinary good day look thin.
  const ceiling = Math.max(goalXp, ...days.map((day) => day.xp), 1);

  return (
    <View style={{ flexDirection: 'row', gap: theme.space.sm, alignItems: 'flex-end' }}>
      {days.map((day) => {
        const isToday = day.dayKey === todayKey;
        const filled = Math.max(day.xp > 0 ? 6 : 0, Math.round((day.xp / ceiling) * height));
        return (
          <View key={day.dayKey} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ height, justifyContent: 'flex-end', alignSelf: 'stretch' }}>
              {day.xp > 0 ? (
                <View
                  style={{
                    height: filled,
                    borderRadius: theme.radius.sm - 2,
                    backgroundColor: day.goalMet ? theme.colors.primary : theme.colors.borderStrong,
                  }}
                />
              ) : (
                <View
                  style={{
                    height: 10,
                    borderRadius: theme.radius.sm - 2,
                    borderWidth: isToday ? 1.5 : 1,
                    borderStyle: isToday ? 'dashed' : 'solid',
                    borderColor: isToday ? theme.colors.borderStrong : theme.colors.border,
                  }}
                />
              )}
            </View>
            <Text
              variant="caption"
              style={{
                letterSpacing: 0,
                color: isToday ? theme.colors.text : theme.colors.textFaint,
              }}
            >
              {weekdayInitial(day.dayKey)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* Mastery bar -------------------------------------------------------------- */

export type MasteryBarProps = {
  counts: Record<MasteryBand, number>;
};

/**
 * One stacked bar plus a legend, in place of five label/number rows.
 *
 * The bands are a progression, so they are drawn as one length divided up: how far
 * along the bank is reads instantly, which five separate numbers never did.
 */
export function MasteryBar({ counts }: MasteryBarProps) {
  const theme = useTheme();
  const bands: MasteryBand[] = ['new', 'learning', 'familiar', 'solid', 'mastered'];

  // A progression from neutral to the accent, so position in the bar carries the
  // meaning and no two neighbouring bands rely on hue alone to be told apart.
  const colorOf: Record<MasteryBand, string> = {
    new: theme.colors.border,
    learning: theme.colors.accentSoft,
    familiar: theme.colors.accent,
    solid: theme.colors.accentText,
    mastered: theme.colors.success,
  };

  const total = bands.reduce((sum, band) => sum + counts[band], 0);

  return (
    <View style={{ gap: theme.space.md }}>
      <View
        style={{
          height: 14,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.track,
          flexDirection: 'row',
          gap: 2,
          overflow: 'hidden',
        }}
      >
        {total > 0
          ? bands.map((band) =>
              counts[band] > 0 ? (
                <View
                  key={band}
                  style={{ flex: counts[band], backgroundColor: colorOf[band] }}
                />
              ) : null
            )
          : null}
      </View>

      <Row style={{ flexWrap: 'wrap', rowGap: theme.space.sm }} gap={theme.space.lg}>
        {bands.map((band) => (
          <Row key={band} gap={6}>
            <View
              style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colorOf[band] }}
            />
            <Text variant="caption" tone="muted" style={{ letterSpacing: 0 }}>
              {MASTERY_LABELS[band]} {counts[band]}
            </Text>
          </Row>
        ))}
      </Row>
    </View>
  );
}
