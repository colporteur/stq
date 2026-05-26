import { json } from "../_shared.js";

// GET /api/info
// Returns public info about the question bank — used by the home page to
// show which difficulty levels currently have enough questions to play.

const REGULAR_COUNT = 20;

export async function onRequestGet({ env }) {
  const counts = { easy: 0, medium: 0, hard: 0 };
  const bonus  = { easy: 0, medium: 0, hard: 0 };
  const rows = (await env.DB.prepare(
    `SELECT difficulty, is_bonus, COUNT(*) AS n FROM questions GROUP BY difficulty, is_bonus`
  ).all()).results || [];
  for (const r of rows) {
    const lvl = r.difficulty;
    if (!(lvl in counts)) continue;
    if (r.is_bonus === 1) bonus[lvl] = r.n;
    else counts[lvl] = r.n;
  }
  const playable = {
    easy:   counts.easy   >= REGULAR_COUNT,
    medium: counts.medium >= REGULAR_COUNT,
    hard:   counts.hard   >= REGULAR_COUNT,
  };
  return json({ counts, bonus, playable, requiredPerQuiz: REGULAR_COUNT });
}
