import { SHAPES, SHAPE_NAMES, AVATARS, ACCESSORIES, api, el, show, countdown, stream, avatarEl } from '/shared.js';
import * as Sound from '/sound.js';

const SESSION_KEY = 'quizblitz.player';
const $ = (id) => document.getElementById(id);

let pin = null;
let session = null; // { pin, token, name }
let es = null;
let stopTimer = () => {};
let shownQuestion = -1; // question index whose answer buttons are on screen
let failedReconnects = 0;
let spinsLeft = 3;

// ---------- nickname: typed, or from the friendly generator when the host turned it on ----------

async function showNameStep(game) {
  const generated = !!game.nameGenerator;
  $('name').classList.toggle('hidden', generated);
  $('name').required = !generated;
  $('gen-box').classList.toggle('hidden', !generated);
  if (generated) { spinsLeft = 3; $('spins').textContent = spinsLeft; await spin(); }
  show('s-name');
  if (!generated) $('name').focus();
}

async function spin() {
  try {
    const { name } = await api(`/api/games/${pin}/random-name`);
    $('gen-name').textContent = name;
    $('name').value = name;
  } catch (ex) { $('name-err').textContent = ex.message; }
}

$('btn-spin').addEventListener('click', async () => {
  if (spinsLeft <= 0) return;
  spinsLeft--;
  $('spins').textContent = spinsLeft;
  $('btn-spin').disabled = spinsLeft === 0;
  await spin();
});

// ---------- join flow ----------

$('pin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pin-err').textContent = '';
  const value = $('pin').value.trim();
  Sound.unlock();
  try {
    const game = await api(`/api/games/${encodeURIComponent(value)}`);
    if (game.locked) throw new Error('This game is locked. Ask the host to unlock it.');
    pin = value;
    history.replaceState(null, '', `/play?pin=${pin}`);
    await showNameStep(game);
  } catch (ex) {
    $('pin-err').textContent = ex.message;
  }
});

$('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('name-err').textContent = '';
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  Sound.unlock();
  try {
    const r = await api(`/api/games/${pin}/join`, { name: $('name').value });
    session = { pin, token: r.token, name: r.name, avatar: r.avatar };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
    connect();
  } catch (ex) {
    $('name-err').textContent = ex.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});

// ---------- live game ----------

function connect() {
  $('t-pin').textContent = session.pin;
  $('f-name').textContent = session.name;
  $('topbar').classList.remove('hidden');
  $('footer').classList.remove('hidden');
  if (!$('f-mute').firstChild) $('f-mute').replaceChildren(Sound.muteButton());
  es?.close();
  es = stream(`/api/games/${session.pin}/events?token=${encodeURIComponent(session.token)}`, (msg) => {
    failedReconnects = 0;
    onMessage(msg);
  }, (ok) => {
    $('offline').classList.toggle('hidden', ok);
  });
  // EventSource gives up on a non-200 reply (game or player gone) without
  // exposing the status, so probe the game and retry a few times.
  es.addEventListener('error', async () => {
    if (es.readyState !== EventSource.CLOSED) return;
    if (++failedReconnects > 3) return endWith('You are no longer in this game.');
    try { await api(`/api/games/${session.pin}`); setTimeout(connect, 1500); }
    catch { endWith('This game is no longer available.'); }
  });
}

function endWith(text) {
  es?.close();
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  $('offline').classList.add('hidden');
  $('m-text').textContent = text;
  show('s-msg');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function renderAvatar(avatar) {
  if (!avatar) return;
  session.avatar = avatar;
  $('lobby-avatar').replaceChildren(avatarEl(avatar, 120, 'groove'));
  $('f-avatar').replaceChildren(avatarEl(avatar, 34));
}

// ---------- avatar picker ----------

let draft = null;    // avatar being edited
let pickerTab = 'char';

function openPicker() {
  draft = { ...session.avatar };
  pickerTab = 'char';
  renderPicker();
  show('s-avatar');
}

function renderPicker() {
  $('pick-preview').replaceChildren(avatarEl(draft, 110, 'pop'));
  $('tab-char').setAttribute('aria-selected', String(pickerTab === 'char'));
  $('tab-acc').setAttribute('aria-selected', String(pickerTab === 'acc'));
  const items = pickerTab === 'char'
    ? AVATARS.map(([, label], i) => ({ i, label, node: avatarEl({ character: i, accessory: draft.accessory }, 48) }))
    : ACCESSORIES.map(([emoji, label], i) => ({
      i, label, node: i === 0 ? el('span', { class: 'acc-none' }, 'None') : avatarEl({ character: draft.character, accessory: i }, 48),
    }));
  const current = pickerTab === 'char' ? draft.character : draft.accessory;
  $('pick-grid').replaceChildren(...items.map(({ i, label, node }) => el('button', {
    type: 'button', role: 'option', title: label, 'aria-label': label, 'aria-selected': String(i === current),
    onclick: () => {
      if (pickerTab === 'char') draft.character = i; else draft.accessory = i;
      renderPicker();
    },
  }, node)));
}

$('btn-edit-avatar').addEventListener('click', openPicker);
$('tab-char').addEventListener('click', () => { pickerTab = 'char'; renderPicker(); });
$('tab-acc').addEventListener('click', () => { pickerTab = 'acc'; renderPicker(); });
$('btn-avatar-done').addEventListener('click', async () => {
  $('avatar-err').textContent = '';
  try {
    const r = await api(`/api/games/${session.pin}/avatar`, { token: session.token, ...draft });
    renderAvatar(r.avatar);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
    show('s-lobby');
  } catch (ex) {
    $('avatar-err').textContent = ex.message;
  }
});

function setScore(score) {
  if (typeof score === 'number') $('f-total').textContent = score.toLocaleString();
}

function onMessage(msg) {
  if (msg.type === 'KICKED') return endWith('The host removed you from the game.');
  if (msg.type !== 'STATE') return;
  // Don't yank the player out of the avatar picker while still in the lobby.
  const inPicker = !$('s-avatar').classList.contains('hidden');
  if (inPicker && msg.state === 'LOBBY') return;
  stopTimer();
  setScore(msg.score);
  if (!inPicker) renderAvatar(msg.avatar);
  const q = msg.question;
  $('t-progress').textContent = q ? `${q.index + 1} of ${q.total}` : '';

  switch (msg.state) {
    case 'LOBBY':
      show('s-lobby');
      break;
    case 'GET_READY':
      $('ready-num').textContent = `Question ${q.index + 1} of ${q.total}`;
      stopTimer = countdown(msg.startsAt, 0, (s) => { $('ready-count').textContent = s; });
      show('s-ready');
      break;
    case 'QUESTION':
      if (msg.answered) { show('s-sent'); break; }
      renderQuestion(q);
      stopTimer = countdown(msg.endsAt, 0, (s) => { $('a-time').textContent = `⏱ ${s}`; });
      show('s-answer');
      break;
    case 'REVEAL':
      renderResult(msg.result, q ? q.index : '');
      break;
    case 'SCOREBOARD':
      $('w-rank').textContent = `You're in ${ordinal(msg.rank)} place`;
      $('w-msg').textContent = 'Look up at the main screen';
      show('s-wait');
      break;
    case 'ENDED':
      $('f-medal').replaceChildren(avatarEl(session.avatar, 120, msg.rank <= 3 ? 'groove' : ''),
        el('span', { class: 'medal' }, ['🥇', '🥈', '🥉'][msg.rank - 1] || '🎉'));
      $('f-rank').textContent = `${ordinal(msg.rank)} of ${msg.total}`;
      $('f-score').textContent = `${msg.score.toLocaleString()} points`;
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      show('s-final');
      break;
  }
}

function renderQuestion(q) {
  $('a-num').textContent = `${q.index + 1} / ${q.total}${q.points === 'double' ? ' · 2×' : ''}`;
  $('a-text').textContent = q.text;
  $('a-text').classList.toggle('hidden', !q.showOnDevices);
  if (shownQuestion === q.index) return; // keep inputs stable on snapshot repeats
  shownQuestion = q.index;
  const box = $('a-buttons');
  const custom = $('a-custom');
  box.replaceChildren();
  custom.replaceChildren();
  const send = (answer) => submit(q.index, answer, custom);

  if (q.choices) {
    box.replaceChildren(...q.choices.map((c, i) => el('button', {
      class: `tile c${i}`,
      type: 'button',
      'aria-label': `${SHAPE_NAMES[i]}${q.showOnDevices ? `: ${c}` : ''}`,
      onclick: () => submit(q.index, i, box),
    }, el('span', { html: SHAPES[i] }), q.showOnDevices ? el('span', {}, c) : null)));
    return;
  }
  if (q.type === 'typeanswer' || q.type === 'wordcloud' || q.type === 'openended') {
    const long = q.type === 'openended';
    const field = long
      ? el('textarea', { rows: '3', maxlength: String(q.maxLength), 'aria-label': 'Your answer', placeholder: 'Type your answer' })
      : el('input', { type: 'text', maxlength: String(q.maxLength), 'aria-label': 'Your answer', placeholder: 'Type your answer', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'send' });
    const form = el('form', { class: 'phone-input', onsubmit: (e) => { e.preventDefault(); if (field.value.trim()) send(field.value); } },
      field, el('button', { class: 'accent', type: 'submit' }, 'Submit'), el('p', { class: 'error', id: 'a-err', role: 'alert' }));
    custom.replaceChildren(form);
    setTimeout(() => field.focus(), 50);
    return;
  }
  if (q.type === 'slider') {
    const mid = Math.round(((q.min + q.max) / 2) / q.step) * q.step;
    const value = el('div', { class: 'value', 'aria-live': 'polite' });
    const range = el('input', { type: 'range', min: String(q.min), max: String(q.max), step: String(q.step), value: String(mid), 'aria-label': 'Your answer',
      oninput: () => { value.textContent = `${range.value}${q.unit ? ` ${q.unit}` : ''}`; } });
    value.textContent = `${range.value}${q.unit ? ` ${q.unit}` : ''}`;
    custom.replaceChildren(el('div', { class: 'phone-input' }, value, range,
      el('div', { class: 'row', style: 'justify-content:space-between;font-weight:800' }, el('span', {}, q.min), el('span', {}, q.max)),
      el('button', { class: 'accent', type: 'button', onclick: () => send(Number(range.value)) }, 'Submit'),
      el('p', { class: 'error', id: 'a-err', role: 'alert' })));
    return;
  }
  if (q.type === 'puzzle') {
    let order = q.items.map((x) => x.id);
    const color = Object.fromEntries(q.items.map((x, i) => [x.id, i]));
    const text = Object.fromEntries(q.items.map((x) => [x.id, x.text]));
    const list = el('ol', { class: 'puzzle-list', 'aria-label': 'Put the items in order' });
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; draw(); };
    const draw = () => list.replaceChildren(...order.map((id, i) => el('li', { class: `tile c${color[id]}`, style: 'min-height:0' },
      el('span', { style: 'font-size:14px;opacity:.8' }, `${i + 1}.`), el('span', { class: 't' }, q.showOnDevices ? text[id] : ''),
      el('button', { type: 'button', 'aria-label': `Move ${text[id]} up`, disabled: i === 0 ? '' : null, onclick: () => move(i, -1) }, '▲'),
      el('button', { type: 'button', 'aria-label': `Move ${text[id]} down`, disabled: i === order.length - 1 ? '' : null, onclick: () => move(i, 1) }, '▼'))));
    draw();
    custom.replaceChildren(el('div', { class: 'phone-input' }, list,
      el('button', { class: 'accent', type: 'button', onclick: () => send(order) }, 'Submit order'),
      el('p', { class: 'error', id: 'a-err', role: 'alert' })));
    return;
  }
  if (q.type === 'droppin') {
    let pinAt = null;
    const marker = el('span', { class: 'pin hidden', 'aria-hidden': 'true' }, '📍');
    const submitBtn = el('button', { class: 'accent', type: 'button', disabled: '', onclick: () => pinAt && send(pinAt) }, 'Submit pin');
    const img = el('img', { src: q.image, alt: 'Tap the image to drop your pin', referrerpolicy: 'no-referrer' });
    const area = el('div', { class: 'tap-image', role: 'button', tabindex: '0', 'aria-label': 'Tap to drop your pin',
      onclick: (e) => {
        const r = img.getBoundingClientRect();
        pinAt = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
        marker.style.left = `${pinAt.x * 100}%`; marker.style.top = `${pinAt.y * 100}%`;
        marker.classList.remove('hidden');
        submitBtn.disabled = false;
      } }, img, marker);
    custom.replaceChildren(el('div', { class: 'phone-input' }, area, submitBtn, el('p', { class: 'error', id: 'a-err', role: 'alert' })));
  }
}

async function submit(questionIndex, answer, box) {
  box.querySelectorAll('button, input, textarea').forEach((b) => { b.disabled = true; });
  show('s-sent');
  try {
    await api(`/api/games/${session.pin}/answer`, { token: session.token, questionIndex, answer });
  } catch (ex) {
    if (ex.code === 'QUESTION_CLOSED' || ex.code === 'ALREADY_ANSWERED') return; // reveal is on its way
    box.querySelectorAll('button, input, textarea').forEach((b) => { b.disabled = false; });
    const err = document.getElementById('a-err');
    if (err) err.textContent = ex.message;
    show('s-answer');
  }
}

let lastResultKey = '';
function renderResult(r, qIndex) {
  const body = document.body;
  body.classList.remove('result-good', 'result-bad', 'result-neutral');
  if (!r) { show('s-wait'); return; }
  setScore(r.totalScore);
  const key = `${session.pin}:${qIndex}`;
  const fresh = key !== lastResultKey; // play the sound once, not on reconnect snapshots
  lastResultKey = key;
  if (!r.scored) {
    body.classList.add('result-neutral');
    $('r-icon').textContent = r.answered ? '👍' : '⏰';
    $('r-title').textContent = r.answered ? 'Thanks for answering!' : "Time's up";
    $('r-streak').textContent = '';
    $('r-points').textContent = r.answered ? `You said: ${r.yourAnswer}` : 'No answer this time';
    $('r-correct').classList.add('hidden');
    if (fresh) Sound.neutral();
  } else {
    body.classList.add(r.isCorrect ? 'result-good' : 'result-bad');
    $('r-icon').textContent = r.isCorrect ? '✔' : '✖';
    $('r-title').textContent = r.isCorrect ? 'Correct' : r.answered ? 'Incorrect' : "Time's up";
    $('r-streak').textContent = r.streak >= 2 ? `🔥 Answer streak ${r.streak}` : '';
    $('r-points').textContent = r.isCorrect ? `+ ${r.points.toLocaleString()}` : 'No points this time';
    $('r-correct').textContent = `Correct answer: ${r.correctText}`;
    $('r-correct').classList.toggle('hidden', r.isCorrect || !r.correctText);
    if (fresh) (r.isCorrect ? Sound.correct : Sound.wrong)();
  }
  $('r-rank').textContent = r.behind
    ? `You're in ${ordinal(r.rank)} place, ${r.behind.gap.toLocaleString()} points behind ${r.behind.name}`
    : `You're in 1st place!`;
  show('s-result');
}

// Result screens tint the whole page; clear it when leaving.
new MutationObserver(() => {
  if ($('s-result').classList.contains('hidden')) document.body.classList.remove('result-good', 'result-bad', 'result-neutral');
}).observe($('s-result'), { attributes: true, attributeFilter: ['class'] });

// ---------- boot ----------

(function boot() {
  const urlPin = new URLSearchParams(location.search).get('pin');
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (saved && saved.token && (!urlPin || urlPin === saved.pin)) {
      session = saved;
      pin = saved.pin;
      connect(); // rejoin after refresh / phone sleep
      return;
    }
  } catch { /* ignore */ }

  if (urlPin) {
    // Arrived from the QR code: the PIN is already in the link.
    $('pin').value = urlPin;
    api(`/api/games/${encodeURIComponent(urlPin)}`)
      .then((game) => {
        if (game.locked) throw new Error('This game is locked. Ask the host to unlock it.');
        pin = urlPin;
        return showNameStep(game);
      })
      .catch((ex) => { $('pin-err').textContent = ex.message; show('s-pin'); });
  } else {
    show('s-pin');
  }
})();
