// Builds the Vercel deployment (Build Output API v3) in .vercel/output:
//   static/      a copy of public/ served from Vercel's CDN (JS, CSS, demo audio…)
//   config.json  routes: pages, /api, /media and anything unknown are proxied to the
//                persistent backend given by BACKEND_URL (Railway, Fly.io, Render…).
// Pages go to the backend so the brand (name, logo, favicon, colours) is injected
// server-side and changes without a new build or deploy.
//
// Usage: BACKEND_URL=https://my-backend.up.railway.app node scripts/build-static.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.vercel', 'output');
const backend = String(process.env.BACKEND_URL || '').replace(/\/+$/, '');

if (!backend) {
  if (process.env.VERCEL) {
    console.error('BACKEND_URL is not set. Add it in Vercel > Project > Settings > Environment Variables (see docs/DEPLOIEMENT_VERCEL.md).');
    process.exit(1);
  }
  console.log('BACKEND_URL not set: skipping the Vercel output (not needed to run locally).');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(backend)) {
  console.error(`BACKEND_URL must be an https origin without a path, e.g. https://api.example.com (got "${backend}")`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'static'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(OUT, 'static'), { recursive: true });

const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

const config = {
  version: 3,
  routes: [
    // Dynamic routes always go to the backend (never cached by the CDN).
    { src: '^/(api|media)/(.*)$', dest: `${backend}/$1/$2` },
    { src: '^/(|host|play|admin|library|reports|manifest\\.webmanifest)$', dest: `${backend}/$1` },
    { src: '^/join/(\\d{6})/?$', dest: `${backend}/join/$1` },
    // Static assets: short cache with revalidation (file names are not hashed).
    { src: '^/(.*)\\.(js|css|svg|json)$', headers: { 'Cache-Control': 'public, max-age=0, must-revalidate', ...security }, continue: true },
    { src: '^/audio/(.*)$', headers: { 'Cache-Control': 'public, max-age=86400', ...security }, continue: true },
    { handle: 'filesystem' },
    // Anything else (unknown paths) is answered by the backend's branded 404 page.
    { src: '^/(.*)$', dest: `${backend}/$1` },
  ],
};
fs.writeFileSync(path.join(OUT, 'config.json'), JSON.stringify(config, null, 2));
console.log(`Vercel output written to .vercel/output (backend: ${backend})`);
