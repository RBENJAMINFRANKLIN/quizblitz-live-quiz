// End-to-end API test: host a 2-question game with 3 simulated players.
// Usage: node test/e2e.js   (server must be running on BASE, default :3000)
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3000';

async function call(path, body) {
  const res = await fetch(BASE + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: res.status, body: await res.json() };
}

// Minimal SSE reader that records messages and lets tests await a state.
function listen(path) {
  const msgs = [];
  const waiters = [];
  const ctrl = new AbortController();
  (async () => {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const m = JSON.parse(line.slice(6));
        msgs.push(m);
        waiters.filter((w) => w.pred(m)).forEach((w) => { w.resolve(m); waiters.splice(waiters.indexOf(w), 1); });
      }
    }
  })().catch(() => {});
  return {
    msgs,
    // `since` skips messages already seen, e.g. an earlier round's REVEAL.
    waitFor: (pred, ms = 10000, since = 0) => {
      const hit = msgs.slice(since).find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    close: () => ctrl.abort(),
  };
}

const state = (s, idx) => (m) => m.type === 'STATE' && m.state === s && (idx === undefined || m.question?.index === idx);

(async () => {
  const quiz = { title: 'Test', questions: [
    { text: 'Q1', choices: ['a', 'b', 'c', 'd'], correct: [1], time: 5 },
    { text: 'Q2', choices: ['T', 'F'], correct: [0], time: 5 },
  ] };

  // invalid quiz rejected
  assert.equal((await call('/api/games', { quiz: { questions: [] } })).status, 400);

  const { body: { pin, hostKey } } = await call('/api/games', { quiz });
  assert.match(pin, /^\d{6}$/);
  assert.equal((await call('/api/games/000000')).status === 404 || pin === '000000', true);

  const host = listen(`/api/games/${pin}/host-events?key=${hostKey}`);
  await host.waitFor(state('LOBBY'));
  assert.equal((await call(`/api/games/${pin}/host-events?key=wrong`)).status, 403);

  // start blocked with no players
  assert.equal((await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'start' })).status, 409);

  const names = ['Ava', 'Ben', 'Cy'];
  const players = [];
  for (const n of names) {
    const r = await call(`/api/games/${pin}/join`, { name: n });
    assert.equal(r.status, 201);
    players.push({ ...r.body, sse: listen(`/api/games/${pin}/events?token=${r.body.token}`) });
  }
  const dup = await call(`/api/games/${pin}/join`, { name: 'ava' });
  assert.equal(dup.body.code, 'NICKNAME_EXISTS');

  // every player gets a different character; avatars can be changed
  const chars = players.map((p) => p.avatar.character);
  assert.equal(new Set(chars).size, 3, 'distinct starting avatars');
  const av = await call(`/api/games/${pin}/avatar`, { token: players[0].token, character: 5, accessory: 1 });
  assert.deepEqual(av.body.avatar, { character: 5, accessory: 1 });
  assert.equal((await call(`/api/games/${pin}/avatar`, { token: players[0].token, character: 99, accessory: 0 })).status, 400);
  await host.waitFor((m) => m.type === 'PLAYERS' && m.players.some((p) => p.name === 'Ava' && p.avatar.character === 5));

  await host.waitFor((m) => (m.type === 'PLAYERS' || m.type === 'STATE') && m.players?.length === 3);

  assert.equal((await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'start' })).status, 200);
  for (const p of players) await p.sse.waitFor(state('GET_READY', 0));

  // answering during GET_READY is rejected
  assert.equal((await call(`/api/games/${pin}/answer`, { token: players[0].token, questionIndex: 0, choice: 1 })).body.code, 'QUESTION_CLOSED');

  const q1 = await players[0].sse.waitFor(state('QUESTION', 0));
  assert.ok(!('correct' in q1.question), 'correct answer must not leak to players');

  // Ava correct fast, Ben correct slower, Cy wrong
  assert.equal((await call(`/api/games/${pin}/answer`, { token: players[0].token, questionIndex: 0, choice: 1 })).status, 200);
  assert.equal((await call(`/api/games/${pin}/answer`, { token: players[0].token, questionIndex: 0, choice: 1 })).body.code, 'ALREADY_ANSWERED');
  await new Promise((r) => setTimeout(r, 1500));
  await call(`/api/games/${pin}/answer`, { token: players[1].token, questionIndex: 0, choice: 1 });
  await call(`/api/games/${pin}/answer`, { token: players[2].token, questionIndex: 0, choice: 3 });

  // all answered -> ends early
  const reveal = await host.waitFor(state('REVEAL', 0));
  assert.deepEqual(reveal.reveal.counts, [0, 2, 0, 1]);
  const [ra, rb, rc] = await Promise.all(players.map((p) => p.sse.waitFor(state('REVEAL'))));
  assert.ok(ra.result.isCorrect && rb.result.isCorrect && !rc.result.isCorrect);
  assert.ok(ra.result.points > rb.result.points, 'faster answer scores more');
  assert.ok(ra.result.points <= 1000 && rb.result.points >= 500);
  assert.equal(ra.result.rank, 1);
  assert.equal(rb.result.behind.name, 'Ava');
  assert.equal(rc.result.points, 0);
  console.log('Q1 points:', ra.result.points, rb.result.points, rc.result.points);

  await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'next' });
  const board = await host.waitFor(state('SCOREBOARD'));
  assert.deepEqual(board.leaderboard.map((x) => x.name), ['Ava', 'Ben', 'Cy']);

  // reconnect: Ben drops and re-opens his stream mid-game, gets a snapshot
  players[1].sse.close();
  await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'next' });
  const ben2 = listen(`/api/games/${pin}/events?token=${players[1].token}`);
  await ben2.waitFor((m) => m.type === 'STATE' && (m.state === 'GET_READY' || m.state === 'QUESTION'));
  players[1].sse = ben2;

  await players[0].sse.waitFor(state('QUESTION', 1));
  const avaMark = players[0].sse.msgs.length;
  await call(`/api/games/${pin}/answer`, { token: players[0].token, questionIndex: 1, choice: 0 });
  // let time run out for Ben and Cy (5s + grace)
  const r2 = await players[0].sse.waitFor(state('REVEAL'), 9000, avaMark);
  assert.equal(r2.result.streak, 2);
  const bonus = r2.result.points;
  console.log('Q2 Ava points incl. streak bonus:', bonus);
  assert.ok(bonus >= 600, 'streak bonus applied');
  const benR2 = await ben2.waitFor(state('REVEAL'));
  assert.equal(benR2.result.answered, false);

  await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'next' });
  await call(`/api/games/${pin}/host-action`, { key: hostKey, action: 'next' });
  const end = await host.waitFor(state('ENDED'));
  assert.equal(end.leaderboard[0].name, 'Ava');
  assert.deepEqual(end.leaderboard[0].avatar, { character: 5, accessory: 1 }, 'podium carries avatars');
  const avaEnd = await players[0].sse.waitFor(state('ENDED'));
  assert.equal(avaEnd.rank, 1);
  console.log('Final:', end.leaderboard.map((x) => `${x.rank}. ${x.name} ${x.score}`).join(' | '));

  host.close(); players.forEach((p) => p.sse.close());
  console.log('ALL TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
