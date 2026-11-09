/**
 * Notification setup: the foreground handler, Android channels, and permissions.
 *
 * The ordering here is the whole point of this module existing. On Android 13+ the
 * OS permission dialog does not appear at all until a channel exists, so calling
 * `requestPermissionsAsync` first returns a silent `denied` -- a bug that reproduces
 * on a real phone and nowhere else. `requestReminderPermission` creates the channels
 * first, every time, so the wrong order is not reachable from outside this file.
 */
import * as Notifications from 'expo-notifications';
import {
  AndroidImportance,
  AndroidNotificationVisibility,
  IosAuthorizationStatus,
} from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Module scope on purpose: this must be registered before any notification can be
 * delivered, not inside a component that may not have mounted yet.
 *
 * All four booleans are set explicitly. The old `shouldShowAlert` is deprecated in
 * favour of `shouldShowBanner` / `shouldShowList`, and relying on it means no
 * foreground banner and no error explaining why.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    // Android badge support is OEM roulette, and a stuck badge reads as a bug.
    shouldSetBadge: false,
  }),
});

export const DAILY_CHANNEL_ID = 'daily-reminder';
export const RESCUE_CHANNEL_ID = 'streak-rescue';

/**
 * Create the channels. Two rather than one, so the evening nudge can be muted in
 * Android settings without losing the daily reminder.
 *
 * A channel's importance and sound are fixed once created -- Android only allows the
 * name and description to change afterwards -- so these values are effectively
 * permanent for an install.
 */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(DAILY_CHANNEL_ID, {
    name: 'Daily practice reminder',
    description: 'One reminder a day, at the time you choose.',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#DD6214',
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync(RESCUE_CHANNEL_ID, {
    name: 'Streak rescue',
    description: 'A late nudge only when a long streak is about to break.',
    importance: AndroidImportance.DEFAULT,
    lightColor: '#F59E0B',
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
  });
}

export type PermissionState = {
  granted: boolean;
  /** True when we can still show the OS prompt; false once it has been denied. */
  canAskAgain: boolean;
};

export async function getPermissionState(): Promise<PermissionState> {
  const settings = await Notifications.getPermissionsAsync();
  const granted =
    settings.granted ||
    settings.ios?.status === IosAuthorizationStatus.PROVISIONAL;
  return { granted, canAskAgain: settings.canAskAgain ?? true };
}

/**
 * Ask for permission to post notifications.
 *
 * Channels are created first, unconditionally -- see the module comment.
 */
export async function requestReminderPermission(): Promise<boolean> {
  await ensureAndroidChannels();

  const existing = await getPermissionState();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return (
    result.granted ||
    result.ios?.status === IosAuthorizationStatus.PROVISIONAL
  );
}

/** How many notifications we currently have queued with the OS. */
export async function pendingCount(): Promise<number> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.length;
}

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function cancelById(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Cancelling something already delivered or never scheduled is not an error.
  }
}

/** The next time anything is due to fire, for the reminder-health card. */
export async function nextScheduledAt(): Promise<Date | null> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  let earliest: number | null = null;

  for (const request of scheduled) {
    const trigger = request.trigger as { type?: string; value?: number } | null;
    // DATE triggers report their instant as `value`; that is all we schedule.
    if (trigger && typeof trigger.value === 'number') {
      earliest = earliest === null ? trigger.value : Math.min(earliest, trigger.value);
    }
  }
  return earliest === null ? null : new Date(earliest);
}
