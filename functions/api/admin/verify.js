import { json, requireAdmin } from "../../_shared.js";

// GET /api/admin/verify  →  { ok: true|false }
// Used by the admin page on load to confirm a stored token is still valid.
export async function onRequestGet({ request, env }) {
  return json({ ok: !!(await requireAdmin(request, env)) });
}
