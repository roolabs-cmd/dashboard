// ---------- Settings (change these) ----------
const CONFIG = {
  name: "Rancho Cucamonga", // placeholder: set your own
  lat: 34.1064,
  lon: -117.5931,
  unit: "fahrenheit",       // or "celsius"
  cacheMinutes: 10          // reloads within this window reuse saved data
};

// Direct from Open-Meteo for now (no API key). Later, swap this for the
// Netlify function URL, e.g. "/.netlify/functions/weather".
const buildUrl = () => "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
  latitude: CONFIG.lat, longitude: CONFIG.lon,
  current: "temperature_2m,weather_code,is_day",
  hourly: "precipitation_probability",
  daily: "temperature_2m_max,temperature_2m_min",
  temperature_unit: CONFIG.unit, timezone: "auto", forecast_days: 2
});

// ---------- Cache (kept on the tablet so reloads are cheap) ----------
const KEY = "weather-cache-v1";
const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const writeCache = (data) => { try { localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch (e) {} };

async function loadWeather() {
  const cached = readCache();
  if (cached && Date.now() - cached.savedAt < CONFIG.cacheMinutes * 60000) {
    return { data: cached.data, savedAt: cached.savedAt, stale: false };
  }
  try {
    const res = await fetch(buildUrl());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    writeCache(data);
    return { data, savedAt: Date.now(), stale: false };
  } catch (err) {
    if (cached) return { data: cached.data, savedAt: cached.savedAt, stale: true };
    throw err;
  }
}

// ---------- Weather codes (WMO) -> label + icon ----------
function describe(code) {
  if (code === 0) return ["Clear", "clear"];
  if (code === 1) return ["Mostly clear", "clear"];
  if (code === 2) return ["Partly cloudy", "partly"];
  if (code === 3) return ["Cloudy", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return ["Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorm", "storm"];
  return ["Unknown", "cloud"];
}

const CLOUD = '<path class="line cloud" d="M20 38h26a9 9 0 0 0 .5-18 13 13 0 0 0-25-2A10 10 0 0 0 20 38z"/>';
function sun(x, y, r) {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    rays += `<line class="line" x1="${x + c * (r + 4)}" y1="${y + s * (r + 4)}" x2="${x + c * (r + 8)}" y2="${y + s * (r + 8)}"/>`;
  }
  return `<g class="sun"><circle class="line" cx="${x}" cy="${y}" r="${r}"/>${rays}</g>`;
}
const MOON = '<path class="line" d="M40 8a15 15 0 1 0 14 22 12 12 0 0 1-14-22z"/>';
const DROPS = [26, 36, 46].map(x => `<line class="accent drop" x1="${x}" y1="43" x2="${x - 2}" y2="48"/>`).join("");
const FLAKES = [26, 36, 46].map(x => `<circle class="accent drop" cx="${x}" cy="45" r="1.5"/>`).join("");
const FOG = '<line class="line" x1="16" y1="44" x2="48" y2="44"/><line class="line" x1="22" y1="50" x2="54" y2="50"/>';
const BOLT = '<path class="accent" d="M36 38l-6 9h7l-5 8"/>';

function iconSvg(kind, isDay) {
  let inner;
  if (kind === "clear") inner = isDay ? sun(32, 28, 11) : MOON;
  else if (kind === "partly") inner = (isDay ? sun(22, 18, 7) : '<g transform="translate(-14 -6) scale(.6)">' + MOON + "</g>") + CLOUD;
  else if (kind === "cloud") inner = CLOUD;
  else if (kind === "fog") inner = CLOUD + FOG;
  else if (kind === "rain") inner = CLOUD + DROPS;
  else if (kind === "snow") inner = CLOUD + FLAKES;
  else inner = CLOUD + BOLT;
  return `<svg class="ico" viewBox="0 0 64 56" aria-hidden="true">${inner}</svg>`;
}

// ---------- Render ----------
const $ = (id) => document.getElementById(id);
const hourLabel = (iso) => { const h = parseInt(iso.slice(11, 13), 10); return (h % 12 || 12) + (h < 12 ? "a" : "p"); };

function render({ data, savedAt, stale }) {
  const [label, kind] = describe(data.current.weather_code);
  $("place").textContent = CONFIG.name;
  $("icon").innerHTML = iconSvg(kind, data.current.is_day === 1);
  $("cond").textContent = label;
  $("temp").textContent = Math.round(data.current.temperature_2m) + "°";
  $("hi").textContent = Math.round(data.daily.temperature_2m_max[0]) + "°";
  $("lo").textContent = Math.round(data.daily.temperature_2m_min[0]) + "°";

  const times = data.hourly.time, probs = data.hourly.precipitation_probability;
  const start = Math.max(0, times.findIndex(t => t.startsWith(data.current.time.slice(0, 13))));
  const bars = $("bars"), hours = $("hours");
  bars.innerHTML = ""; hours.innerHTML = "";
  for (let i = start; i < start + 12 && i < times.length; i++) {
    const bar = document.createElement("i");
    bar.style.height = Math.max(6, probs[i]) + "%";
    bar.title = probs[i] + "%";
    bars.appendChild(bar);
    const lab = document.createElement("span");
    lab.textContent = hourLabel(times[i]);
    hours.appendChild(lab);
  }

  const when = new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("foot").textContent = stale ? "Can’t reach the weather service. Showing the update from " + when + "." : "Updated " + when;
  $("status").hidden = true;
  $("content").hidden = false;
}

loadWeather().then(render).catch(() => {
  $("status").textContent = "Weather unavailable. Check Wi-Fi, then reload.";
});
