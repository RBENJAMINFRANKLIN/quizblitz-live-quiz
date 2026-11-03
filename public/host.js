import { SHAPES, api, el, show, countdown, stream, avatarEl } from '/shared.js';
import * as S from '/sound.js';

const STORAGE_KEY = 'quizblitz.draft';
const SESSION_KEY = 'quizblitz.hosting';
const OPTIONS_KEY = 'quizblitz.options';

// [type, label, icon]; kept in the order Kahoot's "Add question" menu uses.
const TYPES = [
  ['quiz', 'Quiz', '🔷'], ['truefalse', 'True or false', '⚖️'], ['typeanswer', 'Type answer', '⌨️'],
  ['slider', 'Slider', '🎚️'], ['puzzle', 'Puzzle', '🧩'], ['droppin', 'Drop pin', '📍'],
  ['poll', 'Poll', '📊'], ['wordcloud', 'Word cloud', '☁️'], ['openended', 'Open-ended', '💬'],
];
const UNSCORED = new Set(['poll', 'wordcloud', 'openended']);
const TIMES = [5, 10, 20, 30, 45, 60, 90, 120, 240];
const OPTIONS = [
  ['shuffleQuestions', 'Randomise question order', 'Questions are asked in a random order.', false],
  ['shuffleAnswers', 'Randomise answer order', 'Answer options are shuffled for every question.', false],
  ['nameGenerator', 'Friendly nickname generator', 'Players get a fun random name (they can spin for another) instead of typing one.', false],
  ['lockOnStart', 'Lock the game when it starts', 'Nobody new can join once the first question begins.', true],
  ['showOnDevices', "Show questions and answers on players' devices", 'Turn off to show only the coloured shapes on phones.', true],
];

const SAMPLE = {
  title: 'Planet Earth Trivia',
  questions: [
    { type: 'quiz', text: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correct: [2], time: 20, points: 'standard' },
    { type: 'truefalse', text: 'Mount Everest is in the Himalayas.', correct: [0], time: 10, points: 'standard' },
    { type: 'typeanswer', text: 'Which planet is known as the Red Planet?', accepted: ['Mars'], time: 20, points: 'standard' },
    { type: 'slider', text: 'How many continents are there?', min: 0, max: 10, step: 1, answer: 7, tolerance: 0, unit: '', time: 20, points: 'double' },
    { type: 'puzzle', text: 'Order these from closest to farthest from the Sun', items: ['Mercury', 'Venus', 'Earth', 'Mars'], time: 30, points: 'standard' },
    { type: 'droppin', text: 'Tap on Mars', image: '/sample/solar-system.svg', target: { x: 0.8625, y: 0.5, r: 0.06 }, time: 20, points: 'standard' },
    { type: 'poll', text: 'Which would you most like to visit?', choices: ['The Moon', 'Mars', 'The deep sea', 'Antarctica'], time: 20 },
    { type: 'wordcloud', text: 'One word that describes Earth', time: 30 },
  ],
};

const blankQuestion = (type = 'quiz') => withDefaults({ type, text: '', time: 20, points: 'standard', image: '' });

/** Fills in the fields a question type needs, keeping anything already there. */
function withDefaults(q) {
  const d = {
    quiz: { choices: ['', '', '', ''], correct: [0] }, poll: { choices: ['', '', '', ''] },
    truefalse: { correct: [0] }, typeanswer: { accepted: ['', '', '', ''] },
    slider: { min: 0, max: 100, step: 1, answer: 50, tolerance: 0, unit: '' }, puzzle: { items: ['', '', '', ''] },
    droppin: { target: { x: 0.5, y: 0.5, r: 0.1 } }, wordcloud: {}, openended: {},
  }[q.type] || {};
  const out = { ...structuredClone(d), ...q };
  if (out.choices) out.choices = [...out.choices, '', '', '', ''].slice(0, 4);
  if (out.accepted) out.accepted = [...out.accepted, '', '', '', ''].slice(0, 4);
  if (out.items) out.items = [...out.items, '', '', '', ''].slice(0, 4);
  if (!Array.isArray(out.correct)) out.correct = [0];
  return out;
}

// ---------------- editor state ----------------

let quiz = loadDraft();
let me = null; // signed-in host, if any
let dirty = false;

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.questions) && saved.questions.length) {
      return { ...saved, questions: saved.questions.map((q) => withDefaults({ type: 'quiz', points: 'standard', ...q })) };
    }
  } catch { /* storage unavailable or corrupt */ }
  return { ...structuredClone(SAMPLE), questions: SAMPLE.questions.map(withDefaults) };
}

function saveDraft(markDirty = true) {
  if (markDirty) { dirty = true; setStatus(''); }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(quiz)); } catch { /* ignore */ }
}

function loadOptions() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTIONS_KEY)) || {}; } catch { /* ignore */ }
  return Object.fromEntries(OPTIONS.map(([k, , , def]) => [k, saved[k] ?? def]));
}
let options = loadOptions();

function setStatus(text) { document.getElementById('save-status').textContent = text; }

const opt = (value, label, selected) => {
  const o = el('option', { value: String(value) }, label);
  if (String(value) === String(selected)) o.selected = true;
  return o;
};

function input(attrs, onInput) {
  return el('input', { ...attrs, oninput: (e) => { onInput(e.target.value); saveDraft(); } });
}

// ---------------- editor rendering ----------------

function renderEditor() {
  document.getElementById('quiz-title').value = quiz.title || '';
  document.getElementById('questions').replaceChildren(...quiz.questions.map(questionCard));
  renderOptions();
}

function questionCard(q, qi) {
  const n = qi + 1;
  const move = (d) => { const j = qi + d; [quiz.questions[j], quiz.questions[qi]] = [quiz.questions[qi], quiz.questions[j]]; saveDraft(); renderEditor(); };
  const head = el('div', { class: 'q-head' },
    el('span', {}, `Question ${n}`),
    el('div', { class: 'row' },
      el('select', { 'aria-label': `Question ${n} type`, onchange: (e) => { quiz.questions[qi] = withDefaults({ ...q, type: e.target.value }); saveDraft(); renderEditor(); } },
        ...TYPES.map(([t, label, icon]) => opt(t, `${icon} ${label}`, q.type))),
      el('select', { 'aria-label': 'Time limit', onchange: (e) => { q.time = Number(e.target.value); saveDraft(); } },
        ...TIMES.map((s) => opt(s, s < 60 ? `${s} sec` : `${s / 60} min`, q.time))),
      UNSCORED.has(q.type) ? el('span', { class: 'sub' }, 'No points') : el('select', { 'aria-label': 'Points', onchange: (e) => { q.points = e.target.value; saveDraft(); } },
        opt('standard', 'Standard points', q.points), opt('double', 'Double points', q.points), opt('none', 'No points', q.points)),
      el('button', { class: 'small ghost', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: qi === 0 ? '' : null, onclick: () => move(-1) }, '↑'),
      el('button', { class: 'small ghost', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: qi === quiz.questions.length - 1 ? '' : null, onclick: () => move(1) }, '↓'),
      el('button', { class: 'small ghost', type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate question',
        onclick: () => { quiz.questions.splice(qi + 1, 0, structuredClone(q)); saveDraft(); renderEditor(); } }, '⧉'),
      el('button', { class: 'small ghost', type: 'button', title: 'Delete question', 'aria-label': 'Delete question',
        onclick: () => { quiz.questions.splice(qi, 1); if (!quiz.questions.length) quiz.questions.push(blankQuestion()); saveDraft(); renderEditor(); } }, '✕')));

  return el('div', { class: 'card q-card' }, head,
    input({ value: q.text, maxlength: '200', placeholder: 'Type your question', style: 'text-align:left', 'aria-label': `Question ${n} text` }, (v) => { q.text = v; }),
    input({ type: 'url', value: q.image || '', maxlength: '500', style: 'text-align:left;font-size:14px;font-weight:600', 'aria-label': `Question ${n} image link`,
      placeholder: q.type === 'droppin' ? 'Image link (required for drop pin), e.g. https://…/map.jpg' : 'Image link (optional), e.g. https://…/photo.jpg' },
    (v) => { q.image = v.trim(); if (q.type === 'droppin') renderPinPreview(q, qi); }),
    ...typeEditor(q, qi));
}

function typeEditor(q, qi) {
  const n = qi + 1;
  switch (q.type) {
    case 'quiz': case 'poll':
      return q.choices.map((c, ci) => el('div', { class: 'choice-row' },
        el('div', { class: `swatch tile c${ci}`, html: SHAPES[ci], style: 'min-height:0;padding:0;box-shadow:none' }),
        input({ type: 'text', value: c, maxlength: '80', placeholder: ci < 2 ? `Answer ${ci + 1}` : `Answer ${ci + 1} (optional)`, 'aria-label': `Question ${n} answer ${ci + 1}` },
          (v) => { q.choices[ci] = v; }),
        q.type === 'poll' ? null : el('label', {}, (() => {
          const box = el('input', { type: 'checkbox', 'aria-label': `Answer ${ci + 1} is correct`,
            onchange: (e) => { q.correct = e.target.checked ? [...new Set([...q.correct, ci])] : q.correct.filter((x) => x !== ci); saveDraft(); } });
          box.checked = q.correct.includes(ci);
          return box;
        })(), 'Correct')));
    case 'truefalse':
      return [el('div', { class: 'tf-pick' }, ...['True', 'False'].map((label, i) => el('button', {
        type: 'button', class: `tile c${i}`, 'aria-pressed': String(q.correct[0] === i),
        onclick: () => { q.correct = [i]; saveDraft(); renderEditor(); },
      }, el('span', { html: SHAPES[i] }), el('span', {}, `${label}${q.correct[0] === i ? '  ✔ correct' : ''}`))))];
    case 'typeanswer':
      return [el('p', { class: 'sub', style: 'margin:0' }, 'Accepted answers (up to 4, 20 characters each). Capitals, accents and extra spaces are ignored.'),
        el('div', { class: 'field-grid' }, ...q.accepted.map((a, i) => input({ value: a, maxlength: '20', placeholder: i ? 'Other accepted spelling (optional)' : 'Correct answer',
          'aria-label': `Question ${n} accepted answer ${i + 1}`, style: 'text-align:left' }, (v) => { q.accepted[i] = v; })))];
    case 'slider': {
      const numField = (key, label, extra = {}) => el('label', {}, label, input({ type: 'number', value: q[key], 'aria-label': `Question ${n} ${label}`, ...extra }, (v) => { q[key] = v === '' ? '' : Number(v); }));
      return [el('div', { class: 'field-grid' },
        numField('min', 'Minimum'), numField('max', 'Maximum'), numField('step', 'Step', { min: '0.001' }),
        numField('answer', 'Correct answer'), numField('tolerance', 'Margin (±)', { min: '0' }),
        el('label', {}, 'Unit', input({ value: q.unit || '', maxlength: '12', placeholder: 'e.g. km', 'aria-label': `Question ${n} unit` }, (v) => { q.unit = v; }))),
      el('p', { class: 'sub', style: 'margin:0' }, 'Answers within the margin count as correct; closer answers score more.')];
    }
    case 'puzzle':
      return [el('p', { class: 'sub', style: 'margin:0' }, 'Enter 3-4 items in the CORRECT order. Players see them shuffled.'),
        ...q.items.map((it, i) => el('div', { class: 'choice-row' },
          el('div', { class: `swatch tile c${i}`, style: 'min-height:0;padding:0;box-shadow:none;font-weight:900' }, String(i + 1)),
          input({ value: it, maxlength: '60', placeholder: i < 3 ? `Item ${i + 1}` : `Item ${i + 1} (optional)`, 'aria-label': `Question ${n} item ${i + 1}`, style: 'text-align:left' }, (v) => { q.items[i] = v; })))];
    case 'droppin':
      return [el('p', { class: 'sub', style: 'margin:0' }, 'Click the image to mark the correct spot, then set how big the correct area is.'),
        el('div', { id: `pin-preview-${qi}` }, pinPreview(q, qi)),
        el('label', { class: 'sub' }, 'Correct area size ', (() => {
          const r = el('input', { type: 'range', min: '0.02', max: '0.4', step: '0.01', value: String(q.target.r), 'aria-label': 'Correct area size',
            oninput: (e) => { q.target.r = Number(e.target.value); saveDraft(); renderPinPreview(q, qi); } });
          r.style.width = '200px';
          return r;
        })())];
    case 'wordcloud':
      return [el('p', { class: 'sub', style: 'margin:0' }, 'Players type a short answer (up to 20 characters). Answers appear as a word cloud. No points. Offensive words are hidden automatically.')];
    case 'openended':
      return [el('p', { class: 'sub', style: 'margin:0' }, 'Players type a longer answer (up to 120 characters), shown on screen. No points. Offensive answers are hidden automatically.')];
    default: return [];
  }
}

function pinPreview(q, qi) {
  if (!q.image) return el('p', { class: 'sub' }, 'Add an image link above to place the correct spot.');
  const box = el('div', { class: 'pin-editor', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    q.target.x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000;
    q.target.y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000;
    saveDraft(); renderPinPreview(q, qi);
  } }, el('img', { src: q.image, alt: 'Drop pin image', referrerpolicy: 'no-referrer' }));
  const img = box.querySelector('img');
  const place = () => {
    const w = img.clientWidth;
    box.querySelector('.pin-target')?.remove();
    box.append(el('span', { class: 'pin-target', style: `left:${q.target.x * 100}%;top:${q.target.y * 100}%;width:${q.target.r * 2 * w}px;height:${q.target.r * 2 * w}px` }));
  };
  img.onload = place;
  if (img.complete) setTimeout(place);
  return box;
}

function renderPinPreview(q, qi) {
  document.getElementById(`pin-preview-${qi}`)?.replaceChildren(pinPreview(q, qi));
}

function renderOptions() {
  document.getElementById('option-list').replaceChildren(...OPTIONS.map(([key, label, help]) => el('label', {},
    (() => {
      const box = el('input', { type: 'checkbox', onchange: (e) => {
        options[key] = e.target.checked;
        try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* ignore */ }
      } });
      box.checked = options[key];
      return box;
    })(),
    el('span', {}, label, el('small', {}, help)))));
}

/** The quiz in the shape the server validates (empty optional fields removed). */
function cleanedQuiz() {
  const nonEmpty = (arr) => arr.map((x) => String(x ?? '').trim()).filter(Boolean);
  return {
    title: quiz.title,
    questions: quiz.questions.map((q) => {
      const base = { type: q.type, text: q.text, time: q.time, image: q.image || '', points: q.points || 'standard' };
      switch (q.type) {
        case 'quiz': case 'poll': {
          const kept = q.choices.map((c, i) => ({ c: c.trim(), i })).filter((x, idx) => x.c || idx < 2);
          return { ...base, choices: kept.map((x) => x.c), correct: kept.map((x, k) => (q.correct.includes(x.i) ? k : -1)).filter((x) => x >= 0) };
        }
        case 'truefalse': return { ...base, correct: q.correct };
        case 'typeanswer': return { ...base, accepted: nonEmpty(q.accepted) };
        case 'slider': return { ...base, min: q.min, max: q.max, step: q.step, answer: q.answer, tolerance: q.tolerance || 0, unit: q.unit || '' };
        case 'puzzle': return { ...base, items: nonEmpty(q.items) };
        case 'droppin': return { ...base, target: q.target };
        default: return base;
      }
    }),
  };
}

// ---------------- editor actions ----------------

document.getElementById('quiz-title').addEventListener('input', (e) => { quiz.title = e.target.value; saveDraft(); });
document.getElementById('btn-add').addEventListener('click', () => { quiz.questions.push(blankQuestion()); saveDraft(); renderEditor(); });
document.getElementById('btn-new').addEventListener('click', () => {
  if (!confirm('Start a new, empty quiz? Unsaved changes to this quiz will be lost.')) return;
  quiz = { title: '', questions: [blankQuestion()] }; saveDraft(); renderEditor(); dirty = false; setStatus('');
});
document.getElementById('btn-sample').addEventListener('click', () => { quiz = { ...structuredClone(SAMPLE), questions: SAMPLE.questions.map(withDefaults) }; saveDraft(); renderEditor(); });
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cleanedQuiz(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${(quiz.title || 'quiz').replace(/[^\w-]+/g, '_')}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
const importFile = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const f = importFile.files[0];
  if (!f) return;
  try {
    const q = JSON.parse(await f.text());
    if (!Array.isArray(q.questions)) throw new Error('No questions array');
    quiz = { title: String(q.title || ''), questions: q.questions.map((x) => withDefaults({ type: 'quiz', points: 'standard', time: 20, image: '', ...x })) };
    saveDraft();
    renderEditor();
  } catch (ex) {
    document.getElementById('edit-err').textContent = `Import failed: ${ex.message}`;
  }
  importFile.value = '';
});

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!me) { setStatus('Sign in on the My library page to save quizzes to your account.'); return; }
  try {
    const body = { quiz: cleanedQuiz() };
    if (quiz.libraryId) await api(`/api/quizzes/${quiz.libraryId}`, body, 'PUT');
    else quiz.libraryId = (await api('/api/quizzes', body)).id;
    saveDraft(false);
    dirty = false;
    setStatus(`Saved to your library ✓ ${new Date().toLocaleTimeString()}`);
  } catch (ex) {
    setStatus(`Not saved: ${ex.message}`);
  }
});

async function renderAccount() {
  const bar = document.getElementById('account-bar');
  try { me = (await api('/api/auth/me')).user; } catch { me = null; }
  if (me) {
    bar.replaceChildren(el('span', { style: 'font-weight:800' }, `👤 ${me.name}`),
      el('button', { class: 'ghost small', type: 'button', onclick: async () => { await api('/api/auth/logout', {}); renderAccount(); } }, 'Sign out'));
  } else {
    bar.replaceChildren(el('a', { class: 'btn ghost small', href: '/library' }, 'Sign in to save quizzes online'));
  }
  document.getElementById('btn-save').classList.toggle('hidden', !me);
}

document.getElementById('btn-host').addEventListener('click', async () => {
  S.unlock(); // browsers only allow audio after a click
  const errEl = document.getElementById('edit-err');
  errEl.textContent = '';
  try {
    const body = quiz.libraryId && !dirty && me ? { quizId: quiz.libraryId, options } : { quiz: cleanedQuiz(), options };
    const { pin, hostKey } = await api('/api/games', body);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pin, hostKey })); } catch { /* ignore */ }
    startHosting(pin, hostKey);
  } catch (ex) {
    errEl.textContent = ex.message;
  }
});

// ---------------- live game ----------------

let pin, hostKey, stopTimer = () => {};
let lastPhase = '';
let lastPlayerCount = 0;

async function startHosting(p, key) {
  pin = p;
  hostKey = key;
  history.replaceState(null, '', `/host?pin=${pin}`);
  document.getElementById('mute-lobby').replaceChildren(S.muteButton());
  document.getElementById('mute-q').replaceChildren(S.muteButton());
  await setupJoinInfo();
  stream(`/api/games/${pin}/host-events?key=${encodeURIComponent(hostKey)}`, onMessage);
}

async function setupJoinInfo() {
  let base = location.origin;
  const select = document.getElementById('url-choice');
  try {
    const info = await api('/api/info');
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    // Phones can't reach "localhost", so share this computer's Wi-Fi address instead.
    if (isLocal && info.lanUrls.length) {
      base = info.lanUrls[0];
      if (info.lanUrls.length > 1) {
        select.replaceChildren(...info.lanUrls.map((u) => el('option', { value: u }, `Share address: ${u}`)));
        select.classList.remove('hidden');
        select.onchange = () => renderJoin(select.value);
      }
    }
  } catch { /* fall back to current origin */ }
  renderJoin(base);
}

function renderJoin(base) {
  const joinUrl = `${base}/play?pin=${pin}`;
  document.getElementById('join-url').textContent = base.replace(/^https?:\/\//, '');
  document.getElementById('lobby-pin').textContent = pin;
  const qr = document.getElementById('qr');
  qr.replaceChildren();
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(qr, { text: joinUrl, width: 216, height: 216, correctLevel: window.QRCode.CorrectLevel.M });
  } else {
    qr.append(el('p', { style: 'color:#1c1530;font-weight:700;padding:8px;text-align:center' }, 'QR unavailable offline. Share the address and PIN.'));
  }
}

function renderPlayers(players) {
  if (players.length > lastPlayerCount && lastPhase.startsWith('LOBBY')) S.join();
  lastPlayerCount = players.length;
  document.getElementById('player-count').textContent = players.length;
  document.getElementById('btn-start').disabled = players.length === 0;
  document.getElementById('lobby-hint').textContent = players.length ? '' : 'Waiting for players…';
  document.getElementById('players').replaceChildren(...players.map((p) =>
    el('span', { class: `chip pop${p.connected ? '' : ' off'}` }, avatarEl(p.avatar, 40), p.name,
      el('button', { title: `Remove ${p.name}`, 'aria-label': `Remove ${p.name}`, onclick: () => hostAction('kick', { playerId: p.id }) }, '✕'))));
}

function renderLock(locked) {
  const b = document.getElementById('btn-lock');
  b.textContent = locked ? '🔒 Unlock' : '🔓 Lock';
  b.setAttribute('aria-pressed', String(!!locked));
  document.getElementById('locked-banner').classList.toggle('hidden', !locked);
}

function choiceTiles(q, opts = {}) {
  return q.choices.map((c, i) => el('div', {
    class: `tile c${i}${opts.correct && opts.correct.length && !opts.correct.includes(i) ? ' dim' : ''}`,
  }, el('span', { html: SHAPES[i] }), el('span', {}, c),
  opts.correct && opts.correct.includes(i) ? el('span', { class: 'check', 'aria-label': 'Correct' }, '✔') : null));
}

function setTimerRing(node, secs, frac) {
  node.style.setProperty('--p', `${Math.round(frac * 100)}%`);
  node.querySelector('span').textContent = secs;
}

// Question image, or the four answer shapes as a placeholder illustration.
function renderMedia(q) {
  const box = document.getElementById('q-media');
  if (q.image) {
    const img = el('img', { src: q.image, alt: '', referrerpolicy: 'no-referrer' });
    img.onerror = () => box.replaceChildren(shapesArt(q.choices ? q.choices.length : 4));
    box.replaceChildren(img);
  } else {
    box.replaceChildren(shapesArt(q.choices ? q.choices.length : 4));
  }
}
const shapesArt = (n) => el('div', { class: 'shapes', 'aria-hidden': 'true' },
  ...SHAPES.slice(0, Math.max(n, 2)).map((s, i) => el('span', { class: `tile c${i}`, html: s, style: 'min-height:0;padding:0' })));

const prompt = (text) => el('div', { class: 'prompt-box' }, text);

/** Bottom area while a question is open. */
function questionBody(q) {
  switch (q.type) {
    case 'quiz': case 'truefalse': case 'poll': return choiceTiles(q);
    case 'typeanswer': return [prompt('⌨️ Type your answer on your device')];
    case 'wordcloud': return [prompt('☁️ Type a word or two on your device')];
    case 'openended': return [prompt('💬 Type your answer on your device')];
    case 'slider': return [prompt(`🎚️ Pick a number between ${q.min} and ${q.max}${q.unit ? ` ${q.unit}` : ''} on your device`)];
    case 'droppin': return [prompt('📍 Drop a pin on the image on your device')];
    case 'puzzle': return q.items.map((it, i) => el('div', { class: `tile c${i}` }, el('span', { html: SHAPES[i] }), el('span', {}, it.text)));
    default: return [];
  }
}

const pct = (v, q) => `${((v - q.min) / (q.max - q.min)) * 100}%`;
const COLORS = ['var(--a0)', 'var(--a1)', 'var(--a2)', 'var(--a3)', '#ffffff', '#c7b8ff'];

/** Main reveal visual and the line underneath it, per question type. */
function revealViews(q, r) {
  const none = r.answeredCount === 0;
  switch (r.type) {
    case 'quiz': case 'truefalse': case 'poll': {
      const max = Math.max(1, ...r.counts);
      const bars = el('div', { class: 'bars' }, ...r.counts.map((n, i) => el('div', { class: 'bar' },
        el('span', {}, n),
        el('div', { class: `fill tile c${i}${r.correct.length && !r.correct.includes(i) ? ' dim' : ''}`, style: `height:${(n / max) * 80 + 4}%;padding:0;min-height:6px` }),
        el('span', { class: 'label', html: SHAPES[i] + (r.correct.includes(i) ? ' ✔' : '') }))));
      return [bars, choiceTiles(q, { correct: r.correct })];
    }
    case 'typeanswer':
      return [none ? prompt('No answers') : el('div', { class: 'resp-list' }, ...r.responses.map((x) => el('div', {},
        el('span', { class: x.correct ? 'ok' : 'no' }, `${x.correct ? '✔' : '✖'} ${x.text}`), el('span', {}, `×${x.count}`)))),
      [prompt(`Correct answer: ${r.accepted.join(' / ')}`)]];
    case 'slider': {
      const lo = Math.max(r.min, r.answer - r.tolerance); const hi = Math.min(r.max, r.answer + r.tolerance);
      const line = el('div', { class: 'numline' }, el('div', { class: 'track' },
        el('div', { class: 'band', style: `left:${pct(lo, r)};width:calc(${pct(hi, r)} - ${pct(lo, r)} + 4px)` }),
        ...r.values.map((v) => el('span', { class: 'dot', style: `left:${pct(v, r)}` })),
        el('span', { class: 'mark', style: `left:${pct(r.answer, r)}` }, `${r.answer} ✔`)),
      el('div', { class: 'ends' }, el('span', {}, `${r.min}`), el('span', {}, `${r.max}${r.unit ? ` ${r.unit}` : ''}`)));
      const avg = r.average === null ? '' : ` · average answer ${Math.round(r.average * 10) / 10}`;
      return [line, [prompt(`Correct answer: ${r.answer}${r.unit ? ` ${r.unit}` : ''}${r.tolerance ? ` (±${r.tolerance})` : ''}${avg}`)]];
    }
    case 'puzzle':
      return [el('ol', { class: 'order-list' }, ...r.order.map((t, i) => el('li', { class: `tile c${i}`, style: 'min-height:0' }, el('span', { class: 'num' }, i + 1), t))),
        [prompt(`${r.correctCount} of ${r.answeredCount} player${r.answeredCount === 1 ? '' : 's'} got the order right`)]];
    case 'droppin': {
      const map = el('div', { class: 'pinmap' }, el('img', { src: q.image, alt: '', referrerpolicy: 'no-referrer' }));
      const img = map.querySelector('img');
      const draw = () => {
        const w = img.clientWidth;
        map.append(el('span', { class: 'area', style: `left:${r.target.x * 100}%;top:${r.target.y * 100}%;width:${r.target.r * 2 * w}px;height:${r.target.r * 2 * w}px` }),
          ...r.pins.map((p) => el('span', { class: 'pin', style: `left:${p.x * 100}%;top:${p.y * 100}%` }, p.correct ? '📍' : '📌')));
      };
      img.onload = draw;
      const inside = r.pins.filter((p) => p.correct).length;
      return [map, [prompt(`${inside} of ${r.answeredCount} pin${r.answeredCount === 1 ? '' : 's'} landed in the right area 📍`)]];
    }
    case 'wordcloud': {
      const max = Math.max(1, ...r.responses.map((x) => x.count));
      return [none ? prompt('No answers') : el('div', { class: 'cloud' }, ...r.responses.map((x, i) => el('span', {
        style: `font-size:${20 + (x.count / max) * 52}px;color:${COLORS[i % COLORS.length]}`, title: `${x.count} × ${x.text}` }, x.text))), []];
    }
    case 'openended':
      return [none ? prompt('No answers') : el('div', { class: 'resp-list' }, ...r.responses.map((x) => el('div', {}, el('span', {}, x.text), x.count > 1 ? el('span', {}, `×${x.count}`) : null))), []];
    default: return [prompt(''), []];
  }
}

function boardRow(p, delayMs = 0) {
  return el('li', { style: `animation-delay:${delayMs}ms` },
    el('span', {}, p.rank), avatarEl(p.avatar, 44),
    el('span', { class: 'name' }, `${p.name}${p.streak >= 2 ? ` 🔥${p.streak}` : ''}`),
    el('span', {}, p.score.toLocaleString()));
}

// ---------- podium: staged reveal, 3rd -> 2nd -> drumroll -> 1st ----------
// Same ordering and pacing idea as the observed Kahoot podium (bronze 2.2s,
// silver 6.5s, gold 13.7s with spotlight and confetti), compressed to ~8s.
let podiumTimers = [];
function playPodium(lb) {
  podiumTimers.forEach(clearTimeout);
  podiumTimers = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const at = (ms, fn) => podiumTimers.push(setTimeout(fn, reduce ? 0 : ms));

  const slots = [['p2', lb[1], '2'], ['p1', lb[0], '1'], ['p3', lb[2], '3']].map(([cls, p, place]) => {
    if (!p) return null;
    const av = avatarEl(p.avatar, 96);
    const slot = el('div', { class: `slot ${cls}` },
      el('div', { class: 'who' }, av, el('span', {}, p.name), el('span', { class: 'score' }, `${p.score.toLocaleString()} pts`)),
      el('div', { class: 'step' }, place));
    return { slot, av, place };
  });
  document.getElementById('podium').replaceChildren(...slots.filter(Boolean).map((s) => s.slot));
  const byPlace = Object.fromEntries(slots.filter(Boolean).map((s) => [s.place, s]));
  const drum = document.getElementById('drumroll');
  const spot = document.getElementById('spotlight');
  const runners = document.getElementById('runners');
  drum.classList.remove('on'); spot.classList.remove('on'); runners.classList.remove('on');
  document.querySelectorAll('.confetti').forEach((c) => c.remove());

  const reveal = (place) => {
    const s = byPlace[place];
    if (!s) return;
    s.slot.classList.add('up');
    at(700, () => { s.slot.classList.add('pop'); s.av.classList.add('groove'); });
  };
  at(800, () => { reveal('3'); S.getReadyBeep(); });
  at(2600, () => { reveal('2'); S.getReadyBeep(); });
  at(4400, () => { drum.textContent = 'And the winner is…'; drum.classList.add('on'); spot.classList.add('on'); S.drumroll(1.8); });
  at(6200, () => { reveal('1'); drum.classList.remove('on'); S.fanfare(); });
  at(6900, () => { if (!reduce && lb[0]) confetti(); });
  at(8200, () => { spot.classList.remove('on'); runners.classList.add('on'); });
}

function confetti() {
  const colors = ['#e5484d', '#3e63dd', '#f5a524', '#30a46c', '#ffffff', '#7c5cff'];
  const screen = document.getElementById('s-end');
  for (let i = 0; i < 120; i++) {
    screen.append(el('span', {
      class: 'confetti',
      style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};`
        + `animation-duration:${2.5 + Math.random() * 2.5}s;animation-delay:${Math.random() * 1.2}s;`
        + `transform:rotate(${Math.random() * 360}deg)`,
    }));
  }
}
let lastLeaderboard = [];
document.getElementById('btn-replay').addEventListener('click', () => { S.unlock(); playPodium(lastLeaderboard); });

function onMessage(msg) {
  if (msg.type === 'PLAYERS') return renderPlayers(msg.players);
  if (msg.type === 'ANSWER_COUNT') {
    const n = document.getElementById('q-answers');
    n.textContent = msg.answeredCount;
    n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); // bump animation
    return;
  }
  if (msg.type !== 'STATE') return;

  stopTimer();
  const q = msg.question;
  const phase = `${msg.state}:${q ? q.index : ''}`;
  const isNewPhase = phase !== lastPhase; // snapshots repeat on reconnect; only play sounds once
  lastPhase = phase;
  if (msg.players) renderPlayers(msg.players);
  renderLock(msg.locked);

  switch (msg.state) {
    case 'LOBBY':
      document.getElementById('lobby-title').textContent = msg.title;
      if (isNewPhase) S.lobbyMusic();
      show('s-lobby');
      break;
    case 'GET_READY': {
      if (isNewPhase) S.stopMusic();
      document.getElementById('ready-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('ready-text').textContent = q.text;
      const ring = document.getElementById('ready-timer');
      let lastSec = null;
      stopTimer = countdown(msg.startsAt, 4000, (s, f) => {
        setTimerRing(ring, s, f);
        if (s !== lastSec) { if (lastSec !== null || isNewPhase) S.getReadyBeep(s === 0); lastSec = s; }
      });
      show('s-ready');
      break;
    }
    case 'QUESTION': {
      if (isNewPhase) S.questionMusic();
      document.getElementById('q-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('q-pin').textContent = msg.pin;
      const tag = document.getElementById('q-points');
      tag.classList.toggle('hidden', q.points === 'standard' || ['poll', 'wordcloud', 'openended'].includes(q.type));
      tag.textContent = q.points === 'double' ? '2× points' : 'No points';
      document.getElementById('q-text').textContent = q.text;
      document.getElementById('q-answers').textContent = msg.answeredCount;
      document.getElementById('q-choices').replaceChildren(...questionBody(q));
      renderMedia(q);
      const ring = document.getElementById('q-timer');
      const bar = document.getElementById('q-bar');
      let lastSec = null;
      stopTimer = countdown(msg.endsAt, q.time * 1000, (s, f) => {
        setTimerRing(ring, s, f);
        bar.style.transform = `scaleX(${f})`;
        ring.classList.toggle('urgent', s <= 5);
        if (s !== lastSec) { S.questionSecond(s); lastSec = s; }
      });
      show('s-question');
      break;
    }
    case 'REVEAL': {
      if (isNewPhase) { S.timeUp(); setTimeout(S.reveal, 700); }
      const r = msg.reveal;
      document.getElementById('r-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('r-pin').textContent = msg.pin;
      document.getElementById('r-answers').textContent = r.answeredCount;
      document.getElementById('r-text').textContent = q.text;
      const [main, below] = revealViews(q, r);
      document.getElementById('r-bars').replaceChildren(main);
      document.getElementById('r-choices').replaceChildren(...below);
      show('s-reveal');
      break;
    }
    case 'SCOREBOARD':
      if (isNewPhase) S.scoreboard();
      document.getElementById('btn-next-q').textContent = q && q.index + 1 >= q.total ? 'Final results ▶' : 'Next ▶';
      document.getElementById('board').replaceChildren(...msg.leaderboard.map((p, i) => boardRow(p, i * 90)));
      show('s-board');
      break;
    case 'ENDED': {
      S.stopMusic();
      document.getElementById('end-title').textContent = msg.title;
      lastLeaderboard = msg.leaderboard;
      const reportLink = document.getElementById('btn-report');
      reportLink.classList.toggle('hidden', !msg.reportId);
      if (msg.reportId) reportLink.href = `/reports?id=${msg.reportId}`;
      document.getElementById('end-board').replaceChildren(...lastLeaderboard.slice(3).map((p, i) => boardRow(p, i * 90)));
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      show('s-end');
      if (isNewPhase) playPodium(lastLeaderboard);
      break;
    }
  }
}

async function hostAction(action, extra = {}) {
  S.unlock();
  try { await api(`/api/games/${pin}/host-action`, { key: hostKey, action, ...extra }); }
  catch (ex) { alert(ex.message); }
}

document.getElementById('btn-start').addEventListener('click', () => hostAction('start'));
document.getElementById('btn-lock').addEventListener('click', (e) => hostAction(e.currentTarget.getAttribute('aria-pressed') === 'true' ? 'unlock' : 'lock'));
document.getElementById('btn-skip').addEventListener('click', () => hostAction('skip'));
document.getElementById('btn-to-board').addEventListener('click', () => hostAction('next'));
document.getElementById('btn-next-q').addEventListener('click', () => hostAction('next'));
// Resumed games start muted until the host clicks anywhere (browser autoplay rules).
document.addEventListener('click', () => S.unlock(), { once: true });

// ---------------- boot ----------------

(async function boot() {
  renderAccount();
  // Resume a game this tab was hosting (e.g. after a refresh).
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    const urlPin = new URLSearchParams(location.search).get('pin');
    if (saved && saved.pin && (!urlPin || urlPin === saved.pin)) {
      api(`/api/games/${saved.pin}`)
        .then(() => startHosting(saved.pin, saved.hostKey))
        .catch(() => { sessionStorage.removeItem(SESSION_KEY); history.replaceState(null, '', '/host'); renderEditor(); show('s-edit'); });
      return;
    }
  } catch { /* ignore */ }

  // Opened from the library: /host?quiz=ID loads it; &host=1 starts hosting straight away.
  const params = new URLSearchParams(location.search);
  const libId = Number(params.get('quiz'));
  if (libId) {
    try {
      const saved = await api(`/api/quizzes/${libId}`);
      quiz = { title: saved.quiz.title, libraryId: saved.id, questions: saved.quiz.questions.map(withDefaults) };
      saveDraft(false);
      dirty = false;
      setStatus(`Editing "${saved.title}" from your library`);
    } catch (ex) {
      setStatus(`Could not open that quiz: ${ex.message}`);
    }
    history.replaceState(null, '', '/host');
    renderEditor();
    show('s-edit');
    if (params.get('host') === '1') document.getElementById('btn-host').click();
    return;
  }
  renderEditor();
  show('s-edit');
})();
