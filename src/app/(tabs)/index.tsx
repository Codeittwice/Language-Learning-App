/**
 * Today.
 *
 * In this milestone it is the setup checklist, reporting real state rather than a
 * mockup: whether the database migrated, whether an AI key and model are configured,
 * and whether reminders are allowed. The practice loop lands here next.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { readAiConfig } from '@/ai/config';
import { getKey } from '@/ai/keys';
import { getProvider } from '@/ai/registry';
import { count } from '@/db';
import { LATEST_VERSION } from '@/db/migrations';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import { useDbQuery } from '@/hooks/use-db-query';
import { getPermissionState, requestReminderPermission } from '@/notifications';
import { useTheme } from '@/theme/use-theme';
import { Button } from '@/ui/button';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

type SetupState = {
  dayKey: string;
  timezone: string;
  phraseCount: number;
  providerLabel: string | null;
  hasKey: boolean;
  model: string | null;
};

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [notificationsGranted, setNotificationsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void getPermissionState().then((state) => setNotificationsGranted(state.granted));
  }, []);

  const setup = useDbQuery<SetupState>(
    async (database) => {
      const [config, profile, dayKey, phraseCount] = await Promise.all([
        readAiConfig(database),
        getProfile(database),
        currentDayKey(database),
        count(database, 'SELECT COUNT(*) AS n FROM phrases WHERE is_archived = 0'),
      ]);
      const hasKey = config.provider ? (await getKey(config.provider)) !== null : false;
      return {
        dayKey,
        timezone: profile.timezone,
        phraseCount,
        providerLabel: config.provider ? getProvider(config.provider).label : null,
        hasKey,
        model: config.chatModel,
      };
    },
    { events: ['settings:changed', 'phrases:changed', 'ai:changed'] }
  );

  const data = setup.data;
  const aiReady = Boolean(data?.hasKey && data?.model);

  return (
    <ScreenScroll>
      <View style={{ gap: 4 }}>
        <Text variant="h1">Dutch with Friends</Text>
        <Text variant="small" tone="muted">
          Learning day {data?.dayKey ?? '—'} · {data?.timezone ?? '—'}
        </Text>
      </View>

      <Card>
        <Text variant="h3">Setting up</Text>
        <Text variant="small" tone="muted">
          The practice session arrives in the next step. These are the pieces it needs.
        </Text>

        <ChecklistItem
          done
          title="Database ready"
          detail={`Schema v${LATEST_VERSION} · ${data?.phraseCount ?? 0} phrases saved`}
        />
        <ChecklistItem
          done={aiReady}
          title="AI provider connected"
          detail={
            aiReady
              ? `${data?.providerLabel} · ${data?.model}`
              : data?.providerLabel
                ? `${data.providerLabel} chosen, key or model still missing`
                : 'Not configured yet'
          }
        />
        <ChecklistItem
          done={notificationsGranted === true}
          title="Daily reminder allowed"
          detail={
            notificationsGranted === null
              ? 'Checking…'
              : notificationsGranted
                ? 'The reminder can reach you'
                : 'Without this, nothing will nudge you to practise'
          }
        />
      </Card>

      {!aiReady ? (
        <Button
          title={data?.providerLabel ? 'Finish AI setup' : 'Connect an AI provider'}
          onPress={() => router.push('/settings/ai')}
          leading={<Ionicons name="key-outline" size={18} color={theme.colors.onAccent} />}
        />
      ) : null}

      {notificationsGranted === false ? (
        <Button
          title="Allow reminders"
          variant="secondary"
          onPress={() => {
            void requestReminderPermission().then(setNotificationsGranted);
          }}
          leading={
            <Ionicons name="notifications-outline" size={18} color={theme.colors.text} />
          }
        />
      ) : null}

      {setup.error ? (
        <Card>
          <Text variant="smallStrong" tone="danger">
            Could not read the database
          </Text>
          <Text variant="small" tone="muted">
            {setup.error.message}
          </Text>
        </Card>
      ) : null}
    </ScreenScroll>
  );
}

function ChecklistItem({
  done,
  title,
  detail,
}: {
  done: boolean;
  title: string;
  detail: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'flex-start' }}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={done ? theme.colors.success : theme.colors.textFaint}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="muted">
          {detail}
        </Text>
      </View>
    </Row>
  );
}
