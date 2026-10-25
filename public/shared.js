// Shared helpers for host and player pages.

export const SHAPES = [
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 30 28H2z"/></svg>',          // triangle
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1 31 16 16 31 1 16z"/></svg>',  // diamond
  '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/></svg>',     // circle
  '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="2"/></svg>', // square
];
export const SHAPE_NAMES = ['Triangle', 'Diamond', 'Circle', 'Square'];

// Avatar = character + optional accessory. Counts must match server.js.
export const AVATARS = [
  ['🐶', 'Puppy'], ['🐱', 'Kitty'], ['🦊', 'Fox'], ['🐼', 'Panda'], ['🐨', 'Koala'], ['🐯', 'Tiger'],
  ['🦁', 'Lion'], ['🐸', 'Frog'], ['🐵', 'Monkey'], ['🐰', 'Bunny'], ['🐻', 'Bear'], ['🐷', 'Piggy'],
  ['🐮', 'Cow'], ['🐔', 'Chicken'], ['🐧', 'Penguin'], ['🦉', 'Owl'], ['🐙', 'Octopus'], ['🦄', 'Unicorn'],
  ['🐲', 'Dragon'], ['🦖', 'Dino'], ['🐳', 'Whale'], ['🦋', 'Butterfly'], ['🐝', 'Bee'], ['🐢', 'Turtle'],
];
// [emoji, label, placement]: "top" sits on the head, "face" over the eyes.
export const ACCESSORIES = [
  ['', 'None', ''], ['👑', 'Crown', 'top'], ['🎩', 'Top hat', 'top'], ['🧢', 'Cap', 'top'],
  ['🎓', 'Grad cap', 'top'], ['🎀', 'Bow', 'top'], ['🕶️', 'Shades', 'face'], ['🥽', 'Goggles', 'face'],
  ['🌸', 'Flower', 'top'],
];
const AVATAR_BG = ['#ffd6a5', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff', '#fdffb6', '#a0c4ff', '#ffadad'];

export function avatarEl(avatar, size = 48, extraClass = '') {
  const a = avatar || { character: 0, accessory: 0 };
  const [emoji, label] = AVATARS[a.character] || AVATARS[0];
  const [acc, accLabel, place] = ACCESSORIES[a.accessory] || ACCESSORIES[0];
  const node = el('span', {
    class: `avatar ${extraClass}`.trim(),
    role: 'img',
    'aria-label': acc ? `${label} with ${accLabel.toLowerCase()}` : label,
    style: `--size:${size}px;--bg:${AVATAR_BG[a.character % AVATAR_BG.length]}`,
  }, el('span', { class: 'avatar-face', 'aria-hidden': 'true' }, emoji));
  if (acc) node.append(el('span', { class: `avatar-acc ${place}`, 'aria-hidden': 'true' }, acc));
  return node;
}

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Tracks the offset between this device's clock and the server's, so
// countdowns line up across phones whose clocks disagree.
let clockOffset = 0;
export function syncClock(serverNow) {
  if (typeof serverNow === 'number') clockOffset = serverNow - Date.now();
}
export const serverTime = () => Date.now() + clockOffset;

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only ever used with our own static SVG
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function show(id) {
  document.querySelectorAll('[data-screen]').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}

// Runs fn(remainingSeconds, fraction) every animation frame until endsAt.
export function countdown(endsAt, totalMs, fn) {
  let raf;
  const tick = () => {
    const left = Math.max(0, endsAt - serverTime());
    fn(Math.ceil(left / 1000), totalMs ? left / totalMs : 0);
    if (left > 0) raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

// Opens an SSE stream and reconnects automatically (EventSource does this
// natively; we only surface connection state).
export function stream(url, onMessage, onStatus = () => {}) {
  const es = new EventSource(url);
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    syncClock(msg.serverNow);
    onMessage(msg);
  };
  return es;
}
