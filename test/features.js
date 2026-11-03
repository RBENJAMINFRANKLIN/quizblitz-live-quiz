// API test for question types, points options, lobby lock, nickname safety,
// accounts, the quiz library and per-account reports.
// Usage: node test/features.js   (server must be running on BASE, default :3000)
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3000';

function client() {
  let cookie = '';
  return async function call(path, body, method) {
    const res = await fetch(BASE + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', 'X-QuizBlitz': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text };
  };
}

function listen(path) {
  const msgs = []; const waiters = []; const ctrl = new AbortController();
  (async () => {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: ')); buf = buf.slice(i + 2);
        if (!line) continue;
        const m = JSON.parse(line.slice(6)); msgs.push(m);
        waiters.filter((w) => w.pred(m)).forEach((w) => { w.resolve(m); waiters.splice(waiters.indexOf(w), 1); });
      }
    }
  })().catch(() => {});
  return {
    waitFor: (pred, ms = 10000) => {
      const hit = msgs.find(pred);
      if (hit) { msgs.splice(msgs.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => { waiters.push({ pred, resolve }); setTimeout(() => reject(new Error('timeout')), ms); });
    },
    close: () => ctrl.abort(),
  };
}
const state = (s, idx) => (m) => m.type === 'STATE' && m.state === s && (idx === undefined || m.question?.index === idx);

const QUIZ = {
  title: 'Every question type',
  questions: [
    { type: 'quiz', text: 'Double points: 2+2?', choices: ['3', '4'], correct: [1], time: 5, points: 'double' },
    { type: 'truefalse', text: 'The sun is a star.', correct: [0], time: 5 },
    { type: 'typeanswer', text: 'Capital of France?', accepted: ['Paris'], time: 5 },
    { type: 'slider', text: 'Boiling point of water (C)?', min: 0, max: 200, step: 1, answer: 100, tolerance: 10, unit: 'C', time: 5 },
    { type: 'puzzle', text: 'Order smallest to largest', items: ['1', '2', '3'], time: 5 },
    { type: 'droppin', text: 'Tap the middle', image: 'https://example.com/map.png', target: { x: 0.5, y: 0.5, r: 0.1 }, time: 5 },
    { type: 'poll', text: 'Favourite colour?', choices: ['Red', 'Blue'], time: 5 },
    { type: 'wordcloud', text: 'One word for today', time: 5 },
    { type: 'openended', text: 'Any feedback?', time: 5 },
    { type: 'quiz', text: 'No points question', choices: ['a', 'b'], correct: [0], time: 5, points: 'none' },
  ],
};

(async () => {
  const anon = client();

  // ---- validation of question types
  assert.equal((await anon('/api/games', { quiz: { questions: [{ type: 'slider', text: 'x', min: 5, max: 1, answer: 3 }] } })).status, 400);
  assert.equal((await anon('/api/games', { quiz: { questions: [{ type: 'droppin', text: 'x', target: { x: 0.5, y: 0.5 } }] } })).status, 400, 'pin needs image');
  // CSRF header required to create a game
  const noHeader = await fetch(`${BASE}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz: QUIZ }) });
  assert.equal(noHeader.status, 403);

  // ---- accounts
  const ana = client(); const bob = client();
  const email = `ana${Date.now()}@example.com`;
  assert.equal((await ana('/api/auth/register', { email, name: 'Ana', password: 'short' })).status, 400);
  assert.equal((await ana('/api/auth/register', { email, name: 'Ana', password: 'correct horse' })).status, 201);
  assert.equal((await ana('/api/auth/register', { email, name: 'Ana', password: 'correct horse' })).status, 409);
  assert.equal((await ana('/api/auth/me')).body.user.name, 'Ana');
  assert.equal((await bob('/api/auth/login', { email, password: 'wrong password' })).status, 401);
  await bob('/api/auth/register', { email: `bob${Date.now()}@example.com`, name: 'Bob', password: 'another pass' });

  // ---- quiz library (create, read, update, duplicate, isolation, delete)
  assert.equal((await anon('/api/quizzes')).status, 401);
  const { body: { id: quizId } } = await ana('/api/quizzes', { quiz: QUIZ });
  assert.ok(quizId);
  assert.equal((await ana(`/api/quizzes/${quizId}`)).body.quiz.questions.length, 10);
  assert.equal((await ana(`/api/quizzes/${quizId}`, { quiz: { ...QUIZ, title: 'Renamed' } }, 'PUT')).status, 200);
  const dup = (await ana(`/api/quizzes/${quizId}/duplicate`, {})).body.id;
  const lib = (await ana('/api/quizzes')).body.quizzes;
  assert.deepEqual(lib.map((q) => q.title).sort(), ['Renamed', 'Renamed (copy)']);
  assert.ok(lib[0].types.includes('slider'));
  assert.equal((await bob(`/api/quizzes/${quizId}`)).status, 404, 'other users cannot read it');
  assert.equal((await bob(`/api/quizzes/${quizId}`, null, 'DELETE')).status, 404);
  assert.equal((await ana(`/api/quizzes/${dup}`, null, 'DELETE')).status, 200);

  // ---- host the library quiz with options
  assert.equal((await anon('/api/games', { quizId })).status, 401);
  const { body: { pin, hostKey } } = await ana('/api/games', { quizId, options: { nameGenerator: false, lockOnStart: true } });
  assert.equal((await ana('/api/quizzes')).body.quizzes.find((q) => q.id === quizId).plays, 1);
  const host = listen(`/api/games/${pin}/host-events?key=${hostKey}`);
  await host.waitFor(state('LOBBY'));
  const act = (action, extra = {}) => anon(`/api/games/${pin}/host-action`, { key: hostKey, action, ...extra });

  // ---- nickname safety (English, Hindi, Hinglish)
  for (const bad of ['fuck', 'Chutiya', 'b.c', 'भोसड़ी', 'M a d a r c h o d']) {
    const r = await anon(`/api/games/${pin}/join`, { name: bad });
    assert.equal(r.body.code, bad === 'b.c' ? 'NAME_NOT_ALLOWED' : 'NAME_NOT_ALLOWED', bad);
  }
  // ---- lobby lock
  await act('lock');
  assert.equal((await anon(`/api/games/${pin}/join`, { name: 'Late' })).body.code, 'GAME_LOCKED');
  await act('unlock');
  const p1 = (await anon(`/api/games/${pin}/join`, { name: 'Priya' })).body;
  const p2 = (await anon(`/api/games/${pin}/join`, { name: 'Rahul' })).body;
  const ev1 = listen(`/api/games/${pin}/events?token=${p1.token}`);
  const ev2 = listen(`/api/games/${pin}/events?token=${p2.token}`);
  await act('start');
  assert.equal((await anon(`/api/games/${pin}/join`, { name: 'TooLate' })).body.code, 'GAME_LOCKED', 'locked after start');

  // Priya answers everything right, Rahul everything wrong / differently.
  const answers = [
    [1, 0], [0, 1], ['  paris ', 'London'], [104, 150], [null, [2, 1, 0]],
    [{ x: 0.52, y: 0.49 }, { x: 0.9, y: 0.9 }], [0, 1], ['Happy', 'happy'], ['Great game!', 'chutiya'], [0, 1],
  ];
  const results = [];
  for (let i = 0; i < QUIZ.questions.length; i++) {
    const q = await ev1.waitFor(state('QUESTION', i), 12000);
    assert.equal(q.question.type, QUIZ.questions[i].type);
    assert.equal(q.question.correct, undefined, 'no answers leak');
    assert.equal(q.question.accepted, undefined);
    assert.equal(q.question.answer, undefined);
    assert.equal(q.question.target, undefined);
    let [a1, a2] = answers[i];
    if (q.question.type === 'puzzle') {
      assert.equal(q.question.items.length, 3);
      assert.notDeepEqual(q.question.items.map((x) => x.id), [0, 1, 2], 'puzzle starts shuffled');
      a1 = [0, 1, 2];
    }
    assert.equal((await anon(`/api/games/${pin}/answer`, { token: p1.token, questionIndex: i, answer: a1 })).status, 200);
    assert.equal((await anon(`/api/games/${pin}/answer`, { token: p2.token, questionIndex: i, answer: a2 })).status, 200);
    const reveal = await host.waitFor(state('REVEAL', i), 8000);
    const r1 = await ev1.waitFor(state('REVEAL', i));
    const r2 = await ev2.waitFor(state('REVEAL', i));
    results.push({ type: q.question.type, reveal: reveal.reveal, r1: r1.result, r2: r2.result });
    await act('next'); await host.waitFor(state('SCOREBOARD'));
    await act('next');
  }
  const by = (t) => results.filter((r) => r.type === t);
  const [dbl, nopts] = by('quiz');
  assert.ok(dbl.r1.isCorrect && dbl.r1.points > 1000, `double points: ${dbl.r1.points}`);
  assert.ok(nopts.r1.points === 0 && nopts.r1.scored === false, 'no-points question');
  assert.ok(by('truefalse')[0].r1.isCorrect && !by('truefalse')[0].r2.isCorrect);
  assert.ok(by('typeanswer')[0].r1.isCorrect, 'type answer ignores case and spaces');
  const sl = by('slider')[0];
  assert.ok(sl.r1.isCorrect && !sl.r2.isCorrect && sl.reveal.answer === 100);
  assert.ok(by('puzzle')[0].r1.isCorrect && !by('puzzle')[0].r2.isCorrect);
  const pinR = by('droppin')[0];
  assert.ok(pinR.r1.isCorrect && !pinR.r2.isCorrect && pinR.reveal.pins.length === 2);
  const poll = by('poll')[0];
  assert.deepEqual(poll.reveal.counts, [1, 1]);
  assert.ok(!poll.r1.scored && poll.r1.points === 0, JSON.stringify(poll.r1));
  const wc = by('wordcloud')[0];
  assert.deepEqual(wc.reveal.responses, [{ text: 'Happy', count: 2 }], 'word cloud groups case-insensitively');
  const oe = by('openended')[0];
  assert.deepEqual(oe.reveal.responses.map((x) => x.text), ['Great game!'], 'offensive free text hidden');
  assert.ok(results.every((r) => r.r2.streak === 0 || r.r2.isCorrect));

  const end = await host.waitFor(state('ENDED'), 8000);
  assert.ok(Number.isInteger(end.reportId));

  // ---- reports belong to the account that hosted
  const rep = await ana(`/api/reports/${end.reportId}`);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.summary.scoredQuestions, 6);
  assert.equal(rep.body.players[0].name, 'Priya');
  assert.equal(rep.body.players[0].correct, 6);
  const slQ = rep.body.questions.find((q) => q.type === 'slider');
  assert.equal(slQ.correctText, '100 C (±10)');
  assert.equal(rep.body.players[1].answers[4].text, '3 → 2 → 1');
  assert.ok(rep.body.questions.find((q) => q.type === 'poll').correctPct === null);
  assert.ok((await ana(`/api/reports/${end.reportId}/csv`)).text.includes('"slider"'));
  assert.equal((await bob(`/api/reports/${end.reportId}`)).status, 404, 'other accounts cannot see it');
  assert.ok(!(await bob('/api/reports')).body.reports.some((r) => r.id === end.reportId));
  assert.ok((await ana('/api/reports')).body.reports.some((r) => r.id === end.reportId));
  assert.ok(!(await anon('/api/reports')).body.reports.some((r) => r.id === end.reportId), 'not in the no-account list');

  // ---- friendly nickname generator
  const g2 = (await anon('/api/games', { quiz: QUIZ, options: { nameGenerator: true, shuffleAnswers: true, shuffleQuestions: true } })).body;
  assert.equal((await anon(`/api/games/${g2.pin}`)).body.nameGenerator, true);
  assert.equal((await anon(`/api/games/${g2.pin}/join`, { name: 'MyOwnName' })).body.code, 'USE_GENERATOR');
  const suggestion = (await anon(`/api/games/${g2.pin}/random-name`)).body.name;
  assert.match(suggestion, /^[A-Z][a-z]+[A-Z][a-z]+$/);
  assert.equal((await anon(`/api/games/${g2.pin}/join`, { name: suggestion })).status, 201);

  await ana('/api/auth/logout', {});
  assert.equal((await ana('/api/auth/me')).body.user, null);

  [host, ev1, ev2].forEach((s) => s.close());
  console.log('FEATURE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
