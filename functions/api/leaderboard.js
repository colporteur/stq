import { json } from "../_shared.js";

// GET /api/leaderboard
// Returns all leaderboards in one payload:
//   allTime:                top 10 across all levels (not gated by quick mode)
//   byLevel.{easy,medium,hard}:    top 10 per level (not gated)
//   quickByLevel.{easy,medium,hard}: top 10 per level with quick_mode=1 AND percentage >= 90
//
// Sort: percentage DESC, elapsed_seconds ASC (faster wins ties), completed_at ASC.

const TOP_N = 10;
const QUICK_MIN_PCT = 90;

const SORT = "ORDER BY percentage DESC, elapsed_seconds ASC, completed_at ASC LIMIT ?";

export async function onRequestGet({ env }) {
  const allTime = (await env.DB.prepare(
    `SELECT * FROM attempts ${SORT}`
  ).bind(TOP_N).all()).results || [];

  const byLevel = {};
  for (const lvl of ["easy","medium","hard"]) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM attempts WHERE difficulty=? ${SORT}`
    ).bind(lvl, TOP_N).all();
    byLevel[lvl] = results || [];
  }

  const quickByLevel = {};
  for (const lvl of ["easy","medium","hard"]) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM attempts WHERE difficulty=? AND quick_mode=1 AND percentage>=? ${SORT}`
    ).bind(lvl, QUICK_MIN_PCT, TOP_N).all();
    quickByLevel[lvl] = results || [];
  }

  return json({ allTime, byLevel, quickByLevel, quickMinPct: QUICK_MIN_PCT, topN: TOP_N });
}
