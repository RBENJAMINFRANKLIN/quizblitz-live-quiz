// Original music and sound effects, synthesised live with the Web Audio API.
// No audio files: everything (lobby loop, question music that speeds up near the
// buzzer, ticks, gong, correct/wrong jingles, drumroll, fanfare, applause) is
// generated in the browser. Kahoot's own recordings are copyrighted, so this
// recreates the *feel* with original tunes.

const MUTE_KEY = 'quizblitz.muted';
let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage unavailable */ }

/** Must be called from a user gesture (click/tap) before any sound can play. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

/** A 🔊/🔇 toggle button wired to the shared mute setting. */
export function muteButton(extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mute ${extraClass}`.trim();
  const paint = () => { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off'); b.title = b.getAttribute('aria-label'); };
  b.addEventListener('click', () => { unlock(); setMuted(!muted); paint(); });
  paint();
  return b;
}

const ready = () => ctx && ctx.state === 'running';
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// ---------------------------------------------------------------- instruments

function tone(freq, t, dur, { type = 'square', gain = 0.15, attack = 0.005, release = 0.06, bus = sfxBus, filter = null, glideTo = null } = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, t + dur);
  let node = osc.connect(g);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filter;
    node = node.connect(f);
  }
  node.connect(bus);
  osc.start(t); osc.stop(t + dur + 0.02);
}

let noiseBuffer = null;
function noise(t, dur, { gain = 0.2, type = 'highpass', freq = 6000, q = 1, bus = sfxBus, sweepTo = null } = {}) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

const kick = (t, bus) => tone(150, t, 0.18, { type: 'sine', gain: 0.5, glideTo: 40, release: 0.1, bus });
const hat = (t, bus, g = 0.05) => noise(t, 0.04, { gain: g, freq: 8000, bus });
const clap = (t, bus) => noise(t, 0.12, { gain: 0.18, type: 'bandpass', freq: 1500, q: 0.8, bus });

// ---------------------------------------------------------------- sequencer

let loop = null;

function startLoop(bpm, pattern) {
  stopMusic();
  if (!ready()) return;
  const state = { bpm, step: 0, next: ctx.currentTime + 0.05, timer: null, pattern };
  const tick = () => {
    while (state.next < ctx.currentTime + 0.12) {
      state.pattern(state.step, state.next, state);
      state.next += 60 / state.bpm / 4; // sixteenth notes
      state.step++;
    }
  };
  state.timer = setInterval(tick, 25);
  tick();
  loop = state;
}

export function stopMusic() {
  if (loop) { clearInterval(loop.timer); loop = null; }
}

const chord = (root, minor) => [root, root + (minor ? 3 : 4), root + 7];

// Upbeat four-chord loop for the lobby.
const LOBBY_PROG = [[60, false], [57, true], [53, false], [55, false]]; // C Am F G
export function lobbyMusic() {
  startLoop(118, (step, t) => {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const [root, minor] = LOBBY_PROG[bar];
    const notes = chord(root, minor);
    if (s % 4 === 0) kick(t, musicBus);
    if (s % 8 === 4) clap(t, musicBus);
    if (s % 2 === 0) hat(t, musicBus, s % 4 === 2 ? 0.06 : 0.03);
    if (s % 2 === 0) tone(midi(root - 24 + (s % 8 === 6 ? 7 : 0)), t, 0.18, { type: 'sawtooth', gain: 0.12, filter: 700, bus: musicBus });
    if (s === 2 || s === 6 || s === 10 || s === 14) notes.forEach((n) => tone(midi(n), t, 0.12, { type: 'triangle', gain: 0.05, bus: musicBus }));
    const arp = [0, 1, 2, 1, 2, 3, 2, 1][s % 8];
    tone(midi(notes[arp % 3] + 12 * (arp === 3 ? 1 : 0) + 12), t, 0.09, { type: 'square', gain: 0.035, filter: 3000, bus: musicBus });
  });
}

// Tense minor ostinato for an open question; speeds up as time runs out.
const Q_BASS = [45, 45, 48, 45, 50, 45, 48, 52]; // A minor figure
export function questionMusic() {
  startLoop(124, (step, t) => {
    const s = step % 16;
    if (s % 4 === 0) kick(t, musicBus);
    hat(t, musicBus, s % 2 ? 0.02 : 0.045);
    if (s % 2 === 0) tone(midi(Q_BASS[(step / 2) % 8 | 0]), t, 0.16, { type: 'sawtooth', gain: 0.13, filter: 900, bus: musicBus });
    if (s === 0 || s === 3 || s === 6 || s === 10) tone(midi(69 + [0, 3, 7, 5][s % 4]), t, 0.1, { type: 'square', gain: 0.03, filter: 2500, bus: musicBus });
  });
}

/** Called each second while a question is open; the final five seconds tick and speed up. */
export function questionSecond(secondsLeft) {
  if (!ready()) return;
  if (loop) loop.bpm = secondsLeft <= 5 ? 124 + (6 - secondsLeft) * 10 : 124;
  if (secondsLeft <= 5 && secondsLeft > 0) tick(secondsLeft);
}

// ---------------------------------------------------------------- effects

export function tick(secondsLeft = 5) {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(secondsLeft <= 3 ? 1400 : 1000, t, 0.05, { type: 'square', gain: 0.12 });
}

export function getReadyBeep(final = false) {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(final ? 1320 : 880, t, final ? 0.35 : 0.15, { type: 'triangle', gain: 0.25 });
}

export function join() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(520, t, 0.12, { type: 'sine', gain: 0.25, glideTo: 1040 });
  tone(1560, t + 0.08, 0.08, { type: 'triangle', gain: 0.1 });
}

export function timeUp() {
  stopMusic();
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(110, t, 1.6, { type: 'sine', gain: 0.45, release: 1.4 });
  tone(165, t, 1.4, { type: 'triangle', gain: 0.18, release: 1.2 });
  noise(t, 1.2, { gain: 0.25, type: 'bandpass', freq: 400, q: 0.6 });
}

export function reveal() {
  if (!ready()) return;
  const t = ctx.currentTime;
  noise(t, 0.5, { gain: 0.25, type: 'bandpass', freq: 400, q: 1.2, sweepTo: 5000 });
  [72, 76, 79].forEach((n, i) => tone(midi(n), t + 0.35 + i * 0.07, 0.25, { type: 'triangle', gain: 0.15 }));
}

export function correct() {
  if (!ready()) return;
  const t = ctx.currentTime;
  [72, 76, 79, 84].forEach((n, i) => tone(midi(n), t + i * 0.09, 0.22, { type: 'square', gain: 0.1, filter: 4000 }));
}

export function wrong() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(220, t, 0.25, { type: 'sawtooth', gain: 0.12, filter: 1200, glideTo: 180 });
  tone(165, t + 0.22, 0.4, { type: 'sawtooth', gain: 0.12, filter: 1000, glideTo: 110 });
}

export function neutral() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(midi(76), t, 0.15, { type: 'triangle', gain: 0.15 });
  tone(midi(81), t + 0.12, 0.25, { type: 'triangle', gain: 0.15 });
}

export function scoreboard() {
  stopMusic();
  if (!ready()) return;
  const t = ctx.currentTime;
  kick(t, sfxBus);
  [[60, 64, 67], [65, 69, 72]].forEach((c, i) => c.forEach((n) => tone(midi(n), t + i * 0.25, 0.3, { type: 'sawtooth', gain: 0.06, filter: 2500 })));
}

export function drumroll(seconds = 1.8) {
  stopMusic();
  if (!ready()) return;
  const t0 = ctx.currentTime;
  for (let x = 0; x < seconds; x += 0.045) {
    noise(t0 + x, 0.06, { gain: 0.06 + 0.2 * (x / seconds), type: 'bandpass', freq: 2200, q: 0.7 });
  }
}

export function fanfare() {
  if (!ready()) return;
  const t = ctx.currentTime;
  noise(t, 2.5, { gain: 0.3, freq: 5000 }); // cymbal
  kick(t, sfxBus);
  const brass = (notes, at, dur) => notes.forEach((n) => tone(midi(n), t + at, dur, { type: 'sawtooth', gain: 0.07, filter: 3000, attack: 0.03 }));
  brass([60, 64, 67, 72], 0, 0.3);
  brass([60, 64, 67, 72], 0.32, 0.15);
  brass([65, 69, 72, 77], 0.5, 0.3);
  brass([67, 71, 74, 79], 0.85, 0.3);
  brass([72, 76, 79, 84], 1.2, 1.2);
  applause(t + 1.4, 3.5);
}

function applause(start, seconds) {
  for (let x = 0; x < seconds; x += 0.02) {
    if (Math.random() < 0.6) {
      noise(start + x + Math.random() * 0.02, 0.05, { gain: 0.04 * (1 - x / seconds) + 0.01, type: 'bandpass', freq: 1500 + Math.random() * 2500, q: 2 });
    }
  }
}
