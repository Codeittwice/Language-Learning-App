/**
 * Dutch text-to-speech, using the device's own voices.
 *
 * Free, offline and instant, which is why it is the whole of the audio story for now.
 * The catch is that a Dutch voice is not installed by default on every Android phone,
 * and when it is missing the system silently falls back to the default locale -- so
 * `nl-NL` text gets read aloud with English pronunciation, which is worse than
 * silence for a listening exercise. `checkDutchVoice` detects that so the UI can say
 * what to install rather than quietly teaching the wrong sounds.
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

export const DUTCH_LANGUAGE = 'nl-NL';

export type VoiceAvailability = {
  available: boolean;
  /** The identifier we will pass to `speak`, when we found a specific one. */
  voiceId: string | null;
  /** How many Dutch voices the device reports. */
  count: number;
  /** Shown to the learner when none is installed. */
  instructions: string | null;
};

const MISSING_VOICE_HELP =
  Platform.OS === 'android'
    ? 'No Dutch voice is installed. Open Android Settings, search for "Text-to-speech output", then install the Dutch language in your speech engine.'
    : 'No Dutch voice is installed. Open Settings, then Accessibility, Spoken Content, Voices, and add Dutch.';

let cached: VoiceAvailability | null = null;

/**
 * Look for an installed Dutch voice. Cached, because enumerating voices is slow
 * enough to be noticeable if done on every button press.
 */
export async function checkDutchVoice(force = false): Promise<VoiceAvailability> {
  if (cached && !force) return cached;

  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const dutch = voices.filter((voice) => voice.language?.toLowerCase().startsWith('nl'));

    // Prefer Netherlands Dutch over Flemish, which the spec rules out.
    const preferred =
      dutch.find((voice) => voice.language?.toLowerCase() === 'nl-nl') ?? dutch[0] ?? null;

    cached = {
      available: dutch.length > 0,
      voiceId: preferred?.identifier ?? null,
      count: dutch.length,
      instructions: dutch.length > 0 ? null : MISSING_VOICE_HELP,
    };
  } catch (error) {
    // Some devices refuse to enumerate. Assume speech works and let it try: a voice
    // that turns out to be wrong is better than disabling the feature on a guess.
    console.warn('[tts] could not list voices', error);
    cached = { available: true, voiceId: null, count: 0, instructions: null };
  }

  return cached;
}

export type SpeakOptions = {
  /** 1 is normal. The Slower control uses 0.6. */
  rate?: number;
  onDone?: () => void;
  onError?: () => void;
};

/**
 * Android's TTS engine truncates very long input, so sentences are queued
 * individually rather than sent as one block.
 */
const MAX_CHUNK = 600;

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > MAX_CHUNK) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/** Speak Dutch text. Any previous utterance is cancelled first. */
export async function speakDutch(text: string, options: SpeakOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const voice = await checkDutchVoice();
  await stopSpeaking();

  const chunks = chunkText(trimmed);
  chunks.forEach((chunk, index) => {
    const isLast = index === chunks.length - 1;
    Speech.speak(chunk, {
      language: DUTCH_LANGUAGE,
      voice: voice.voiceId ?? undefined,
      rate: options.rate ?? 1,
      onDone: isLast ? options.onDone : undefined,
      onError: options.onError,
      onStopped: isLast ? options.onDone : undefined,
    });
  });
}

/**
 * Stop immediately.
 *
 * Call this in a screen's cleanup: without it the phone carries on talking over the
 * next screen, which reads as a bug even though nothing failed.
 */
export async function stopSpeaking(): Promise<void> {
  try {
    if (await Speech.isSpeakingAsync()) await Speech.stop();
  } catch {
    // Stopping something that is not speaking is not an error.
  }
}

export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}
