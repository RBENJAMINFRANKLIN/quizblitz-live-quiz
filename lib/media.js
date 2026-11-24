// Uploaded media (logos, favicons, covers, audio excerpts).
//
// Uploads are checked on their real content (magic bytes), not on the name or
// the Content-Type the browser claims. Files are stored under a random name
// with an extension derived from the detected type, so a stored URL never
// reveals the original file name (important for blind tests) and an uploaded
// file can never be served as HTML or script.
//
// Storage goes through a small driver interface so the local-disk driver can
// be replaced by an object store (Vercel Blob, Cloudflare R2, S3, Supabase
// Storage) without touching the rest of the app:
//   driver.put(key, buffer, mime)  -> Promise<void>
//   driver.stat(key)               -> Promise<{ size } | null>
//   driver.stream(key, {start,end})-> Readable
//   driver.remove(key)             -> Promise<void>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = {
  image: { max: 2 * 1024 * 1024, types: ['png', 'jpg', 'webp'] },
  favicon: { max: 512 * 1024, types: ['png', 'ico'] },
  audio: { max: 25 * 1024 * 1024, types: ['mp3', 'm4a', 'ogg', 'wav'] },
};

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
};

// Accepted file-name extensions for each detected type.
const EXTENSIONS = {
  png: ['png'], jpg: ['jpg', 'jpeg'], webp: ['webp'], ico: ['ico'],
  mp3: ['mp3'], m4a: ['m4a', 'aac', 'mp4'], ogg: ['ogg', 'oga', 'opus'], wav: ['wav'],
};

const ascii = (buf, start, len) => buf.subarray(start, start + len).toString('latin1');

/** Detects the real file type from its first bytes; returns a short type id or null. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && ascii(buf, 1, 3) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'webp';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return 'wav';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf[4] > 0) return 'ico';
  if (ascii(buf, 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return 'mp3'; // MPEG audio frame sync (not ADTS)
  if (ascii(buf, 4, 4) === 'ftyp') return 'm4a';
  if (ascii(buf, 0, 4) === 'OggS') return 'ogg';
  return null;
}

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

/**
 * Validates an upload and returns { type, ext, mime }.
 * `originalName` is only used to check the extension; it is never stored on disk.
 */
function checkUpload(kind, buf, originalName = '') {
  const rule = KINDS[kind];
  if (!rule) fail('Type de média inconnu');
  if (!buf || !buf.length) fail('Fichier vide');
  if (buf.length > rule.max) fail(`Fichier trop volumineux (maximum ${Math.round(rule.max / 1024 / 1024 * 10) / 10} Mo)`, 413);
  const head = buf.subarray(0, 512).toString('latin1').toLowerCase();
  if (head.includes('<svg') || head.includes('<?xml') || head.includes('<html') || head.includes('<script')) {
    fail('Les fichiers SVG, XML et HTML sont refusés pour des raisons de sécurité. Utilisez PNG, JPEG ou WebP.');
  }
  const type = sniff(buf);
  if (!type || !rule.types.includes(type)) {
    const allowed = rule.types.map((t) => t.toUpperCase()).join(', ');
    fail(`Format non accepté. Formats acceptés : ${allowed}.`);
  }
  const ext = String(originalName).toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (ext && !EXTENSIONS[type].includes(ext)) fail(`L'extension .${ext} ne correspond pas au contenu réel du fichier (${type.toUpperCase()}).`);
  return { type, ext: type, mime: MIME[type] };
}

// ---------------------------------------------------------------- local disk driver

function localDiskDriver(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key) => {
    if (!/^[a-f0-9]{32}\.[a-z0-9]{2,4}$/.test(key)) fail('Média introuvable', 404);
    return path.join(dir, key);
  };
  return {
    name: 'local',
    async put(key, buf) { await fs.promises.writeFile(file(key), buf, { flag: 'wx' }); },
    async stat(key) {
      try { const s = await fs.promises.stat(file(key)); return { size: s.size }; } catch { return null; }
    },
    stream(key, range) { return fs.createReadStream(file(key), range); },
    async remove(key) { await fs.promises.rm(file(key), { force: true }); },
  };
}

/** Picks the storage driver from the environment. Only the local driver ships in this version. */
function createDriver(env = process.env, defaultDir) {
  const kind = (env.MEDIA_STORAGE || 'local').toLowerCase();
  if (kind === 'local') return localDiskDriver(env.MEDIA_DIR || defaultDir);
  throw new Error(`MEDIA_STORAGE=${kind} is not implemented yet. See docs/ARCHITECTURE.md (storage drivers).`);
}

const newKey = (ext) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;
const keyFromUrl = (url) => (typeof url === 'string' && /^\/media\/[a-f0-9]{32}\.[a-z0-9]{2,4}$/.test(url) ? url.slice(7) : null);

/** Parses a single "bytes=start-end" Range header against a file size. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

module.exports = { KINDS, MIME, sniff, checkUpload, localDiskDriver, createDriver, newKey, keyFromUrl, parseRange };
