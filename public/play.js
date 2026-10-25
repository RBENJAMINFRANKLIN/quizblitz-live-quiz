import { SHAPES, SHAPE_NAMES, AVATARS, ACCESSORIES, api, el, show, countdown, stream, avatarEl } from '/shared.js';

const SESSION_KEY = 'quizblitz.player';
const $ = (id) => document.getElementById(id);

let pin = null;
let session = null; // { pin, token, name }
let es = null;
let stopTimer = () => {};
let shownQuestion = -1; // question index whose answer buttons are on screen
let failedReconnects = 0;

// ---------- join flow ----------

$('pin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pin-err').textContent = '';
  const value = $('pin').value.trim();
  try {
    await api(`/api/games/${encodeURIComponent(value)}`);
    pin = value;
    history.replaceState(null, '', `/play?pin=${pin}`);
    show('s-name');
    $('name').focus();
  } catch (ex) {
    $('pin-err').textContent = ex.message;
  }
});

$('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('name-err').textContent = '';
  const btn = e.submitter;
  if (btn) btn.disabled = true;
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
      renderButtons(q);
      stopTimer = countdown(msg.endsAt, 0, (s) => { $('a-time').textContent = `⏱ ${s}`; });
      show('s-answer');
      break;
    case 'REVEAL':
      renderResult(msg.result);
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

function renderButtons(q) {
  $('a-num').textContent = `${q.index + 1} / ${q.total}`;
  $('a-text').textContent = q.text;
  if (shownQuestion === q.index) return; // keep buttons stable on snapshot repeats
  shownQuestion = q.index;
  const box = $('a-buttons');
  box.replaceChildren(...q.choices.map((c, i) => el('button', {
    class: `tile c${i}`,
    type: 'button',
    'aria-label': `${SHAPE_NAMES[i]}: ${c}`,
    onclick: () => submit(q.index, i, box),
  }, el('span', { html: SHAPES[i] }), el('span', {}, c))));
}

async function submit(questionIndex, choice, box) {
  box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  show('s-sent');
  try {
    await api(`/api/games/${session.pin}/answer`, { token: session.token, questionIndex, choice });
  } catch (ex) {
    if (ex.code === 'QUESTION_CLOSED') return; // reveal is on its way
    if (ex.code === 'ALREADY_ANSWERED') return;
    box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    show('s-answer');
  }
}

function renderResult(r) {
  const body = document.body;
  body.classList.remove('result-good', 'result-bad');
  if (!r) { show('s-wait'); return; }
  setScore(r.totalScore);
  body.classList.add(r.isCorrect ? 'result-good' : 'result-bad');
  $('r-icon').textContent = r.isCorrect ? '✔' : '✖';
  $('r-title').textContent = r.isCorrect ? 'Correct' : r.answered ? 'Incorrect' : "Time's up";
  $('r-streak').textContent = r.streak >= 2 ? `🔥 Answer streak ${r.streak}` : '';
  $('r-points').textContent = r.isCorrect ? `+ ${r.points.toLocaleString()}` : 'No points this time';
  $('r-rank').textContent = r.behind
    ? `You're in ${ordinal(r.rank)} place, ${r.behind.gap.toLocaleString()} points behind ${r.behind.name}`
    : `You're in 1st place!`;
  show('s-result');
}

// Result screens tint the whole page; clear it when leaving.
new MutationObserver(() => {
  if ($('s-result').classList.contains('hidden')) document.body.classList.remove('result-good', 'result-bad');
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
      .then(() => { pin = urlPin; show('s-name'); $('name').focus(); })
      .catch((ex) => { $('pin-err').textContent = ex.message; show('s-pin'); });
  } else {
    show('s-pin');
  }
})();
