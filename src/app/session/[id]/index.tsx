/**
 * The resume router.
 *
 * A pure redirect: it reads the stage that is actually next from the database and
 * replaces itself with it. That single indirection is what makes resuming behave
 * identically whether it came from the Today button, a notification tap, or a cold
 * start after the app was killed mid-stage.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { checkpointConflict, resumeStage, sessionById } from '@/session/engine';
import { useTheme } from '@/theme/use-theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import type { SessionStage } from '@/types';

/** Which file handles each stage. */
const ROUTE_FOR: Record<SessionStage, string> = {
  recall: 'recall',
  listening: 'listening',
  writing: 'writing',
  topic_conversation: 'roleplay',
  casual_conversation: 'casual',
  wrap_up: 'wrapup',
};

export default function SessionResume() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ stage: SessionStage; expected: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (cancelled) return;

      if (!session) {
        setProblem('That session no longer exists.');
        return;
      }
      if (session.status !== 'in_progress') {
        router.replace(`/session/${session.id}/complete`);
        return;
      }

      const stage = await resumeStage(db, session);
      if (cancelled) return;

      // The spec asks for uncertainty to be stated rather than guessed at.
      const check = await checkpointConflict(db, session);
      if (!cancelled && check.conflicted && check.checkpointStage) {
        setConflict({ stage: check.checkpointStage, expected: stage });
        return;
      }

      router.replace(`/session/${session.id}/${ROUTE_FOR[stage]}`);
    })().catch(() => {
      if (!cancelled) setProblem('Could not read the saved session.');
    });

    return () => {
      cancelled = true;
    };
  }, [db, id, router]);

  if (problem) {
    return (
      <Centered>
        <Text variant="h3" center>
          {problem}
        </Text>
        <Button title="Back to Today" variant="secondary" onPress={() => router.replace('/')} />
      </Centered>
    );
  }

  if (conflict) {
    return (
      <Centered>
        <Text variant="h3" center>
          Not sure where you left off
        </Text>
        <Text variant="small" tone="muted" center>
          The saved checkpoint points at the {conflict.stage.replace(/_/g, ' ')} stage, while
          the stage records say {conflict.expected.replace(/_/g, ' ')}. Rather than guess, pick
          one.
        </Text>
        <Button
          title={`Continue at ${conflict.expected.replace(/_/g, ' ')}`}
          onPress={() => router.replace(`/session/${id}/${ROUTE_FOR[conflict.expected as SessionStage]}`)}
        />
        <Button
          title={`Go back to ${conflict.stage.replace(/_/g, ' ')}`}
          variant="secondary"
          onPress={() => router.replace(`/session/${id}/${ROUTE_FOR[conflict.stage]}`)}
        />
      </Centered>
    );
  }

  return (
    <Centered>
      <ActivityIndicator color={theme.colors.primary} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.space.xl,
        gap: theme.space.lg,
      }}
    >
      {children}
    </View>
  );
}
