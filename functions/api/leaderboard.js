import { json, BOARD_FILTERS, applyLazyResets, ensureBoardRows } from "../_shared.js";

// GET /api/leaderboard
// Each of the 7 boards may have an independent reset cutoff (last_reset_at).
// We don't delete attempt rows; we filter to rows newer than each board's
// cutoff. That lets one board reset without affecting the others.

const TOP_N = 10;
const QUICK_MIN_PCT = 90;

export async function onRequestGet({ env }) {
  // Run any scheduled resets that are due before we read.
  await applyLazyResets(env);
  await ensureBoardRows(env);

  // Pull all 7 boards' cutoffs in one query.
  const settingsRows = (await env.DB
    .prepare("SELECT board, last_reset_at, next_reset_at, schedule FROM leaderboard_settings")
    .all()).results || [];
  const cutoffs = {};
  const schedules = {};
  for (const r of settingsRows) {
    cutoffs[r.board] = r.last_reset_at || "1970-01-01 00:00:00";
    schedules[r.board] = { schedule: r.schedule, last_reset_at: r.last_reset_at, next_reset_at: r.next_reset_at };
  }
  const cutoff = (b) => cutoffs[b] || "1970-01-01 00:00:00";

  async function fetchBoard(boardKey, extraSql = "", extraParams = []) {
    const f = BOARD_FILTERS[boardKey];
    const sql = `SELECT * FROM attempts
                 WHERE ${f.sql} AND completed_at > ? ${extraSql}
                 ORDER BY percentage DESC, elapsed_seconds ASC, completed_at ASC
                 LIMIT ?`;
    const params = [...f.params(), cutoff(boardKey), ...extraParams, TOP_N];
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return results || [];
  }

  const allTime = await fetchBoard("all");
  const byLevel = {
    easy:   await fetchBoard("easy"),
    medium: await fetchBoard("medium"),
    hard:   await fetchBoard("hard"),
  };
  // Quick boards additionally require percentage >= 90.
  const quickByLevel = {
    easy:   await fetchBoard("quick-easy",   "AND percentage >= ?", [QUICK_MIN_PCT]),
    medium: await fetchBoard("quick-medium", "AND percentage >= ?", [QUICK_MIN_PCT]),
    hard:   await fetchBoard("quick-hard",   "AND percentage >= ?", [QUICK_MIN_PCT]),
  };

  return json({
    allTime, byLevel, quickByLevel,
    quickMinPct: QUICK_MIN_PCT, topN: TOP_N,
    schedules,
  });
}
