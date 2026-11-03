// Persistent data in SQLite via Node's built-in `node:sqlite` (Node 22.13+),
// so QuizBlitz still has zero npm dependencies:
//   users, sessions   host accounts (scrypt-hashed passwords, hashed session tokens)
//   quizzes           each host's quiz library
//   games, players, answers   game history shown on /reports
// Live games stay in memory; a game is written here once, when it ends.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Q = require('./questions');

const DIFFICULT_BELOW = 0.35; // questions answered correctly by < 35% of players
const NEEDS_HELP_BELOW = 0.35; // players with < 35% correct answers
const SESSION_DAYS = 30;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      quiz_json TEXT NOT NULL,
      plays INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes(owner_id, updated_at);
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pin TEXT NOT NULL,
      title TEXT NOT NULL,
      quiz_json TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      questions_played INTEGER NOT NULL,
      completed INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      avatar_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      rank INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      question_index INTEGER NOT NULL,
      choice INTEGER,
      correct INTEGER NOT NULL,
      points INTEGER NOT NULL,
      response_ms INTEGER,
      PRIMARY KEY (player_id, question_index)
    );
    CREATE INDEX IF NOT EXISTS answers_game ON answers(game_id);
  `);
  // Columns added after the first release (databases created earlier are upgraded in place).
  addColumn(db, 'games', 'owner_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');
  addColumn(db, 'answers', 'response_json', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS games_owner ON games(owner_id, ended_at)');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return db;
}

function addColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

// ---------------------------------------------------------------- accounts

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'base64'));
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createUser(db, { email, name, password }) {
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw Object.assign(new Error('Enter a valid email address'), { status: 400 });
  if (!n) throw Object.assign(new Error('Enter your name'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('Use a password of at least 8 characters'), { status: 400 });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) {
    throw Object.assign(new Error('An account with this email already exists. Sign in instead.'), { status: 409 });
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(e, n, hashPassword(String(password)), Date.now());
  return { id: Number(lastInsertRowid), email: e, name: n };
}

function checkLogin(db, email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  // Run scrypt even for unknown emails so response time does not reveal which emails exist.
  const ok = verifyPassword(String(password || ''), u ? u.pass_hash : DUMMY_HASH);
  return u && ok ? { id: u.id, email: u.email, name: u.name } : null;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, Date.now() + SESSION_DAYS * 86400000);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), Date.now());
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

// ---------------------------------------------------------------- quiz library

const quizRow = (r) => {
  const quiz = JSON.parse(r.quiz_json);
  return { id: r.id, title: r.title, questions: quiz.questions.length, types: [...new Set(quiz.questions.map((q) => q.type))],
    plays: r.plays, createdAt: r.created_at, updatedAt: r.updated_at };
};

function listQuizzes(db, ownerId) {
  return db.prepare('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId).map(quizRow);
}

function getQuiz(db, ownerId, id) {
  const r = db.prepare('SELECT * FROM quizzes WHERE id = ? AND owner_id = ?').get(id, ownerId);
  return r ? { ...quizRow(r), quiz: JSON.parse(r.quiz_json) } : null;
}

function saveQuiz(db, ownerId, quiz, id = null) {
  const now = Date.now();
  if (id) {
    const res = db.prepare('UPDATE quizzes SET title = ?, quiz_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
      .run(quiz.title, JSON.stringify(quiz), now, id, ownerId);
    return res.changes ? id : null;
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE owner_id = ?').get(ownerId).n;
  if (count >= 500) throw Object.assign(new Error('Your library is full (500 quizzes). Delete some first.'), { status: 409 });
  return Number(db.prepare('INSERT INTO quizzes (owner_id, title, quiz_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, quiz.title, JSON.stringify(quiz), now, now).lastInsertRowid);
}

function deleteQuiz(db, ownerId, id) {
  return db.prepare('DELETE FROM quizzes WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0;
}

function countPlay(db, ownerId, id) {
  db.prepare('UPDATE quizzes SET plays = plays + 1 WHERE id = ? AND owner_id = ?').run(id, ownerId);
}

// ---------------------------------------------------------------- game history

/** Saves a finished game. `history[q]` maps playerId -> {answer, correct, points, responseMs}. */
function saveGame(db, g, rankedPlayers, completed) {
  const played = g.history.length;
  if (!played || !rankedPlayers.length) return null;
  db.exec('BEGIN');
  try {
    const { lastInsertRowid: gameId } = db.prepare(
      'INSERT INTO games (pin, title, quiz_json, started_at, ended_at, questions_played, completed, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(g.pin, g.quiz.title, JSON.stringify(g.quiz), g.startedAt, Date.now(), played, completed ? 1 : 0, g.ownerId ?? null);
    const insPlayer = db.prepare('INSERT INTO players (game_id, name, avatar_json, score, rank) VALUES (?, ?, ?, ?, ?)');
    const insAnswer = db.prepare(`INSERT INTO answers (game_id, player_id, question_index, choice, correct, points, response_ms, response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    rankedPlayers.forEach((p, i) => {
      const { lastInsertRowid: pid } = insPlayer.run(gameId, p.name, JSON.stringify(p.avatar), p.score, i + 1);
      g.history.forEach((byPlayer, q) => {
        const a = byPlayer[p.id];
        if (!a) return;
        insAnswer.run(gameId, pid, q, Number.isInteger(a.answer) ? a.answer : null, a.correct ? 1 : 0, a.points, a.responseMs,
          a.answer === null || a.answer === undefined ? null : JSON.stringify(a.answer));
      });
    });
    db.exec('COMMIT');
    return Number(gameId);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Hosts see their own games; without an account, only games hosted without one.
const ownerClause = (ownerId) => (ownerId ? 'g.owner_id = ?' : 'g.owner_id IS NULL');
const ownerArgs = (ownerId) => (ownerId ? [ownerId] : []);

function listReports(db, ownerId) {
  return db.prepare(`
    SELECT g.id, g.title, g.pin, g.started_at, g.ended_at, g.questions_played, g.completed, g.quiz_json,
           (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS players
    FROM games g WHERE ${ownerClause(ownerId)} ORDER BY g.ended_at DESC LIMIT 500`).all(...ownerArgs(ownerId)).map((r) => {
    const report = getReport(db, r.id, ownerId);
    return {
      id: r.id, title: r.title, pin: r.pin, startedAt: r.started_at, endedAt: r.ended_at,
      questionsPlayed: r.questions_played, completed: !!r.completed, players: r.players, accuracy: report.summary.accuracy,
    };
  });
}

function getReport(db, id, ownerId) {
  const g = db.prepare(`SELECT * FROM games g WHERE g.id = ? AND ${ownerClause(ownerId)}`).get(id, ...ownerArgs(ownerId));
  if (!g) return null;
  const quiz = JSON.parse(g.quiz_json);
  const n = g.questions_played;
  const questions = quiz.questions.slice(0, n).map((q) => ({ type: 'quiz', points: 'standard', ...q })); // older reports had no type
  const scoredIdx = questions.map((q, i) => (Q.isScored(q) ? i : -1)).filter((i) => i >= 0);
  const players = db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY rank').all(id);
  const answers = db.prepare('SELECT * FROM answers WHERE game_id = ?').all(id);
  const byPlayer = new Map(players.map((p) => [p.id, []]));
  for (const a of answers) {
    const value = a.response_json !== null ? JSON.parse(a.response_json) : a.choice;
    byPlayer.get(a.player_id)[a.question_index] = { ...a, value };
  }

  const qStats = questions.map((q, i) => {
    const given = [];
    let correct = 0; let totalMs = 0;
    for (const p of players) {
      const a = byPlayer.get(p.id)[i];
      if (!a || a.value === null || a.value === undefined) continue;
      given.push(a.value); totalMs += a.response_ms; correct += a.correct;
    }
    const scored = Q.isScored(q);
    const pct = scored && players.length ? correct / players.length : null;
    return { index: i, type: q.type, text: q.text, time: q.time, points: q.points, scored,
      correctText: Q.describeCorrect(q), choices: q.choices || null, correctChoices: q.correct || [],
      summary: Q.revealSummary(q, given), answered: given.length, unanswered: players.length - given.length,
      correct, correctPct: pct, avgMs: given.length ? Math.round(totalMs / given.length) : null,
      difficult: scored && pct < DIFFICULT_BELOW };
  });

  const playerRows = players.map((p) => {
    const list = byPlayer.get(p.id);
    const correct = scoredIdx.filter((i) => list[i]?.correct).length;
    const answered = questions.filter((_, i) => list[i] && list[i].value !== null && list[i].value !== undefined).length;
    const acc = scoredIdx.length ? correct / scoredIdx.length : null;
    return { rank: p.rank, name: p.name, avatar: JSON.parse(p.avatar_json), score: p.score, correct, answered,
      unanswered: n - answered, accuracy: acc, needsHelp: acc !== null && acc < NEEDS_HELP_BELOW, didNotFinish: answered < n,
      answers: questions.map((q, i) => {
        const a = list[i];
        if (!a || a.value === null || a.value === undefined) return null;
        return { text: Q.describeAnswer(q, a.value), choice: Number.isInteger(a.value) ? a.value : null,
          correct: !!a.correct, scored: Q.isScored(q), points: a.points, ms: a.response_ms };
      }) };
  });

  const totalCorrect = playerRows.reduce((s, p) => s + p.correct, 0);
  return {
    id: g.id, title: g.title, pin: g.pin, startedAt: g.started_at, endedAt: g.ended_at, completed: !!g.completed,
    summary: { players: players.length, questions: n, scoredQuestions: scoredIdx.length, questionsInQuiz: quiz.questions.length,
      accuracy: players.length && scoredIdx.length ? totalCorrect / (players.length * scoredIdx.length) : null,
      averageScore: players.length ? Math.round(playerRows.reduce((s, p) => s + p.score, 0) / players.length) : 0,
      difficult: qStats.filter((q) => q.difficult).length, needHelp: playerRows.filter((p) => p.needsHelp).length,
      didNotFinish: playerRows.filter((p) => p.didNotFinish).length },
    thresholds: { difficultBelow: DIFFICULT_BELOW, needsHelpBelow: NEEDS_HELP_BELOW },
    questions: qStats, players: playerRows,
  };
}

function deleteReport(db, id, ownerId) {
  return db.prepare(`DELETE FROM games WHERE id = ? AND ${ownerClause(ownerId).replace(/g\./g, '')}`).run(id, ...ownerArgs(ownerId)).changes > 0;
}

// Spreadsheet-safe CSV: quotes everything and neutralises formula injection (=, +, -, @).
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function reportCsv(r) {
  const head = ['Rank', 'Player', 'Total score', 'Correct', 'Accuracy %', 'Unanswered'];
  r.questions.forEach((q, i) => head.push(`Q${i + 1} answer`, `Q${i + 1} correct`, `Q${i + 1} points`, `Q${i + 1} time (s)`));
  const rows = r.players.map((p) => {
    const row = [p.rank, p.name, p.score, p.correct, p.accuracy === null ? '' : Math.round(p.accuracy * 100), p.unanswered];
    p.answers.forEach((a, i) => {
      if (!a) row.push('(no answer)', r.questions[i].scored ? 'no' : '', 0, '');
      else row.push(a.text, a.scored ? (a.correct ? 'yes' : 'no') : '', a.points, (a.ms / 1000).toFixed(1));
    });
    return row;
  });
  const qSection = [[], ['Question', 'Type', 'Correct answer', 'Correct %', 'Answered', 'Average time (s)', 'Difficult'],
    ...r.questions.map((q, i) => [`Q${i + 1}: ${q.text}`, q.type, q.correctText, q.correctPct === null ? '' : Math.round(q.correctPct * 100),
      q.answered, q.avgMs === null ? '' : (q.avgMs / 1000).toFixed(1), q.difficult ? 'yes' : 'no'])];
  return '﻿' + [head, ...rows, ...qSection].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  open, createUser, checkLogin, createSession, sessionUser, deleteSession,
  listQuizzes, getQuiz, saveQuiz, deleteQuiz, countPlay,
  saveGame, listReports, getReport, deleteReport, reportCsv,
};
