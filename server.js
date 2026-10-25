// QuizBlitz — live quiz server (zero dependencies, Node 18+).
// The server is authoritative: it owns the game state machine, the timer,
// answer validation and scoring. Browsers only render what it pushes.
//   Host  -> server : REST  (POST /api/games, POST /api/games/:pin/host-action)
//   Player-> server : REST  (POST /api/games/:pin/join, POST /api/games/:pin/answer)
//   Server-> both   : Server-Sent Events streams (one per host, one per player)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const GET_READY_MS = 4000;      // countdown before each question opens
const ANSWER_GRACE_MS = 400;    // accept answers that were in flight at time-up
const MAX_PLAYERS = 200;
const MAX_NAME = 15;
const AVATAR_CHARACTERS = 24; // must match AVATARS in public/shared.js
const AVATAR_ACCESSORIES = 9; // must match ACCESSORIES (index 0 = none)
const GAME_IDLE_TTL_MS = 3 * 60 * 60 * 1000;

// Game states (mirrors the phases a player moves through).
const S = {
  LOBBY: 'LOBBY',
  GET_READY: 'GET_READY',
  QUESTION: 'QUESTION',
  REVEAL: 'REVEAL',
  SCOREBOARD: 'SCOREBOARD',
  ENDED: 'ENDED',
};

/** @type {Map<string, any>} */
const games = new Map();

// ---------- helpers ----------

const id = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

function newPin() {
  for (;;) {
    const pin = String(crypto.randomInt(100000, 1000000));
    if (!games.has(pin)) return pin;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
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

// Validates and normalizes a quiz submitted by the host.
function validateQuiz(q) {
  if (!q || typeof q !== 'object') throw new Error('Quiz is missing');
  const title = String(q.title || 'Untitled quiz').slice(0, 80);
  if (!Array.isArray(q.questions) || q.questions.length === 0) throw new Error('Add at least one question');
  if (q.questions.length > 100) throw new Error('Too many questions (max 100)');
  const questions = q.questions.map((qq, i) => {
    const text = String(qq.text || '').trim().slice(0, 200);
    if (!text) throw new Error(`Question ${i + 1} has no text`);
    const choices = (Array.isArray(qq.choices) ? qq.choices : [])
      .map((c) => String(c ?? '').trim().slice(0, 80));
    if (choices.length < 2 || choices.length > 4 || choices.some((c) => !c)) {
      throw new Error(`Question ${i + 1} needs 2–4 non-empty answers`);
    }
    const correct = [...new Set((Array.isArray(qq.correct) ? qq.correct : [qq.correct])
      .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < choices.length))];
    if (!correct.length) throw new Error(`Question ${i + 1} needs a correct answer`);
    const time = Math.min(120, Math.max(5, Number(qq.time) || 20));
    const image = String(qq.image || '').trim();
    if (image && (!/^https?:\/\/\S+$/i.test(image) || image.length > 500)) {
      throw new Error(`Question ${i + 1} image must be an http(s) link`);
    }
    return { text, choices, correct, time, image };
  });
  return { title, questions };
}

// Kahoot-style scoring: up to 1000 points, linearly decaying to 500 at the
// buzzer, plus an answer-streak bonus of 100 per consecutive correct answer
// beyond the first (capped at +500).
function scoreAnswer(responseMs, timeLimitMs) {
  const ratio = Math.min(1, Math.max(0, responseMs / timeLimitMs));
  return Math.round(1000 * (1 - ratio / 2));
}
const streakBonus = (streak) => Math.min(Math.max(streak - 1, 0), 5) * 100;

// ---------- SSE ----------

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
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
    if (now - g.lastActivity > GAME_IDLE_TTL_MS) { endTimers(g); games.delete(pin); continue; }
    for (const s of g.hostStreams) s.write(': keepalive\n\n');
    for (const p of g.players.values()) for (const s of p.streams) s.write(': keepalive\n\n');
  }
}, 20000).unref();

const toHosts = (g, msg) => g.hostStreams.forEach((s) => push(s, msg));
const toPlayer = (p, msg) => p.streams.forEach((s) => push(s, msg));

// ---------- game logic ----------

function playerList(g) {
  return [...g.players.values()].map((p) => ({
    id: p.id, name: p.name, score: p.score, avatar: p.avatar, connected: p.streams.size > 0,
  }));
}

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

function publicQuestion(g) {
  const q = currentQ(g);
  return { index: g.qIndex, total: g.quiz.questions.length, text: q.text, choices: q.choices, time: q.time, image: q.image };
}

function hostSnapshot(g) {
  const base = { type: 'STATE', state: g.state, pin: g.pin, title: g.quiz.title, players: playerList(g) };
  if (g.state === S.GET_READY) return { ...base, question: publicQuestion(g), startsAt: g.questionStartsAt };
  if (g.state === S.QUESTION) {
    return { ...base, question: publicQuestion(g), endsAt: g.endsAt, answeredCount: g.answers.size };
  }
  if (g.state === S.REVEAL) return { ...base, question: publicQuestion(g), reveal: g.lastReveal };
  if (g.state === S.SCOREBOARD) return { ...base, question: publicQuestion(g), leaderboard: leaderboard(g, 5) };
  if (g.state === S.ENDED) return { ...base, leaderboard: leaderboard(g, 10) };
  return base;
}

// What a (re)connecting player should see right now — the equivalent of the
// recovery snapshot a real-time quiz client restores from after a reconnect.
function playerSnapshot(g, p) {
  const base = { type: 'STATE', state: g.state, pin: g.pin, name: p.name, score: p.score, avatar: p.avatar };
  if (g.state === S.GET_READY) return { ...base, question: publicQuestion(g), startsAt: g.questionStartsAt };
  if (g.state === S.QUESTION) {
    const answered = g.answers.has(p.id);
    return { ...base, question: publicQuestion(g), endsAt: g.endsAt, answered };
  }
  if (g.state === S.REVEAL) return { ...base, result: p.lastResult || null };
  if (g.state === S.SCOREBOARD) return { ...base, rank: rankOf(g, p), total: g.players.size };
  if (g.state === S.ENDED) return { ...base, rank: rankOf(g, p), total: g.players.size };
  return base;
}

function leaderboard(g, n) {
  return ranked(g).slice(0, n).map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, streak: p.streak, avatar: p.avatar }));
}

function broadcastState(g) {
  toHosts(g, hostSnapshot(g));
  for (const p of g.players.values()) toPlayer(p, playerSnapshot(g, p));
}

function startGetReady(g) {
  endTimers(g);
  g.state = S.GET_READY;
  g.questionStartsAt = Date.now() + GET_READY_MS;
  g.answers = new Map();
  for (const p of g.players.values()) p.lastResult = null;
  broadcastState(g);
  g.timer = setTimeout(() => startQuestion(g), GET_READY_MS);
}

function startQuestion(g) {
  endTimers(g);
  const q = currentQ(g);
  g.state = S.QUESTION;
  g.questionOpenedAt = Date.now();
  g.endsAt = g.questionOpenedAt + q.time * 1000;
  broadcastState(g);
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + ANSWER_GRACE_MS);
}

function endQuestion(g) {
  if (g.state !== S.QUESTION) return;
  endTimers(g);
  const q = currentQ(g);
  const counts = q.choices.map(() => 0);

  for (const p of g.players.values()) {
    const a = g.answers.get(p.id);
    if (a) counts[a.choice]++;
    const isCorrect = !!a && q.correct.includes(a.choice);
    let points = 0;
    if (isCorrect) {
      p.streak += 1;
      points = scoreAnswer(a.responseMs, q.time * 1000) + streakBonus(p.streak);
    } else {
      p.streak = 0;
    }
    p.score += points;
    p.lastResult = { answered: !!a, choice: a ? a.choice : null, isCorrect, points, streak: p.streak };
  }

  // Ranks are computed after every score is updated, then attached per player.
  const order = ranked(g);
  order.forEach((p, i) => {
    const ahead = order[i - 1];
    p.lastResult = { ...p.lastResult, totalScore: p.score, rank: i + 1, total: order.length,
      behind: ahead ? { name: ahead.name, gap: ahead.score - p.score } : null };
  });

  g.state = S.REVEAL;
  g.lastReveal = { correct: q.correct, counts, answeredCount: g.answers.size };
  broadcastState(g);
}

function goNext(g) {
  if (g.state === S.REVEAL) {
    g.state = S.SCOREBOARD;
    broadcastState(g);
  } else if (g.state === S.SCOREBOARD) {
    if (g.qIndex + 1 < g.quiz.questions.length) { g.qIndex++; startGetReady(g); }
    else { g.state = S.ENDED; broadcastState(g); }
  }
}

// ---------- HTTP routing ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const pretty = { '/': '/index.html', '/host': '/host.html', '/play': '/play.html' };
  const rel = pretty[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'games', pin, action]

  if (req.method === 'GET' && url.pathname === '/api/info') {
    return sendJson(res, 200, { lanUrls: lanUrls(), port: PORT });
  }

  if (req.method === 'POST' && url.pathname === '/api/games') {
    const body = await readBody(req);
    const quiz = validateQuiz(body.quiz);
    const g = {
      pin: newPin(), hostKey: id(), quiz, state: S.LOBBY, qIndex: 0,
      players: new Map(), hostStreams: new Set(), answers: new Map(),
      timer: null, lastActivity: Date.now(),
    };
    games.set(g.pin, g);
    return sendJson(res, 201, { pin: g.pin, hostKey: g.hostKey });
  }

  if (parts[0] !== 'api' || parts[1] !== 'games' || !parts[2]) return sendJson(res, 404, { error: 'Not found' });
  const g = games.get(parts[2]);
  const action = parts[3];
  if (!g) return sendJson(res, 404, { error: 'We could not find a game with that PIN.', code: 'PIN_NOT_FOUND' });
  touch(g);

  // GET /api/games/:pin — does the game exist (used to validate a typed PIN)?
  if (req.method === 'GET' && !action) {
    return sendJson(res, 200, { pin: g.pin, state: g.state, title: g.quiz.title });
  }

  // Host event stream
  if (req.method === 'GET' && action === 'host-events') {
    if (url.searchParams.get('key') !== g.hostKey) return sendJson(res, 403, { error: 'Not the host' });
    const s = openStream(req, res);
    g.hostStreams.add(s);
    push(s, hostSnapshot(g));
    req.on('close', () => g.hostStreams.delete(s));
    return;
  }

  if (req.method === 'POST' && action === 'host-action') {
    const body = await readBody(req);
    if (body.key !== g.hostKey) return sendJson(res, 403, { error: 'Not the host' });
    switch (body.action) {
      case 'start':
        if (g.state !== S.LOBBY) return sendJson(res, 409, { error: 'Game already started' });
        if (g.players.size === 0) return sendJson(res, 409, { error: 'Wait for at least one player' });
        g.qIndex = 0;
        startGetReady(g);
        break;
      case 'skip': // end the open question early
        if (g.state === S.QUESTION) endQuestion(g);
        break;
      case 'next':
        goNext(g);
        break;
      case 'kick': {
        const p = g.players.get(String(body.playerId));
        if (p) {
          toPlayer(p, { type: 'KICKED' });
          p.streams.forEach((s) => s.end());
          g.players.delete(p.id);
          g.answers.delete(p.id);
          toHosts(g, hostSnapshot(g));
        }
        break;
      }
      case 'end':
        endTimers(g);
        g.state = S.ENDED;
        broadcastState(g);
        break;
      default:
        return sendJson(res, 400, { error: 'Unknown action' });
    }
    return sendJson(res, 200, { ok: true, state: g.state });
  }

  if (req.method === 'POST' && action === 'join') {
    const body = await readBody(req);
    const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name) return sendJson(res, 400, { error: 'Enter a nickname', code: 'USER_INPUT' });
    if (g.state === S.ENDED) return sendJson(res, 409, { error: 'This game has ended', code: 'GAME_ENDED' });
    if (g.players.size >= MAX_PLAYERS) return sendJson(res, 409, { error: 'This game is full', code: 'MAX_PLAYERS_REACHED' });
    const taken = [...g.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return sendJson(res, 409, { error: 'That nickname is taken — try another', code: 'NICKNAME_EXISTS' });
    const p = {
      id: id(6), token: id(), name, score: 0, streak: 0, joinedAt: Date.now(),
      avatar: pickAvatar(g), streams: new Set(), lastResult: null,
    };
    g.players.set(p.id, p);
    toHosts(g, { type: 'PLAYERS', players: playerList(g) });
    return sendJson(res, 201, { playerId: p.id, token: p.token, name: p.name, avatar: p.avatar });
  }

  // Player changes their character / accessory (shown live on the host screen).
  if (req.method === 'POST' && action === 'avatar') {
    const body = await readBody(req);
    const p = [...g.players.values()].find((x) => x.token === body.token);
    if (!p) return sendJson(res, 404, { error: 'Player not found' });
    if (g.state === S.ENDED) return sendJson(res, 409, { error: 'This game has ended' });
    const character = Number(body.character);
    const accessory = Number(body.accessory);
    if (!Number.isInteger(character) || character < 0 || character >= AVATAR_CHARACTERS
      || !Number.isInteger(accessory) || accessory < 0 || accessory >= AVATAR_ACCESSORIES) {
      return sendJson(res, 400, { error: 'Invalid avatar' });
    }
    p.avatar = { character, accessory };
    toHosts(g, { type: 'PLAYERS', players: playerList(g) });
    return sendJson(res, 200, { avatar: p.avatar });
  }

  // Player event stream (token identifies the player; reconnects resume)
  if (req.method === 'GET' && action === 'events') {
    const token = url.searchParams.get('token');
    const p = [...g.players.values()].find((x) => x.token === token);
    if (!p) return sendJson(res, 404, { error: 'Player not found', code: 'PLAYER_NOT_FOUND' });
    const s = openStream(req, res);
    p.streams.add(s);
    push(s, playerSnapshot(g, p));
    toHosts(g, { type: 'PLAYERS', players: playerList(g) });
    req.on('close', () => { p.streams.delete(s); toHosts(g, { type: 'PLAYERS', players: playerList(g) }); });
    return;
  }

  if (req.method === 'POST' && action === 'answer') {
    const receivedAt = Date.now();
    const body = await readBody(req);
    const p = [...g.players.values()].find((x) => x.token === body.token);
    if (!p) return sendJson(res, 404, { error: 'Player not found' });
    if (g.state !== S.QUESTION || Number(body.questionIndex) !== g.qIndex) {
      return sendJson(res, 409, { error: 'Question is closed', code: 'QUESTION_CLOSED' });
    }
    if (receivedAt > g.endsAt + ANSWER_GRACE_MS) return sendJson(res, 409, { error: 'Too late', code: 'QUESTION_CLOSED' });
    if (g.answers.has(p.id)) return sendJson(res, 409, { error: 'Already answered', code: 'ALREADY_ANSWERED' });
    const choice = Number(body.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= currentQ(g).choices.length) {
      return sendJson(res, 400, { error: 'Invalid answer' });
    }
    // Response time is measured on the server clock, so a slow phone clock
    // cannot earn extra speed points.
    g.answers.set(p.id, { choice, responseMs: Math.max(0, receivedAt - g.questionOpenedAt) });
    toHosts(g, { type: 'ANSWER_COUNT', answeredCount: g.answers.size, playerCount: g.players.size });
    if (g.answers.size >= g.players.size) setTimeout(() => endQuestion(g), 300);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QuizBlitz running`);
  console.log(`  This computer : http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  Same Wi-Fi    : ${u}`);
  console.log(`Open /host on this computer to start a game.`);
});
