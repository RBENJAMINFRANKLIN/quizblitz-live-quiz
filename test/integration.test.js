// Integration tests against a real server process (random port, temporary data directory).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, listen, state, sleep, ADMIN, PNG_1X1, ICO_HEADER } = require('./helpers');

const BLIND = {
  type: 'music-blind-test',
  title: 'Test Années 80',
  description: 'deux morceaux',
  settings: { countdownDuration: 0, excerptDuration: 5, allowLateJoin: false },
  rounds: [{
    title: 'Artistes',
    questionType: 'artist',
    tracks: [
      { title: 'Arpèges', artist: 'Synthés', year: 1985, audioUrl: '/audio/demo-arpeges.wav', startTime: 1, duration: 5, choices: ['Synthés', 'Pixel', 'Cassette', 'Modem'], correctAnswer: 'Synthés' },
      { title: 'Valse', artist: 'Pixel', year: 1986, audioUrl: '/audio/demo-valse.wav', startTime: 0, duration: 5, choices: ['Modem', 'Pixel', 'Synthés', 'Cassette'], correctAnswer: 'Pixel' },
    ],
  }],
};

test('admin, white-label settings, media, blind tests and a full blind test game', async (t) => {
  let srv = await startServer();
  t.after(() => srv.stop());
  const anon = client(srv.base);
  const admin = client(srv.base);

  await t.test('admin access requires a session and the CSRF header', async () => {
    assert.equal((await anon('/api/admin/dashboard')).status, 401);
    assert.equal((await anon('/api/admin/settings')).status, 401);
    assert.equal((await anon('/api/admin/login', { body: { email: ADMIN.email, password: 'wrong' } })).status, 401);
    const noCsrf = await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) });
    assert.equal(noCsrf.status, 403);
    const ok = await admin('/api/admin/login', { body: ADMIN });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.getSetCookie().find((c) => c.startsWith('qb_admin='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await admin('/api/admin/me')).body.user.email, ADMIN.email);
    const dash = await admin('/api/admin/dashboard');
    assert.equal(dash.status, 200);
    assert.ok(Array.isArray(dash.body.warnings));
  });

  await t.test('pages carry security headers and never expose admin secrets', async () => {
    const res = await fetch(`${srv.base}/admin`);
    const html = await res.text();
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(!html.includes(ADMIN.password));
    assert.equal((await fetch(`${srv.base}/index.html`)).status, 404, 'templates are not served raw');
  });

  await t.test('global settings: read, rename, recolour, validate, reset theme', async () => {
    const pub = await anon('/api/public/settings');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.settings.updatedBy, undefined, 'internal fields are not public');
    const r = await admin('/api/admin/settings', { method: 'PUT', body: { settings: { appName: "Le Blind Test du Bal Pop'", shortName: "Blind Test Bal Pop'", tagline: 'Scannez. Jouez. Vibrez.', primaryColor: '#ff0066' } } });
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.appName, "Le Blind Test du Bal Pop'");
    assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { settings: { accentColor: 'url(javascript:1)' } } })).status, 400);
    assert.equal((await anon('/api/admin/settings', { method: 'PUT', body: { settings: { appName: 'Hack' } } })).status, 401);

    // New visitors see the new identity immediately (no rebuild, no redeploy).
    for (const p of ['/', '/play', '/host', '/admin', '/nope']) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(html.includes('Le Blind Test du Bal Pop&#39;') || html.includes("Blind Test Bal Pop&#39;"), `${p} shows the configured name`);
      assert.ok(!/QuizBlitz/.test(html), `${p} has no hard-coded QuizBlitz`);
    }
    const home = await (await fetch(`${srv.base}/`)).text();
    assert.match(home, /--color-primary:#ff0066/);
    assert.match(home, /<title>Le Blind Test du Bal Pop&#39;<\/title>/);
    const manifest = await (await fetch(`${srv.base}/manifest.webmanifest`)).json();
    assert.equal(manifest.short_name, "Blind Test Bal Pop'");

    const reset = await admin('/api/admin/settings/reset-theme', { body: {} });
    assert.equal(reset.body.settings.primaryColor, '#7c5cff');
    assert.equal(reset.body.settings.appName, "Le Blind Test du Bal Pop'", 'reset keeps the name');
  });

  await t.test('logo and favicon upload, replacement and refusal of invalid files', async () => {
    const up = (kind, raw, name) => admin(`/api/admin/media?kind=${kind}`, { raw, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': name } });
    assert.equal((await anon(`/api/admin/media?kind=image`, { raw: PNG_1X1, headers: { 'Content-Type': 'application/octet-stream' } })).status, 401);
    const svg = await up('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg');
    assert.equal(svg.status, 400);
    assert.equal((await up('image', Buffer.from('not an image at all, just text'), 'logo.png')).status, 400);
    const logo1 = (await up('image', PNG_1X1, 'logo.png')).body.media;
    assert.match(logo1.url, /^\/media\/[a-f0-9]{32}\.png$/);
    const fav = await up('favicon', ICO_HEADER, 'favicon.ico');
    assert.equal(fav.status, 201);
    await admin('/api/admin/settings', { method: 'PUT', body: { settings: { logoUrl: logo1.url, faviconUrl: fav.body.media.url } } });
    const served = await fetch(srv.base + logo1.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.match(served.headers.get('content-security-policy'), /sandbox/);
    const home = await (await fetch(`${srv.base}/`)).text();
    assert.ok(home.includes(`src="${logo1.url}"`), 'logo on the home page');
    assert.ok(home.includes(`<link rel="icon" href="${fav.body.media.url}">`), 'favicon applied');

    // Replacing the logo removes the old, now unused file (no orphans).
    const logo2 = (await up('image', PNG_1X1, 'logo2.png')).body.media;
    await admin('/api/admin/settings', { method: 'PUT', body: { settings: { logoUrl: logo2.url } } });
    assert.equal((await fetch(srv.base + logo1.url)).status, 404);
    assert.equal((await admin(`/api/admin/media/${logo2.id}`, { method: 'DELETE' })).status, 409, 'a file in use cannot be deleted');
    assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { settings: { logoUrl: '/media/0123456789abcdef0123456789abcdef.png' } } })).status, 400);
  });

  let btId;
  await t.test('blind test CRUD, validation, duplicate, archive, export', async () => {
    const invalid = await admin('/api/admin/blind-tests', { body: { blindTest: { ...BLIND, rounds: [{ title: 'x', tracks: [{ title: 'a' }] }] } } });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.details.length >= 3);
    const created = await admin('/api/admin/blind-tests', { body: { blindTest: BLIND } });
    assert.equal(created.status, 201);
    btId = created.body.id;
    const upd = await admin(`/api/admin/blind-tests/${btId}`, { method: 'PUT', body: { blindTest: { ...created.body.blindTest, description: 'modifié' } } });
    assert.equal(upd.body.blindTest.description, 'modifié');
    const dup = await admin(`/api/admin/blind-tests/${btId}/duplicate`, { body: {} });
    assert.equal(dup.status, 201);
    await admin(`/api/admin/blind-tests/${dup.body.id}/archive`, { body: { archived: true } });
    const list = (await admin('/api/admin/blind-tests')).body.blindTests;
    assert.equal(list.find((b) => b.id === dup.body.id).archived, true);
    const exp = await admin(`/api/admin/blind-tests/${btId}/export`);
    assert.match(exp.headers.get('content-disposition'), /attachment/);
    assert.equal(exp.body.type, 'music-blind-test');
    assert.equal(exp.body.rounds[0].tracks.length, 2);
    // Re-importing the export creates a copy rather than overwriting.
    const reimport = await admin('/api/admin/blind-tests', { body: { blindTest: exp.body } });
    assert.notEqual(reimport.body.id, btId);
    assert.equal((await admin(`/api/admin/blind-tests/${dup.body.id}`, { method: 'DELETE' })).status, 200);
  });

  let pin; let hostKey; let host; const players = [];
  await t.test('game creation, PIN, QR link, joining and nickname rules', async () => {
    assert.equal((await anon('/api/games', { body: { blindTestId: btId } })).status, 401, 'only the admin launches blind tests');
    const g = await admin('/api/games', { body: { blindTestId: btId } });
    assert.equal(g.status, 201);
    ({ pin, hostKey } = g.body);
    assert.match(pin, /^\d{6}$/);
    const join = await anon(`/join/${pin}`);
    assert.equal(join.status, 302);
    assert.equal(join.headers.get('location'), `/play?pin=${pin}`, 'the QR link opens the right game');
    assert.equal((await anon(`/api/games/${pin}`)).body.kind, 'music-blind-test');
    assert.equal((await anon(`/api/games/${pin}/host-events?key=nope`)).status, 403);
    host = listen(`${srv.base}/api/games/${pin}/host-events?key=${hostKey}`);
    const lobby = await host.waitFor(state('LOBBY'));
    assert.equal(lobby.blind.reveal, undefined, 'no answer in the lobby');

    for (const bad of ['', ' ', 'A', '<b>']) {
      const r = await anon(`/api/games/${pin}/join`, { body: { name: bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    for (const name of ['Ava', 'Ben', 'Cy']) {
      const r = await anon(`/api/games/${pin}/join`, { body: { name } });
      assert.equal(r.status, 201);
      players.push({ ...r.body, sse: listen(`${srv.base}/api/games/${pin}/events?token=${r.body.token}`) });
    }
    assert.equal((await anon(`/api/games/${pin}/join`, { body: { name: 'AVA' } })).body.code, 'NICKNAME_EXISTS');
    await host.waitFor((m) => m.type === 'PLAYERS' && m.players.length === 3 && m.players.every((p) => p.connected));
  });

  const act = (action, extra = {}) => anon(`/api/games/${pin}/host-action`, { body: { key: hostKey, action, ...extra } });
  const answer = (p, choice, extra = {}) => anon(`/api/games/${pin}/answer`, { body: { token: p.token, questionIndex: 0, choice, ...extra } });

  await t.test('track 1: countdown, audio only for the host, answers, pause, scoring, reveal', async () => {
    assert.equal((await act('start')).status, 200);
    const ready = await host.waitFor(state('GET_READY', 0));
    assert.equal(ready.blind.audioUrl, '/audio/demo-arpeges.wav', 'host gets the excerpt');
    assert.equal(ready.blind.nextAudioUrl, '/audio/demo-valse.wav', 'and the next one to preload');
    const pReady = await players[0].sse.waitFor(state('GET_READY', 0));
    assert.equal(pReady.blind.audioUrl, undefined, 'phones never get audio');
    assert.equal(JSON.stringify(pReady).includes('Arpèges'), false, 'no title before the reveal');
    assert.equal((await anon(`/api/games/${pin}/join`, { body: { name: 'Late' } })).body.code, 'GAME_LOCKED', 'late join disabled for this blind test');

    const q = await players[0].sse.waitFor(state('QUESTION', 0));
    assert.equal(q.question.correct, undefined);
    assert.ok(!JSON.stringify(q).includes('Arpèges') && !JSON.stringify(q).includes('1985'), 'no answer data leaks to phones');
    assert.equal(q.blind.roundTitle, 'Artistes');

    // Pause: answers are refused, the timer is frozen; resume restores it.
    assert.equal((await act('pause')).status, 200);
    const paused = await host.waitFor((m) => m.type === 'STATE' && m.state === 'QUESTION' && m.paused);
    assert.ok(paused.paused.remainingMs > 0);
    assert.equal((await answer(players[0], 0)).body.code, 'QUESTION_PAUSED');
    await sleep(300);
    assert.equal((await act('resume')).status, 200);
    await host.waitFor((m) => m.type === 'STATE' && m.state === 'QUESTION' && !m.paused);

    // A forged client timestamp / score is ignored: points come from the server clock.
    assert.equal((await answer(players[0], 0, { points: 999999, responseMs: 0, clientTime: 0 })).status, 200);
    assert.equal((await answer(players[0], 0)).body.code, 'ALREADY_ANSWERED');
    await sleep(600);
    await answer(players[1], 0);
    await answer(players[2], 3);
    const reveal = await host.waitFor(state('REVEAL', 0));
    assert.deepEqual(reveal.reveal.counts, [2, 0, 0, 1]);
    assert.equal(reveal.blind.reveal.title, 'Arpèges');
    assert.equal(reveal.blind.reveal.year, 1985);
    const [ra, rb, rc] = await Promise.all(players.map((p) => p.sse.waitFor(state('REVEAL', 0))));
    assert.ok(ra.result.isCorrect && rb.result.isCorrect && !rc.result.isCorrect);
    assert.ok(ra.result.points <= 1000 && ra.result.points >= 500, `capped: ${ra.result.points}`);
    assert.ok(ra.result.points > rb.result.points, 'faster answer scores more');
    assert.equal(rc.result.points, 0);
    assert.equal(ra.result.reveal.artist, 'Synthés', 'phones get the track card at the reveal');
    assert.equal(typeof ra.result.responseMs, 'number');
  });

  await t.test('scoreboard with rank movement, host refresh and player reconnection', async () => {
    await act('next');
    const board = await host.waitFor(state('SCOREBOARD'));
    assert.deepEqual(board.leaderboard.map((x) => x.name), ['Ava', 'Ben', 'Cy']);
    assert.ok(board.leaderboard.every((x) => Number.isInteger(x.prevRank)));
    await act('hide-board');
    await host.waitFor((m) => m.type === 'STATE' && m.state === 'REVEAL', 5000, host.mark() - 1);
    await act('next');
    // Host refreshes the page: a new stream gets the current state straight away.
    const host2 = listen(`${srv.base}/api/games/${pin}/host-events?key=${hostKey}`);
    const snap = await host2.waitFor((m) => m.type === 'STATE');
    assert.equal(snap.state, 'SCOREBOARD');
    host2.close();
    // Player reconnects after the phone slept.
    players[1].sse.close();
    players[1].sse = listen(`${srv.base}/api/games/${pin}/events?token=${players[1].token}`);
    const again = await players[1].sse.waitFor(state('SCOREBOARD'));
    assert.equal(again.rank, 2);
  });

  await t.test('backend restart keeps the game, players, scores and timers', async () => {
    await sleep(400); // let the debounced snapshot reach the database
    host.close(); players.forEach((p) => p.sse.close());
    await srv.stop();
    srv = await startServer({ dataDir: srv.dataDir });
    const again = client(srv.base);
    assert.equal((await again(`/api/games/${pin}`)).status, 200, 'game restored after restart');
    host = listen(`${srv.base}/api/games/${pin}/host-events?key=${hostKey}`);
    const snap = await host.waitFor(state('SCOREBOARD'));
    assert.deepEqual(snap.leaderboard.map((x) => x.name), ['Ava', 'Ben', 'Cy']);
    for (const p of players) p.sse = listen(`${srv.base}/api/games/${pin}/events?token=${p.token}`);
    await host.waitFor((m) => m.type === 'PLAYERS' && m.players.filter((p) => p.connected).length === 3);

    const call = client(srv.base);
    const act2 = (action) => call(`/api/games/${pin}/host-action`, { body: { key: hostKey, action } });
    // Track 2: restart the excerpt once, then let the timer run out (timers re-armed after restart).
    await act2('next');
    await host.waitFor(state('GET_READY', 1));
    assert.equal((await act2('restart-track')).status, 200);
    await players[0].sse.waitFor(state('QUESTION', 1));
    assert.equal((await call(`/api/games/${pin}/answer`, { body: { token: players[0].token, questionIndex: 1, choice: 1 } })).status, 200);
    const r2 = await players[0].sse.waitFor(state('REVEAL', 1), 9000);
    assert.equal(r2.result.streak, 2);
    assert.ok(r2.result.points >= 600, 'streak bonus applied');
    await act2('next');
    await act2('next');
    const end = await host.waitFor(state('ENDED'));
    assert.equal(end.leaderboard[0].name, 'Ava');
    assert.ok(Number.isInteger(end.reportId), 'finished game saved to the history');
    const ava = await players[0].sse.waitFor(state('ENDED'));
    assert.equal(ava.rank, 1);
    const rep = await admin('/api/reports/' + end.reportId).catch(() => null);
    void rep;
    host.close(); players.forEach((p) => p.sse.close());
  });

  await t.test('two simultaneous games stay isolated', async () => {
    const adminB = client(srv.base);
    await adminB('/api/admin/login', { body: ADMIN });
    const g1 = (await adminB('/api/games', { body: { blindTestId: btId } })).body;
    const g2 = (await adminB('/api/games', { body: { blindTestId: btId } })).body;
    assert.notEqual(g1.pin, g2.pin);
    const call = client(srv.base);
    const a = (await call(`/api/games/${g1.pin}/join`, { body: { name: 'Zoé' } })).body;
    const b = (await call(`/api/games/${g2.pin}/join`, { body: { name: 'Zoé' } })).body;
    assert.ok(a.token && b.token, 'same nickname allowed in different games');
    assert.equal((await call(`/api/games/${g1.pin}/host-action`, { body: { key: g2.hostKey, action: 'start' } })).status, 403, 'host keys are per game');
    const h1 = listen(`${srv.base}/api/games/${g1.pin}/host-events?key=${g1.hostKey}`);
    const h2 = listen(`${srv.base}/api/games/${g2.pin}/host-events?key=${g2.hostKey}`);
    await call(`/api/games/${g1.pin}/host-action`, { body: { key: g1.hostKey, action: 'start' } });
    await h1.waitFor(state('GET_READY', 0));
    const s2 = await h2.waitFor((m) => m.type === 'STATE');
    assert.equal(s2.state, 'LOBBY', 'starting one game does not affect the other');
    assert.equal((await call(`/api/games/${g2.pin}/answer`, { body: { token: a.token, questionIndex: 0, choice: 0 } })).status, 404, 'tokens are per game');
    const games = (await adminB('/api/admin/games')).body.games;
    assert.ok(games.some((g) => g.pin === g1.pin) && games.some((g) => g.pin === g2.pin));
    h1.close(); h2.close();
  });

  await t.test('expired games are removed on restart', async () => {
    const adminC = client(srv.base);
    await adminC('/api/admin/login', { body: ADMIN });
    const g = (await adminC('/api/games', { body: { blindTestId: btId } })).body;
    await sleep(400);
    await srv.stop();
    const db = new DatabaseSync(path.join(srv.dataDir, 'quizblitz.db'));
    db.prepare('UPDATE live_games SET expires_at = ? WHERE pin = ?').run(Date.now() - 1000, g.pin);
    db.close();
    srv = await startServer({ dataDir: srv.dataDir });
    assert.equal((await client(srv.base)(`/api/games/${g.pin}`)).status, 404);
    // Settings survived every restart.
    assert.equal((await client(srv.base)('/api/public/settings')).body.settings.appName, "Le Blind Test du Bal Pop'");
  });
});
