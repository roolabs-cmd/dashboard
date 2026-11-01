import { sign, safeEqual } from "../lib/shared.mjs";
export const config = { path: "/api/google/start" };

// Visit once: /api/google/start?pass=YOUR_PASSCODE
export default async (req) => {
  const pass = new URL(req.url).searchParams.get("pass") || "";
  if (!process.env.DASHBOARD_PASSCODE || !safeEqual(pass, process.env.DASHBOARD_PASSCODE))
    return new Response("Wrong passcode", { status: 401 });
  const ts = String(Date.now());
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.SITE_URL + "/api/google/callback",
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline",
    prompt: "consent",
    state: ts + "." + sign(ts)
  });
  return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p, 302);
};
