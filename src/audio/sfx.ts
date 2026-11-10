/**
 * Interface sound.
 *
 * Sound is the fastest feedback channel there is -- it lands before the eye has
 * finished moving -- which makes it the cheapest way to make a drill feel responsive.
 * It is also the fastest way to make an app insufferable, so three rules hold here:
 *
 * 1. **Every sound is optional and off-switchable**, and the switch is honoured
 *    synchronously by an in-memory flag rather than a database read per tap.
 * 2. **We never override the silent switch.** `expo-audio` without an explicit audio
 *    mode respects it, so a phone on silent stays silent. Playing anyway is a thing
 *    only alarm clocks are allowed to do.
 * 3. **Nothing here can throw into a press handler.** Audio is best-effort; a missing
 *    codec or a device in a strange route must cost a sound, not an answer.
 *
 * The files are synthesised by `scripts/generate-sfx.mjs`, so the whole set shares one
 * instrument and can be retuned in one place.
 */
import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

import comboSfx from '../../assets/sfx/combo.wav';
import correctSfx from '../../assets/sfx/correct.wav';
import goalSfx from '../../assets/sfx/goal.wav';
import hintSfx from '../../assets/sfx/hint.wav';
import levelupSfx from '../../assets/sfx/levelup.wav';
import missedSfx from '../../assets/sfx/missed.wav';
import roundSfx from '../../assets/sfx/round.wav';
import tapSfx from '../../assets/sfx/tap.wav';

export type SoundName =
  /** Under a button press. Barely audible by design. */
  | 'tap'
  /** Answered correctly with no help. */
  | 'correct'
  /** Correct, but a hint was taken. Approving, not triumphant. */
  | 'hint'
  /** Missed. A soft falling third, never a buzzer. */
  | 'missed'
  /** A combo bonus landed. */
  | 'combo'
  /** A round finished. */
  | 'round'
  /** The daily goal was met -- the streak is safe. */
  | 'goal'
  /** A level was gained. The only fanfare in the app. */
  | 'levelup';

const SOURCES: Record<SoundName, AudioSource> = {
  tap: tapSfx,
  correct: correctSfx,
  hint: hintSfx,
  missed: missedSfx,
  combo: comboSfx,
  round: roundSfx,
  goal: goalSfx,
  levelup: levelupSfx,
};

/**
 * Per-sound trim.
 *
 * The files are normalised to the same peak, which is right for consistency and wrong
 * for mixing: a sound you hear forty times a round must be far quieter than one you
 * hear twice a month, or the frequent one becomes the only one you notice.
 */
const VOLUME: Record<SoundName, number> = {
  tap: 0.3,
  correct: 0.5,
  hint: 0.4,
  missed: 0.4,
  combo: 0.6,
  round: 0.6,
  goal: 0.65,
  levelup: 0.75,
};

/**
 * Players are created on first use and kept for the life of the process.
 *
 * Eight short sounds is a few hundred kilobytes of decoded audio, and creating a
 * player per press would put file I/O on the tap path -- the exact latency that makes
 * a sound feel disconnected from the thing that caused it.
 */
const players = new Map<SoundName, AudioPlayer>();

let enabled = true;

/** Mirror of the stored preference. Set once at startup and on every change. */
export function setSoundEnabled(next: boolean): void {
  enabled = next;
  if (!next) releaseSounds();
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function playerFor(name: SoundName): AudioPlayer | null {
  const existing = players.get(name);
  if (existing) return existing;
  try {
    const player = createAudioPlayer(SOURCES[name]);
    player.volume = VOLUME[name];
    players.set(name, player);
    return player;
  } catch {
    return null;
  }
}

/**
 * Play a sound, if sound is on.
 *
 * Fire-and-forget and deliberately not async: a caller must never be able to `await`
 * a sound and so couple an answer being recorded to audio being ready.
 */
export function play(name: SoundName): void {
  if (!enabled) return;
  const player = playerFor(name);
  if (!player) return;
  try {
    // Rewind first: a player parked at the end of its clip will not restart on
    // `play()`, which is how a sound silently stops working after the first tap.
    void Promise.resolve(player.seekTo(0)).catch(() => undefined);
    player.play();
  } catch {
    // Best effort. A device in a strange audio route is not an error worth surfacing.
  }
}

/**
 * The sound for a recall outcome, so callers do not each re-derive the mapping.
 * A combo bonus overrides the plain correct sound -- the bonus is the news.
 */
export function playRecallOutcome(outcome: {
  independent: boolean;
  prompted: boolean;
  comboBonus: boolean;
}): void {
  if (outcome.independent) play(outcome.comboBonus ? 'combo' : 'correct');
  else if (outcome.prompted) play('hint');
  else play('missed');
}

/** Drop every player. Called when sound is switched off, and by tests. */
export function releaseSounds(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Already gone; nothing to do.
    }
  }
  players.clear();
}
