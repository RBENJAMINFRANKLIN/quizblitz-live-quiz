// Game history / reports page (host computer only). Layout follows the usual
// quiz-report pattern: summary, per-player results and per-question breakdown.
import { SHAPES, avatarEl, el, show } from './shared.js';

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const secs = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);
const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const COLORS = ['var(--a0)', 'var(--a1)', 'var(--a2)', 'var(--a3)'];

// /reports?key=… (REPORTS_KEY) opens no-account reports from another computer.
const KEY = new URLSearchParams(location.search).get('key') || '';

async function get(path, opts = {}) {
  const headers = { 'X-QuizBlitz': '1', ...(KEY ? { 'X-Reports-Key': KEY } : {}), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function ring(fraction) {
  return el('div', { class: 'ring', style: `--p:${Math.round((fraction ?? 0) * 100)}` }, el('span', {}, pct(fraction)));
}

// ---------------- list ----------------

async function showList() {
  history.replaceState(null, '', '/reports');
  show('s-list');
  const box = document.getElementById('games');
  try {
    const { reports } = await get('/api/reports');
    if (!reports.length) {
      box.replaceChildren(el('div', { class: 'card' }, el('p', { style: 'margin:0;font-weight:700' }, 'No finished games yet.'),
        el('p', { class: 'sub' }, 'Host a game and play it to the end (or press End); its report appears here.')));
      return;
    }
    box.replaceChildren(...reports.map((r) => el('button', { class: 'game', type: 'button', onclick: () => openReport(r.id) },
      el('div', {}, el('div', { class: 'title' }, r.title), el('div', { class: 'sub' }, `${when(r.endedAt)} · PIN ${r.pin}${r.completed ? '' : ' · ended early'}`)),
      el('div', { class: 'sub hide-sm' }, `${r.players} player${r.players === 1 ? '' : 's'}`),
      el('div', { class: 'sub hide-sm' }, `${r.questionsPlayed} question${r.questionsPlayed === 1 ? '' : 's'}`),
      ring(r.accuracy))));
  } catch (e) {
    document.getElementById('list-err').textContent = e.message;
  }
}

// ---------------- one report ----------------

let report = null;

async function openReport(id) {
  try { report = await get(`/api/reports/${id}`); }
  catch (e) { document.getElementById('list-err').textContent = e.message; return showList(); }
  history.replaceState(null, '', `/reports?id=${id}`);
  document.getElementById('r-title').textContent = report.title;
  document.getElementById('r-meta').textContent = `${when(report.startedAt)} · PIN ${report.pin} · `
    + `${report.summary.questions} of ${report.summary.questionsInQuiz} questions played${report.completed ? '' : ' (ended early)'}`;
  document.getElementById('btn-csv').href = `/api/reports/${id}/csv${KEY ? `?key=${encodeURIComponent(KEY)}` : ''}`;
  const s = report.summary;
  document.getElementById('kpis').replaceChildren(
    kpi(ring(s.accuracy), 'Correct answers'),
    kpi(s.players, 'Players'),
    kpi(s.questions, 'Questions'),
    kpi(s.averageScore.toLocaleString(), 'Average score'),
  );
  tab('summary');
  show('s-report');
}

const kpi = (n, label) => el('div', { class: 'kpi' }, el('div', { class: 'n' }, n), el('div', { class: 'l' }, label));

function tab(name) {
  for (const t of ['summary', 'players', 'questions']) document.getElementById(`tab-${t}`).setAttribute('aria-selected', String(t === name));
  const panel = document.getElementById('panel');
  panel.replaceChildren(...({ summary, players, questions })[name]());
}

function summary() {
  const s = report.summary;
  const th = report.thresholds;
  const hard = report.questions.filter((q) => q.difficult);
  const help = report.players.filter((p) => p.needsHelp);
  const dnf = report.players.filter((p) => p.didNotFinish);
  const podium = report.players.slice(0, 3);
  return [
    el('div', { class: 'card stack', style: 'margin-bottom:12px' },
      el('h3', { style: 'margin:0' }, 'Podium'),
      el('div', { class: 'row' }, ...podium.map((p) => el('div', { class: 'who', style: 'margin-right:24px' },
        `${['🥇', '🥈', '🥉'][p.rank - 1]}`, avatarEl(p.avatar, 40), p.name, el('span', { class: 'sub' }, `${p.score.toLocaleString()} pts`))))),
    el('div', { class: 'card stack', style: 'margin-bottom:12px' },
      el('h3', { style: 'margin:0' }, `Difficult questions (${s.difficult})`),
      el('p', { class: 'sub', style: 'margin:0' }, `Answered correctly by fewer than ${pct(th.difficultBelow)} of players. Worth re-teaching.`),
      hard.length ? el('ul', { style: 'margin:0' }, ...hard.map((q) => el('li', {}, `Q${q.index + 1}: ${q.text} `, el('span', { class: 'tag bad' }, `${pct(q.correctPct)} correct`))))
        : el('p', { style: 'margin:0' }, 'None. Every question was answered correctly by most players.')),
    el('div', { class: 'card stack', style: 'margin-bottom:12px' },
      el('h3', { style: 'margin:0' }, `Need help (${s.needHelp})`),
      el('p', { class: 'sub', style: 'margin:0' }, `Players with fewer than ${pct(th.needsHelpBelow)} correct answers.`),
      help.length ? el('div', { class: 'row' }, ...help.map((p) => el('span', { class: 'who' }, avatarEl(p.avatar, 32), p.name, el('span', { class: 'tag warn' }, pct(p.accuracy)))))
        : el('p', { style: 'margin:0' }, 'Nobody. Every player got at least a third right.')),
    el('div', { class: 'card stack' },
      el('h3', { style: 'margin:0' }, `Didn't finish (${s.didNotFinish})`),
      el('p', { class: 'sub', style: 'margin:0' }, 'Players who missed at least one question (joined late, ran out of time or dropped out).'),
      dnf.length ? el('div', { class: 'row' }, ...dnf.map((p) => el('span', { class: 'who' }, avatarEl(p.avatar, 32), p.name, el('span', { class: 'tag warn' }, `${p.unanswered} unanswered`))))
        : el('p', { style: 'margin:0' }, 'Everyone answered every question.')),
  ];
}

function players() {
  const table = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Rank'), el('th', {}, 'Player'), el('th', {}, 'Correct'), el('th', {}, 'Unanswered'), el('th', {}, 'Score'), el('th', {}, ''))),
    el('tbody', {}, ...report.players.flatMap((p) => {
      const detail = el('tr', { class: 'hidden' }, el('td', { colspan: '6' }, playerAnswers(p)));
      const row = el('tr', { class: 'clickable', tabindex: '0', 'aria-expanded': 'false',
        onclick: () => toggle(row, detail), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row, detail); } } },
      el('td', {}, String(p.rank)),
      el('td', {}, el('span', { class: 'who' }, avatarEl(p.avatar, 32), p.name)),
      el('td', {}, report.summary.scoredQuestions ? `${p.correct}/${report.summary.scoredQuestions} ` : '–', el('span', { class: 'sub' }, pct(p.accuracy))),
      el('td', {}, String(p.unanswered)),
      el('td', {}, p.score.toLocaleString()),
      el('td', {}, p.needsHelp ? el('span', { class: 'tag warn' }, 'Needs help') : ''));
      return [row, detail];
    })));
  return [el('div', { class: 'card' }, el('p', { class: 'sub', style: 'margin-top:0' }, 'Click a player to see each of their answers.'), table)];
}

function toggle(row, detail) {
  const open = detail.classList.toggle('hidden') === false;
  row.setAttribute('aria-expanded', String(open));
}

function playerAnswers(p) {
  return el('table', {},
    el('tbody', {}, ...report.questions.map((q, i) => {
      const a = p.answers[i];
      return el('tr', {},
        el('td', { style: 'width:40px' }, `Q${i + 1}`),
        el('td', {}, q.text),
        el('td', {}, a ? a.text : el('span', { class: 'sub' }, 'No answer')),
        el('td', {}, a && a.scored ? el('span', { class: a.correct ? 'ok' : 'no' }, a.correct ? '✔ correct' : '✖ wrong') : a ? el('span', { class: 'sub' }, 'no right answer') : ''),
        el('td', {}, a ? `${a.points} pts` : '0 pts'),
        el('td', { class: 'sub' }, a ? secs(a.ms) : ''));
    })));
}

const TYPE_LABEL = { quiz: 'Quiz', truefalse: 'True or false', typeanswer: 'Type answer', slider: 'Slider', puzzle: 'Puzzle',
  droppin: 'Drop pin', poll: 'Poll', wordcloud: 'Word cloud', openended: 'Open-ended' };

function choiceBars(q) {
  return el('div', { class: 'dist' }, ...q.choices.map((c, i) => {
    const share = q.answered ? q.summary.counts[i] / q.answered : 0;
    const right = q.correctChoices.includes(i);
    return el('div', { class: 'bar' },
      el('span', { class: 'shape', style: `background:${COLORS[i]}`, html: SHAPES[i] }),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${Math.round(share * 100)}%;background:${COLORS[i]};opacity:${right || !q.scored ? 1 : 0.45}` }),
        el('span', { class: 'label' }, `${c}${right ? '  ✔' : ''}`)),
      el('span', { style: 'text-align:right;font-weight:800' }, String(q.summary.counts[i])));
  }));
}

function typeDetail(q) {
  const s = q.summary;
  if (q.choices) return choiceBars(q);
  if (s.responses) {
    if (!s.responses.length) return el('p', { class: 'sub' }, 'No answers.');
    return el('div', { class: 'row', style: 'gap:8px' }, ...s.responses.map((r) => el('span', {
      class: `tag ${s.type === 'typeanswer' ? (r.correct ? 'good' : 'bad') : 'warn'}` }, `${r.text} ×${r.count}`)));
  }
  if (s.type === 'slider') {
    return el('p', { style: 'margin:0' }, `Average answer: ${s.average === null ? '–' : Math.round(s.average * 10) / 10}${s.unit ? ` ${s.unit}` : ''}`,
      el('br'), el('span', { class: 'sub' }, `Answers: ${s.values.join(', ') || 'none'}`));
  }
  if (s.type === 'puzzle') return el('p', { style: 'margin:0' }, `${s.correctCount} of ${s.answeredCount} got the order right.`);
  if (s.type === 'droppin') return el('p', { style: 'margin:0' }, `${s.pins.filter((p) => p.correct).length} of ${s.answeredCount} pins in the right area.`);
  return el('span');
}

function questions() {
  return report.questions.map((q) => el('div', { class: 'card', style: 'margin-bottom:12px' },
    el('div', { class: 'q' },
      el('div', {},
        el('h3', {}, `Q${q.index + 1}. ${q.text}`),
        el('p', { class: 'sub', style: 'margin:0 0 4px' }, `${TYPE_LABEL[q.type] || q.type}${q.points === 'double' ? ' · double points' : ''}${!q.scored ? ' · no points' : ''}`),
        q.scored ? el('p', { style: 'margin:0 0 6px;font-weight:800' }, `Correct answer: ${q.correctText}`) : null,
        el('p', { class: 'sub', style: 'margin:0 0 10px' }, `${q.answered} answered · ${q.unanswered} no answer · average time ${secs(q.avgMs)} of ${q.time}s`),
        typeDetail(q)),
      el('div', { class: 'stack', style: 'align-items:center' }, q.scored ? ring(q.correctPct) : el('span', { class: 'tag warn' }, 'Not scored'),
        !q.scored ? null : q.difficult ? el('span', { class: 'tag bad' }, 'Difficult') : el('span', { class: 'tag good' }, 'Most got it')))));
}

// ---------------- wiring ----------------

document.getElementById('btn-back').addEventListener('click', showList);
document.getElementById('tab-summary').addEventListener('click', () => tab('summary'));
document.getElementById('tab-players').addEventListener('click', () => tab('players'));
document.getElementById('tab-questions').addEventListener('click', () => tab('questions'));
document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!report || !confirm(`Delete the report for "${report.title}"? This cannot be undone.`)) return;
  try { await get(`/api/reports/${report.id}`, { method: 'DELETE' }); report = null; showList(); }
  catch (e) { alert(e.message); }
});

const startId = Number(new URLSearchParams(location.search).get('id'));
if (startId) openReport(startId); else showList();
