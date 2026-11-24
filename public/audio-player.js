// Excerpt player used on the host screen and in the admin preview.
// One HTMLAudioElement plays the current excerpt; a second one preloads the
// next track. Plays from `startTime` for `duration` seconds, with optional
// fade-in / fade-out, pause / resume / restart and a master volume.
//
// Browsers block audio until the user interacts with the page: call unlock()
// from a click handler (e.g. the host's "Start" button) before the first play.

const VOLUME_KEY = 'blindtest.volume';

function loadVolume() {
  try { const v = Number(localStorage.getItem(VOLUME_KEY)); return v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.9; } catch { return 0.9; }
}

export class ExcerptPlayer {
  constructor({ fadeIn = 0.6, fadeOut = 1.2, onState = () => {}, onError = () => {}, onProgress = () => {} } = {}) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.next = new Audio();
    this.next.preload = 'auto';
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
    this.master = loadVolume();
    this.onState = onState;
    this.onError = onError;
    this.onProgress = onProgress;
    this.excerpt = null; // { url, start, duration }
    this.state = 'idle'; // idle | loading | playing | paused | ended | error | blocked
    this.unlocked = false;
    this.raf = 0;
    // Only errors from the element currently playing count (the other one may be preloading).
    for (const el of [this.audio, this.next]) el.addEventListener('error', (e) => { if (e.target === this.audio) this.fail(); });
  }

  setState(s) { this.state = s; this.onState(s); }

  fail() {
    if (!this.excerpt) return;
    const code = this.audio.error ? this.audio.error.code : 0;
    const why = { 1: 'lecture interrompue', 2: 'erreur réseau', 3: 'fichier illisible', 4: 'format non pris en charge ou fichier introuvable' }[code] || 'erreur inconnue';
    this.stopLoop();
    this.setState('error');
    this.onError(`Audio indisponible (${why})`);
  }

  /** Must be called from a user gesture. Plays a silent, muted sound to satisfy autoplay rules. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const a = this.audio;
      a.muted = true;
      const p = a.play();
      if (p && p.catch) p.catch(() => {}).finally(() => { a.pause(); a.muted = false; });
      else { a.pause(); a.muted = false; }
    } catch { /* ignore */ }
  }

  setVolume(v) {
    this.master = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME_KEY, String(this.master)); } catch { /* ignore */ }
    if (this.state === 'playing') this.applyVolume();
  }

  /** Preloads the next excerpt so it starts instantly. */
  preload(url, start = 0) {
    if (!url || this.next.dataset.src === url) return;
    this.next.dataset.src = url;
    this.next.src = url;
    this.next.load();
    this.next.addEventListener('loadedmetadata', () => { try { this.next.currentTime = start; } catch { /* ignore */ } }, { once: true });
  }

  /**
   * Starts an excerpt. `offset` (seconds already elapsed) lets a refreshed host page
   * resume in sync with the server's timer.
   */
  async play(url, start = 0, duration = 20, offset = 0) {
    this.stopLoop();
    this.excerpt = { url, start: Number(start) || 0, duration: Number(duration) || 20 };
    const a = this.audio;
    a.pause();
    if (this.next.dataset.src === url) {
      // Swap in the preloaded element.
      [this.audio, this.next] = [this.next, this.audio];
      this.next.removeAttribute('src');
      delete this.next.dataset.src;
    } else if (a.dataset.src !== url) {
      a.dataset.src = url;
      a.src = url;
    }
    this.setState('loading');
    await this.waitForMetadata();
    if (this.state === 'error' || this.excerpt.url !== url) return;
    const pos = Math.min(this.excerpt.start + Math.max(0, offset), this.excerpt.start + this.excerpt.duration);
    try { this.audio.currentTime = pos; } catch { /* some servers ignore seeking before data is ready */ }
    await this.startPlayback();
  }

  waitForMetadata() {
    const a = this.audio;
    if (a.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { a.removeEventListener('loadedmetadata', done); a.removeEventListener('error', done); clearTimeout(t); resolve(); };
      const t = setTimeout(done, 8000);
      a.addEventListener('loadedmetadata', done);
      a.addEventListener('error', done);
      a.load();
    });
  }

  async startPlayback() {
    this.applyVolume();
    try {
      await this.audio.play();
      this.setState('playing');
      this.loop();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') { this.setState('blocked'); this.onError('Cliquez sur la page pour autoriser le son, puis « Relancer l’extrait ».'); }
      else this.fail();
    }
  }

  get elapsed() {
    if (!this.excerpt) return 0;
    return Math.max(0, this.audio.currentTime - this.excerpt.start);
  }

  applyVolume() {
    if (!this.excerpt) return;
    const t = this.elapsed;
    const left = this.excerpt.duration - t;
    let g = 1;
    if (this.fadeIn > 0 && t < this.fadeIn) g = Math.min(g, t / this.fadeIn);
    if (this.fadeOut > 0 && left < this.fadeOut) g = Math.min(g, Math.max(0, left / this.fadeOut));
    this.audio.volume = Math.max(0, Math.min(1, g * this.master));
  }

  loop() {
    this.stopLoop();
    const tick = () => {
      if (this.state !== 'playing' || !this.excerpt) return;
      this.applyVolume();
      const t = this.elapsed;
      this.onProgress(Math.min(1, t / this.excerpt.duration), t);
      if (t >= this.excerpt.duration || this.audio.ended) { this.audio.pause(); this.setState('ended'); this.onProgress(1, this.excerpt.duration); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopLoop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  pause() {
    if (this.state !== 'playing') return;
    this.audio.pause();
    this.stopLoop();
    this.setState('paused');
  }

  async resume() {
    if (this.state !== 'paused' && this.state !== 'blocked') return;
    await this.startPlayback();
  }

  async restart() {
    if (!this.excerpt) return;
    const { url, start, duration } = this.excerpt;
    await this.play(url, start, duration, 0);
  }

  /** Fades out over `seconds` then stops. */
  fadeStop(seconds = 1) {
    if (this.state !== 'playing') { this.stop(); return; }
    this.stopLoop();
    const a = this.audio;
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      a.volume = from * (1 - k);
      if (k < 1) this.raf = requestAnimationFrame(step); else this.stop();
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.stopLoop();
    this.audio.pause();
    if (this.excerpt && this.state !== 'error') this.setState('idle');
  }
}
