// Host accounts and the quiz library: sign in / register, then list, edit,
// host, duplicate and delete saved quizzes.
import { api, el, show } from '/shared.js';

const $ = (id) => document.getElementById(id);
const ICON = { quiz: '🔷', truefalse: '⚖️', typeanswer: '⌨️', slider: '🎚️', puzzle: '🧩', droppin: '📍', poll: '📊', wordcloud: '☁️', openended: '💬' };
let mode = 'login';
let quizzes = [];

function setMode(m) {
  mode = m;
  $('tab-login').setAttribute('aria-selected', String(m === 'login'));
  $('tab-register').setAttribute('aria-selected', String(m === 'register'));
  $('name-row').classList.toggle('hidden', m === 'login');
  $('auth-submit').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $('a-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-err').textContent = '';
}
$('tab-login').addEventListener('click', () => setMode('login'));
$('tab-register').addEventListener('click', () => setMode('register'));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-err').textContent = '';
  try {
    const body = { email: $('a-email').value, password: $('a-pass').value };
    if (mode === 'register') body.name = $('a-name').value;
    await api(`/api/auth/${mode}`, body);
    $('a-pass').value = '';
    boot();
  } catch (ex) {
    $('auth-err').textContent = ex.message;
  }
});

const when = (t) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });

function render() {
  const term = $('search').value.trim().toLowerCase();
  const list = quizzes.filter((q) => !term || q.title.toLowerCase().includes(term));
  if (!quizzes.length) {
    $('quizzes').replaceChildren(el('div', { class: 'card' }, el('p', { style: 'margin:0;font-weight:800' }, 'Your library is empty.'),
      el('p', { class: 'sub' }, 'Create a quiz, then press "Save to library" in the editor.')));
    return;
  }
  $('quizzes').replaceChildren(...list.map((q) => el('div', { class: 'card quiz' },
    el('h3', {}, q.title),
    el('div', { class: 'types', title: q.types.join(', ') }, ...q.types.map((t) => ICON[t] || '')),
    el('p', { class: 'sub', style: 'margin:0' }, `${q.questions} question${q.questions === 1 ? '' : 's'} · played ${q.plays} time${q.plays === 1 ? '' : 's'} · updated ${when(q.updatedAt)}`),
    el('div', { class: 'actions' },
      el('a', { class: 'btn accent small', href: `/host?quiz=${q.id}&host=1`, style: 'color:var(--accent-ink)' }, '▶ Host'),
      el('a', { class: 'btn ghost small', href: `/host?quiz=${q.id}` }, '✏️ Edit'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => act(() => api(`/api/quizzes/${q.id}/duplicate`, {})) }, '⧉ Duplicate'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => {
        if (confirm(`Delete "${q.title}"? This cannot be undone.`)) act(() => api(`/api/quizzes/${q.id}`, undefined, 'DELETE'));
      } }, '🗑 Delete')))));
}

async function act(fn) {
  $('list-err').textContent = '';
  try { await fn(); await loadList(); } catch (ex) { $('list-err').textContent = ex.message; }
}

async function loadList() {
  quizzes = (await api('/api/quizzes')).quizzes;
  render();
}
$('search').addEventListener('input', render);

async function boot() {
  const { user } = await api('/api/auth/me');
  if (!user) {
    $('who').replaceChildren(el('a', { class: 'btn ghost small', href: '/host' }, '← Back to editor'));
    setMode(mode);
    show('s-auth');
    return;
  }
  $('who').replaceChildren(el('span', { style: 'font-weight:800' }, `👤 ${user.name}`),
    el('button', { class: 'ghost small', type: 'button', onclick: async () => { await api('/api/auth/logout', {}); boot(); } }, 'Sign out'));
  show('s-list');
  try { await loadList(); } catch (ex) { $('list-err').textContent = ex.message; }
}

boot();
