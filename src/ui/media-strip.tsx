import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { readMediaIdeas } from '@/db/repo/media';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/theme/use-theme';
import { Button } from '@/ui/button';
import { Card, Row } from '@/ui/surface';
import { Text } from '@/ui/text';

const EVENTS = ['media:changed'] as const;

export function MediaStrip() {
  const theme = useTheme();
  const router = useRouter();
  const { data } = useDbQuery((db) => readMediaIdeas(db, 6), { events: EVENTS });

  return (
    <Card>
      <Text variant="h2">Dutch in the wild</Text>
      {data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row>
            {data.map((item) => (
              <Card key={item.id} variant="flat" style={{ width: 225, gap: theme.space.sm }}>
                <Text variant="bodyStrong" numberOfLines={2}>{item.title}</Text>
                <Button size="medium" variant="secondary" title="View search" onPress={() => router.push({ pathname: '/media', params: { idea: String(item.id) } })} />
              </Card>
            ))}
          </Row>
        </ScrollView>
      ) : <Text tone="muted">Find a short clip tied to language you’ve practised.</Text>}
      <Button title="Listening ideas" variant="ghost" size="medium" onPress={() => router.push('/media')} />
    </Card>
  );
}
