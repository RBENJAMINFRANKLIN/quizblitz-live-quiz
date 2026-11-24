// AppSettings: the single source of truth for the application's identity
// (name, logos, colours) and global game defaults. Stored as one JSON row in
// the `app_settings` table; defaults apply to any field never saved.

const { DEFAULT_SCORING, normaliseScoring } = require('./scoring');

const DEFAULT_THEME = Object.freeze({
  primaryColor: '#7c5cff',
  secondaryColor: '#3d2a7a',
  accentColor: '#f5a524',
  backgroundColor: '#2b1a5e',
  surfaceColor: '#ffffff',
  textColor: '#1c1530',
  mutedTextColor: '#5b5370',
  buttonRadius: 10,
  themeMode: 'dark',
});

const DEFAULT_SETTINGS = Object.freeze({
  appName: 'Blind Test Live',
  shortName: 'Blind Test',
  tagline: 'Scannez. Jouez. Vibrez.',
  organizerName: '',
  welcomeText: '',
  qrCodeText: 'Scannez pour jouer',
  logoUrl: '',
  darkLogoUrl: '',
  faviconUrl: '',
  homeImageUrl: '',
  ...DEFAULT_THEME,
  defaultLanguage: 'fr',
  // Game behaviour
  gameExpiryHours: 3,
  allowLateJoin: true,
  maxPlayers: 200,
  keepDisconnectedPlayers: true,
  scoring: DEFAULT_SCORING,
  updatedAt: null,
  updatedBy: null,
});

const TEXT_LIMITS = { appName: 60, shortName: 30, tagline: 120, organizerName: 80, welcomeText: 500, qrCodeText: 80 };
const IMAGE_FIELDS = ['logoUrl', 'darkLogoUrl', 'faviconUrl', 'homeImageUrl'];
const COLOR_FIELDS = ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedTextColor'];
const THEME_MODES = ['light', 'dark', 'auto'];
const LANGUAGES = ['fr', 'en'];

const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// Images are either files uploaded to this server (/media/<random>.<ext>) or https links.
const isImageUrl = (v) => v === '' || /^\/media\/[a-f0-9]{32}\.(png|jpe?g|webp|ico)$/.test(v) || /^https:\/\/[^\s"'<>]+$/i.test(v);

function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }

/**
 * Validates a partial update and returns the complete settings object.
 * Unknown fields are ignored; invalid values are rejected with a 400 error.
 */
function mergeSettings(current, patch) {
  if (!patch || typeof patch !== 'object') fail('Paramètres manquants');
  const out = { ...current };
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (patch[key] === undefined) continue;
    out[key] = String(patch[key]).replace(/[\u0000-\u001f\u007f]/g, key === 'welcomeText' ? (c) => (c === '\n' ? c : '') : '').trim().slice(0, max);
  }
  if (!out.appName) fail("Le nom de l'application est obligatoire");
  if (!out.shortName) out.shortName = out.appName.slice(0, TEXT_LIMITS.shortName);
  for (const key of IMAGE_FIELDS) {
    if (patch[key] === undefined) continue;
    const v = String(patch[key] ?? '').trim();
    if (!isImageUrl(v)) fail(`Adresse d'image invalide pour ${key}`);
    out[key] = v;
  }
  for (const key of COLOR_FIELDS) {
    if (patch[key] === undefined) continue;
    if (!isColor(patch[key])) fail(`Couleur invalide pour ${key} (format attendu : #RRGGBB)`);
    out[key] = patch[key].toLowerCase();
  }
  if (patch.buttonRadius !== undefined) {
    const r = Number(patch.buttonRadius);
    if (!Number.isInteger(r) || r < 0 || r > 32) fail("L'arrondi des boutons doit être compris entre 0 et 32 px");
    out.buttonRadius = r;
  }
  if (patch.themeMode !== undefined) {
    if (!THEME_MODES.includes(patch.themeMode)) fail('Thème invalide');
    out.themeMode = patch.themeMode;
  }
  if (patch.defaultLanguage !== undefined) {
    if (!LANGUAGES.includes(patch.defaultLanguage)) fail('Langue non prise en charge');
    out.defaultLanguage = patch.defaultLanguage;
  }
  if (patch.gameExpiryHours !== undefined) {
    const h = Number(patch.gameExpiryHours);
    if (!(h >= 1 && h <= 72)) fail("La durée d'expiration doit être comprise entre 1 et 72 heures");
    out.gameExpiryHours = Math.round(h);
  }
  if (patch.maxPlayers !== undefined) {
    const n = Number(patch.maxPlayers);
    if (!Number.isInteger(n) || n < 2 || n > 500) fail('Le nombre maximal de joueurs doit être compris entre 2 et 500');
    out.maxPlayers = n;
  }
  if (patch.allowLateJoin !== undefined) out.allowLateJoin = !!patch.allowLateJoin;
  if (patch.keepDisconnectedPlayers !== undefined) out.keepDisconnectedPlayers = !!patch.keepDisconnectedPlayers;
  if (patch.scoring !== undefined) out.scoring = normaliseScoring(patch.scoring);
  return out;
}

/** Only what anonymous visitors may see (no updatedBy, nothing internal). */
function publicSettings(s) {
  return {
    appName: s.appName, shortName: s.shortName, tagline: s.tagline, organizerName: s.organizerName,
    welcomeText: s.welcomeText, qrCodeText: s.qrCodeText, logoUrl: s.logoUrl, darkLogoUrl: s.darkLogoUrl,
    faviconUrl: s.faviconUrl, homeImageUrl: s.homeImageUrl,
    primaryColor: s.primaryColor, secondaryColor: s.secondaryColor, accentColor: s.accentColor,
    backgroundColor: s.backgroundColor, surfaceColor: s.surfaceColor, textColor: s.textColor,
    mutedTextColor: s.mutedTextColor, buttonRadius: s.buttonRadius, themeMode: s.themeMode,
    defaultLanguage: s.defaultLanguage, updatedAt: s.updatedAt,
  };
}

// ---------------------------------------------------------------- colours

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((c, i) => c + (hexToRgb(b)[i] - c) * t));

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Readable text colour (white or near-black) on a given background. */
const inkFor = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#14101f') ? '#ffffff' : '#14101f');

/** CSS custom properties for one palette. Old variable names stay mapped for existing styles. */
function paletteVars(s, mode) {
  const light = mode === 'light';
  const bg = light ? mix(s.primaryColor, '#ffffff', 0.9) : s.backgroundColor;
  const bg2 = light ? mix(s.secondaryColor, '#ffffff', 0.8) : s.secondaryColor;
  const onBg = inkFor(bg);
  return {
    '--color-primary': s.primaryColor,
    '--color-secondary': s.secondaryColor,
    '--color-accent': s.accentColor,
    '--color-background': bg,
    '--color-surface': s.surfaceColor,
    '--color-text': s.textColor,
    '--color-text-muted': s.mutedTextColor,
    '--button-radius': `${s.buttonRadius}px`,
    '--bg': bg,
    '--bg-2': bg2,
    '--surface': s.surfaceColor,
    '--surface-2': mix(s.surfaceColor, s.textColor, 0.06),
    '--text': s.textColor,
    '--text-muted': s.mutedTextColor,
    '--on-bg': onBg,
    '--on-bg-muted': mix(onBg, bg, 0.25),
    '--accent': s.primaryColor,
    '--accent-ink': inkFor(s.primaryColor),
    '--highlight': s.accentColor,
    '--highlight-ink': inkFor(s.accentColor),
  };
}

const varsToCss = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** The theme stylesheet injected into every page (values are validated, so safe to inline). */
function themeCss(s) {
  const dark = varsToCss(paletteVars(s, 'dark'));
  const light = varsToCss(paletteVars(s, 'light'));
  if (s.themeMode === 'light') return `:root{color-scheme:light;${light}}`;
  if (s.themeMode === 'auto') return `:root{color-scheme:light dark;${dark}}@media (prefers-color-scheme: light){:root{${light}}}`;
  return `:root{color-scheme:dark;${dark}}`;
}

// ---------------------------------------------------------------- HTML injection

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function logoHtml(s, cls = 'brand-logo') {
  if (s.logoUrl) return `<img class="${cls}" src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.appName)}">`;
  return `<span class="${cls} brand-wordmark">${escapeHtml(s.appName)}</span>`;
}

/**
 * Fills a page template: <!--BRAND_HEAD:Page title--> becomes the <title>, favicon,
 * share metadata, theme and a JSON copy of the public settings; {{appName}}-style
 * tokens become escaped text and {{logo}} the logo markup.
 */
function renderPage(template, s, baseUrl = '') {
  const pub = publicSettings(s);
  const json = JSON.stringify(pub).replace(/</g, '\\u003c');
  let html = template.replace(/<!--BRAND_HEAD(?::([^>]*?))?-->/, (_, pageTitle) => {
    const title = pageTitle ? `${pageTitle} · ${s.shortName}` : s.appName;
    const favicon = s.faviconUrl || '/favicon.svg';
    const image = s.homeImageUrl || s.logoUrl;
    const abs = (u) => (u && u.startsWith('/') && baseUrl ? baseUrl + u : u);
    return [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(s.tagline || s.appName)}">`,
      `<meta name="application-name" content="${escapeHtml(s.shortName)}">`,
      `<meta name="apple-mobile-web-app-title" content="${escapeHtml(s.shortName)}">`,
      `<meta name="theme-color" content="${s.themeMode === 'light' ? mix(s.primaryColor, '#ffffff', 0.9) : s.backgroundColor}">`,
      `<meta property="og:title" content="${escapeHtml(s.appName)}">`,
      `<meta property="og:description" content="${escapeHtml(s.tagline || '')}">`,
      `<meta property="og:site_name" content="${escapeHtml(s.appName)}">`,
      image ? `<meta property="og:image" content="${escapeHtml(abs(image))}">` : '',
      `<link rel="icon" href="${escapeHtml(favicon)}">`,
      `<link rel="manifest" href="/manifest.webmanifest">`,
      `<style id="brand-theme">${themeCss(s)}</style>`,
      `<script type="application/json" id="brand-data">${json}</script>`,
    ].filter(Boolean).join('\n  ');
  });
  html = html.replace(/\{\{logo\}\}/g, () => logoHtml(s));
  html = html.replace(/\{\{(appName|shortName|tagline|organizerName|welcomeText|qrCodeText)\}\}/g, (_, k) => escapeHtml(s[k]));
  return html;
}

function manifest(s) {
  return {
    name: s.appName, short_name: s.shortName, start_url: '/', display: 'standalone',
    background_color: s.backgroundColor, theme_color: s.backgroundColor, lang: s.defaultLanguage,
    icons: [s.faviconUrl ? { src: s.faviconUrl, sizes: 'any' } : { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

/** Media URLs referenced by the settings (used to avoid deleting files still in use). */
const referencedMedia = (s) => IMAGE_FIELDS.map((k) => s[k]).filter((u) => u && u.startsWith('/media/'));

module.exports = {
  DEFAULT_SETTINGS, DEFAULT_THEME, IMAGE_FIELDS, COLOR_FIELDS,
  mergeSettings, publicSettings, themeCss, paletteVars, renderPage, manifest, escapeHtml,
  contrast, inkFor, referencedMedia, isColor,
};
