import { json, errorJson, generateDistractors } from "../../_shared.js";

// POST /api/quiz/start
// body: { difficulty: "easy"|"medium"|"hard" }
// returns: { questions: [...], bonusCount }
//
// The server picks 20 random regular questions + 0-3 random bonus questions
// at the chosen difficulty, then generates distractors via Claude in parallel
// for each multiple-choice part. Correct answers are NOT returned to the client.

const REGULAR_COUNT = 20;
const BONUS_MIN = 1;
const BONUS_MAX = 3;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return errorJson("Invalid JSON", 400); }
  const difficulty = String(body.difficulty || "").toLowerCase();
  if (!["easy","medium","hard"].includes(difficulty)) return errorJson("Bad difficulty", 400);

  // Pull pools
  const regularRows = (await env.DB.prepare(
    "SELECT * FROM questions WHERE difficulty=? AND is_bonus=0"
  ).bind(difficulty).all()).results || [];

  if (regularRows.length === 0) {
    return errorJson(`No ${difficulty} questions in the database yet`, 400);
  }
  if (regularRows.length < REGULAR_COUNT) {
    return errorJson(
      `Only ${regularRows.length} ${difficulty} questions in the database — need ${REGULAR_COUNT}.`,
      400
    );
  }

  const bonusRows = (await env.DB.prepare(
    "SELECT * FROM questions WHERE difficulty=? AND is_bonus=1"
  ).bind(difficulty).all()).results || [];

  shuffle(regularRows);
  shuffle(bonusRows);

  const picked = regularRows.slice(0, REGULAR_COUNT);
  const bonusCount = Math.min(
    bonusRows.length,
    BONUS_MIN + Math.floor(Math.random() * (BONUS_MAX - BONUS_MIN + 1))
  );
  const bonusPicked = bonusRows.slice(0, bonusCount);
  const all = picked.concat(bonusPicked);
  shuffle(all);

  // Generate distractors in parallel for all multiple-choice parts.
  const jobs = [];
  const partsToFill = [];
  for (let i = 0; i < all.length; i++) {
    const q = all[i];
    if (q.a_type === "multiple-choice") {
      partsToFill.push({ qi: i, side: "a" });
    }
    if (q.b_type === "multiple-choice") {
      partsToFill.push({ qi: i, side: "b" });
    }
  }
  for (const p of partsToFill) {
    const q = all[p.qi];
    const part = p.side === "a"
      ? { prompt: q.a_prompt, answer: q.a_answer, numeric: q.a_numeric }
      : { prompt: q.b_prompt, answer: q.b_answer, numeric: q.b_numeric };
    jobs.push(
      generateDistractors(env, part, q.difficulty, q.notes)
        .then((arr) => ({ ok: true, ...p, distractors: arr }))
        .catch((e) => ({ ok: false, ...p, error: String(e.message || e) }))
    );
  }
  const results = await Promise.all(jobs);

  // Attach choices to each question part.
  const distractorMap = new Map();
  for (const r of results) {
    distractorMap.set(`${r.qi}-${r.side}`, r);
  }

  const out = all.map((q, i) => {
    const obj = {
      id: q.id,
      isBonus: q.is_bonus === 1,
      a: partPayload(q, "a", distractorMap.get(`${i}-a`)),
    };
    if (q.b_type) obj.b = partPayload(q, "b", distractorMap.get(`${i}-b`));
    return obj;
  });

  return json({ questions: out, bonusCount, regularCount: REGULAR_COUNT });
}

function partPayload(q, side, distractorResult) {
  const type = q[`${side}_type`];
  const prompt = q[`${side}_prompt`];
  const answer = q[`${side}_answer`];
  const base = { type, prompt };
  if (type === "true-false") {
    base.choices = ["True", "False"];
  } else if (type === "multiple-choice") {
    let distractors;
    if (distractorResult && distractorResult.ok) {
      distractors = distractorResult.distractors;
    } else {
      // Fallback: if Claude failed, return a still-playable choice set.
      distractors = makeFallbackDistractors(answer, q.difficulty, side === "a" ? q.a_numeric : q.b_numeric);
      base.distractorWarning = distractorResult ? distractorResult.error : "no result";
    }
    const choices = distractors.slice(0, 3);
    const correctIdx = Math.floor(Math.random() * 4);
    choices.splice(correctIdx, 0, answer);
    base.choices = choices;
  }
  // free-form: no choices
  return base;
}

function makeFallbackDistractors(correct, difficulty, isNumeric) {
  if (isNumeric) {
    const n = parseFloat(correct);
    if (Number.isFinite(n)) {
      const step = difficulty === "hard" ? 1 : difficulty === "medium" ? 2 : 4;
      const round = correct.indexOf(".") < 0;
      return [n + step, n - step, n + step * 2].map((x) => (round ? String(Math.round(x)) : String(x)));
    }
  }
  return [`Not ${correct}`, `Maybe ${correct}`, `Almost ${correct}`];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
