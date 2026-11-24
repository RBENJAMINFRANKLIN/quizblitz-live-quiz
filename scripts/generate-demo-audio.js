// Generates the demo audio excerpts in public/audio/ (original synthesised
// melodies written for this project: no third-party music, no rights issues).
// Usage: node scripts/generate-demo-audio.js
// Output: 8-bit mono WAV at 11 025 Hz (small files, fine for a demo).

const fs = require('fs');
const path = require('path');

const RATE = 11025;
const OUT = path.join(__dirname, '..', 'public', 'audio');

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note -> Hz

// Each tune: [bpm, waveform, melody (MIDI notes, 0 = rest), bass notes].
const TUNES = {
  'demo-arpeges.wav': [120, 'square', [60, 64, 67, 72, 67, 64, 60, 64, 65, 69, 72, 77, 72, 69, 65, 69, 67, 71, 74, 79, 74, 71, 67, 71, 60, 64, 67, 72, 76, 72, 67, 64], [48, 53, 55, 48]],
  'demo-valse.wav': [150, 'triangle', [67, 0, 71, 74, 0, 71, 72, 0, 69, 71, 0, 67, 66, 0, 69, 72, 0, 69, 67, 0, 64, 62, 0, 0], [43, 50, 48, 50]],
  'demo-disco.wav': [124, 'saw', [72, 72, 75, 72, 70, 67, 70, 72, 0, 72, 75, 77, 75, 72, 70, 67, 65, 65, 67, 70, 72, 70, 67, 65, 63, 65, 67, 0, 67, 70, 72, 0], [36, 36, 39, 41]],
};

function wave(type, phase) {
  const p = phase % 1;
  if (type === 'square') return p < 0.5 ? 1 : -1;
  if (type === 'triangle') return 4 * Math.abs(p - 0.5) - 1;
  if (type === 'saw') return 2 * p - 1;
  return Math.sin(2 * Math.PI * p);
}

function render([bpm, type, melody, bass], seconds = 40) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const step = 60 / bpm / 2; // eighth notes
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const k = Math.floor(t / step);
    const inNote = (t % step) / step;
    const env = Math.min(1, inNote * 20) * (1 - inNote * 0.7);
    const m = melody[k % melody.length];
    let v = m ? 0.32 * env * wave(type, t * NOTE(m)) : 0;
    const b = bass[Math.floor(t / (step * 8)) % bass.length];
    v += 0.22 * wave('triangle', t * NOTE(b));
    if (k % 2 === 0 && inNote < 0.08) v += 0.25 * (Math.random() * 2 - 1) * (1 - inNote / 0.08); // hi-hat
    samples[i] = Math.max(-1, Math.min(1, v));
  }
  return samples;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length);
  samples.forEach((s, i) => { data[i] = Math.round((s * 0.9 + 1) * 127.5); });
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, tune] of Object.entries(TUNES)) {
  fs.writeFileSync(path.join(OUT, name), toWav(render(tune)));
  console.log(`public/audio/${name}`);
}
