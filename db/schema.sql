-- STQ (Storage Room Quiz) — D1 database schema
-- Apply with: wrangler d1 execute stq-db --remote --file=db/schema.sql

PRAGMA foreign_keys = ON;

-- Questions written by the admin.
-- A question may have one part (Part A only) or two parts (Part A + Part B).
-- Each part has its own type, prompt, and answer.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
  is_bonus  INTEGER NOT NULL DEFAULT 0 CHECK(is_bonus IN (0,1)),
  notes     TEXT,                  -- admin context, sent to Claude

  -- Part A
  a_type    TEXT NOT NULL CHECK(a_type IN ('multiple-choice','true-false','free-form')),
  a_prompt  TEXT NOT NULL,
  a_answer  TEXT NOT NULL,
  a_numeric INTEGER NOT NULL DEFAULT 0 CHECK(a_numeric IN (0,1)),
  a_alts    TEXT,                  -- JSON array of accepted alternate answers (free-form)

  -- Part B (optional). If b_type IS NULL the question is single-part.
  b_type    TEXT          CHECK(b_type IN ('multiple-choice','true-false','free-form')),
  b_prompt  TEXT,
  b_answer  TEXT,
  b_numeric INTEGER NOT NULL DEFAULT 0 CHECK(b_numeric IN (0,1)),
  b_alts    TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_bonus      ON questions(is_bonus);

-- One row per completed quiz attempt. Drives the leaderboards.
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name      TEXT    NOT NULL,
  difficulty       TEXT    NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
  quick_mode       INTEGER NOT NULL DEFAULT 0 CHECK(quick_mode IN (0,1)),
  score            INTEGER NOT NULL,        -- raw points earned
  max_score        INTEGER NOT NULL,        -- max possible
  percentage       REAL    NOT NULL,        -- score / max_score * 100
  elapsed_seconds  INTEGER NOT NULL,        -- total time from start to submit
  question_count   INTEGER NOT NULL,        -- 20 + bonus_count
  bonus_count      INTEGER NOT NULL DEFAULT 0,
  completed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_lb_all     ON attempts(percentage DESC, elapsed_seconds ASC);
CREATE INDEX IF NOT EXISTS idx_attempts_lb_level   ON attempts(difficulty, percentage DESC, elapsed_seconds ASC);
CREATE INDEX IF NOT EXISTS idx_attempts_lb_quick   ON attempts(difficulty, quick_mode, percentage DESC, elapsed_seconds ASC);

-- Tiny key/value table for admin password hash and any future settings.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per leaderboard, controlling when it auto-resets and tracking
-- the last reset cutoff. Resets don't delete attempt rows — the leaderboard
-- query simply filters to rows where completed_at > last_reset_at. This
-- lets each board reset independently without touching the others' history.
--
-- Boards (the 7 we render):
--   'all'           — All-Time across every level
--   'easy','medium','hard'             — per-level boards
--   'quick-easy','quick-medium','quick-hard' — Quick Mode boards (>=90%)
CREATE TABLE IF NOT EXISTS leaderboard_settings (
  board         TEXT PRIMARY KEY,
  schedule      TEXT NOT NULL DEFAULT 'manual'
                  CHECK(schedule IN ('manual','daily','weekly','monthly','yearly')),
  last_reset_at TEXT,
  next_reset_at TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
