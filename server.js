// Live quiz & music blind test server (zero npm dependencies, Node 22.13+ for built-in SQLite).
// The server is authoritative: it owns the game state machine, the timers,
// answer validation and scoring. Browsers only render what it pushes.
//   Host  -> server : REST  (POST /api/games, POST /api/games/:pin/host-action)
//   Player-> server : REST  (POST /api/games/:pin/join, POST /api/games/:pin/answer)
//   Server-> both   : Server-Sent Events streams (one per host, one per player)
//   Admin -> server : REST under /api/admin (session cookie, CSRF header)
// Every live game is snapshotted to SQLite and restored after a restart.
// Finished games are saved as reports (db.js) and shown on /reports.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./db');
const Q = require('./questions');
const BT = require('./lib/blindtest');
const Settings = require('./lib/settings');
const Media = require('./lib/media');
const Scoring = require('./lib/scoring');
const { serializeGame, restoreGame } = require('./lib/gamestore');
const { isOffensive, randomName, isGeneratedName } = require('./filter');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const IS_PROD = process.env.NODE_ENV === 'production';
const db = store.open(process.env.QUIZBLITZ_DB || path.join(DATA_DIR, 'quizblitz.db'));
const mediaStore = Media.createDriver(process.env, path.join(DATA_DIR, 'media'));
// Reports are private to the host: allowed from this computer, or with REPORTS_KEY when hosted.
const REPORTS_KEY = process.env.REPORTS_KEY || '';
const SESSION_COOKIE = 'qb_session';
const ADMIN_COOKIE = 'qb_admin';
const ADMIN_SESSION_SECONDS = Number(process.env.ADMIN_SESSION_HOURS || 12) * 3600;
const SECURE_COOKIES = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : IS_PROD;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const ALLOW_PUBLIC_QUIZ_HOSTING = process.env.ALLOW_PUBLIC_QUIZ_HOSTING !== 'false';

const GET_READY_MS = 4000;      // countdown before each quiz question opens
const ANSWER_GRACE_MS = 400;    // accept answers that were in flight at time-up
const MIN_NAME = 2;
const MAX_NAME = 15;
const MAX_LIVE_GAMES = 300;
const AVATAR_CHARACTERS = 24; // must match AVATARS in public/shared.js
const AVATAR_ACCESSORIES = 9; // must match ACCESSORIES (index 0 = none)

// Game states (mirrors the phases a player moves through).
const S = {
  LOBBY: 'LOBBY',
  GET_READY: 'GET_READY',
  QUESTION: 'QUESTION',
  REVEAL: 'REVEAL',
  SCOREBOARD: 'SCOREBOARD',
  ENDED: 'ENDED',
};

let settings = store.getSettings(db, Settings.DEFAULT_SETTINGS);

/** @type {Map<string, any>} */
const games = new Map();

// ---------- helpers ----------

const id = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const gameTtlMs = () => settings.gameExpiryHours * 3600 * 1000;

function newPin() {
  for (;;) {
    const pin = String(crypto.randomInt(100000, 1000000));
    if (!games.has(pin)) return pin;
  }
}

function sendJson(res, status, body, cache = 'no-store') {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache });
  res.end(JSON.stringify(body));
}

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > max) { reject(httpError(413, 'Fichier ou requête trop volumineux')); req.resume(); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(httpError(413, 'Fichier ou requête trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req, max = 512 * 1024) {
  const buf = await readRaw(req, max);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw httpError(400, 'JSON invalide'); }
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}`);
    }
  }
  return urls;
}

/** Client IP; behind a trusted proxy (Vercel, Railway, Render…) the first X-Forwarded-For entry. */
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// ---------- security headers ----------

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (SECURE_COOKIES) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

// ---------- SSE ----------

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  return res;
}

function push(res, msg) {
  if (!res || res.writableEnded) return;
  res.write(`data: ${JSON.stringify({ ...msg, serverNow: Date.now() })}\n\n`);
}

setInterval(() => {
  const now = Date.now();
  for (const [pin, g] of games) {
    if (now - g.lastActivity > gameTtlMs()) { dropGame(pin); continue; }
    // Optional: forget players who left the lobby and never came back.
    if (!settings.keepDisconnectedPlayers && g.state === S.LOBBY) {
      for (const p of [...g.players.values()]) {
        if (!p.streams.size && now - (p.lastSeen || p.joinedAt) > 2 * 60000) { g.players.delete(p.id); toHosts(g, { type: 'PLAYERS', players: playerList(g) }); persist(g); }
      }
    }
    for (const s of g.hostStreams) s.write(': keepalive\n\n');
    for (const p of g.players.values()) for (const s of p.streams) s.write(': keepalive\n\n');
  }
}, 20000).unref();

const toHosts = (g, msg) => g.hostStreams.forEach((s) => push(s, msg));
const toPlayer = (p, msg) => p.streams.forEach((s) => push(s, msg));

// ---------- persistence of live games ----------

function persistNow(g) {
  clearTimeout(g.persistTimer);
  g.persistTimer = null;
  try { store.saveLiveGame(db, g.pin, serializeGame(g), g.lastActivity + gameTtlMs()); }
  catch (err) { console.error(`Could not save game ${g.pin}:`, err.message); }
}

/** Debounced snapshot: many joins or answers in a burst cost one write. */
function persist(g) {
  if (!g.persistTimer) g.persistTimer = setTimeout(() => persistNow(g), 250);
}

function dropGame(pin) {
  const g = games.get(pin);
  if (g) { endTimers(g); clearTimeout(g.persistTimer); g.hostStreams.forEach((s) => s.end()); }
  games.delete(pin);
  store.deleteLiveGame(db, pin);
}

function restoreGames() {
  let restored = 0;
  for (const json of store.loadLiveGames(db)) {
    try {
      const g = restoreGame(json);
      games.set(g.pin, g);
      armTimers(g);
      restored++;
    } catch (err) { console.error('Could not restore a game:', err.message); }
  }
  if (restored) console.log(`Restored ${restored} live game(s) from the database.`);
}

// ---------- game logic ----------

function playerList(g) {
  return [...g.players.values()].map((p) => ({
    id: p.id, name: p.name, score: p.score, avatar: p.avatar, connected: p.streams.size > 0,
  }));
}

const connectedCount = (g) => [...g.players.values()].filter((p) => p.streams.size > 0).length;

// Gives each new player a character nobody else has yet (while any remain).
function pickAvatar(g) {
  const used = new Set([...g.players.values()].map((p) => p.avatar.character));
  const free = [...Array(AVATAR_CHARACTERS).keys()].filter((c) => !used.has(c));
  const pool = free.length ? free : [...Array(AVATAR_CHARACTERS).keys()];
  return { character: pool[crypto.randomInt(pool.length)], accessory: 0 };
}

function ranked(g) {
  return [...g.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
}

function rankOf(g, player) {
  return ranked(g).findIndex((p) => p.id === player.id) + 1;
}

function currentQ(g) {
  return g.quiz.questions[g.qIndex];
}

function endTimers(g) {
  clearTimeout(g.timer);
  g.timer = null;
}

function touch(g) { g.lastActivity = Date.now(); }

const isBlind = (g) => g.quiz.kind === BT.TYPE;

function publicQuestion(g) {
  return Q.publicView(currentQ(g), g.qIndex, g.quiz.questions.length, g.options.showOnDevices);
}

/** Round/track position shown to everyone (no answer, no audio). */
function blindPosition(q) {
  const b = q && q.blind;
  if (!b) return null;
  return { roundIndex: b.roundIndex, roundCount: b.roundCount, roundTitle: b.roundTitle, trackInRound: b.trackInRound,
    tracksInRound: b.tracksInRound, questionType: b.questionType };
}

/** What the host screen needs to play the excerpt; the answer card only once revealed. */
function blindHostView(g) {
  const q = currentQ(g);
  if (!q || !q.blind || g.state === S.ENDED) return null;
  const next = g.quiz.questions[g.qIndex + 1]?.blind;
  const v = { ...blindPosition(q), audioUrl: q.blind.audioUrl, startTime: q.blind.startTime, duration: q.blind.duration,
    nextAudioUrl: next ? next.audioUrl : null, nextStartTime: next ? next.startTime : 0 };
  if (g.state === S.REVEAL || g.state === S.SCOREBOARD) v.reveal = q.blind.reveal;
  return v;
}

function blindPlayerView(g) {
  const q = currentQ(g);
  if (!q || !q.blind || g.state === S.LOBBY || g.state === S.ENDED) return null;
  const v = blindPosition(q);
  if (g.state === S.REVEAL) v.reveal = q.blind.reveal;
  return v;
}

const pausedView = (g) => (g.paused ? { remainingMs: g.paused.remainingMs } : null);

function hostSnapshot(g) {
  const base = { type: 'STATE', state: g.state, pin: g.pin, title: g.quiz.title, kind: g.quiz.kind || 'quiz', players: playerList(g),
    connectedCount: connectedCount(g), locked: g.locked, options: g.options, paused: pausedView(g), blind: blindHostView(g),
    total: g.quiz.questions.length };
  if (g.state === S.GET_READY) return { ...base, question: publicQuestion(g), startsAt: g.questionStartsAt, readyMs: g.readyMs };
  if (g.state === S.QUESTION) {
    return { ...base, question: publicQuestion(g), endsAt: g.endsAt, openedAt: g.questionOpenedAt, answeredCount: g.answers.size };
  }
  if (g.state === S.REVEAL) return { ...base, question: publicQuestion(g), reveal: g.lastReveal };
  if (g.state === S.SCOREBOARD) return { ...base, question: publicQuestion(g), leaderboard: leaderboard(g, 5) };
  if (g.state === S.ENDED) return { ...base, leaderboard: leaderboard(g, 10), reportId: g.reportId ?? null };
  return base;
}

// What a (re)connecting player should see right now — the equivalent of the
// recovery snapshot a real-time quiz client restores from after a reconnect.
function playerSnapshot(g, p) {
  const base = { type: 'STATE', state: g.state, pin: g.pin, title: g.quiz.title, kind: g.quiz.kind || 'quiz', name: p.name,
    score: p.score, avatar: p.avatar, paused: pausedView(g), blind: blindPlayerView(g) };
  if (g.state === S.GET_READY) return { ...base, question: publicQuestion(g), startsAt: g.questionStartsAt };
  if (g.state === S.QUESTION) {
    const answered = g.answers.has(p.id);
    return { ...base, question: publicQuestion(g), endsAt: g.endsAt, answered, canChange: !!g.quiz.settings?.allowAnswerChange };
  }
  if (g.state === S.REVEAL) return { ...base, result: p.lastResult || null, question: publicQuestion(g) };
  if (g.state === S.SCOREBOARD) return { ...base, rank: rankOf(g, p), total: g.players.size, prevRank: p.prevRank ?? null };
  if (g.state === S.ENDED) return { ...base, rank: rankOf(g, p), total: g.players.size };
  return base;
}

function leaderboard(g, n) {
  return ranked(g).slice(0, n).map((p, i) => ({ rank: i + 1, prevRank: p.prevRank ?? null, name: p.name, score: p.score, streak: p.streak, avatar: p.avatar }));
}

function broadcastState(g) {
  toHosts(g, hostSnapshot(g));
  for (const p of g.players.values()) toPlayer(p, playerSnapshot(g, p));
  persist(g);
}

/** (Re)starts the timer for the current phase from the persisted deadlines. */
function armTimers(g) {
  endTimers(g);
  if (g.paused) return;
  const now = Date.now();
  if (g.state === S.GET_READY) g.timer = setTimeout(() => startQuestion(g), Math.max(0, g.questionStartsAt - now));
  else if (g.state === S.QUESTION) g.timer = setTimeout(() => endQuestion(g), Math.max(0, g.endsAt + ANSWER_GRACE_MS - now));
}

function startGetReady(g) {
  endTimers(g);
  g.state = S.GET_READY;
  g.paused = null;
  g.readyMs = isBlind(g) ? Math.max(1000, (g.quiz.settings?.countdownDuration ?? 3) * 1000) : GET_READY_MS;
  g.questionStartsAt = Date.now() + g.readyMs;
  g.answers = new Map();
  for (const p of g.players.values()) p.lastResult = null;
  broadcastState(g);
  armTimers(g);
}

function startQuestion(g) {
  if (g.state !== S.GET_READY || g.paused) return;
  endTimers(g);
  const q = currentQ(g);
  g.state = S.QUESTION;
  g.questionOpenedAt = Date.now();
  g.endsAt = g.questionOpenedAt + q.time * 1000;
  broadcastState(g);
  armTimers(g);
}

function endQuestion(g) {
  if (g.state !== S.QUESTION) return;
  endTimers(g);
  g.paused = null;
  const q = currentQ(g);
  const scored = Q.isScored(q);
  const record = {};
  const before = new Map(ranked(g).map((p, i) => [p.id, i + 1]));

  for (const p of g.players.values()) {
    const a = g.answers.get(p.id);
    const verdict = a ? Q.judge(q, a.answer) : { correct: false, factor: 0 };
    let points = 0;
    if (scored) {
      if (verdict.correct) {
        p.streak += 1;
        points = Math.round((Scoring.speedPoints(a.responseMs, q.time * 1000, g.scoring) * verdict.factor
          + Scoring.streakBonus(p.streak, g.scoring)) * Q.multiplier(q));
      } else {
        p.streak = 0;
      }
    }
    p.score += points;
    p.prevRank = before.get(p.id);
    p.lastResult = { answered: !!a, scored, isCorrect: scored && verdict.correct, points, streak: p.streak,
      responseMs: a ? a.responseMs : null,
      correctText: scored ? Q.describeCorrect(q) : null, yourAnswer: a ? Q.describeAnswer(q, a.answer) : null,
      reveal: q.blind ? q.blind.reveal : null };
    record[p.id] = { answer: a ? a.answer : null, correct: scored && verdict.correct, points, responseMs: a ? a.responseMs : null };
  }
  g.history[g.qIndex] = record;

  // Ranks are computed after every score is updated, then attached per player.
  const order = ranked(g);
  order.forEach((p, i) => {
    const ahead = order[i - 1];
    p.lastResult = { ...p.lastResult, totalScore: p.score, rank: i + 1, prevRank: p.prevRank, total: order.length,
      behind: ahead ? { name: ahead.name, gap: ahead.score - p.score } : null };
  });

  g.state = S.REVEAL;
  g.lastReveal = Q.revealSummary(q, [...g.answers.values()].map((x) => x.answer));
  broadcastState(g);
}

function goNext(g) {
  if (g.state === S.REVEAL) {
    g.state = S.SCOREBOARD;
    broadcastState(g);
  } else if (g.state === S.SCOREBOARD) {
    if (g.qIndex + 1 < g.quiz.questions.length) { g.qIndex++; startGetReady(g); }
    else finishGame(g, true);
  }
}

// Ends the game once, saving it to the report history.
function finishGame(g, completed) {
  endTimers(g);
  g.paused = null;
  g.state = S.ENDED;
  if (g.reportId === undefined) {
    try { g.reportId = store.saveGame(db, g, ranked(g), completed); }
    catch (err) { g.reportId = null; console.error('Could not save game report:', err.message); }
  }
  broadcastState(g);
  persistNow(g);
}

function createGame({ quiz, options, ownerId }) {
  if (games.size >= MAX_LIVE_GAMES) throw httpError(503, 'Trop de parties en cours sur ce serveur. Réessayez plus tard.');
  const now = Date.now();
  const g = {
    pin: newPin(), hostKey: id(), quiz: Q.prepareForGame(quiz, options), options, locked: false, ownerId: ownerId ?? null,
    state: S.LOBBY, qIndex: 0, players: new Map(), hostStreams: new Set(), answers: new Map(),
    timer: null, persistTimer: null, lastActivity: now, createdAt: now, history: [], startedAt: null, paused: null,
    scoring: Scoring.normaliseScoring(settings.scoring), maxPlayers: settings.maxPlayers,
  };
  games.set(g.pin, g);
  persistNow(g);
  return g;
}

// ---------- static files and pages ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

const PAGES = { '/': 'index', '/host': 'host', '/play': 'play', '/admin': 'admin', '/library': 'library', '/reports': 'reports' };
const templates = new Map();
function template(name) {
  if (!IS_PROD || !templates.has(name)) templates.set(name, fs.readFileSync(path.join(VIEWS_DIR, `${name}.html`), 'utf8'));
  return templates.get(name);
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : 'http';
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function sendPage(req, res, name, status = 200) {
  const html = Settings.renderPage(template(name), settings, baseUrl(req));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
}

/** Streams a file, honouring Range requests (Safari needs them to play audio). */
function streamFile(req, res, { size, type, open, cache, extra = {} }) {
  const range = Media.parseRange(req.headers.range, size);
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ...extra };
  if (range === 'invalid') { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
    if (req.method === 'HEAD') return res.end();
    return open(range).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return open(undefined).pipe(res);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendPage(req, res, '404', 404);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') return sendPage(req, res, '404', 404); // pages are rendered from views/
    const type = MIME[ext] || 'application/octet-stream';
    const mtime = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === mtime) { res.writeHead(304); return res.end(); }
    streamFile(req, res, { size: st.size, type, cache: 'no-cache', extra: { 'Last-Modified': mtime }, open: (r) => fs.createReadStream(file, r) });
  });
}

async function serveMedia(req, res, key) {
  const m = store.getMedia(db, key);
  const st = m && await mediaStore.stat(key);
  if (!m || !st) return sendPage(req, res, '404', 404);
  // Uploaded files are never executable: fixed type from the sniffed content, nosniff, sandboxed.
  streamFile(req, res, {
    size: st.size, type: m.mime, cache: 'public, max-age=31536000, immutable',
    extra: { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin' },
    open: (r) => mediaStore.stream(key, r),
  });
}

// ---------- accounts: cookies, sessions, CSRF and rate limiting ----------

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ }
    }
  }
  return out;
}

function currentUser(req) {
  if (req.user === undefined) req.user = store.sessionUser(db, cookies(req)[SESSION_COOKIE]);
  return req.user;
}

function currentAdmin(req) {
  if (req.admin === undefined) {
    const u = store.sessionUser(db, cookies(req)[ADMIN_COOKIE]);
    req.admin = u && u.role === 'admin' ? u : null;
  }
  return req.admin;
}

function addCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, value) : value);
}

function setSessionCookie(res, token, maxAge) {
  addCookie(res, `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIES ? '; Secure' : ''}`);
}

function setAdminCookie(res, token, maxAge) {
  addCookie(res, `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${SECURE_COOKIES ? '; Secure' : ''}`);
}

// Browsers cannot send this custom header cross-site without a CORS preflight
// (which this server never approves), so it blocks CSRF on cookie-authenticated requests.
const hasCsrfHeader = (req) => req.headers['x-quizblitz'] === '1';

const hits = new Map();
function rateLimited(req, bucket, limit, windowMs = 60000) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => t > now - windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > limit;
}
setInterval(() => {
  const cutoff = Date.now() - 15 * 60000;
  for (const [k, list] of hits) { const kept = list.filter((t) => t > cutoff); if (kept.length) hits.set(k, kept); else hits.delete(k); }
}, 5 * 60000).unref();

async function handleAuth(req, res, parts) {
  const action = parts[2];
  if (req.method === 'GET' && action === 'me') {
    const u = currentUser(req);
    return sendJson(res, 200, { user: u ? { id: u.id, email: u.email, name: u.name } : null });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!hasCsrfHeader(req)) return sendJson(res, 403, { error: 'Missing request header' });
  if (action === 'logout') {
    store.deleteSession(db, cookies(req)[SESSION_COOKIE]);
    setSessionCookie(res, '', 0);
    return sendJson(res, 200, { ok: true });
  }
  if (rateLimited(req, 'auth', 10)) return sendJson(res, 429, { error: 'Trop de tentatives. Patientez une minute.' });
  const body = await readBody(req);
  let user;
  if (action === 'register') {
    try { user = store.createUser(db, body); }
    catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }
  } else if (action === 'login') {
    user = store.checkLogin(db, body.email, body.password);
    if (!user) return sendJson(res, 401, { error: 'E-mail ou mot de passe incorrect.' });
  } else {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const { token, maxAge } = store.createSession(db, user.id);
  setSessionCookie(res, token, maxAge);
  return sendJson(res, action === 'register' ? 201 : 200, { user: { id: user.id, email: user.email, name: user.name } });
}

// GET/POST /api/quizzes, GET/PUT/DELETE /api/quizzes/:id, POST /api/quizzes/:id/duplicate
async function handleQuizzes(req, res, parts) {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { error: 'Connectez-vous pour utiliser votre bibliothèque.', code: 'SIGN_IN' });
  if (req.method !== 'GET' && !hasCsrfHeader(req)) return sendJson(res, 403, { error: 'Missing request header' });
  const quizId = parts[2] ? Number(parts[2]) : null;
  if (parts[2] && !(Number.isInteger(quizId) && quizId > 0)) return sendJson(res, 404, { error: 'Quiz not found' });
  try {
    if (!quizId) {
      if (req.method === 'GET') return sendJson(res, 200, { quizzes: store.listQuizzes(db, user.id) });
      if (req.method === 'POST') {
        const quiz = Q.validateQuiz((await readBody(req)).quiz);
        return sendJson(res, 201, { id: store.saveQuiz(db, user.id, quiz) });
      }
    } else if (parts[3] === 'duplicate' && req.method === 'POST') {
      const q = store.getQuiz(db, user.id, quizId);
      if (!q) return sendJson(res, 404, { error: 'Quiz not found' });
      return sendJson(res, 201, { id: store.saveQuiz(db, user.id, { ...q.quiz, title: `${q.quiz.title} (copy)`.slice(0, 80) }) });
    } else if (!parts[3]) {
      if (req.method === 'GET') {
        const q = store.getQuiz(db, user.id, quizId);
        return q ? sendJson(res, 200, q) : sendJson(res, 404, { error: 'Quiz not found' });
      }
      if (req.method === 'PUT') {
        const quiz = Q.validateQuiz((await readBody(req)).quiz);
        return store.saveQuiz(db, user.id, quiz, quizId) ? sendJson(res, 200, { id: quizId }) : sendJson(res, 404, { error: 'Quiz not found' });
      }
      if (req.method === 'DELETE') {
        return store.deleteQuiz(db, user.id, quizId) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Quiz not found' });
      }
    }
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

function canSeeReports(req, url) {
  const key = req.headers['x-reports-key'] || url.searchParams.get('key');
  if (REPORTS_KEY && key && key.length === REPORTS_KEY.length
    && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(REPORTS_KEY))) return true;
  const ip = req.socket.remoteAddress;
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local && !req.headers['x-forwarded-for']; // a reverse proxy would make every visitor look local
}

// GET /api/reports, GET /api/reports/:id, GET /api/reports/:id/csv, DELETE /api/reports/:id
function handleReports(req, res, url, parts) {
  // Signed-in hosts (or the admin) see their own games from anywhere; games hosted
  // without an account are visible only on the host computer (or with REPORTS_KEY).
  const user = currentUser(req) || currentAdmin(req);
  if (!user && !canSeeReports(req, url)) {
    return sendJson(res, 403, { error: 'Connectez-vous pour voir vos rapports, ou ouvrez cette page sur l’ordinateur qui héberge le serveur.', code: 'REPORTS_LOCAL_ONLY' });
  }
  const ownerId = user ? user.id : null;
  if (req.method !== 'GET' && user && !hasCsrfHeader(req)) return sendJson(res, 403, { error: 'Missing request header' });
  if (!parts[2]) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 200, { reports: store.listReports(db, ownerId) });
  }
  const reportId = Number(parts[2]);
  if (!Number.isInteger(reportId) || reportId <= 0) return sendJson(res, 404, { error: 'Report not found' });
  if (req.method === 'DELETE' && !parts[3]) {
    return store.deleteReport(db, reportId, ownerId) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Report not found' });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const report = store.getReport(db, reportId, ownerId);
  if (!report) return sendJson(res, 404, { error: 'Report not found' });
  if (parts[3] === 'csv') {
    const name = `rapport-${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'partie'}-${report.id}.csv`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    return res.end(store.reportCsv(report));
  }
  return sendJson(res, 200, report);
}

// ---------- administration ----------

/** Media URLs still used by the settings or any blind test. */
function mediaInUse() {
  const used = new Set(Settings.referencedMedia(settings));
  for (const bt of store.allBlindTestJson(db)) for (const u of BT.referencedMedia(bt)) used.add(u);
  return used;
}

async function removeMediaIfUnused(urls) {
  const used = mediaInUse();
  for (const url of urls) {
    const key = Media.keyFromUrl(url);
    if (!key || used.has(url)) continue;
    store.deleteMedia(db, key);
    await mediaStore.remove(key).catch(() => {});
  }
}

function activeGamesSummary() {
  return [...games.values()].map((g) => ({
    pin: g.pin, title: g.quiz.title, kind: g.quiz.kind || 'quiz', state: g.state, paused: !!g.paused,
    players: g.players.size, connected: connectedCount(g), question: g.qIndex + 1, questions: g.quiz.questions.length,
    createdAt: g.createdAt, lastActivity: g.lastActivity, hostConnected: g.hostStreams.size > 0,
  })).sort((a, b) => b.lastActivity - a.lastActivity);
}

function configWarnings() {
  const w = [];
  if (IS_PROD && !SECURE_COOKIES) w.push('COOKIE_SECURE est désactivé en production : les cookies de session peuvent circuler en clair.');
  if (IS_PROD && !PUBLIC_URL) w.push("PUBLIC_URL n'est pas défini : les QR codes utilisent l'adresse de la requête.");
  if (!process.env.ADMIN_PASSWORD) w.push('ADMIN_PASSWORD n’est pas défini : mot de passe administrateur généré au démarrage (voir les logs).');
  else if (process.env.ADMIN_PASSWORD.length < 12) w.push('ADMIN_PASSWORD est court : utilisez au moins 12 caractères.');
  if (!store.listBlindTests(db, { includeArchived: false }).length) w.push('Aucun blind test actif : créez-en un ou importez l’exemple.');
  if (!settings.updatedAt) w.push("L'identité visuelle n'a jamais été personnalisée (nom et couleurs par défaut).");
  return w;
}

async function handleAdmin(req, res, url, parts) {
  const action = parts[2];
  if (req.method !== 'GET' && !hasCsrfHeader(req)) return sendJson(res, 403, { error: 'En-tête de requête manquant' });

  if (action === 'login' && req.method === 'POST') {
    if (rateLimited(req, 'admin-login', 5, 15 * 60000)) {
      return sendJson(res, 429, { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' });
    }
    const body = await readBody(req, 4096);
    const user = store.checkLogin(db, body.email, body.password);
    if (!user || user.role !== 'admin') return sendJson(res, 401, { error: 'Identifiants incorrects.' });
    const { token, maxAge } = store.createSession(db, user.id, ADMIN_SESSION_SECONDS);
    setAdminCookie(res, token, maxAge);
    return sendJson(res, 200, { user: { email: user.email, name: user.name } });
  }
  if (action === 'logout' && req.method === 'POST') {
    store.deleteSession(db, cookies(req)[ADMIN_COOKIE]);
    setAdminCookie(res, '', 0);
    return sendJson(res, 200, { ok: true });
  }

  const admin = currentAdmin(req);
  if (action === 'me') return sendJson(res, 200, { user: admin ? { email: admin.email, name: admin.name } : null });
  if (!admin) return sendJson(res, 401, { error: 'Connexion administrateur requise.', code: 'ADMIN_SIGN_IN' });

  // --- dashboard
  if (action === 'dashboard' && req.method === 'GET') {
    const active = activeGamesSummary();
    return sendJson(res, 200, {
      stats: { ...store.stats(db), activeGames: active.filter((g) => g.state !== S.ENDED).length,
        connectedPlayers: active.reduce((n, g) => n + (g.state === S.ENDED ? 0 : g.connected), 0) },
      activeGames: active, recentGames: store.recentGames(db), warnings: configWarnings(),
    });
  }

  // --- settings
  if (action === 'settings') {
    if (req.method === 'GET' && !parts[3]) return sendJson(res, 200, { settings, defaults: Settings.DEFAULT_SETTINGS });
    if (req.method === 'PUT' && !parts[3]) {
      const before = settings;
      const next = Settings.mergeSettings(settings, (await readBody(req, 64 * 1024)).settings);
      for (const k of Settings.IMAGE_FIELDS) {
        const key = Media.keyFromUrl(next[k]);
        if (next[k] && next[k].startsWith('/media/') && !(key && store.getMedia(db, key))) throw httpError(400, `Le fichier choisi pour ${k} n'existe pas`);
      }
      settings = store.saveSettings(db, next, admin.email);
      await removeMediaIfUnused(Settings.IMAGE_FIELDS.map((k) => before[k]).filter((u, i) => u && u !== settings[Settings.IMAGE_FIELDS[i]]));
      return sendJson(res, 200, { settings });
    }
    if (req.method === 'POST' && parts[3] === 'reset-theme') {
      settings = store.saveSettings(db, Settings.mergeSettings(settings, { ...Settings.DEFAULT_THEME }), admin.email);
      return sendJson(res, 200, { settings });
    }
  }

  // --- blind tests
  if (action === 'blind-tests') {
    const btId = parts[3];
    const sub = parts[4];
    if (!btId) {
      if (req.method === 'GET') return sendJson(res, 200, { blindTests: store.listBlindTests(db) });
      if (req.method === 'POST') {
        const body = await readBody(req, 2 * 1024 * 1024);
        const input = body.blindTest;
        // Import or creation: never overwrite an existing blind test by accident.
        if (input && input.id && store.getBlindTest(db, String(input.id))) delete input.id;
        const { blindTest, warnings } = BT.assertValid(input);
        store.saveBlindTest(db, blindTest);
        return sendJson(res, 201, { id: blindTest.id, blindTest, warnings });
      }
    } else if (btId === 'validate' && req.method === 'POST') {
      const r = BT.validateBlindTest((await readBody(req, 2 * 1024 * 1024)).blindTest);
      return sendJson(res, 200, { errors: r.errors, warnings: r.warnings, tracks: r.blindTest ? BT.countTracks(r.blindTest) : 0 });
    } else {
      const row = store.getBlindTest(db, btId);
      if (!row) return sendJson(res, 404, { error: 'Blind test introuvable' });
      if (!sub) {
        if (req.method === 'GET') return sendJson(res, 200, row);
        if (req.method === 'PUT') {
          const input = { ...(await readBody(req, 2 * 1024 * 1024)).blindTest, id: row.id };
          const before = BT.referencedMedia(row.blindTest);
          const { blindTest, warnings } = BT.assertValid(input);
          store.saveBlindTest(db, blindTest);
          const after = new Set(BT.referencedMedia(blindTest));
          await removeMediaIfUnused(before.filter((u) => !after.has(u)));
          return sendJson(res, 200, { id: row.id, blindTest, warnings });
        }
        if (req.method === 'DELETE') {
          store.deleteBlindTest(db, row.id);
          await removeMediaIfUnused(BT.referencedMedia(row.blindTest));
          return sendJson(res, 200, { ok: true });
        }
      }
      if (sub === 'duplicate' && req.method === 'POST') {
        const copy = { ...structuredClone(row.blindTest), id: undefined, title: `${row.blindTest.title} (copie)`.slice(0, 100) };
        const { blindTest } = BT.assertValid(copy);
        store.saveBlindTest(db, blindTest);
        return sendJson(res, 201, { id: blindTest.id });
      }
      if (sub === 'archive' && req.method === 'POST') {
        store.setBlindTestArchived(db, row.id, (await readBody(req, 1024)).archived !== false);
        return sendJson(res, 200, { ok: true });
      }
      if (sub === 'export' && req.method === 'GET') {
        const name = `${row.id.replace(/[^\w-]/g, '_')}.json`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(row.blindTest, null, 2));
      }
    }
  }

  // --- media
  if (action === 'media') {
    if (req.method === 'GET' && !parts[3]) {
      const used = mediaInUse();
      return sendJson(res, 200, { media: store.listMedia(db, url.searchParams.get('kind') || null).map((m) => ({ ...m, inUse: used.has(m.url) })) });
    }
    if (req.method === 'POST' && !parts[3]) {
      if (rateLimited(req, 'upload', 60)) return sendJson(res, 429, { error: 'Trop de téléversements. Patientez une minute.' });
      const kind = url.searchParams.get('kind');
      const rule = Media.KINDS[kind];
      if (!rule) return sendJson(res, 400, { error: 'Type de média inconnu (image, favicon ou audio)' });
      let originalName = '';
      try { originalName = decodeURIComponent(String(req.headers['x-filename'] || '')).slice(0, 200); } catch { /* keep empty */ }
      const buf = await readRaw(req, rule.max + 1);
      const { ext, mime } = Media.checkUpload(kind, buf, originalName);
      const key = Media.newKey(ext);
      await mediaStore.put(key, buf, mime);
      store.addMedia(db, { id: key, kind, mime, size: buf.length, originalName: originalName.replace(/[^\p{L}\p{N} ._()-]/gu, '_') || key });
      return sendJson(res, 201, { media: store.getMedia(db, key) });
    }
    if (req.method === 'DELETE' && parts[3]) {
      const m = store.getMedia(db, parts[3]);
      if (!m) return sendJson(res, 404, { error: 'Média introuvable' });
      if (mediaInUse().has(m.url)) return sendJson(res, 409, { error: 'Ce fichier est encore utilisé (paramètres ou blind test).' });
      store.deleteMedia(db, m.id);
      await mediaStore.remove(m.id).catch(() => {});
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- live games
  if (action === 'games') {
    if (req.method === 'GET' && !parts[3]) return sendJson(res, 200, { games: activeGamesSummary() });
    const g = parts[3] && games.get(parts[3]);
    if (!g) return sendJson(res, 404, { error: 'Partie introuvable' });
    // Lets the admin take back control of a game (e.g. after closing the host tab).
    if (parts[4] === 'host-key' && req.method === 'POST') return sendJson(res, 200, { pin: g.pin, hostKey: g.hostKey });
    if (parts[4] === 'end' && req.method === 'POST') { if (g.state !== S.ENDED) finishGame(g, false); return sendJson(res, 200, { ok: true }); }
    if (!parts[4] && req.method === 'DELETE') { dropGame(g.pin); return sendJson(res, 200, { ok: true }); }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------- game API ----------

function hostActionHandler(g, body) {
  const now = Date.now();
  switch (body.action) {
    case 'start':
      if (g.state !== S.LOBBY) throw httpError(409, 'La partie a déjà commencé');
      if (g.players.size === 0) throw httpError(409, 'Attendez au moins un joueur');
      g.qIndex = 0;
      g.startedAt = now;
      if (g.options.lockOnStart) g.locked = true;
      startGetReady(g);
      break;
    case 'skip': case 'close': // close answers now and reveal
      if (g.state === S.QUESTION) endQuestion(g);
      else if (g.state === S.GET_READY) { g.paused = null; startQuestion(g); }
      break;
    case 'next':
      goNext(g);
      break;
    case 'hide-board':
      if (g.state === S.SCOREBOARD) { g.state = S.REVEAL; broadcastState(g); }
      break;
    case 'pause': {
      if (g.paused || (g.state !== S.GET_READY && g.state !== S.QUESTION)) throw httpError(409, 'Rien à mettre en pause');
      const deadline = g.state === S.GET_READY ? g.questionStartsAt : g.endsAt;
      g.paused = { at: now, remainingMs: Math.max(0, deadline - now) };
      endTimers(g);
      broadcastState(g);
      break;
    }
    case 'resume': {
      if (!g.paused) throw httpError(409, "La partie n'est pas en pause");
      const pausedFor = now - g.paused.at;
      if (g.state === S.GET_READY) g.questionStartsAt = now + g.paused.remainingMs;
      else { g.endsAt = now + g.paused.remainingMs; g.questionOpenedAt += pausedFor; } // the pause does not count as thinking time
      g.paused = null;
      broadcastState(g);
      armTimers(g);
      break;
    }
    case 'restart-track': // replay the current excerpt from the countdown; answers to it are discarded
      if (g.state !== S.GET_READY && g.state !== S.QUESTION) throw httpError(409, 'Impossible de relancer ce morceau maintenant');
      startGetReady(g);
      break;
    case 'recover': // unstick a game: re-send the state and re-arm the timers; nothing is deleted
      armTimers(g);
      if (g.state === S.QUESTION && !g.paused && g.answers.size >= g.players.size && g.players.size) endQuestion(g);
      else broadcastState(g);
      break;
    case 'kick': {
      const p = g.players.get(String(body.playerId));
      if (p) {
        toPlayer(p, { type: 'KICKED' });
        p.streams.forEach((s) => s.end());
        g.players.delete(p.id);
        g.answers.delete(p.id);
        toHosts(g, hostSnapshot(g));
        persist(g);
      }
      break;
    }
    case 'lock': case 'unlock':
      g.locked = body.action === 'lock';
      toHosts(g, hostSnapshot(g));
      persist(g);
      break;
    case 'end':
      if (g.state !== S.ENDED) finishGame(g, false);
      break;
    default:
      throw httpError(400, 'Action inconnue');
  }
}

const findPlayer = (g, token) => (typeof token === 'string' && token ? [...g.players.values()].find((x) => x.token === token) : null);

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'games', pin, action]

  if (rateLimited(req, 'api', 1200)) return sendJson(res, 429, { error: 'Trop de requêtes. Patientez quelques secondes.' });

  if (req.method === 'GET' && url.pathname === '/api/info') {
    return sendJson(res, 200, { lanUrls: PUBLIC_URL ? [] : lanUrls(), port: PORT, publicUrl: PUBLIC_URL || null });
  }
  if (req.method === 'GET' && url.pathname === '/api/public/settings') {
    return sendJson(res, 200, { settings: Settings.publicSettings(settings) }, 'public, max-age=15');
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, games: games.size, uptime: Math.round(process.uptime()) });
  }

  if (parts[1] === 'admin') return handleAdmin(req, res, url, parts);
  if (parts[1] === 'reports') return handleReports(req, res, url, parts);
  if (parts[1] === 'auth') return handleAuth(req, res, parts);
  if (parts[1] === 'quizzes') return handleQuizzes(req, res, parts);

  if (req.method === 'POST' && url.pathname === '/api/games') {
    if (!hasCsrfHeader(req)) return sendJson(res, 403, { error: 'Missing request header' });
    if (rateLimited(req, 'create-game', 20)) return sendJson(res, 429, { error: 'Trop de parties créées. Patientez une minute.' });
    const user = currentUser(req);
    const admin = currentAdmin(req);
    const body = await readBody(req);
    const o = body.options || {};
    let quiz;
    let options = {
      shuffleQuestions: !!o.shuffleQuestions, shuffleAnswers: !!o.shuffleAnswers, nameGenerator: !!o.nameGenerator,
      lockOnStart: o.lockOnStart !== false, showOnDevices: o.showOnDevices !== false,
    };
    let ownerId = user ? user.id : null;
    if (body.blindTestId !== undefined) {
      if (!admin) return sendJson(res, 401, { error: 'Connexion administrateur requise pour lancer un blind test.', code: 'ADMIN_SIGN_IN' });
      const row = store.getBlindTest(db, String(body.blindTestId));
      if (!row) return sendJson(res, 404, { error: 'Blind test introuvable' });
      const { blindTest } = BT.assertValid(row.blindTest);
      quiz = BT.toGameQuiz(blindTest);
      const allowLateJoin = o.allowLateJoin !== undefined ? !!o.allowLateJoin : (blindTest.settings.allowLateJoin && settings.allowLateJoin);
      options = { shuffleQuestions: false, shuffleAnswers: !!blindTest.settings.shuffleChoices, nameGenerator: !!o.nameGenerator,
        lockOnStart: !allowLateJoin, showOnDevices: true };
      ownerId = admin.id;
      store.countBlindTestPlay(db, row.id);
    } else if (body.quizId !== undefined) {
      if (!user) return sendJson(res, 401, { error: 'Connectez-vous pour lancer un quiz de votre bibliothèque.', code: 'SIGN_IN' });
      const saved = store.getQuiz(db, user.id, Number(body.quizId));
      if (!saved) return sendJson(res, 404, { error: 'Quiz not found' });
      quiz = Q.validateQuiz(saved.quiz);
      store.countPlay(db, user.id, saved.id);
    } else {
      if (!ALLOW_PUBLIC_QUIZ_HOSTING && !admin && !user) return sendJson(res, 401, { error: 'Connexion requise pour créer une partie.', code: 'SIGN_IN' });
      quiz = Q.validateQuiz(body.quiz);
    }
    const g = createGame({ quiz, options, ownerId });
    return sendJson(res, 201, { pin: g.pin, hostKey: g.hostKey });
  }

  if (parts[0] !== 'api' || parts[1] !== 'games' || !parts[2]) return sendJson(res, 404, { error: 'Not found' });
  const g = games.get(parts[2]);
  const action = parts[3];
  if (!g) return sendJson(res, 404, { error: 'Aucune partie ne correspond à ce PIN.', code: 'PIN_NOT_FOUND' });
  touch(g);

  // GET /api/games/:pin — does the game exist (used to validate a typed PIN)?
  if (req.method === 'GET' && !action) {
    return sendJson(res, 200, { pin: g.pin, state: g.state, title: g.quiz.title, kind: g.quiz.kind || 'quiz', locked: g.locked, nameGenerator: g.options.nameGenerator });
  }

  // Friendly nickname generator: a fresh suggestion that is not already taken.
  if (req.method === 'GET' && action === 'random-name') {
    const taken = new Set([...g.players.values()].map((p) => p.name.toLowerCase()));
    let name = randomName();
    for (let i = 0; i < 20 && taken.has(name.toLowerCase()); i++) name = randomName();
    return sendJson(res, 200, { name });
  }

  const isHost = (key) => typeof key === 'string' && key.length === g.hostKey.length
    && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(g.hostKey));

  // Host event stream
  if (req.method === 'GET' && action === 'host-events') {
    if (!isHost(url.searchParams.get('key'))) return sendJson(res, 403, { error: 'Not the host' });
    const s = openStream(req, res);
    g.hostStreams.add(s);
    push(s, hostSnapshot(g));
    req.on('close', () => g.hostStreams.delete(s));
    return;
  }

  if (req.method === 'POST' && action === 'host-action') {
    const body = await readBody(req, 8192);
    if (!isHost(body.key)) return sendJson(res, 403, { error: 'Not the host' });
    hostActionHandler(g, body);
    return sendJson(res, 200, { ok: true, state: g.state });
  }

  if (req.method === 'POST' && action === 'join') {
    if (rateLimited(req, 'join', 30)) return sendJson(res, 429, { error: 'Trop de tentatives. Patientez une minute.' });
    const body = await readBody(req, 4096);
    const name = String(body.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name) return sendJson(res, 400, { error: 'Choisissez un pseudo', code: 'USER_INPUT' });
    if ([...name].length < MIN_NAME) return sendJson(res, 400, { error: `Le pseudo doit contenir au moins ${MIN_NAME} caractères`, code: 'USER_INPUT' });
    if (g.state === S.ENDED) return sendJson(res, 409, { error: 'Cette partie est terminée', code: 'GAME_ENDED' });
    if (g.locked) return sendJson(res, 409, { error: "L'animateur a verrouillé la partie. Demandez-lui de la déverrouiller.", code: 'GAME_LOCKED' });
    if (g.options.nameGenerator && !isGeneratedName(name)) {
      return sendJson(res, 400, { error: 'Cette partie utilise le générateur de pseudos. Lancez le dé !', code: 'USE_GENERATOR' });
    }
    // Check the full text too: cutting it to the length limit must not hide a word.
    if (isOffensive(name) || isOffensive(String(body.name).slice(0, 200))) {
      return sendJson(res, 400, { error: 'Merci de choisir un autre pseudo.', code: 'NAME_NOT_ALLOWED' });
    }
    if (g.players.size >= (g.maxPlayers || 200)) return sendJson(res, 409, { error: 'Cette partie est complète', code: 'MAX_PLAYERS_REACHED' });
    const taken = [...g.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return sendJson(res, 409, { error: 'Ce pseudo est déjà pris, essayez-en un autre', code: 'NICKNAME_EXISTS' });
    const p = {
      id: id(6), token: id(), name, score: 0, streak: 0, joinedAt: Date.now(), lastSeen: Date.now(),
      avatar: pickAvatar(g), streams: new Set(), lastResult: null, prevRank: null,
    };
    g.players.set(p.id, p);
    toHosts(g, { type: 'PLAYERS', players: playerList(g), connectedCount: connectedCount(g) });
    persist(g);
    return sendJson(res, 201, { playerId: p.id, token: p.token, name: p.name, avatar: p.avatar });
  }

  // Player changes their character / accessory (shown live on the host screen).
  if (req.method === 'POST' && action === 'avatar') {
    const body = await readBody(req, 4096);
    const p = findPlayer(g, body.token);
    if (!p) return sendJson(res, 404, { error: 'Joueur introuvable' });
    if (g.state === S.ENDED) return sendJson(res, 409, { error: 'Cette partie est terminée' });
    const character = Number(body.character);
    const accessory = Number(body.accessory);
    if (!Number.isInteger(character) || character < 0 || character >= AVATAR_CHARACTERS
      || !Number.isInteger(accessory) || accessory < 0 || accessory >= AVATAR_ACCESSORIES) {
      return sendJson(res, 400, { error: 'Avatar invalide' });
    }
    p.avatar = { character, accessory };
    toHosts(g, { type: 'PLAYERS', players: playerList(g), connectedCount: connectedCount(g) });
    persist(g);
    return sendJson(res, 200, { avatar: p.avatar });
  }

  // Player event stream (token identifies the player; reconnects resume)
  if (req.method === 'GET' && action === 'events') {
    const p = findPlayer(g, url.searchParams.get('token'));
    if (!p) return sendJson(res, 404, { error: 'Joueur introuvable', code: 'PLAYER_NOT_FOUND' });
    const s = openStream(req, res);
    p.streams.add(s);
    p.lastSeen = Date.now();
    push(s, playerSnapshot(g, p));
    toHosts(g, { type: 'PLAYERS', players: playerList(g), connectedCount: connectedCount(g) });
    req.on('close', () => {
      p.streams.delete(s);
      p.lastSeen = Date.now();
      toHosts(g, { type: 'PLAYERS', players: playerList(g), connectedCount: connectedCount(g) });
    });
    return;
  }

  if (req.method === 'POST' && action === 'answer') {
    const receivedAt = Date.now();
    const body = await readBody(req, 8192);
    const p = findPlayer(g, body.token);
    if (!p) return sendJson(res, 404, { error: 'Joueur introuvable' });
    if (g.state !== S.QUESTION || Number(body.questionIndex) !== g.qIndex) {
      return sendJson(res, 409, { error: 'Les réponses sont fermées', code: 'QUESTION_CLOSED' });
    }
    if (g.paused) return sendJson(res, 409, { error: 'Partie en pause', code: 'QUESTION_PAUSED' });
    if (receivedAt > g.endsAt + ANSWER_GRACE_MS) return sendJson(res, 409, { error: 'Trop tard', code: 'QUESTION_CLOSED' });
    const canChange = !!g.quiz.settings?.allowAnswerChange;
    if (g.answers.has(p.id) && !canChange) return sendJson(res, 409, { error: 'Réponse déjà enregistrée', code: 'ALREADY_ANSWERED' });
    let answer;
    try { answer = Q.parseAnswer(currentQ(g), body); }
    catch (err) { return sendJson(res, 400, { error: err.message, code: 'INVALID_ANSWER' }); }
    // Response time is measured on the server clock from the official opening of
    // the answers, so a phone cannot claim a faster time.
    g.answers.set(p.id, { answer, responseMs: Math.max(0, receivedAt - g.questionOpenedAt) });
    toHosts(g, { type: 'ANSWER_COUNT', answeredCount: g.answers.size, playerCount: g.players.size });
    persist(g);
    if (!canChange && g.answers.size >= g.players.size) setTimeout(() => endQuestion(g), 300);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------- admin bootstrap ----------

function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  if (process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 8) { console.error('ADMIN_PASSWORD must be at least 8 characters: admin account not updated.'); return; }
    const a = store.ensureAdmin(db, email, process.env.ADMIN_PASSWORD);
    console.log(`Admin account: ${a.email}${a.created ? ' (created)' : ''}`);
    return;
  }
  if (store.adminCount(db) > 0) return;
  if (IS_PROD) { console.warn('No admin account: set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.'); return; }
  // Local development convenience: a one-off random password printed once.
  const password = crypto.randomBytes(9).toString('base64url');
  store.ensureAdmin(db, email, password);
  console.log(`Admin account created for local use: ${email} / ${password}  (set ADMIN_PASSWORD to choose your own)`);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  securityHeaders(res);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const page = PAGES[url.pathname] || PAGES[url.pathname.replace(/\/+$/, '')];
    if (page) return sendPage(req, res, page);
    const join = /^\/join\/(\d{6})\/?$/.exec(url.pathname);
    if (join) { res.writeHead(302, { Location: `/play?pin=${join[1]}` }); return res.end(); }
    if (url.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(Settings.manifest(settings)));
    }
    const mediaKey = /^\/media\/([a-f0-9]{32}\.[a-z0-9]{2,4})$/.exec(url.pathname);
    if (mediaKey) return await serveMedia(req, res, mediaKey[1]);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 400;
    if (status >= 500 || !err.status) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Requête invalide', details: err.details });
    else res.end();
  }
});

function shutdown() {
  for (const g of games.values()) persistNow(g);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrapAdmin();
restoreGames();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${settings.appName} running`);
  console.log(`  This computer : http://localhost:${PORT}`);
  if (!PUBLIC_URL) for (const u of lanUrls()) console.log(`  Same Wi-Fi    : ${u}`);
  else console.log(`  Public URL    : ${PUBLIC_URL}`);
  console.log('Open /admin to manage blind tests and settings, /host to run a classic quiz.');
});

module.exports = { server };
