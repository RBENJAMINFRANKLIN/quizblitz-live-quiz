import { SHAPES, api, el, show, countdown, stream, avatarEl } from '/shared.js';

const STORAGE_KEY = 'quizblitz.draft';
const SESSION_KEY = 'quizblitz.hosting';

const SAMPLE = {
  title: 'Planet Earth Trivia',
  questions: [
    { text: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correct: [2], time: 20 },
    { text: 'Mount Everest is in the Himalayas.', choices: ['True', 'False'], correct: [0], time: 10 },
    { text: 'Which planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: [1], time: 20 },
    { text: 'How many continents are there?', choices: ['5', '6', '7', '8'], correct: [2], time: 15 },
  ],
};

const blankQuestion = () => ({ text: '', choices: ['', '', '', ''], correct: [0], time: 20 });

// ---------------- editor ----------------

let quiz = loadDraft();

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.questions) && saved.questions.length) return saved;
  } catch { /* storage unavailable or corrupt */ }
  return structuredClone(SAMPLE);
}

function saveDraft() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(quiz)); } catch { /* ignore */ }
}

function renderEditor() {
  document.getElementById('quiz-title').value = quiz.title || '';
  const list = document.getElementById('questions');
  list.replaceChildren(...quiz.questions.map((q, qi) => {
    const choiceRows = q.choices.map((c, ci) => el('div', { class: 'choice-row' },
      el('div', { class: `swatch tile c${ci}`, html: SHAPES[ci], style: 'min-height:0;padding:0;box-shadow:none' }),
      el('input', {
        type: 'text', value: c, maxlength: '80', placeholder: ci < 2 ? `Answer ${ci + 1}` : `Answer ${ci + 1} (optional)`,
        'aria-label': `Question ${qi + 1} answer ${ci + 1}`,
        oninput: (e) => { q.choices[ci] = e.target.value; saveDraft(); },
      }),
      el('label', {},
        (() => {
          const box = el('input', {
            type: 'checkbox', 'aria-label': `Answer ${ci + 1} is correct`,
            onchange: (e) => {
              q.correct = e.target.checked ? [...new Set([...q.correct, ci])] : q.correct.filter((x) => x !== ci);
              saveDraft();
            },
          });
          box.checked = q.correct.includes(ci);
          return box;
        })(),
        'Correct'),
    ));

    const timeSel = el('select', { 'aria-label': 'Time limit', onchange: (e) => { q.time = Number(e.target.value); saveDraft(); } },
      ...[5, 10, 15, 20, 30, 45, 60, 90, 120].map((s) => {
        const o = el('option', { value: String(s) }, `${s} sec`);
        if (s === q.time) o.selected = true;
        return o;
      }));

    return el('div', { class: 'card q-card' },
      el('div', { class: 'q-head' },
        el('span', {}, `Question ${qi + 1}`),
        el('div', { class: 'row' },
          timeSel,
          el('button', { class: 'small ghost', type: 'button', title: 'Move up', disabled: qi === 0 ? '' : null,
            onclick: () => { [quiz.questions[qi - 1], quiz.questions[qi]] = [quiz.questions[qi], quiz.questions[qi - 1]]; saveDraft(); renderEditor(); } }, '↑'),
          el('button', { class: 'small ghost', type: 'button', title: 'True / False',
            onclick: () => { q.choices = ['True', 'False']; q.correct = [0]; saveDraft(); renderEditor(); } }, 'T/F'),
          el('button', { class: 'small ghost', type: 'button', title: 'Delete question',
            onclick: () => { quiz.questions.splice(qi, 1); if (!quiz.questions.length) quiz.questions.push(blankQuestion()); saveDraft(); renderEditor(); } }, '✕'),
        )),
      el('input', {
        value: q.text, maxlength: '200', placeholder: 'Type your question', style: 'text-align:left',
        'aria-label': `Question ${qi + 1} text`,
        oninput: (e) => { q.text = e.target.value; saveDraft(); },
      }),
      el('input', {
        type: 'url', value: q.image || '', maxlength: '500', placeholder: 'Image link (optional), e.g. https://…/photo.jpg',
        style: 'text-align:left;font-size:14px;font-weight:600', 'aria-label': `Question ${qi + 1} image link`,
        oninput: (e) => { q.image = e.target.value.trim(); saveDraft(); },
      }),
      ...choiceRows,
    );
  }));
}

// Drops empty optional answers (3 and 4) and remaps correct indices.
function cleanedQuiz() {
  return {
    title: quiz.title,
    questions: quiz.questions.map((q) => {
      const kept = q.choices.map((c, i) => ({ c: c.trim(), i })).filter((x, idx) => x.c || idx < 2);
      return {
        text: q.text,
        time: q.time,
        image: q.image || '',
        choices: kept.map((x) => x.c),
        correct: kept.map((x, newIdx) => (q.correct.includes(x.i) ? newIdx : -1)).filter((x) => x >= 0),
      };
    }),
  };
}

document.getElementById('quiz-title').addEventListener('input', (e) => { quiz.title = e.target.value; saveDraft(); });
document.getElementById('btn-add').addEventListener('click', () => { quiz.questions.push(blankQuestion()); saveDraft(); renderEditor(); });
document.getElementById('btn-sample').addEventListener('click', () => { quiz = structuredClone(SAMPLE); saveDraft(); renderEditor(); });
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
    quiz = {
      title: String(q.title || ''),
      questions: q.questions.map((x) => {
        const choices = [...(x.choices || []).map(String), '', '', ''].slice(0, 4);
        return {
          text: String(x.text || ''), choices, correct: [].concat(x.correct ?? 0).map(Number),
          time: Number(x.time) || 20, image: String(x.image || ''),
        };
      }),
    };
    saveDraft();
    renderEditor();
  } catch (ex) {
    document.getElementById('edit-err').textContent = `Import failed: ${ex.message}`;
  }
  importFile.value = '';
});

document.getElementById('btn-host').addEventListener('click', async () => {
  const errEl = document.getElementById('edit-err');
  errEl.textContent = '';
  try {
    const { pin, hostKey } = await api('/api/games', { quiz: cleanedQuiz() });
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pin, hostKey })); } catch { /* ignore */ }
    startHosting(pin, hostKey);
  } catch (ex) {
    errEl.textContent = ex.message;
  }
});

// ---------------- live game ----------------

let pin, hostKey, stopTimer = () => {};

async function startHosting(p, key) {
  pin = p;
  hostKey = key;
  history.replaceState(null, '', `/host?pin=${pin}`);
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
  document.getElementById('player-count').textContent = players.length;
  document.getElementById('btn-start').disabled = players.length === 0;
  document.getElementById('lobby-hint').textContent = players.length ? '' : 'Waiting for players…';
  document.getElementById('players').replaceChildren(...players.map((p) =>
    el('span', { class: `chip pop${p.connected ? '' : ' off'}` }, avatarEl(p.avatar, 40), p.name,
      el('button', { title: `Remove ${p.name}`, 'aria-label': `Remove ${p.name}`, onclick: () => hostAction('kick', { playerId: p.id }) }, '✕'))));
}

function choiceTiles(q, opts = {}) {
  return q.choices.map((c, i) => el('div', {
    class: `tile c${i}${opts.correct && !opts.correct.includes(i) ? ' dim' : ''}`,
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
    img.onerror = () => box.replaceChildren(shapesArt(q.choices.length));
    box.replaceChildren(img);
  } else {
    box.replaceChildren(shapesArt(q.choices.length));
  }
}
const shapesArt = (n) => el('div', { class: 'shapes', 'aria-hidden': 'true' },
  ...SHAPES.slice(0, Math.max(n, 2)).map((s, i) => el('span', { class: `tile c${i}`, html: s, style: 'min-height:0;padding:0' })));

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
  at(800, () => reveal('3'));
  at(2600, () => reveal('2'));
  at(4400, () => { drum.textContent = 'And the winner is…'; drum.classList.add('on'); spot.classList.add('on'); });
  at(6200, () => { reveal('1'); drum.classList.remove('on'); });
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
document.getElementById('btn-replay').addEventListener('click', () => playPodium(lastLeaderboard));

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
  if (msg.players) renderPlayers(msg.players);
  const q = msg.question;

  switch (msg.state) {
    case 'LOBBY':
      document.getElementById('lobby-title').textContent = msg.title;
      show('s-lobby');
      break;
    case 'GET_READY': {
      document.getElementById('ready-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('ready-text').textContent = q.text;
      const ring = document.getElementById('ready-timer');
      stopTimer = countdown(msg.startsAt, 4000, (s, f) => setTimerRing(ring, s, f));
      show('s-ready');
      break;
    }
    case 'QUESTION': {
      document.getElementById('q-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('q-pin').textContent = msg.pin;
      document.getElementById('q-text').textContent = q.text;
      document.getElementById('q-answers').textContent = msg.answeredCount;
      document.getElementById('q-choices').replaceChildren(...choiceTiles(q));
      renderMedia(q);
      const ring = document.getElementById('q-timer');
      const bar = document.getElementById('q-bar');
      stopTimer = countdown(msg.endsAt, q.time * 1000, (s, f) => {
        setTimerRing(ring, s, f);
        bar.style.transform = `scaleX(${f})`;
        ring.classList.toggle('urgent', s <= 5);
      });
      show('s-question');
      break;
    }
    case 'REVEAL': {
      const r = msg.reveal;
      document.getElementById('r-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      document.getElementById('r-pin').textContent = msg.pin;
      document.getElementById('r-answers').textContent = r.answeredCount;
      document.getElementById('r-text').textContent = q.text;
      const max = Math.max(1, ...r.counts);
      document.getElementById('r-bars').replaceChildren(...r.counts.map((n, i) => el('div', { class: 'bar' },
        el('span', {}, n),
        el('div', { class: `fill tile c${i}${r.correct.includes(i) ? '' : ' dim'}`, style: `height:${(n / max) * 80 + 4}%;padding:0;min-height:6px` }),
        el('span', { class: 'label', html: SHAPES[i] + (r.correct.includes(i) ? ' ✔' : '') }))));
      document.getElementById('r-choices').replaceChildren(...choiceTiles(q, { correct: r.correct }));
      show('s-reveal');
      break;
    }
    case 'SCOREBOARD':
      document.getElementById('btn-next-q').textContent = q && q.index + 1 >= q.total ? 'Final results ▶' : 'Next ▶';
      document.getElementById('board').replaceChildren(...msg.leaderboard.map((p, i) => boardRow(p, i * 90)));
      show('s-board');
      break;
    case 'ENDED': {
      document.getElementById('end-title').textContent = msg.title;
      lastLeaderboard = msg.leaderboard;
      document.getElementById('end-board').replaceChildren(...lastLeaderboard.slice(3).map((p, i) => boardRow(p, i * 90)));
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      show('s-end');
      playPodium(lastLeaderboard);
      break;
    }
  }
}

async function hostAction(action, extra = {}) {
  try { await api(`/api/games/${pin}/host-action`, { key: hostKey, action, ...extra }); }
  catch (ex) { alert(ex.message); }
}

document.getElementById('btn-start').addEventListener('click', () => hostAction('start'));
document.getElementById('btn-skip').addEventListener('click', () => hostAction('skip'));
document.getElementById('btn-to-board').addEventListener('click', () => hostAction('next'));
document.getElementById('btn-next-q').addEventListener('click', () => hostAction('next'));

// ---------------- boot ----------------

(function boot() {
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
  renderEditor();
  show('s-edit');
})();
