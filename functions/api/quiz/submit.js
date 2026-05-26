import { json, errorJson, checkFreeForm, normalizeAnswer } from "../../_shared.js";

// POST /api/quiz/submit
// body: {
//   playerName, difficulty, quickMode, elapsedSeconds,
//   answers: [{ id, a: "...", b: "..." }, ...]
// }
// Server re-fetches each question, grades, saves an attempt row, returns details.

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return errorJson("Invalid JSON", 400); }

  const playerName = String(body.playerName || "").trim().slice(0, 40) || "Anonymous";
  const difficulty = String(body.difficulty || "").toLowerCase();
  if (!["easy","medium","hard"].includes(difficulty)) return errorJson("Bad difficulty", 400);
  const quickMode = body.quickMode ? 1 : 0;
  const elapsedSeconds = Math.max(0, Math.round(Number(body.elapsedSeconds) || 0));
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (answers.length === 0) return errorJson("No answers submitted", 400);

  const ids = answers.map((a) => parseInt(a.id, 10)).filter(Number.isFinite);
  if (ids.length === 0) return errorJson("No question ids", 400);

  // Bind a parameterized IN-list
  const placeholders = ids.map(() => "?").join(",");
  const { results: questions } = await env.DB
    .prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();

  const qmap = new Map();
  for (const q of (questions || [])) qmap.set(q.id, q);

  let score = 0;
  let max = 0;
  let bonusCount = 0;
  const details = [];
  for (const a of answers) {
    const q = qmap.get(parseInt(a.id, 10));
    if (!q) continue;
    const isBonus = q.is_bonus === 1;
    if (isBonus) bonusCount++;
    const partWeight = isBonus ? 2 : 1;

    const aResult = gradePart(q, "a", a.a);
    let bResult = null;
    max += partWeight;
    if (aResult.correct) score += partWeight;
    if (q.b_type) {
      bResult = gradePart(q, "b", a.b);
      max += partWeight;
      if (bResult.correct) score += partWeight;
    }
    details.push({
      id: q.id,
      isBonus,
      a: { prompt: q.a_prompt, answer: q.a_answer, submitted: a.a ?? null, correct: aResult.correct },
      b: bResult ? { prompt: q.b_prompt, answer: q.b_answer, submitted: a.b ?? null, correct: bResult.correct } : null,
    });
  }

  const percentage = max > 0 ? (score / max) * 100 : 0;

  await env.DB.prepare(
    `INSERT INTO attempts
      (player_name, difficulty, quick_mode, score, max_score, percentage,
       elapsed_seconds, question_count, bonus_count)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    playerName, difficulty, quickMode, score, max, percentage,
    elapsedSeconds, answers.length, bonusCount
  ).run();

  return json({
    playerName, difficulty, quickMode: !!quickMode,
    score, max, percentage, elapsedSeconds, questionCount: answers.length, bonusCount,
    details,
  });
}

function gradePart(q, side, submitted) {
  const type = q[`${side}_type`];
  const correct = q[`${side}_answer`];
  const alts = q[`${side}_alts`];
  if (submitted == null || submitted === "") return { correct: false };
  if (type === "free-form") {
    return { correct: checkFreeForm(submitted, correct, alts) };
  }
  // multiple-choice and true-false: case-insensitive trimmed compare.
  return { correct: normalizeAnswer(submitted) === normalizeAnswer(correct) };
}
