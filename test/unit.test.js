// Unit tests (no server): scoring, blind test format, settings/theme, uploads, snapshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Scoring = require('../lib/scoring');
const BT = require('../lib/blindtest');
const Settings = require('../lib/settings');
const Media = require('../lib/media');
const { serializeGame, restoreGame } = require('../lib/gamestore');
const { PNG_1X1, ICO_HEADER } = require('./helpers');

const D = Scoring.DEFAULT_SCORING;
const LIMIT = 20000;

test('scoring: immediate answer earns the maximum (1000)', () => {
  assert.equal(Scoring.speedPoints(0, LIMIT, D), 1000);
});
test('scoring: answer at half time earns 750', () => {
  assert.equal(Scoring.speedPoints(10000, LIMIT, D), 750);
});
test('scoring: answer just before the end earns just above 500', () => {
  const p = Scoring.speedPoints(19900, LIMIT, D);
  assert.ok(p > 500 && p <= 503, String(p));
});
test('scoring: an answer after the end (grace window) is capped at 500, never below', () => {
  assert.equal(Scoring.speedPoints(20400, LIMIT, D), 500);
  assert.equal(Scoring.speedPoints(999999, LIMIT, D), 500);
});
test('scoring: negative or forged response times cannot exceed the cap', () => {
  assert.equal(Scoring.speedPoints(-5000, LIMIT, D), 1000);
  assert.equal(Scoring.speedPoints('abc', LIMIT, D), 500);
});
test('scoring: streak bonus +100 per consecutive correct answer beyond the first, capped at +500', () => {
  assert.deepEqual([0, 1, 2, 3, 6, 7, 20].map((s) => Scoring.streakBonus(s, D)), [0, 0, 100, 200, 500, 500, 500]);
});
test('scoring: configuration is clamped to sane values', () => {
  const c = Scoring.normaliseScoring({ basePoints: -10, speedBonus: '300', streakStep: 99999, streakCap: 'x' });
  assert.deepEqual(c, { basePoints: 0, speedBonus: 300, streakStep: 1000, streakCap: 500 });
  assert.equal(Scoring.speedPoints(0, LIMIT, c), 300);
});

// ---------------------------------------------------------------- blind test format

const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'exemples', 'blindtest-demo.json'), 'utf8'));

test('blind test: the bundled demo is valid', () => {
  const r = BT.validateBlindTest(demo);
  assert.deepEqual(r.errors, []);
  assert.equal(BT.countTracks(r.blindTest), 3);
});

test('blind test: detects missing title, wrong answer, duplicates and bad URLs', () => {
  const bad = structuredClone(demo);
  bad.title = '';
  bad.rounds[0].tracks[0].correctAnswer = 'Nobody';
  bad.rounds[0].tracks[1].choices = ['A', 'a', 'B', 'C'];
  bad.rounds[0].tracks[1].correctAnswer = 'A';
  bad.rounds[1].tracks[0].audioUrl = 'javascript:alert(1)';
  bad.rounds[1].tracks[0].choices = ['x', 'y', 'z'];
  const { errors } = BT.validateBlindTest(bad);
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes('title'));
  assert.ok(paths.includes('rounds[0].tracks[0].correctAnswer'));
  assert.ok(paths.includes('rounds[0].tracks[1].choices'));
  assert.ok(paths.includes('rounds[1].tracks[0].audioUrl'));
  assert.ok(paths.some((p) => p === 'rounds[1].tracks[0].choices'));
  assert.throws(() => BT.assertValid(bad), (e) => e.status === 400 && e.details.length === errors.length);
});

test('blind test: rejects non-objects and the wrong type', () => {
  assert.equal(BT.validateBlindTest(null).errors.length, 1);
  assert.ok(BT.validateBlindTest({ ...demo, type: 'quiz' }).errors.some((e) => e.path === 'type'));
});

test('blind test: converted questions carry the answer only in the reveal block', () => {
  const quiz = BT.toGameQuiz(BT.assertValid(demo).blindTest);
  assert.equal(quiz.kind, 'music-blind-test');
  assert.equal(quiz.questions.length, 3);
  const q = quiz.questions[0];
  assert.equal(q.type, 'quiz');
  assert.equal(q.choices[q.correct[0]], 'Les Synthés Rêveurs');
  assert.equal(q.blind.reveal.title, 'Arpèges du dimanche');
  assert.equal(q.text, 'Qui interprète ce morceau ?');
  assert.equal(quiz.questions[2].text, 'Quel est le titre de ce morceau ?');
  // The public view the phones get never contains the blind block.
  const Q = require('../questions');
  const pub = Q.publicView(q, 0, 3, true);
  assert.equal(pub.blind, undefined);
  assert.equal(pub.correct, undefined);
});

test('blind test: generates ids and keeps ids unique', () => {
  const copy = structuredClone(demo);
  delete copy.id;
  copy.rounds[0].tracks[1].id = copy.rounds[0].tracks[0].id;
  const { blindTest } = BT.assertValid(copy);
  assert.match(blindTest.id, /^blindtest-/);
  assert.notEqual(blindTest.rounds[0].tracks[0].id, blindTest.rounds[0].tracks[1].id);
});

// ---------------------------------------------------------------- settings and theme

test('settings: merge validates colours, radius, theme and required name', () => {
  const s = Settings.mergeSettings(Settings.DEFAULT_SETTINGS, { appName: '  Le Blind Test du Bal Pop\'  ', primaryColor: '#FF0066', buttonRadius: 20, themeMode: 'light' });
  assert.equal(s.appName, "Le Blind Test du Bal Pop'");
  assert.equal(s.primaryColor, '#ff0066');
  assert.equal(s.buttonRadius, 20);
  assert.throws(() => Settings.mergeSettings(s, { primaryColor: 'red; background:url(x)' }), /Couleur invalide/);
  assert.throws(() => Settings.mergeSettings(s, { buttonRadius: 99 }));
  assert.throws(() => Settings.mergeSettings(s, { themeMode: 'neon' }));
  assert.throws(() => Settings.mergeSettings(s, { appName: '   ' }), /obligatoire/);
  assert.throws(() => Settings.mergeSettings(s, { logoUrl: 'javascript:alert(1)' }));
  assert.throws(() => Settings.mergeSettings(s, { logoUrl: '/media/../server.js' }));
});

test('settings: page rendering escapes the brand and injects theme, favicon and metadata', () => {
  const s = Settings.mergeSettings(Settings.DEFAULT_SETTINGS, { appName: '<script>alert(1)</script>', shortName: 'Bal Pop', tagline: 'Scannez & jouez' });
  const html = Settings.renderPage('<head><!--BRAND_HEAD:Jouer--></head><h1>{{logo}}</h1><p>{{tagline}}</p>', s, 'https://example.org');
  assert.ok(!html.includes('<script>alert'), 'brand is escaped');
  assert.ok(html.includes('<title>Jouer · Bal Pop</title>'));
  assert.ok(html.includes('Scannez &amp; jouez'));
  assert.ok(html.includes('--color-primary:'));
  assert.ok(html.includes('<link rel="icon" href="/favicon.svg">'));
  assert.ok(html.includes('id="brand-data"'));
  assert.ok(!/<\/script>alert/.test(html.split('id="brand-data">')[1].split('</script>')[0]), 'JSON cannot close the script tag');
});

test('settings: readable ink colour is chosen for any background', () => {
  assert.equal(Settings.inkFor('#ffffff'), '#14101f');
  assert.equal(Settings.inkFor('#000000'), '#ffffff');
  assert.ok(Settings.themeCss({ ...Settings.DEFAULT_SETTINGS, themeMode: 'auto' }).includes('prefers-color-scheme: light'));
});

// ---------------------------------------------------------------- uploads

test('media: detects real file types from their content', () => {
  assert.equal(Media.sniff(PNG_1X1), 'png');
  assert.equal(Media.sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpg');
  assert.equal(Media.sniff(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)])), 'mp3');
  assert.equal(Media.sniff(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)])), 'ogg');
  assert.equal(Media.sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(20)])), 'm4a');
  assert.equal(Media.sniff(ICO_HEADER), 'ico');
  assert.equal(Media.sniff(Buffer.from('<html><body>hello world</body></html>')), null);
});

test('media: refuses SVG, HTML, wrong kinds, mismatched extensions and oversize files', () => {
  assert.throws(() => Media.checkUpload('image', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'logo.svg'), /SVG/);
  assert.throws(() => Media.checkUpload('image', Buffer.from('<html><script>alert(1)</script></html>'), 'logo.png'));
  assert.throws(() => Media.checkUpload('audio', PNG_1X1, 'song.mp3'), /Format non accepté/);
  assert.throws(() => Media.checkUpload('image', PNG_1X1, 'logo.jpg'), /extension/);
  assert.throws(() => Media.checkUpload('favicon', Buffer.concat([PNG_1X1, Buffer.alloc(600 * 1024)]), 'f.png'), (e) => e.status === 413);
  assert.deepEqual(Media.checkUpload('image', PNG_1X1, 'logo.PNG'), { type: 'png', ext: 'png', mime: 'image/png' });
});

test('media: range parsing', () => {
  assert.deepEqual(Media.parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(Media.parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(Media.parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.equal(Media.parseRange('bytes=2000-', 1000), 'invalid');
  assert.equal(Media.parseRange(undefined, 1000), null);
});

// ---------------------------------------------------------------- live game snapshots

test('game snapshot: round-trips players, answers and timestamps without runtime objects', () => {
  const g = {
    pin: '123456', hostKey: 'k', quiz: { title: 'T', questions: [] }, options: {}, locked: false, ownerId: null, state: 'QUESTION',
    qIndex: 2, lastActivity: 1, history: [{}], startedAt: 2, questionStartsAt: 3, questionOpenedAt: 4, endsAt: 5, paused: null,
    createdAt: 0, scoring: D, maxPlayers: 10, timer: setTimeout(() => {}, 0), hostStreams: new Set(['x']),
    players: new Map([['p1', { id: 'p1', token: 't', name: 'Ava', score: 10, streak: 1, joinedAt: 1, avatar: { character: 1, accessory: 0 }, streams: new Set(['s']) }]]),
    answers: new Map([['p1', { answer: 1, responseMs: 900 }]]),
  };
  clearTimeout(g.timer);
  const json = serializeGame(g);
  assert.ok(!json.includes('"streams"'));
  const r = restoreGame(json);
  assert.equal(r.players.get('p1').name, 'Ava');
  assert.equal(r.players.get('p1').streams.size, 0);
  assert.deepEqual(r.answers.get('p1'), { answer: 1, responseMs: 900 });
  assert.equal(r.endsAt, 5);
  assert.equal(r.hostStreams.size, 0);
});
