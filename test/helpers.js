// Test helpers: start a real server on a free port with a throw-away data
// directory, an HTTP client with a cookie jar, and an SSE listener.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery' };

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blindtest-test-'));

/** Starts server.js; resolves once it listens. Returns { base, stop(), dataDir }. */
async function startServer({ dataDir = tempDir(), env = {} } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 15000);
    const check = () => { if (log.includes('running')) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check);
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
  child.removeAllListeners('exit');
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  });
  return { base: `http://127.0.0.1:${port}`, stop, dataDir, log: () => log };
}

function client(base) {
  const jar = new Map();
  async function call(p, { method, body, raw, headers = {} } = {}) {
    const h = { 'X-QuizBlitz': '1', ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method: method || (payload !== undefined ? 'POST' : 'GET'), headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const v = pair.slice(i + 1);
      if (v) jar.set(pair.slice(0, i), v); else jar.delete(pair.slice(0, i));
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return call;
}

function listen(url) {
  const msgs = [];
  const waiters = [];
  const ctrl = new AbortController();
  (async () => {
    const res = await fetch(url, { signal: ctrl.signal });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const m = JSON.parse(line.slice(6));
        msgs.push(m);
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
      }
    }
  })().catch(() => {});
  return {
    msgs,
    mark: () => msgs.length,
    waitFor(pred, ms = 10000, since = 0) {
      const hit = msgs.slice(since).find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) reject(new Error('timeout waiting for SSE message')); }, ms);
      });
    },
    close: () => ctrl.abort(),
  };
}

const state = (s, idx) => (m) => m.type === 'STATE' && m.state === s && (idx === undefined || m.question?.index === idx);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Smallest valid files for upload tests.
const PNG_1X1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const ICO_HEADER = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(40)]);

module.exports = { startServer, client, listen, state, sleep, tempDir, ADMIN, PNG_1X1, ICO_HEADER, ROOT };
