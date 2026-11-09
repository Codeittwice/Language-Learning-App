/**
 * Placeholder for a tab whose feature lands in a later milestone.
 *
 * It says plainly what is not built yet rather than showing a convincing mockup --
 * a fake screen that looks finished is how you end up debugging a feature that was
 * never written.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { Card, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

export function ComingSoon({
  icon,
  title,
  summary,
  bullets,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  summary: string;
  bullets: string[];
}) {
  const theme = useTheme();
  return (
    <ScreenScroll>
      <View style={{ gap: theme.space.xs }}>
        <Text variant="h1">{title}</Text>
        <Text variant="small" tone="muted">
          {summary}
        </Text>
      </View>

      <Card>
        <View style={{ alignItems: 'center', paddingVertical: theme.space.lg, gap: theme.space.md }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={30} color={theme.colors.accentText} />
          </View>
          <Text variant="bodyStrong" center>
            Not built yet
          </Text>
        </View>

        <View style={{ gap: theme.space.sm }}>
          {bullets.map((bullet) => (
            <View key={bullet} style={{ flexDirection: 'row', gap: theme.space.sm }}>
              <Text variant="small" tone="faint">
                •
              </Text>
              <Text variant="small" tone="muted" style={{ flex: 1 }}>
                {bullet}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </ScreenScroll>
  );
}
