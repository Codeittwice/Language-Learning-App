/**
 * You: profile, settings entry points, and the honest status of each.
 */
import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { readAiConfig } from '@/ai/config';
import { getKey } from '@/ai/keys';
import { getProvider } from '@/ai/registry';
import { getProfile } from '@/db/repo/profile';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/theme/use-theme';
import { tapFeedback } from '@/ui/button';
import { Card, Row, ScreenScroll, Separator } from '@/ui/surface';
import { Text } from '@/ui/text';

export default function YouScreen() {
  const theme = useTheme();

  const state = useDbQuery(
    async (db) => {
      const [config, profile] = await Promise.all([readAiConfig(db), getProfile(db)]);
      const hasKey = config.provider ? (await getKey(config.provider)) !== null : false;
      return { config, profile, hasKey };
    },
    { events: ['settings:changed', 'ai:changed'] }
  );

  const config = state.data?.config;
  const profile = state.data?.profile;

  const aiDetail = !config?.provider
    ? 'Not connected'
    : !state.data?.hasKey
      ? `${getProvider(config.provider).label} · key missing`
      : !config.chatModel
        ? `${getProvider(config.provider).label} · pick a model`
        : `${getProvider(config.provider).label} · ${config.chatModel}`;

  return (
    <ScreenScroll>
      <Text variant="h1">You</Text>

      <Card padded={false}>
        <SettingsRow
          icon="sparkles-outline"
          title="AI provider"
          detail={aiDetail}
          href="/settings/ai"
        />
        <Separator />
        <SettingsRow icon="notifications-outline" title="Reminders" detail="Time, permission and schedule" href="/settings/reminders" />
        <Separator />
        <SettingsRow icon="person-outline" title="Practice preferences" detail="Topics, session length and Dutch voice" href="/settings/profile" />
        <Separator />
        <SettingsRow icon="download-outline" title="Learning data" detail="Exports and backups" href="/settings/data" />
      </Card>

      <Card>
        <Text variant="h3">Learner</Text>
        <Row>
          <Text variant="small" tone="muted" style={{ flex: 1 }}>
            Target
          </Text>
          <Text variant="smallStrong">Netherlands Dutch, informal</Text>
        </Row>
        <Separator />
        <Row>
          <Text variant="small" tone="muted" style={{ flex: 1 }}>
            Explanations in
          </Text>
          <Text variant="smallStrong">
            {profile?.explanationLanguage === 'en' ? 'English' : (profile?.explanationLanguage ?? '—')}
          </Text>
        </Row>
        <Separator />
        <Row>
          <Text variant="small" tone="muted" style={{ flex: 1 }}>
            A new day starts at
          </Text>
          <Text variant="smallStrong">
            {profile ? `${String(profile.dayStartHour).padStart(2, '0')}:00` : '—'}
          </Text>
        </Row>
        <Text variant="caption" tone="faint">
          Practising after midnight still counts for the day before, so a late session
          never costs you a streak.
        </Text>
      </Card>

      <Card>
        <Text variant="h3">Your data</Text>
        <Text variant="small" tone="muted">
          Everything lives on this phone: your phrases, your history and your API key.
          There is no account and no server, so nothing is uploaded anywhere except the
          text of a practice turn, which goes to the AI provider you chose.
        </Text>
      </Card>

      <Text variant="caption" tone="faint" center>
        Reminders, voice, data export and session history arrive with the practice loop.
      </Text>

      <View style={{ height: theme.space.xl }} />
    </ScreenScroll>
  );
}

function SettingsRow({
  icon,
  title,
  detail,
  href,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  href: Href;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tapFeedback();
        router.push(href);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.md,
        padding: theme.space.lg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={theme.colors.accentText} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textFaint} />
    </Pressable>
  );
}
