// The "music-blind-test" format: validation and conversion into game questions.
// See docs/FORMAT_BLIND_TEST.md for the full specification.
//
// A blind test is played by the existing game engine: each track becomes a
// "quiz" question (4 choices, one correct) carrying a `blind` block with the
// audio excerpt (sent to the host screen only) and the answer card shown at
// the reveal. Scoring, reveal statistics, reports and the podium are reused.

const crypto = require('crypto');

const TYPE = 'music-blind-test';
const QUESTION_TYPES = ['artist', 'title', 'year', 'custom'];
const ANSWER_MODES = ['multiple-choice']; // later: free-text, buzzer, teams
const DIFFICULTIES = ['', 'easy', 'medium', 'hard'];
const MAX_ROUNDS = 20;
const MAX_TRACKS = 150;

const QUESTION_TEXT = {
  artist: 'Qui interprète ce morceau ?',
  title: 'Quel est le titre de ce morceau ?',
  year: 'En quelle année est sorti ce morceau ?',
  custom: 'Quelle est la bonne réponse ?',
};

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const canon = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => canon(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const newId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
const intIn = (v, def, min, max) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : NaN;
};

// Audio: a file uploaded to this server, or an https link. Covers: same for images.
const isAudioUrl = (u) => /^\/media\/[a-f0-9]{32}\.(mp3|m4a|ogg|wav)$/.test(u) || /^\/audio\/[\w.\-/]+\.(mp3|m4a|ogg|wav)$/i.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u);
const isImageUrl = (u) => u === '' || /^\/media\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(u) || /^\/covers\/[\w.\-/]+\.(png|jpe?g|webp)$/i.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u);

/**
 * Validates a blind test. Returns { blindTest, errors, warnings } where errors
 * is a list of { path, message }. A blind test with errors must not be saved.
 */
function validateBlindTest(input) {
  const errors = [];
  const warnings = [];
  const err = (p, message) => errors.push({ path: p, message });
  const warn = (p, message) => warnings.push({ path: p, message });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { blindTest: null, errors: [{ path: '', message: 'Le blind test doit être un objet JSON' }], warnings };
  }
  if (input.type !== undefined && input.type !== TYPE) err('type', `Le type doit être "${TYPE}"`);

  const title = str(input.title, 100);
  if (!title) err('title', 'Le titre est obligatoire');
  const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const settings = {
    answerMode: ANSWER_MODES.includes(s.answerMode) ? s.answerMode : 'multiple-choice',
    countdownDuration: intIn(s.countdownDuration, 3, 0, 10),
    excerptDuration: intIn(s.excerptDuration, 20, 5, 120),
    revealDuration: intIn(s.revealDuration, 8, 0, 60),
    scoreboardDuration: intIn(s.scoreboardDuration, 8, 0, 60),
    allowLateJoin: s.allowLateJoin !== false,
    allowAnswerChange: s.allowAnswerChange === true,
    playAudioOnHostOnly: true, // phones never play audio (avoids devices drifting out of sync)
    shuffleChoices: s.shuffleChoices === true,
  };
  if (s.answerMode && !ANSWER_MODES.includes(s.answerMode)) warn('settings.answerMode', `Mode "${s.answerMode}" pas encore disponible : QCM utilisé`);
  for (const k of ['countdownDuration', 'excerptDuration', 'revealDuration', 'scoreboardDuration']) {
    if (Number.isNaN(settings[k])) err(`settings.${k}`, 'Durée invalide');
  }

  const rounds = [];
  const ids = new Set();
  const uniqueId = (raw, prefix) => {
    let v = str(raw, 60).replace(/[^\w-]/g, '');
    if (!v || ids.has(v)) v = newId(prefix);
    ids.add(v);
    return v;
  };
  const roundsIn = Array.isArray(input.rounds) ? input.rounds : [];
  if (!roundsIn.length) err('rounds', 'Ajoutez au moins une manche');
  if (roundsIn.length > MAX_ROUNDS) err('rounds', `Trop de manches (maximum ${MAX_ROUNDS})`);
  let trackCount = 0;

  roundsIn.slice(0, MAX_ROUNDS).forEach((r, ri) => {
    const rp = `rounds[${ri}]`;
    if (!r || typeof r !== 'object') { err(rp, 'Manche invalide'); return; }
    const questionType = QUESTION_TYPES.includes(r.questionType) ? r.questionType : 'artist';
    const round = { id: uniqueId(r.id, 'round'), title: str(r.title, 80) || `Manche ${ri + 1}`, questionType, tracks: [] };
    const tracksIn = Array.isArray(r.tracks) ? r.tracks : [];
    if (!tracksIn.length) err(`${rp}.tracks`, `La manche « ${round.title} » ne contient aucun morceau`);
    tracksIn.forEach((t, ti) => {
      const tp = `${rp}.tracks[${ti}]`;
      const label = `Manche ${ri + 1}, morceau ${ti + 1}`;
      trackCount++;
      if (!t || typeof t !== 'object') { err(tp, `${label} : morceau invalide`); return; }
      const track = {
        id: uniqueId(t.id, 'track'),
        title: str(t.title, 120),
        artist: str(t.artist, 120),
        year: t.year === undefined || t.year === null || t.year === '' ? null : Number(t.year),
        audioUrl: str(t.audioUrl, 1000),
        coverUrl: str(t.coverUrl, 1000),
        startTime: t.startTime === undefined || t.startTime === '' ? 0 : Number(t.startTime),
        duration: intIn(t.duration, settings.excerptDuration, 5, 120),
        questionType: QUESTION_TYPES.includes(t.questionType) && t.questionType !== questionType ? t.questionType : null, // null = same as the round
        question: str(t.question, 160),
        choices: (Array.isArray(t.choices) ? t.choices : []).map((c) => str(c, 80)),
        correctAnswer: str(t.correctAnswer, 80),
        difficulty: DIFFICULTIES.includes(t.difficulty) ? t.difficulty : '',
        notes: str(t.notes, 500),
      };
      if (!track.title) err(`${tp}.title`, `${label} : le titre est obligatoire`);
      if (!track.artist) err(`${tp}.artist`, `${label} : l'artiste est obligatoire`);
      if (track.year !== null && !(Number.isInteger(track.year) && track.year >= 1800 && track.year <= 2100)) err(`${tp}.year`, `${label} : année invalide`);
      if (!track.audioUrl) err(`${tp}.audioUrl`, `${label} : ajoutez un fichier ou une URL audio`);
      else if (!isAudioUrl(track.audioUrl)) err(`${tp}.audioUrl`, `${label} : URL audio invalide (fichier téléversé ou lien https)`);
      if (!isImageUrl(track.coverUrl)) err(`${tp}.coverUrl`, `${label} : URL de pochette invalide`);
      if (!(Number.isFinite(track.startTime) && track.startTime >= 0 && track.startTime <= 3600)) err(`${tp}.startTime`, `${label} : début d'extrait invalide`);
      else track.startTime = Math.round(track.startTime * 10) / 10;
      if (Number.isNaN(track.duration)) err(`${tp}.duration`, `${label} : durée invalide`);
      if (track.choices.length !== 4 || track.choices.some((c) => !c)) err(`${tp}.choices`, `${label} : il faut exactement 4 propositions non vides`);
      const seen = new Set(track.choices.filter(Boolean).map(canon));
      if (seen.size !== track.choices.filter(Boolean).length) err(`${tp}.choices`, `${label} : propositions en double`);
      if (!track.correctAnswer) err(`${tp}.correctAnswer`, `${label} : indiquez la bonne réponse`);
      else if (!track.choices.includes(track.correctAnswer)) err(`${tp}.correctAnswer`, `${label} : la bonne réponse doit faire partie des propositions`);
      if (/^https:\/\//i.test(track.audioUrl) && [track.title, track.artist].some((x) => x && slug(track.audioUrl).includes(slug(x)) && slug(x).length > 3)) {
        warn(`${tp}.audioUrl`, `${label} : l'URL audio semble contenir la réponse ; elle reste invisible des joueurs mais apparaît dans le navigateur de l'animateur`);
      }
      round.tracks.push(track);
    });
    rounds.push(round);
  });
  if (trackCount > MAX_TRACKS) err('rounds', `Trop de morceaux (maximum ${MAX_TRACKS})`);

  const blindTest = {
    id: str(input.id, 60).replace(/[^\w-]/g, '') || `blindtest-${slug(title) || 'sans-titre'}-${crypto.randomBytes(3).toString('hex')}`,
    type: TYPE,
    title,
    description: str(input.description, 500),
    settings,
    rounds,
  };
  return { blindTest, errors, warnings };
}

/** Throws a 400 error listing the problems if the blind test is invalid. */
function assertValid(input) {
  const r = validateBlindTest(input);
  if (r.errors.length) {
    const e = new Error(r.errors.slice(0, 5).map((x) => x.message).join(' · ') + (r.errors.length > 5 ? ` (+${r.errors.length - 5})` : ''));
    e.status = 400;
    e.details = r.errors;
    throw e;
  }
  return r;
}

const countTracks = (bt) => bt.rounds.reduce((n, r) => n + r.tracks.length, 0);

/** Converts a validated blind test into the quiz shape the game engine plays. */
function toGameQuiz(bt) {
  const questions = [];
  bt.rounds.forEach((round, ri) => {
    round.tracks.forEach((t, ti) => {
      questions.push({
        type: 'quiz',
        text: t.question || QUESTION_TEXT[t.questionType || round.questionType] || QUESTION_TEXT.artist,
        time: t.duration,
        image: '',
        points: 'standard',
        choices: [...t.choices],
        correct: [t.choices.indexOf(t.correctAnswer)],
        blind: {
          trackId: t.id,
          questionType: t.questionType || round.questionType,
          roundIndex: ri,
          roundCount: bt.rounds.length,
          roundTitle: round.title,
          trackInRound: ti,
          tracksInRound: round.tracks.length,
          audioUrl: t.audioUrl,
          startTime: t.startTime,
          duration: t.duration,
          reveal: { title: t.title, artist: t.artist, year: t.year, coverUrl: t.coverUrl },
        },
      });
    });
  });
  return { title: bt.title, kind: TYPE, blindTestId: bt.id, settings: bt.settings, questions };
}

/** Media URLs referenced by a blind test (audio and covers uploaded to this server). */
function referencedMedia(bt) {
  const out = [];
  for (const r of bt.rounds || []) for (const t of r.tracks || []) {
    for (const u of [t.audioUrl, t.coverUrl]) if (typeof u === 'string' && u.startsWith('/media/')) out.push(u);
  }
  return out;
}

module.exports = { TYPE, QUESTION_TYPES, QUESTION_TEXT, validateBlindTest, assertValid, toGameQuiz, countTracks, referencedMedia };
