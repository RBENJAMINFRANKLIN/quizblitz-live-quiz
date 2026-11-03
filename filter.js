// Nickname and free-text safety: English, Hindi (Devanagari) and romanised Hindi
// ("Hinglish") offensive words, including common disguises (f.u.c.k, fuuuck,
// sh1t, spaced letters). Also the "friendly nickname" generator.
//
// Two lists keep false positives down:
//   SUBSTRING  distinctive words blocked anywhere, even inside other text ("xxchutiyaxx")
//   TOKEN      short or ambiguous words blocked only as a whole word ("ass" but not "class")

const SUBSTRING = [
  // English
  'fuck', 'fuk', 'fck', 'bullshit', 'shithead', 'bitch', 'biatch', 'asshole', 'arsehole', 'bastard', 'slut', 'whore',
  'faggot', 'nigger', 'nigga', 'retard', 'motherfuck', 'dildo', 'jizz', 'wanker', 'pussy', 'penis', 'vagina',
  'boobs', 'blowjob', 'handjob', 'porn', 'rapist', 'molest', 'pedo', 'hitler', 'nazi',
  // Hinglish (romanised Hindi)
  'chutiya', 'chutiye', 'chutia', 'chutiy', 'chootiya', 'madarchod', 'madarch', 'maderchod', 'behench', 'bhench', 'madarjat', 'behenchod',
  'bhenchod', 'benchod', 'bahenchod', 'behnchod', 'betichod', 'bhosdi', 'bhosda', 'bhosad', 'bhosri', 'lauda', 'lavda',
  'lawda', 'lavde', 'lawde', 'laude', 'lodu', 'gandu', 'gaandu', 'randi', 'raand', 'harami', 'haramzada', 'haramzadi',
  'haramkhor', 'jhant', 'jhaant', 'bakchod', 'chodu', 'bhadwa', 'bhadwe', 'bhadve', 'chinal', 'kutiya',
  'hijda', 'hijra', 'chakka', 'chamar', 'bhangi',
  // Hindi (Devanagari)
  'चूतिया', 'चुतिया', 'चूतिये', 'मादरचोद', 'मादर', 'बहनचोद', 'बहनचो', 'भेनचोद', 'बेटीचोद', 'भोसड', 'भोसड़', 'भोसडी',
  'लंड', 'लौड़', 'लौड', 'लवड', 'गांड', 'गाण्ड', 'गांडू', 'रंडी', 'रण्डी', 'हरामी', 'हरामज़ाद', 'हरामजाद', 'हरामखोर',
  'झांट', 'झाँट', 'चोद', 'चूत', 'भड़वा', 'भडवा', 'भड़वे', 'छिनाल', 'कुतिया', 'हिजड़ा', 'हिजडा', 'कमीना', 'कमीने', 'चमार', 'भंगी',
];
const TOKEN = [
  'shit', 'shitty', 'cunt', 'cunts', 'ass', 'arse', 'sex', 'sexy', 'cum', 'tit', 'tits', 'fag', 'dick', 'cock', 'prick', 'twat', 'rape', 'anal', 'nude',
  'horny', 'piss', 'kkk', 'wtf', 'stfu', 'milf',
  'bc', 'mc', 'bsdk', 'bkl', 'mkc', 'bhak', 'gand', 'gaand', 'chut', 'lund', 'loda', 'lode', 'chod', 'kamina',
  'kamine', 'kutta', 'kutte', 'kutti', 'saala', 'suar', 'ullu', 'jhatu', 'choot', 'tatti', 'tatte',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalise(text) {
  return String(text).normalize('NFKC').toLowerCase()
    .replace(/[​-‍⁠﻿]/g, '') // zero-width characters
    .replace(/[़]/g, '') // Devanagari nukta (ड़ -> ड)
    .replace(/[0134578@$!|]/g, (c) => LEET[c] || c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, ''); // Latin accents
}
const squeeze = (s) => s.replace(/(.)\1+/g, '$1'); // fuuuck -> fuck

const SUB_N = [...new Set(SUBSTRING.map((w) => squeeze(normalise(w).replace(/[^\p{L}\p{M}]/gu, ''))))];
const TOK_N = new Set(TOKEN.map((w) => squeeze(normalise(w))));

/** True if the text contains an offensive word in English, Hindi or Hinglish. */
function isOffensive(text) {
  const n = normalise(text);
  const tokens = n.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  if (tokens.some((t) => TOK_N.has(t) || TOK_N.has(squeeze(t)))) return true;
  // Joined form catches spacing tricks ("f u c k", "chu-tiya").
  const joined = n.replace(/[^\p{L}\p{M}]/gu, '');
  if (tokens.length > 1 && tokens.every((t) => t.length === 1) && (TOK_N.has(joined) || TOK_N.has(squeeze(joined)))) return true;
  const variants = [joined, squeeze(joined)];
  return SUB_N.some((w) => variants.some((v) => v.includes(w)));
}

/** Returns the text, or '' if it is offensive (used for word clouds and open answers). */
function cleanText(text) {
  return isOffensive(text) ? '' : text;
}

// ---------- friendly nickname generator ----------
const ADJECTIVES = ['Brave', 'Clever', 'Cosmic', 'Dizzy', 'Fancy', 'Fuzzy', 'Giant', 'Happy', 'Jolly', 'Lucky', 'Mighty',
  'Ninja', 'Peppy', 'Quick', 'Rapid', 'Shiny', 'Silly', 'Sneaky', 'Sparkly', 'Speedy', 'Sunny', 'Super', 'Turbo', 'Witty', 'Zippy'];
const NOUNS = ['Panda', 'Tiger', 'Koala', 'Falcon', 'Otter', 'Rocket', 'Comet', 'Mango', 'Lemur', 'Dragon', 'Penguin', 'Gecko',
  'Llama', 'Meteor', 'Pixel', 'Robot', 'Walrus', 'Badger', 'Cactus', 'Dolphin', 'Narwhal', 'Pretzel', 'Sloth', 'Unicorn', 'Yeti'];

function randomName(rnd = Math.random) {
  return ADJECTIVES[Math.floor(rnd() * ADJECTIVES.length)] + NOUNS[Math.floor(rnd() * NOUNS.length)];
}
function isGeneratedName(name) {
  const a = ADJECTIVES.find((x) => name.startsWith(x));
  return !!a && NOUNS.includes(name.slice(a.length));
}

module.exports = { isOffensive, cleanText, randomName, isGeneratedName };
