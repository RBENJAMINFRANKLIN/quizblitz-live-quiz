// Minimal "lint": checks the syntax of every JavaScript file and a few project rules,
// without any npm dependency. Usage: node scripts/check-syntax.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'data', '.vercel', 'dist', '.claude']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
}(ROOT));

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (err) { failed++; console.error(`✖ ${path.relative(ROOT, f)}\n${err.stderr}`); }
}

// Project rule: the brand must come from the settings, never be hard-coded in pages.
for (const dir of ['views', 'public']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/\.(html|js|css)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
    if (/Quiz<span>Blitz|>QuizBlitz</.test(text)) { failed++; console.error(`✖ ${dir}/${f}: hard-coded "QuizBlitz" brand (use {{appName}} / {{logo}})`); }
  }
}

if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log(`✔ ${files.length} JavaScript files OK, no hard-coded brand in pages`);
