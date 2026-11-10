import { parseReminderTime, reminderTimeLabel } from '@/notifications/preferences';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Row } from '@/ui/surface';

export function ReminderTimeInput({ value, disabled, onChange }: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const time = parseReminderTime(value);
  function step(delta: number) {
    if (!time) return;
    const minutes = (time.hour * 60 + time.minute + delta + 1440) % 1440;
    onChange(reminderTimeLabel(Math.floor(minutes / 60), minutes % 60));
  }

  return (
    <>
      <Field label="Reminder time (24-hour clock)" placeholder="19:30" value={value}
        maxLength={5} editable={!disabled} onChangeText={onChange} />
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="−15 min" size="small" fullWidth={false} variant="secondary"
          accessibilityLabel="Move reminder 15 minutes earlier" disabled={disabled || !time} onPress={() => step(-15)} />
        <Button title="+15 min" size="small" fullWidth={false} variant="secondary"
          accessibilityLabel="Move reminder 15 minutes later" disabled={disabled || !time} onPress={() => step(15)} />
      </Row>
    </>
  );
}
