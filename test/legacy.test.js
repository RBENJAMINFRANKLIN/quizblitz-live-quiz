// Runs the original API test scripts (classic quiz: 9 question types, accounts,
// library, reports) against a fresh server, to guard against regressions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const path = require('path');
const { startServer } = require('./helpers');

function run(script, base) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, script)], { env: { ...process.env, BASE: base }, timeout: 90000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('legacy quiz API tests still pass', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  for (const script of ['e2e.js', 'features.js']) {
    await t.test(script, async () => {
      const r = await run(script, srv.base);
      assert.equal(r.code, 0, r.out);
    });
  }
});
