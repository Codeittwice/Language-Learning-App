/**
 * Generates the UI sound effects in `assets/sfx/`.
 *
 * Synthesised rather than licensed, for three reasons: the set stays coherent because
 * every sound comes from the same instrument, the files are ~20 KB instead of a
 * megabyte of stock samples, and the whole palette is tunable by editing one table
 * instead of re-sourcing audio.
 *
 * The instrument is a struck bell: a sine fundamental with two quiet harmonics and an
 * exponential decay. It reads as "interface" rather than "game", which is what we
 * want at seven in the morning on day ninety.
 *
 * Run with:  node scripts/generate-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');

/** Equal-temperament note names to frequencies, for the octaves we use. */
const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

/**
 * One struck note.
 *
 * `attack` is deliberately non-zero: starting a sine at full amplitude puts a step
 * discontinuity at sample zero, which every speaker reproduces as a click.
 */
function strike(buffer, { at, freq, decay, gain = 1, attack = 0.006, harmonics = [1, 0.26, 0.09] }) {
  const start = Math.floor(at * SAMPLE_RATE);
  // Four time constants is inaudible; past that we are only burning file size.
  const length = Math.floor(decay * 4 * SAMPLE_RATE);

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= buffer.length) break;

    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t / decay) * Math.min(1, t / attack);

    let sample = 0;
    for (let h = 0; h < harmonics.length; h += 1) {
      sample += harmonics[h] * Math.sin(2 * Math.PI * freq * (h + 1) * t);
    }
    buffer[index] += sample * envelope * gain;
  }
}

/** Peak-normalise, then fade the tail so the file cannot end on a discontinuity. */
function finish(buffer, peak = 0.82) {
  let max = 0;
  for (const sample of buffer) max = Math.max(max, Math.abs(sample));
  const scale = max > 0 ? peak / max : 1;

  const fade = Math.min(buffer.length, Math.floor(0.012 * SAMPLE_RATE));
  for (let i = 0; i < buffer.length; i += 1) {
    const tail = i >= buffer.length - fade ? (buffer.length - i) / fade : 1;
    buffer[i] *= scale * tail;
  }
  return buffer;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before quantising: a value past ±1 wraps around into a loud crackle.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32_767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

function render(seconds, notes) {
  const buffer = new Float64Array(Math.ceil(seconds * SAMPLE_RATE));
  for (const note of notes) strike(buffer, note);
  return finish(buffer);
}

/**
 * The palette.
 *
 * Rising intervals for progress, falling for a miss, and a major triad for the two
 * moments worth celebrating. `missed` is a gentle minor third rather than a buzzer:
 * the whole app is built on it being safe to get something wrong.
 */
const SOUNDS = {
  // A soft click under a button press. Barely there by design.
  tap: render(0.07, [{ at: 0, freq: 1_320, decay: 0.012, gain: 0.5, harmonics: [1, 0.1] }]),

  // Correct, unprompted: a clean rising fifth.
  correct: render(0.3, [
    { at: 0, freq: NOTE.E5, decay: 0.1 },
    { at: 0.07, freq: NOTE.B5, decay: 0.12, gain: 0.9 },
  ]),

  // Correct, but a hint was taken: one note, no resolution. Approving, not triumphant.
  hint: render(0.24, [{ at: 0, freq: NOTE.A4, decay: 0.09, gain: 0.85 }]),

  // Missed: a falling major third, quiet. Never a buzzer.
  missed: render(0.34, [
    { at: 0, freq: NOTE.F4, decay: 0.1, gain: 0.7 },
    { at: 0.09, freq: NOTE.C4, decay: 0.12, gain: 0.6 },
  ]),

  // The combo bonus landing: three steps up, brighter than `correct`.
  combo: render(0.46, [
    { at: 0, freq: NOTE.G5, decay: 0.09 },
    { at: 0.065, freq: NOTE.B5, decay: 0.1 },
    { at: 0.13, freq: NOTE.D6, decay: 0.14, gain: 0.95 },
  ]),

  // Round finished: a major triad, arpeggiated fast enough to read as one chord.
  round: render(0.6, [
    { at: 0, freq: NOTE.C5, decay: 0.22 },
    { at: 0.03, freq: NOTE.E5, decay: 0.22, gain: 0.8 },
    { at: 0.06, freq: NOTE.G5, decay: 0.26, gain: 0.7 },
  ]),

  // The daily goal met: the same chord, warmer and slower, with the octave on top.
  goal: render(0.95, [
    { at: 0, freq: NOTE.C5, decay: 0.4 },
    { at: 0.04, freq: NOTE.G5, decay: 0.4, gain: 0.75 },
    { at: 0.1, freq: NOTE.E5, decay: 0.45, gain: 0.7 },
    { at: 0.18, freq: NOTE.C6, decay: 0.5, gain: 0.6 },
  ]),

  // Level up: the only fanfare in the app. Four notes, with a pad underneath.
  levelup: render(1.35, [
    { at: 0, freq: NOTE.C5, decay: 0.6, gain: 0.45, harmonics: [1, 0.12] },
    { at: 0, freq: NOTE.C5, decay: 0.1 },
    { at: 0.085, freq: NOTE.E5, decay: 0.12 },
    { at: 0.17, freq: NOTE.G5, decay: 0.14 },
    { at: 0.255, freq: NOTE.C6, decay: 0.45, gain: 0.95 },
    { at: 0.255, freq: NOTE.G6, decay: 0.3, gain: 0.3 },
  ]),
};

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, samples] of Object.entries(SOUNDS)) {
  const wav = toWav(samples);
  writeFileSync(join(OUT_DIR, `${name}.wav`), wav);
  console.log(`${name}.wav  ${(wav.length / 1024).toFixed(1)} KB`);
}

console.log(`\n${Object.keys(SOUNDS).length} sounds written to assets/sfx/`);
