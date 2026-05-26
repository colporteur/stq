import { json, errorJson, requireAdmin } from "../../../_shared.js";
import { normalizeQuestionInput } from "../questions.js";

// GET    /api/admin/questions/:id
// PUT    /api/admin/questions/:id
// DELETE /api/admin/questions/:id

export async function onRequestGet({ request, env, params }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return errorJson("Bad id", 400);
  const row = await env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first();
  if (!row) return errorJson("Not found", 404);
  return json({ question: row });
}

export async function onRequestPut({ request, env, params }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return errorJson("Bad id", 400);
  let body;
  try { body = await request.json(); } catch { return errorJson("Invalid JSON", 400); }
  const q = normalizeQuestionInput(body);
  if (q.error) return errorJson(q.error, 400);
  await env.DB.prepare(
    `UPDATE questions SET
       difficulty=?, is_bonus=?, notes=?,
       a_type=?, a_prompt=?, a_answer=?, a_numeric=?, a_alts=?,
       b_type=?, b_prompt=?, b_answer=?, b_numeric=?, b_alts=?,
       updated_at=datetime('now')
     WHERE id = ?`
  ).bind(
    q.difficulty, q.is_bonus, q.notes,
    q.a_type, q.a_prompt, q.a_answer, q.a_numeric, q.a_alts,
    q.b_type, q.b_prompt, q.b_answer, q.b_numeric, q.b_alts,
    id
  ).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return errorJson("Bad id", 400);
  await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
