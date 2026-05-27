// Shared helpers for STQ Cloudflare Pages Functions.
// Bindings expected on env:
//   DB              D1 binding
//   ADMIN_PASSWORD  admin password (plain string env var)
//   CLAUDE_API_KEY  Anthropic API key
//   SESSION_SECRET  random string used to sign admin tokens
//   CLAUDE_MODEL    (optional) override; defaults to claude-haiku-4-5-20251001

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

// --- Constant-time string compare ---
export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Admin token: HMAC-SHA256-signed JSON payload ---
function b64urlEncode(bytesOrStr) {
  let s = typeof bytesOrStr === "string"
    ? btoa(bytesOrStr)
    : btoa(String.fromCharCode(...new Uint8Array(bytesOrStr)));
  return s.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecodeToString(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
async function hmacSign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlEncode(sig);
}
export async function issueAdminToken(env, ttlMs = 8 * 60 * 60 * 1000) {
  const payload = JSON.stringify({ role: "admin", exp: Date.now() + ttlMs });
  const b64 = b64urlEncode(payload);
  const sig = await hmacSign(env.SESSION_SECRET || "dev-secret", b64);
  return `${b64}.${sig}`;
}
export async function verifyAdminToken(env, token) {
  if (!token || typeof token !== "string") return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const b64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmacSign(env.SESSION_SECRET || "dev-secret", b64);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(b64urlDecodeToString(b64));
    if (payload.role !== "admin") return false;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    return true;
  } catch { return false; }
}
export async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return await verifyAdminToken(env, m[1]);
}

// --- Claude API ---
export async function callClaude(env, prompt, maxTokens = 400) {
  if (!env.CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY not set");
  const model = env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// --- Distractor generation ---
function distractorRules(difficulty, isNumeric) {
  if (isNumeric) {
    if (difficulty === "hard")
      return "All wrong answers MUST be numeric and within +/- 2 of the correct number. Match the format/units exactly.";
    if (difficulty === "medium")
      return "All wrong answers MUST be numeric and within +/- 3 of the correct number. Match the format/units exactly.";
    return "All wrong answers MUST be numeric and within +/- 10 of the correct number. Match the format/units exactly.";
  }
  if (difficulty === "hard")
    return "Wrong answers should be VERY similar to the correct answer — same category, same setting, easy to confuse.";
  if (difficulty === "medium")
    return "Wrong answers should be somewhat similar to the correct answer — related but distinguishable.";
  return "Wrong answers should be clearly different from the correct answer — different category or obviously wrong on reflection.";
}

export async function generateDistractors(env, part, difficulty, questionNotes) {
  const isNumeric = !!part.numeric;
  const parts = [
    "You are writing wrong answers for a multiple-choice quiz about storage rooms at Lineville Elementary School.",
    questionNotes ? `Context for this question: ${questionNotes}` : null,
    `Difficulty: ${difficulty}. ${distractorRules(difficulty, isNumeric)}`,
    `Question: ${part.prompt}`,
    `Correct answer: ${part.answer}`,
    "",
    "Write exactly 3 plausible but INCORRECT alternatives.",
    "They must NOT equal the correct answer (or be a close paraphrase of it).",
    "They must match the style and length of the correct answer.",
    'Respond with ONLY a JSON array of 3 strings, like ["a","b","c"]. No prose, no code fence.',
  ].filter(Boolean);
  const text = await callClaude(env, parts.join("\n"), 300);
  return parseDistractorArray(text, part.answer);
}

function parseDistractorArray(text, correctAnswer) {
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const i = s.indexOf("[");
  const j = s.lastIndexOf("]");
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  let arr;
  try { arr = JSON.parse(s); }
  catch { throw new Error("Could not parse Claude distractor JSON: " + text.slice(0, 200)); }
  if (!Array.isArray(arr)) throw new Error("Distractors not an array");
  const lc = String(correctAnswer).trim().toLowerCase();
  const out = [];
  for (const v of arr) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const t = String(v).trim();
    if (!t || t.toLowerCase() === lc) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error(`Only got ${out.length} usable distractors`);
  return out;
}

// ============================================================
// Leaderboard reset support
// ============================================================
// The 7 boards we render. Each has a SQL filter used both for fetching
// the leaderboard and for "resetting" only the rows that contribute to it.
export const BOARD_NAMES = [
  "all", "easy", "medium", "hard",
  "quick-easy", "quick-medium", "quick-hard",
];
export const BOARD_FILTERS = {
  "all":          { sql: "1=1",                                       params: () => [] },
  "easy":         { sql: "difficulty = ?",                            params: () => ["easy"] },
  "medium":       { sql: "difficulty = ?",                            params: () => ["medium"] },
  "hard":         { sql: "difficulty = ?",                            params: () => ["hard"] },
  "quick-easy":   { sql: "difficulty = ? AND quick_mode = 1",         params: () => ["easy"] },
  "quick-medium": { sql: "difficulty = ? AND quick_mode = 1",         params: () => ["medium"] },
  "quick-hard":   { sql: "difficulty = ? AND quick_mode = 1",         params: () => ["hard"] },
};
export const VALID_SCHEDULES = ["manual", "daily", "weekly", "monthly", "yearly"];

// Compute the next reset timestamp (ISO-ish, "YYYY-MM-DD HH:MM:SS") given a
// starting time and a schedule. Returns null for "manual".
export function computeNextReset(fromIso, schedule) {
  if (!fromIso || schedule === "manual") return null;
  const d = new Date(fromIso.replace(" ", "T") + "Z");
  if (schedule === "daily")   d.setUTCDate(d.getUTCDate() + 1);
  if (schedule === "weekly")  d.setUTCDate(d.getUTCDate() + 7);
  if (schedule === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  if (schedule === "yearly")  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
export function nowSqlIso() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// Idempotent: make sure all 7 board rows exist with default 'manual' schedule.
export async function ensureBoardRows(env) {
  for (const b of BOARD_NAMES) {
    await env.DB
      .prepare("INSERT OR IGNORE INTO leaderboard_settings (board, schedule) VALUES (?, 'manual')")
      .bind(b)
      .run();
  }
}

// Walk every board whose next_reset_at is in the past; advance last_reset_at
// to that timestamp and compute the next one. This is the "lazy cron" — it
// runs every time the leaderboard is fetched, so missed periods catch up.
export async function applyLazyResets(env) {
  await ensureBoardRows(env);
  const now = nowSqlIso();
  const due = (await env.DB
    .prepare("SELECT board, schedule, next_reset_at FROM leaderboard_settings WHERE next_reset_at IS NOT NULL AND next_reset_at <= ?")
    .bind(now).all()).results || [];
  for (const r of due) {
    let last = r.next_reset_at;
    let next = computeNextReset(last, r.schedule);
    // If we skipped several periods (e.g. site idle for a week on a daily schedule),
    // advance until next_reset_at is in the future.
    let safety = 0;
    while (next && next <= now && safety < 5000) {
      last = next;
      next = computeNextReset(next, r.schedule);
      safety++;
    }
    await env.DB
      .prepare("UPDATE leaderboard_settings SET last_reset_at=?, next_reset_at=?, updated_at=? WHERE board=?")
      .bind(last, next, now, r.board)
      .run();
  }
}

// --- Free-form answer grading ---
export function normalizeAnswer(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[‘’“”]/g, '"')   // smart quotes -> straight
    .replace(/[.,!?]+$/g, "")                       // trailing punctuation
    .replace(/\s+/g, " ");
}
export function checkFreeForm(submitted, correct, altsJson) {
  const cand = normalizeAnswer(submitted);
  if (!cand) return false;
  const accepted = new Set([normalizeAnswer(correct)]);
  if (altsJson) {
    try {
      const alts = JSON.parse(altsJson);
      if (Array.isArray(alts)) alts.forEach((a) => accepted.add(normalizeAnswer(a)));
    } catch {}
  }
  return accepted.has(cand);
}
