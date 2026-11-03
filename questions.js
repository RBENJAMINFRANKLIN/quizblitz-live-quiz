// Question types: validation, the public (answer-free) view sent to phones,
// answer checking/scoring, reveal summaries and report statistics.
//
// Types (modelled on Kahoot's question types):
//   quiz       2-4 choices, one or more correct (player picks one)
//   truefalse  True / False
//   typeanswer player types the answer; up to 4 accepted spellings
//   slider     player picks a number; correct within a tolerance
//   puzzle     put 3-4 items in the right order
//   droppin    tap the right spot on an image
//   poll       2-4 choices, no right answer, no points
//   wordcloud  short free text, shown as a word cloud, no points
//   openended  longer free text, shown as a list, no points

const { cleanText } = require('./filter');

const TYPES = ['quiz', 'truefalse', 'typeanswer', 'slider', 'puzzle', 'droppin', 'poll', 'wordcloud', 'openended'];
const UNSCORED = new Set(['poll', 'wordcloud', 'openended']);
const POINTS = { standard: 1, double: 2, none: 0 };

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => (typeof v === 'number' ? v : Number(v));
const fail = (i, msg) => { throw new Error(`Question ${i + 1}: ${msg}`); };

// Canonical form for comparing typed answers: case, accents, punctuation and spacing ignored.
function canon(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function validateQuestion(qq, i) {
  const type = TYPES.includes(qq.type) ? qq.type : 'quiz';
  const text = str(qq.text, 200);
  if (!text) fail(i, 'add the question text');
  const time = Math.min(240, Math.max(5, Math.round(num(qq.time) || 20)));
  const image = str(qq.image, 500);
  // Full http(s) links, or images served by QuizBlitz itself (e.g. /sample/solar-system.svg).
  if (image && !/^https?:\/\/\S+$/i.test(image) && !/^\/[\w./-]+\.(png|jpe?g|gif|svg|webp)$/i.test(image)) fail(i, 'the image must be an http(s) link');
  const points = UNSCORED.has(type) ? 'none' : (POINTS[qq.points] !== undefined ? qq.points : 'standard');
  const base = { type, text, time, image, points };

  if (type === 'quiz' || type === 'poll') {
    const choices = (Array.isArray(qq.choices) ? qq.choices : []).map((c) => str(c, 80)).filter(Boolean);
    if (choices.length < 2 || choices.length > 4) fail(i, 'needs 2-4 answers');
    if (type === 'poll') return { ...base, choices, correct: [] };
    const correct = [...new Set([].concat(qq.correct ?? []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n < choices.length);
    if (!correct.length) fail(i, 'mark at least one correct answer');
    return { ...base, choices, correct };
  }
  if (type === 'truefalse') {
    const c = Number([].concat(qq.correct ?? 0)[0]);
    return { ...base, choices: ['True', 'False'], correct: [c === 1 ? 1 : 0] };
  }
  if (type === 'typeanswer') {
    const accepted = [...new Set((Array.isArray(qq.accepted) ? qq.accepted : []).map((a) => str(a, 20)).filter(Boolean))].slice(0, 4);
    if (!accepted.length) fail(i, 'add at least one accepted answer');
    return { ...base, accepted };
  }
  if (type === 'slider') {
    const min = num(qq.min); const max = num(qq.max); const correct = num(qq.answer);
    const step = num(qq.step) > 0 ? num(qq.step) : 1;
    const tolerance = Math.max(0, num(qq.tolerance) || 0);
    if (![min, max, correct].every(Number.isFinite) || min >= max) fail(i, 'set a minimum below the maximum');
    if (correct < min || correct > max) fail(i, 'the correct value must be between min and max');
    if ((max - min) / step > 10000) fail(i, 'the step is too small for that range');
    return { ...base, min, max, step, answer: correct, tolerance, unit: str(qq.unit, 12) };
  }
  if (type === 'puzzle') {
    const items = (Array.isArray(qq.items) ? qq.items : []).map((c) => str(c, 60)).filter(Boolean);
    if (items.length < 3 || items.length > 4) fail(i, 'needs 3-4 items to put in order');
    return { ...base, items };
  }
  if (type === 'droppin') {
    if (!image) fail(i, 'a drop-pin question needs an image link');
    const x = num(qq.target?.x); const y = num(qq.target?.y); const r = num(qq.target?.r);
    if (![x, y].every((v) => v >= 0 && v <= 1)) fail(i, 'place the correct spot on the image');
    return { ...base, target: { x, y, r: Math.min(0.5, Math.max(0.02, Number.isFinite(r) ? r : 0.1)) } };
  }
  if (type === 'wordcloud') return { ...base, maxLength: 20 };
  return { ...base, maxLength: 120 }; // openended
}

function validateQuiz(q) {
  if (!q || typeof q !== 'object') throw new Error('Quiz is missing');
  const title = str(q.title, 80) || 'Untitled quiz';
  if (!Array.isArray(q.questions) || q.questions.length === 0) throw new Error('Add at least one question');
  if (q.questions.length > 100) throw new Error('Too many questions (max 100)');
  return { title, questions: q.questions.map(validateQuestion) };
}

function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Game options applied once when a game is created. Puzzle items are always shown shuffled. */
function prepareForGame(quiz, opts) {
  let questions = quiz.questions.map((q) => ({ ...q }));
  if (opts.shuffleQuestions) questions = shuffle(questions);
  questions = questions.map((q) => {
    if (opts.shuffleAnswers && (q.type === 'quiz' || q.type === 'poll')) {
      const order = shuffle(q.choices.map((_, i) => i));
      return { ...q, choices: order.map((i) => q.choices[i]), correct: q.correct.map((c) => order.indexOf(c)) };
    }
    if (q.type === 'puzzle') {
      let order = shuffle(q.items.map((_, i) => i));
      if (order.every((v, i) => v === i)) order = [...order.slice(1), order[0]]; // never start solved
      return { ...q, displayOrder: order };
    }
    return q;
  });
  return { ...quiz, questions };
}

/** What phones and the host see while the question is open: never the answer. */
function publicView(q, index, total, showOnDevices = true) {
  const v = { index, total, type: q.type, text: q.text, time: q.time, image: q.image, points: q.points, showOnDevices };
  if (q.choices) v.choices = q.choices;
  if (q.type === 'slider') Object.assign(v, { min: q.min, max: q.max, step: q.step, unit: q.unit });
  if (q.type === 'puzzle') v.items = q.displayOrder.map((id) => ({ id, text: q.items[id] }));
  if (q.maxLength) v.maxLength = q.maxLength;
  if (q.type === 'typeanswer') v.maxLength = 20;
  return v;
}

/** Validates a submitted answer; returns the normalised value or throws. */
function parseAnswer(q, body) {
  const raw = body.answer !== undefined ? body.answer : body.choice;
  switch (q.type) {
    case 'quiz': case 'truefalse': case 'poll': {
      const c = Number(raw);
      if (!Number.isInteger(c) || c < 0 || c >= q.choices.length) throw new Error('Invalid answer');
      return c;
    }
    case 'typeanswer': case 'wordcloud': case 'openended': {
      const max = q.type === 'openended' ? 120 : 20;
      const t = str(raw, max);
      if (!t) throw new Error('Type an answer');
      return t;
    }
    case 'slider': {
      const v = num(raw);
      if (!Number.isFinite(v) || v < q.min || v > q.max) throw new Error('Invalid answer');
      return v;
    }
    case 'puzzle': {
      if (!Array.isArray(raw) || raw.length !== q.items.length) throw new Error('Put every item in order');
      const ids = raw.map(Number);
      if (new Set(ids).size !== ids.length || ids.some((x) => !Number.isInteger(x) || x < 0 || x >= q.items.length)) throw new Error('Invalid order');
      return ids;
    }
    case 'droppin': {
      const x = num(raw?.x); const y = num(raw?.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error('Invalid pin');
      return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    }
    default: throw new Error('Invalid answer');
  }
}

/** Correctness and a 0..1 accuracy factor (slider answers inside the margin score less the further off they are). */
function judge(q, a) {
  switch (q.type) {
    case 'quiz': case 'truefalse': return { correct: q.correct.includes(a), factor: 1 };
    case 'typeanswer': return { correct: q.accepted.some((x) => canon(x) === canon(a)), factor: 1 };
    case 'slider': {
      const d = Math.abs(a - q.answer);
      if (d > q.tolerance + 1e-9) return { correct: false, factor: 0 };
      return { correct: true, factor: q.tolerance ? 1 - 0.5 * (d / q.tolerance) : 1 };
    }
    case 'puzzle': return { correct: a.every((id, i) => id === i), factor: 1 };
    case 'droppin': {
      const d = Math.hypot(a.x - q.target.x, a.y - q.target.y);
      return { correct: d <= q.target.r, factor: 1 };
    }
    default: return { correct: false, factor: 0 }; // unscored types
  }
}

const isScored = (q) => !UNSCORED.has(q.type) && q.points !== 'none';
const multiplier = (q) => POINTS[q.points] ?? 1;

/** Summary shown on the host's reveal screen (and to phones where useful). */
function revealSummary(q, answers /* array of parsed answers */, filter = cleanText) {
  const base = { type: q.type, answeredCount: answers.length, scored: isScored(q) };
  if (q.choices) {
    const counts = q.choices.map(() => 0);
    answers.forEach((a) => { counts[a]++; });
    return { ...base, counts, correct: q.correct || [] };
  }
  if (q.type === 'typeanswer' || q.type === 'wordcloud' || q.type === 'openended') {
    const map = new Map();
    for (const a of answers) {
      const key = canon(a);
      const e = map.get(key) || { text: a, count: 0 };
      e.count++;
      map.set(key, e);
    }
    const items = [...map.values()].map((e) => ({ ...e, text: filter(e.text) }))
      .filter((e) => e.text) // hidden by the word filter
      .sort((a, b) => b.count - a.count).slice(0, q.type === 'openended' ? 40 : 30);
    if (q.type === 'typeanswer') items.forEach((e) => { e.correct = judge(q, e.text).correct; });
    return { ...base, responses: items, accepted: q.accepted };
  }
  if (q.type === 'slider') {
    const avg = answers.length ? answers.reduce((s, a) => s + a, 0) / answers.length : null;
    return { ...base, answer: q.answer, tolerance: q.tolerance, min: q.min, max: q.max, unit: q.unit, values: answers.slice(0, 200), average: avg };
  }
  if (q.type === 'puzzle') {
    return { ...base, order: q.items, correctCount: answers.filter((a) => judge(q, a).correct).length };
  }
  if (q.type === 'droppin') {
    return { ...base, target: q.target, pins: answers.slice(0, 200).map((a) => ({ ...a, correct: judge(q, a).correct })) };
  }
  return base;
}

/** Human-readable form of an answer for reports and CSV. */
function describeAnswer(q, a) {
  if (a === null || a === undefined) return '';
  if (q.choices) return q.choices[a] ?? '';
  if (q.type === 'puzzle') return a.map((id) => q.items[id]).join(' → ');
  if (q.type === 'droppin') return `(${Math.round(a.x * 100)}%, ${Math.round(a.y * 100)}%)`;
  if (q.type === 'slider') return `${a}${q.unit ? ` ${q.unit}` : ''}`;
  return String(a);
}

function describeCorrect(q) {
  switch (q.type) {
    case 'quiz': case 'truefalse': return q.correct.map((c) => q.choices[c]).join(' / ');
    case 'typeanswer': return q.accepted.join(' / ');
    case 'slider': return `${q.answer}${q.unit ? ` ${q.unit}` : ''}${q.tolerance ? ` (±${q.tolerance})` : ''}`;
    case 'puzzle': return q.items.join(' → ');
    case 'droppin': return 'Marked area on the image';
    default: return '(no correct answer)';
  }
}

module.exports = {
  TYPES, validateQuiz, prepareForGame, publicView, parseAnswer, judge, isScored, multiplier,
  revealSummary, describeAnswer, describeCorrect, canon, shuffle,
};
