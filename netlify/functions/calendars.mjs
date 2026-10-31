import { guard, json, gcal, db } from "../lib/shared.mjs";
export const config = { path: "/api/calendars" };

// GET: your calendars + which are hidden.  PUT {hidden:[ids]}: save the sidebar toggles.
export default guard(async (req) => {
  const supa = db();
  if (req.method === "PUT") {
    const { hidden } = await req.json();
    const { error } = await supa.from("calendar_prefs").upsert({ id: 1, hidden_ids: Array.isArray(hidden) ? hidden : [], updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return json({ ok: true });
  }
  const [list, prefs] = await Promise.all([
    gcal("/users/me/calendarList?minAccessRole=reader"),
    supa.from("calendar_prefs").select("hidden_ids").eq("id", 1).maybeSingle()
  ]);
  return json({
    calendars: list.items.map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor,
      primary: Boolean(c.primary), canEdit: ["owner", "writer"].includes(c.accessRole)
    })),
    hidden: (prefs.data && prefs.data.hidden_ids) || []
  });
});
