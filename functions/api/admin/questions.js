import { json, errorJson, requireAdmin } from "../../_shared.js";

// GET  /api/admin/questions          → list all questions
// POST /api/admin/questions          → create
export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  const { results } = await env.DB.prepare(
    "SELECT * FROM questions ORDER BY id DESC"
  ).all();
  return json({ questions: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  let body;
  try { body = await request.json(); }
  catch { return errorJson("Invalid JSON", 400); }
  const q = normalizeQuestionInput(body);
  if (q.error) return errorJson(q.error, 400);
  const { lastRowId } = await env.DB.prepare(
    `INSERT INTO questions
      (difficulty, is_bonus, notes,
       a_type, a_prompt, a_answer, a_numeric, a_alts,
       b_type, b_prompt, b_answer, b_numeric, b_alts)
     VALUES (?,?,?, ?,?,?,?,?, ?,?,?,?,?)`
  ).bind(
    q.difficulty, q.is_bonus, q.notes,
    q.a_type, q.a_prompt, q.a_answer, q.a_numeric, q.a_alts,
    q.b_type, q.b_prompt, q.b_answer, q.b_numeric, q.b_alts
  ).run();
  return json({ id: lastRowId, ok: true });
}

export function normalizeQuestionInput(body) {
  const out = { error: null };
  const diff = String(body.difficulty || "").toLowerCase();
  if (!["easy", "medium", "hard"].includes(diff)) return { error: "difficulty must be easy/medium/hard" };
  out.difficulty = diff;
  out.is_bonus = body.is_bonus ? 1 : 0;
  out.notes = body.notes ? String(body.notes).slice(0, 4000) : null;

  const A = body.a || {};
  if (!A.prompt || !A.answer || !A.type) return { error: "Part A must have type, prompt, and answer" };
  if (!["multiple-choice", "true-false", "free-form"].includes(A.type)) return { error: "Part A type invalid" };
  out.a_type    = A.type;
  out.a_prompt  = String(A.prompt).slice(0, 2000);
  out.a_answer  = String(A.answer).slice(0, 500);
  out.a_numeric = A.numeric ? 1 : 0;
  out.a_alts    = Array.isArray(A.alts) && A.alts.length ? JSON.stringify(A.alts.map(String)) : null;

  if (body.b && body.b.prompt) {
    const B = body.b;
    if (!B.answer || !B.type) return { error: "Part B requires type and answer" };
    if (!["multiple-choice", "true-false", "free-form"].includes(B.type)) return { error: "Part B type invalid" };
    out.b_type    = B.type;
    out.b_prompt  = String(B.prompt).slice(0, 2000);
    out.b_answer  = String(B.answer).slice(0, 500);
    out.b_numeric = B.numeric ? 1 : 0;
    out.b_alts    = Array.isArray(B.alts) && B.alts.length ? JSON.stringify(B.alts.map(String)) : null;
  } else {
    out.b_type = null; out.b_prompt = null; out.b_answer = null; out.b_numeric = 0; out.b_alts = null;
  }
  return out;
}
