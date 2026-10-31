import { guard, json, gcal, db } from "../lib/shared.mjs";
export const config = { path: "/api/brief" };

const WX = (c) => c === 0 ? "clear" : c <= 2 ? "partly cloudy" : c === 3 ? "overcast" : c <= 48 ? "foggy" : c <= 57 ? "drizzle" : c <= 67 ? "rain" : c <= 77 ? "snow" : c <= 82 ? "rain showers" : c <= 86 ? "snow showers" : "thunderstorms";

// "-07:00" style offset for a time zone, so we can ask Google for "today" in your local time.
function offsetStr(tz) {
  const v = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value;
  const m = v.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? m[1] + ":" + (m[2] || "00") : "Z";
}

async function schedule(supa, tz, day) {
  const [list, prefs] = await Promise.all([
    gcal("/users/me/calendarList?minAccessRole=reader"),
    supa.from("calendar_prefs").select("hidden_ids").eq("id", 1).maybeSingle()
  ]);
  const hidden = (prefs.data && prefs.data.hidden_ids) || [];
  const off = offsetStr(tz), next = new Date(day + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const qs = new URLSearchParams({ timeMin: `${day}T00:00:00${off}`, timeMax: `${next.toISOString().slice(0, 10)}T00:00:00${off}`, singleEvents: "true", orderBy: "startTime", maxResults: "25" });
  const all = await Promise.all(list.items.filter((c) => !hidden.includes(c.id)).map((c) =>
    gcal(`/calendars/${encodeURIComponent(c.id)}/events?${qs}`).then((r) => r.items, () => [])));
  const t = (s) => new Date(s).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return all.flat().filter((e) => e.status !== "cancelled").map((e) => ({
    ms: e.start.date ? 0 : new Date(e.start.dateTime).getTime(),
    line: e.start.date ? `All day: ${e.summary || "Busy"}`
      : `${t(e.start.dateTime)} to ${t(e.end.dateTime)}: ${e.summary || "Busy"}${e.location ? " at " + e.location : ""}`
  })).sort((a, b) => a.ms - b.ms).map((x) => x.line);
}

async function gemini(system, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY isn't set in Netlify");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 24000);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 1500 }
      })
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Gemini took too long. Try again." : e.message);
  } finally { clearTimeout(timer); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error("Gemini's free limit was reached. Try again in a minute, or tomorrow.");
  if (!res.ok) throw new Error((j.error && j.error.message) || "Gemini error " + res.status);
  const cand = j.candidates && j.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned no text" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : ""));
  const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const sources = [...new Set(chunks.map((c) => c.web && c.web.title).filter(Boolean))].slice(0, 6);
  return { text, sources };
}

// POST {day:"YYYY-MM-DD", force?:true}. Returns today's saved brief unless force is set.
export default guard(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const body = await req.json().catch(() => ({}));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || "") ? body.day : null;
  if (!day) return json({ error: "Missing day" }, 400);

  const supa = db();
  const { data: old } = await supa.from("daily_brief").select("*").eq("day", day).maybeSingle();
  if (old && (!body.force || Date.now() - new Date(old.created_at) < 60000)) return json({ brief: old });

  const { data: st } = await supa.from("app_settings").select("*").eq("id", 1).maybeSingle();
  const lat = Number(st ? st.latitude : 34.10), lon = Number(st ? st.longitude : -117.65);
  const unit = st ? st.temperature_unit : "fahrenheit", place = st ? st.location_name : "home";

  const w = await (await fetch("https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: lat, longitude: lon, current: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
    temperature_unit: unit, timezone: "auto", forecast_days: 1
  }))).json();
  const u = unit === "celsius" ? "Celsius" : "Fahrenheit";
  const weather = `Location: ${place}. Right now ${Math.round(w.current.temperature_2m)} degrees ${u}, ${WX(w.current.weather_code)}. Today's high ${Math.round(w.daily.temperature_2m_max[0])}, low ${Math.round(w.daily.temperature_2m_min[0])}. Chance of rain up to ${w.daily.precipitation_probability_max[0]} percent. UV index up to ${Math.round(w.daily.uv_index_max[0])}.`;

  let events;
  try { events = (await schedule(supa, w.timezone, day)).join("\n") || "Nothing scheduled today."; }
  catch (e) { events = "Calendar unavailable (" + e.message + ")."; }

  const name = process.env.BRIEF_NAME ? ` for ${process.env.BRIEF_NAME}` : "";
  const focus = process.env.NEWS_FOCUS ? ` When choosing news, favor: ${process.env.NEWS_FOCUS}.` : "";
  const system = `You write a short morning brief${name} that will be read aloud on a wall display. Write 130 to 180 words of plain spoken English: no markdown, no bullet points, no emoji, no headings. Order: a one-line greeting, today's weather, three or four of the biggest news stories from the last 24 hours (one short sentence each, naming the outlet, like "according to Reuters"), then today's schedule. Use only the weather and schedule facts given; never invent events. Find news with Google Search and use reputable outlets. If you can't find news, say so briefly instead of guessing. If the schedule is empty, say the day is clear.${focus}`;
  const prompt = `Today is ${day}.\n\nWEATHER:\n${weather}\n\nSCHEDULE:\n${events}`;

  const { text, sources } = await gemini(system, prompt);
  const row = { day, text, sources, created_at: new Date().toISOString() };
  const { error } = await supa.from("daily_brief").upsert(row);
  if (error) throw new Error("Couldn't save the brief: " + error.message);

  const cutoff = new Date(day + "T12:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  await supa.from("daily_brief").delete().lt("day", cutoff.toISOString().slice(0, 10));
  return json({ brief: row });
});
