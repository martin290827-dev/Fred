'use strict';
/* Weather card: Open-Meteo forecast, second place, current location, places edited in the card.
   Loaded right after app.js; uses its helpers (store, el, $). */

/* ---------- 3) Weather (Open-Meteo, no key) ---------- */
const WMO = {
  0: 'Klar', 1: 'Überwiegend klar', 2: 'Teils bewölkt', 3: 'Bedeckt', 45: 'Nebel', 48: 'Raureifnebel',
  51: 'Leichter Niesel', 53: 'Nieselregen', 55: 'Starker Niesel', 56: 'Gefrierender Niesel', 57: 'Gefrierender Niesel',
  61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen', 66: 'Gefrierender Regen', 67: 'Gefrierender Regen',
  71: 'Leichter Schnee', 73: 'Schnee', 75: 'Starker Schnee', 77: 'Schneegriesel',
  80: 'Regenschauer', 81: 'Regenschauer', 82: 'Heftige Schauer', 85: 'Schneeschauer', 86: 'Schneeschauer',
  95: 'Gewitter', 96: 'Gewitter, Hagel', 99: 'Gewitter, Hagel',
};

async function fetchWeather(p) {
  return getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&hourly=temperature_2m,precipitation,weather_code' +
    '&timezone=auto&forecast_days=2');
}

// Warnings: rain (or snow) for the rest of today, frost in the next 12 hours.
// Nothing is returned when all is calm, so the card stays quiet on dry days.
function weatherWarnings(w) {
  const h = w.hourly;
  if (!h || !h.time || !w.current || !w.current.time) return [];
  const hourNow = w.current.time.slice(0, 13); // e.g. 2026-09-29T06 (place time, both from the same response)
  const today = hourNow.slice(0, 10);
  const from = h.time.findIndex((t) => t.slice(0, 13) >= hourNow);
  if (from < 0) return [];
  const rest = h.time.map((_, i) => i).slice(from).filter((i) => h.time[i].slice(0, 10) === today);
  const next12 = h.time.map((_, i) => i).slice(from, from + 12);
  const hhmm = (i) => h.time[i].slice(11, 16);
  const out = [];
  const wet = rest.filter((i) => h.precipitation[i] >= 0.2);
  if (wet.length) {
    const mm = wet.reduce((s, i) => s + h.precipitation[i], 0);
    const cold = h.temperature_2m[wet[0]] <= 1;
    const last = wet[wet.length - 1];
    const endH = String(Math.min(24, +hhmm(last).slice(0, 2) + 1)).padStart(2, '0') + ':00';
    const start = h.time[wet[0]].slice(0, 13) === hourNow ? 'jetzt' : hhmm(wet[0]);
    out.push({ kind: 'rain', text: (cold ? 'Schnee heute ' : 'Regen heute ') + start + '\u2013' + endH + ' \u00b7 ' + fmtD(mm, 1) + ' mm' });
  }
  const icy = next12.filter((i) => h.temperature_2m[i] <= 0);
  if (icy.length) {
    const low = Math.min(...icy.map((i) => h.temperature_2m[i]));
    const start = h.time[icy[0]].slice(0, 13) === hourNow ? 'jetzt' : 'ab ' + hhmm(icy[0]);
    out.push({ kind: 'frost', text: 'Frost ' + start + ', bis ' + Math.round(low) + '°' });
  }
  return out;
}

// Simple outline weather icons (stroke = current colour). Grouped by WMO code.
const CLOUD_HI = 'M7 14h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 7.1 3.5 3.5 0 0 0 7 14z';
const WX_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  part: '<circle cx="9" cy="8" r="3"/><path d="M9 2v1.3M3 8h1.3M4.8 3.8l.9.9M13.2 3.8l-.9.9"/><path d="M10 21h8a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 9.1 14.6 3.2 3.2 0 0 0 10 21z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18z"/>',
  fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  rain: '<path d="' + CLOUD_HI + '"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>',
  snow: '<path d="' + CLOUD_HI + '"/><path d="M9 18h.01M13 20h.01M17 18h.01M11 17h.01M15 17h.01"/>',
  storm: '<path d="' + CLOUD_HI + '"/><path d="M13 14l-3 4h4l-3 4"/>',
};
function wxKind(code) {
  if (code <= 1) return 'sun';
  if (code === 2) return 'part';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
}
function wxIcon(code, cls) {
  const kind = wxKind(code);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'wxi wxi-' + kind + (cls ? ' ' + cls : ''));
  s.innerHTML = WX_ICONS[kind]; // fixed strings from above, no outside data
  return s;
}

// Next hours as a small strip (like the Weather app). Shown on the phone, where the card has room for it.
function hourStrip(w) {
  const h = w.hourly;
  if (!h || !h.time || !h.weather_code || !w.current || !w.current.time) return '';
  const from = h.time.findIndex((t) => t.slice(0, 13) >= w.current.time.slice(0, 13));
  if (from < 0) return '';
  const cells = [];
  for (let i = from; i < Math.min(from + 8, h.time.length); i++) {
    cells.push(el('div', { class: 'wx-hour' },
      el('span', { class: 'wx-h-t' }, i === from ? 'Jetzt' : h.time[i].slice(11, 13)),
      wxIcon(h.weather_code[i], 'sm'),
      el('span', { class: 'wx-h-v' }, Math.round(h.temperature_2m[i]) + '\u00b0')));
  }
  return el('div', { class: 'wx-hours', 'aria-label': 'Nächste Stunden' }, ...cells);
}

function renderWeatherMain(box, w) {
  const warn = weatherWarnings(w).map((x) => el('div', { class: 'wx-warn ' + x.kind }, x.text));
  const day = (label, i) => el('div', { class: 'wx-tile' },
    el('div', { class: 'wx-tile-head' }, el('span', null, label), wxIcon(w.daily.weather_code[i], 'sm')),
    el('div', { class: 'wx-tile-temp' }, Math.round(w.daily.temperature_2m_max[i]) + '°',
      el('span', { class: 'muted' }, ' / ' + Math.round(w.daily.temperature_2m_min[i]) + '°')),
    el('div', { class: 'muted small' }, WMO[w.daily.weather_code[i]] || '?',
      // rain chance only when it matters; a dry day shows no rain info
      (w.daily.precipitation_probability_max[i] ?? 0) >= 20 ? el('span', { class: 'wx-rain' }, ' · Regen ' + w.daily.precipitation_probability_max[i] + '%') : ''));
  box.replaceChildren(
    ...warn,
    el('div', { class: 'wx-now' },
      wxIcon(w.current.weather_code, 'lg'),
      el('div', { class: 'wx-temp' }, Math.round(w.current.temperature_2m) + '°'),
      el('div', { class: 'wx-cond' },
        el('div', { class: 'wx-cond-t' }, WMO[w.current.weather_code] || 'Unbekannt'),
        el('div', { class: 'muted small' }, 'Gefühlt ' + Math.round(w.current.apparent_temperature) + '\u00b0'),
        el('div', { class: 'muted small' }, 'Wind ' + Math.round(w.current.wind_speed_10m) + ' km/h'))),
    el('div', { class: 'wx-days' }, day('Heute', 0), day('Morgen', 1)),
    hourStrip(w));
}

// Second place as a quiet block at the bottom of the card. Click it to make it the main place.
function renderWeatherAlt(box, p, w) {
  const warn = weatherWarnings(w)[0];
  const desc = (WMO[w.current.weather_code] || '?') + ' · ' +
    Math.round(w.daily.temperature_2m_min[0]) + '° / ' + Math.round(w.daily.temperature_2m_max[0]) + '°' + (warn ? ' · ' + warn.text.split(' \u00b7 ')[0].split(',')[0] : '');
  box.replaceChildren(el('button', { type: 'button', class: 'wx-alt', title: p.name + ' – klicken, um es als Hauptort zu zeigen', onclick: swapPlaces },
    wxIcon(w.current.weather_code, 'md'),
    el('span', { class: 'wx-alt-text' },
      el('span', { class: 'wx-alt-name' }, p.name.split(',')[0]),
      el('span', { class: 'wx-alt-desc' }, desc)),
    el('span', { class: 'wx-alt-temp' }, Math.round(w.current.temperature_2m) + '°'),
    el('span', { class: 'wx-alt-swap', 'aria-hidden': 'true' }, '⇄')));
}

/* ---------- Current location as the main place (per device, never synced) ---------- */
let useGeo = store.get('useGeo', false);
let geoPlace = store.get('geoPlace', null); // last known { name, lat, lon, t }, only on this device
let geoSwapped = false;                     // you clicked the second place: show it on top until reload
let geoNote = '';

function geoPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('kein Standort in diesem Browser')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12000, maximumAge: 15 * 60000 });
  });
}

// Where am I? Rounded to about 1 km before anything is sent out. The name comes from a free reverse lookup.
async function currentPlace() {
  if (geoPlace && Date.now() - geoPlace.t < 15 * 60000) return geoPlace;
  const pos = await geoPosition();
  const lat = Math.round(pos.coords.latitude * 100) / 100;
  const lon = Math.round(pos.coords.longitude * 100) / 100;
  let name = geoPlace && Math.abs(geoPlace.lat - lat) < 0.05 && Math.abs(geoPlace.lon - lon) < 0.05 ? geoPlace.name : '';
  if (!name) {
    try {
      const r = await getJSON('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=de');
      name = [r.city || r.locality, r.countryCode].filter(Boolean).join(', ');
    } catch { /* no name: fine */ }
  }
  geoPlace = { name: name || 'Aktueller Standort', lat, lon, t: Date.now() };
  store.set('geoPlace', geoPlace);
  return geoPlace;
}

function hereIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'here-ico');
  s.setAttribute('aria-label', 'Aktueller Standort');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M21 3 3 10.5l7.5 3L13.5 21z');
  s.append(p);
  return s;
}

function swapPlaces() {
  if (useGeo) { geoSwapped = !geoSwapped; loadWeather(); return; } // do not touch the saved places
  const t = place;
  place = place2;
  place2 = t;
  store.set('place', place);
  store.set('place2', place2);
  loadWeather();
}

/* ---------- places and clocks: edited right in the cards, saved in the Sheet ---------- */
let wxOpen = false;

function wxEditor() {
  const box = $('wx-edit');
  if (!wxOpen) { box.replaceChildren(); box.hidden = true; return; }
  const msg = el('p', { class: 'muted small gform-msg' });
  const row = (label, current, which) => {
    const input = el('input', { type: 'text', placeholder: which === 1 ? 'Ortsname' : 'Optional', value: current ? current.name : '', 'aria-label': label });
    const go = async () => {
      const name = input.value.trim();
      if (!name && which === 1) return;
      msg.textContent = 'Sucht…';
      try {
        const p = name ? await geocode(name) : null;
        if (which === 1) { place = p; store.set('place', place); } else { place2 = p; store.set('place2', place2); }
        input.value = p ? p.name : '';
        msg.textContent = p ? 'Gespeichert: ' + p.name : 'Zweiter Ort entfernt.';
        loadWeather();
      } catch (e) { msg.textContent = e.message; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return el('div', { class: 'row' }, el('span', { class: 'muted small wx-lbl' }, label), input, el('button', { type: 'button', class: 'ghost small', onclick: go }, 'Setzen'));
  };
  box.replaceChildren(el('div', { class: 'gform' }, row('Hauptort', place, 1), row('Zweiter Ort', place2, 2), msg,
    el('div', { class: 'row end gform-btns' }, el('button', { type: 'button', class: 'ghost', onclick: () => { wxOpen = false; wxEditor(); } }, 'Fertig'))));
  box.hidden = false;
}

async function loadWeather() {
  const box = $('weather');
  const alt = $('weather2');
  alt.replaceChildren();
  let top = place;
  let low = place2;
  let here = false;
  geoNote = '';
  if (useGeo) {
    try {
      top = await currentPlace();
      here = true;
      low = place2 || place; // with no second place, your saved place shows small below
    } catch (e) {
      geoNote = e && e.code === 1 ? 'Standort nicht erlaubt' : 'Standort nicht verfügbar';
    }
  }
  if (here && geoSwapped && low) { const t = top; top = low; low = t; }
  if (!top) { $('weather-place').textContent = ''; box.replaceChildren(el('p', { class: 'empty' }, 'Tippe auf den Stift, um einen Ort festzulegen.')); return; }
  const title = $('weather-place');
  title.replaceChildren(here && !geoSwapped ? hereIcon() : '', top.name, geoNote ? el('span', { class: 'small' }, ' \u00b7 ' + geoNote) : '');
  const [main, second] = await Promise.allSettled([fetchWeather(top), low ? fetchWeather(low) : Promise.resolve(null)]);
  if (main.status === 'fulfilled') renderWeatherMain(box, main.value);
  else box.textContent = 'Wetter nicht verfügbar. ' + main.reason.message;
  if (low) {
    if (second.status === 'fulfilled') renderWeatherAlt(alt, low, second.value);
    else alt.textContent = 'Zweiter Ort nicht verfügbar.';
  }
  matchWeatherHeight();
}

async function geocode(name) {
  const r = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name));
  if (!r.results || !r.results.length) throw new Error('Ort nicht gefunden');
  const p = r.results[0];
  return { name: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude };
}
