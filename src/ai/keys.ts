/**
 * API key storage.
 *
 * The plaintext key lives only in the device keychain and in the local variable of
 * whichever provider call is in flight. It never enters a Zustand store, a React
 * state value, a prop, a log line or the database. UI code asks `hasKey()` and
 * `maskKey()` and is otherwise given no way to see it.
 */
import * as SecureStore from 'expo-secure-store';

import type { ProviderId } from '@/ai/types';

function storageKey(provider: ProviderId): string {
  return `ai_key_${provider}`;
}

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Available whenever the device is unlocked, which is the only time the app runs.
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
};

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(storageKey(provider), key.trim(), OPTIONS);
}

export async function getKey(provider: ProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(storageKey(provider), OPTIONS);
  } catch (error) {
    // A keychain read can fail after a device restore; treat it as "no key" so the
    // app offers to re-enter it rather than crashing on launch.
    console.warn(`[ai] could not read the stored ${provider} key`, error);
    return null;
  }
}

export async function hasKey(provider: ProviderId): Promise<boolean> {
  return (await getKey(provider)) !== null;
}

export async function deleteKey(provider: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(provider), OPTIONS);
}

/**
 * A safe-to-display fingerprint: enough to tell two keys apart, not enough to use.
 * Short keys are masked entirely rather than partially revealed.
 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '•'.repeat(Math.max(trimmed.length, 4));
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`;
}
