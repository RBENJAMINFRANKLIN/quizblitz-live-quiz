// Game history (reports) stored in SQLite, using Node's built-in `node:sqlite`
// module (Node 22.13+), so QuizBlitz still has zero npm dependencies.
// Live games stay in memory; a game is written here once, when it ends.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DIFFICULT_BELOW = 0.35; // questions answered correctly by < 35% of players
const NEEDS_HELP_BELOW = 0.35; // players with < 35% correct answers

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
  return db;
}

/** Saves a finished game. `history[q]` maps playerId -> {choice, correct, points, responseMs}. */
function saveGame(db, g, rankedPlayers, completed) {
  const played = g.history.length;
  if (!played || !rankedPlayers.length) return null;
  db.exec('BEGIN');
  try {
    const { lastInsertRowid: gameId } = db.prepare(
      'INSERT INTO games (pin, title, quiz_json, started_at, ended_at, questions_played, completed) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(g.pin, g.quiz.title, JSON.stringify(g.quiz), g.startedAt, Date.now(), played, completed ? 1 : 0);
    const insPlayer = db.prepare('INSERT INTO players (game_id, name, avatar_json, score, rank) VALUES (?, ?, ?, ?, ?)');
    const insAnswer = db.prepare('INSERT INTO answers (game_id, player_id, question_index, choice, correct, points, response_ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    rankedPlayers.forEach((p, i) => {
      const { lastInsertRowid: pid } = insPlayer.run(gameId, p.name, JSON.stringify(p.avatar), p.score, i + 1);
      g.history.forEach((byPlayer, q) => {
        const a = byPlayer[p.id];
        if (a) insAnswer.run(gameId, pid, q, a.choice, a.correct ? 1 : 0, a.points, a.responseMs);
      });
    });
    db.exec('COMMIT');
    return Number(gameId);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function listReports(db) {
  return db.prepare(`
    SELECT g.id, g.title, g.pin, g.started_at, g.ended_at, g.questions_played, g.completed,
           (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS players,
           (SELECT COALESCE(SUM(a.correct), 0) FROM answers a WHERE a.game_id = g.id) AS correct_answers
    FROM games g ORDER BY g.ended_at DESC LIMIT 500`).all().map((r) => ({
    id: r.id, title: r.title, pin: r.pin, startedAt: r.started_at, endedAt: r.ended_at,
    questionsPlayed: r.questions_played, completed: !!r.completed, players: r.players,
    accuracy: r.players && r.questions_played ? r.correct_answers / (r.players * r.questions_played) : null,
  }));
}

function getReport(db, id) {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!g) return null;
  const quiz = JSON.parse(g.quiz_json);
  const n = g.questions_played;
  const questions = quiz.questions.slice(0, n);
  const players = db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY rank').all(id);
  const answers = db.prepare('SELECT * FROM answers WHERE game_id = ?').all(id);
  const byPlayer = new Map(players.map((p) => [p.id, []]));
  for (const a of answers) byPlayer.get(a.player_id)[a.question_index] = a;

  const qStats = questions.map((q, i) => {
    const counts = q.choices.map(() => 0);
    let correct = 0; let answered = 0; let totalMs = 0;
    for (const p of players) {
      const a = byPlayer.get(p.id)[i];
      if (!a || a.choice === null) continue;
      answered++; counts[a.choice]++; totalMs += a.response_ms; correct += a.correct;
    }
    const pct = players.length ? correct / players.length : 0;
    return { index: i, text: q.text, choices: q.choices, correctChoices: q.correct, time: q.time, counts, answered,
      unanswered: players.length - answered, correct, correctPct: pct, avgMs: answered ? Math.round(totalMs / answered) : null,
      difficult: pct < DIFFICULT_BELOW };
  });

  const playerRows = players.map((p) => {
    const list = byPlayer.get(p.id);
    const correct = list.filter((a) => a && a.correct).length;
    const answered = list.filter((a) => a && a.choice !== null).length;
    const acc = n ? correct / n : 0;
    return { rank: p.rank, name: p.name, avatar: JSON.parse(p.avatar_json), score: p.score, correct, answered,
      unanswered: n - answered, accuracy: acc, needsHelp: acc < NEEDS_HELP_BELOW, didNotFinish: answered < n,
      answers: questions.map((_, i) => {
        const a = list[i];
        return a && a.choice !== null ? { choice: a.choice, correct: !!a.correct, points: a.points, ms: a.response_ms } : null;
      }) };
  });

  const totalCorrect = playerRows.reduce((s, p) => s + p.correct, 0);
  return {
    id: g.id, title: g.title, pin: g.pin, startedAt: g.started_at, endedAt: g.ended_at, completed: !!g.completed,
    summary: { players: players.length, questions: n, questionsInQuiz: quiz.questions.length,
      accuracy: players.length && n ? totalCorrect / (players.length * n) : null,
      averageScore: players.length ? Math.round(playerRows.reduce((s, p) => s + p.score, 0) / players.length) : 0,
      difficult: qStats.filter((q) => q.difficult).length, needHelp: playerRows.filter((p) => p.needsHelp).length,
      didNotFinish: playerRows.filter((p) => p.didNotFinish).length },
    thresholds: { difficultBelow: DIFFICULT_BELOW, needsHelpBelow: NEEDS_HELP_BELOW },
    questions: qStats, players: playerRows,
  };
}

function deleteReport(db, id) {
  return db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
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
    const row = [p.rank, p.name, p.score, p.correct, Math.round(p.accuracy * 100), p.unanswered];
    p.answers.forEach((a, i) => {
      if (!a) row.push('(no answer)', 'no', 0, '');
      else row.push(r.questions[i].choices[a.choice], a.correct ? 'yes' : 'no', a.points, (a.ms / 1000).toFixed(1));
    });
    return row;
  });
  const qSection = [[], ['Question', 'Correct %', 'Answered', 'Average time (s)', 'Difficult'],
    ...r.questions.map((q, i) => [`Q${i + 1}: ${q.text}`, Math.round(q.correctPct * 100), q.answered,
      q.avgMs === null ? '' : (q.avgMs / 1000).toFixed(1), q.difficult ? 'yes' : 'no'])];
  return '﻿' + [head, ...rows, ...qSection].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { open, saveGame, listReports, getReport, deleteReport, reportCsv };
