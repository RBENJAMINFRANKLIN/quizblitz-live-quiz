import { api, brand, el } from '/shared.js';

const form = document.getElementById('pin-form');
const pinInput = document.getElementById('pin');
const err = document.getElementById('err');
const b = brand();

// Optional home image and welcome text (multi-line text, rendered as text only).
if (b.homeImageUrl) document.getElementById('home-hero').append(el('img', { src: b.homeImageUrl, alt: '' }));
const welcome = document.getElementById('welcome');
welcome.textContent = b.welcomeText || '';
welcome.classList.toggle('hidden', !b.welcomeText);

pinInput.addEventListener('input', () => { pinInput.value = pinInput.value.replace(/\D/g, ''); });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const pin = pinInput.value.trim();
  try {
    await api(`/api/games/${encodeURIComponent(pin)}`);
    location.href = `/play?pin=${encodeURIComponent(pin)}`;
  } catch (ex) {
    err.textContent = ex.message;
  }
});
