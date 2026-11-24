// Live game snapshots. Every running game is written to the database after
// each change (debounced) so that a backend restart or redeploy does not lose
// it: on boot, games are rebuilt from their snapshot and their timers are
// re-armed from the persisted server timestamps.
//
// Only data goes into the snapshot: open SSE connections and timers are
// runtime objects and are recreated (players simply reconnect).

const SNAPSHOT_VERSION = 1;

const PLAYER_FIELDS = ['id', 'token', 'name', 'score', 'streak', 'joinedAt', 'avatar', 'lastResult', 'prevRank', 'lastSeen'];
const GAME_FIELDS = [
  'pin', 'hostKey', 'quiz', 'options', 'locked', 'ownerId', 'state', 'qIndex', 'lastActivity', 'history', 'startedAt',
  'questionStartsAt', 'questionOpenedAt', 'endsAt', 'readyMs', 'lastReveal', 'reportId', 'paused', 'createdAt', 'scoring', 'maxPlayers',
];

function serializeGame(g) {
  const out = { v: SNAPSHOT_VERSION };
  for (const k of GAME_FIELDS) if (g[k] !== undefined) out[k] = g[k];
  out.players = [...g.players.values()].map((p) => Object.fromEntries(PLAYER_FIELDS.map((k) => [k, p[k] ?? null])));
  out.answers = [...g.answers.entries()];
  return JSON.stringify(out);
}

function restoreGame(json) {
  const data = JSON.parse(json);
  if (data.v !== SNAPSHOT_VERSION) throw new Error(`Unsupported game snapshot version ${data.v}`);
  const g = {};
  for (const k of GAME_FIELDS) if (data[k] !== undefined) g[k] = data[k];
  g.players = new Map(data.players.map((p) => [p.id, { ...p, streams: new Set() }]));
  g.answers = new Map(data.answers || []);
  g.hostStreams = new Set();
  g.timer = null;
  g.persistTimer = null;
  return g;
}

module.exports = { serializeGame, restoreGame, SNAPSHOT_VERSION };
