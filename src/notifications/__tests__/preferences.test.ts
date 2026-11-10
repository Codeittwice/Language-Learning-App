import { parseReminderTime, reminderTimeLabel } from '@/notifications/preferences';

it.each([
  ['19:30', 19, 30],
  ['0:05', 0, 5],
  [' 23:59 ', 23, 59],
])('accepts a valid 24-hour time %s', (time, hour, minute) => {
  expect(parseReminderTime(time)).toEqual({ hour, minute });
});

it.each(['24:00', '12:60', '19:3', '12.30', '', '-1:30'])('rejects an invalid time %s', (time) => {
  expect(parseReminderTime(time)).toBeNull();
});

it('formats an hour and minute with leading zeroes', () => {
  expect(reminderTimeLabel(7, 5)).toBe('07:05');
});
