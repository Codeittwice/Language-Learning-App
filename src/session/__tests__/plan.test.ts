import { stagesFor } from '@/session/plan';

it.each(['standard', 'short'] as const)('includes the full practice sequence for %s sessions', (mode) => {
  expect(stagesFor(mode)).toEqual([
    'recall', 'listening', 'writing', 'topic_conversation', 'casual_conversation', 'wrap_up',
  ]);
});

it('keeps the notification quick practice plan short', () => {
  expect(stagesFor('quick')).toEqual(['recall', 'casual_conversation', 'wrap_up']);
});
