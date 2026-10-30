import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const db = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export const sign = (v) => createHmac("sha256", process.env.DASHBOARD_PASSCODE || "").update(v).digest("hex");

// Every data request must carry the passcode in the x-passcode header.
export const guard = (fn) => async (req) => {
  const pass = process.env.DASHBOARD_PASSCODE;
  if (!pass || !safeEqual(req.headers.get("x-passcode") || "", pass)) return json({ error: "Wrong passcode" }, 401);
  try { return await fn(req); } catch (e) { return json({ error: e.message }, 500); }
};

// Trades the stored refresh token for a short-lived access token (kept while the function stays warm).
let cached = { token: null, exp: 0 };
export async function accessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const { data } = await db().from("google_auth").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new Error("Google isn't connected yet");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token, grant_type: "refresh_token"
    })
  });
  const t = await res.json();
  if (!res.ok) throw new Error(t.error_description || t.error || "Token refresh failed");
  cached = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return cached.token;
}

export async function gcal(path, init = {}) {
  const res = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    ...init,
    headers: { authorization: "Bearer " + (await accessToken()), "content-type": "application/json", ...(init.headers || {}) }
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || "Google error " + res.status);
  return body;
}
