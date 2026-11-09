import { ComingSoon } from '@/ui/coming-soon';

export default function ProgressScreen() {
  return (
    <ComingSoon
      icon="stats-chart-outline"
      title="Progress"
      summary="What you can actually produce, not a fluency percentage."
      bullets={[
        'Completed sessions, and where you are in the seven-day rotation.',
        'How many phrases you produce without a hint, versus with one.',
        'Which mistakes keep coming back, by category.',
        'Words you own, measured by how long you are predicted to remember them.',
      ]}
    />
  );
}
