import {
  json, errorJson, requireAdmin,
  BOARD_NAMES, VALID_SCHEDULES,
  ensureBoardRows, applyLazyResets,
  computeNextReset, nowSqlIso,
} from "../../_shared.js";

// GET  /api/admin/leaderboard-resets
//   → { boards: [{ board, schedule, last_reset_at, next_reset_at }, ...] }
//
// POST /api/admin/leaderboard-resets
//   body: { board: "<name>" | "all-boards", schedule: "manual"|"daily"|"weekly"|"monthly"|"yearly" }
//   Sets the schedule. If board === "all-boards", applies to every board.
//
// POST /api/admin/leaderboard-resets?action=reset
//   body: { board: "<name>" | "all-boards" }
//   Immediately resets the chosen board(s) by setting last_reset_at = now.

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  await applyLazyResets(env);
  await ensureBoardRows(env);
  const rows = (await env.DB
    .prepare("SELECT board, schedule, last_reset_at, next_reset_at FROM leaderboard_settings")
    .all()).results || [];
  return json({ boards: rows });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return errorJson("Unauthorized", 401);
  await ensureBoardRows(env);

  let body;
  try { body = await request.json(); } catch { return errorJson("Invalid JSON", 400); }
  const action = new URL(request.url).searchParams.get("action");
  const board  = String(body.board || "").trim();

  const targets = board === "all-boards"
    ? BOARD_NAMES
    : (BOARD_NAMES.includes(board) ? [board] : null);
  if (!targets) return errorJson("Bad board: " + board, 400);

  if (action === "reset") {
    // Immediate reset: bump last_reset_at to now. Do NOT change schedule.
    const now = nowSqlIso();
    for (const b of targets) {
      // Recompute next_reset_at relative to now if the board is on a schedule.
      const cur = await env.DB.prepare("SELECT schedule FROM leaderboard_settings WHERE board=?").bind(b).first();
      const sched = cur ? cur.schedule : "manual";
      const next = computeNextReset(now, sched);
      await env.DB
        .prepare("UPDATE leaderboard_settings SET last_reset_at=?, next_reset_at=?, updated_at=? WHERE board=?")
        .bind(now, next, now, b)
        .run();
    }
    return json({ ok: true, reset: targets, at: now });
  }

  // Otherwise it's a schedule change.
  const schedule = String(body.schedule || "").trim();
  if (!VALID_SCHEDULES.includes(schedule)) return errorJson("Bad schedule: " + schedule, 400);
  const now = nowSqlIso();
  for (const b of targets) {
    const next = computeNextReset(now, schedule);
    await env.DB
      .prepare("UPDATE leaderboard_settings SET schedule=?, next_reset_at=?, updated_at=? WHERE board=?")
      .bind(schedule, next, now, b)
      .run();
  }
  return json({ ok: true, updated: targets, schedule });
}
