// End-to-end smoke test for STQ API functions.
// Stands up an in-memory SQLite, mocks D1, mocks the Claude fetch, and walks
// through the full admin + quiz flow.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");

// ---- Mock D1 binding using node:sqlite ----
class D1Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.boundArgs = []; }
  bind(...args) { this.boundArgs = args; return this; }
  async run() {
    const stmt = this.db.prepare(this.sql);
    const r = stmt.run(...this.boundArgs);
    return { lastRowId: Number(r.lastInsertRowid), success: true };
  }
  async first() {
    const stmt = this.db.prepare(this.sql);
    return stmt.get(...this.boundArgs) || null;
  }
  async all() {
    const stmt = this.db.prepare(this.sql);
    return { results: stmt.all(...this.boundArgs) };
  }
}
class D1Mock {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    const schema = fs.readFileSync(path.join(ROOT, "db/schema.sql"), "utf-8");
    this.db.exec(schema);
  }
  prepare(sql) { return new D1Stmt(this.db, sql); }
}

// ---- Mock global fetch (for the Claude API call) ----
let claudeCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === "string" && url.includes("api.anthropic.com")) {
    claudeCalls++;
    const body = JSON.parse(init.body);
    const userMsg = body.messages[0].content;
    // Find correct answer line: "Correct answer: X"
    const m = userMsg.match(/Correct answer: (.+)/);
    const correct = m ? m[1].trim() : "answer";
    // Return 3 fake distractors that vary from correct
    const distractors = [`Not ${correct}`, `Almost ${correct}`, `Maybe ${correct}`];
    return new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(distractors) }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};

// ---- Helper to invoke a handler ----
const env = {
  DB: new D1Mock(),
  ADMIN_PASSWORD: "letmein",
  CLAUDE_API_KEY: "fake-key",
  SESSION_SECRET: "test-secret-12345",
};
function reqJson(method, body, headers = {}) {
  return new Request("http://test.example/", {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const login   = await import("./functions/api/admin/login.js");
const verify  = await import("./functions/api/admin/verify.js");
const qList   = await import("./functions/api/admin/questions.js");
const qOne    = await import("./functions/api/admin/questions/[id].js");
const info    = await import("./functions/api/info.js");
const start   = await import("./functions/api/quiz/start.js");
const submit  = await import("./functions/api/quiz/submit.js");
const board   = await import("./functions/api/leaderboard.js");

let pass = 0, fail = 0;
async function check(name, cond, extra = "") {
  if (cond) { console.log("  ✓", name); pass++; }
  else      { console.log("  ✗", name, extra); fail++; }
}

// --- 1. Login flow ---
console.log("\n[1] admin login");
let r = await login.onRequestPost({ request: reqJson("POST", { password: "wrong" }), env });
await check("wrong password returns 401", r.status === 401);
r = await login.onRequestPost({ request: reqJson("POST", { password: "letmein" }), env });
await check("right password returns 200", r.status === 200);
const { token } = await r.json();
await check("token returned", typeof token === "string" && token.length > 10);

// Verify endpoint
r = await verify.onRequestGet({ request: reqJson("GET", null, { Authorization: "Bearer " + token }), env });
await check("verify returns ok with token", (await r.json()).ok === true);
r = await verify.onRequestGet({ request: reqJson("GET", null), env });
await check("verify returns false without token", (await r.json()).ok === false);

// --- 2. Insert 25 easy questions + 1 bonus + 1 two-part + 22 medium + 22 hard ---
console.log("\n[2] adding questions");
async function addQ(body) {
  const r = await qList.onRequestPost({
    request: reqJson("POST", body, { Authorization: "Bearer " + token }), env
  });
  return r;
}
let inserted = 0;
for (let i = 1; i <= 22; i++) {
  await addQ({
    difficulty: "easy",
    a: { type: "multiple-choice", prompt: `Easy MC #${i}?`, answer: String(i * 2), numeric: true },
  });
  inserted++;
}
// one easy bonus
await addQ({
  difficulty: "easy", is_bonus: true,
  a: { type: "true-false", prompt: "Easy bonus T/F", answer: "True" },
});
// one easy two-part
await addQ({
  difficulty: "easy",
  a: { type: "multiple-choice", prompt: "Easy A", answer: "5", numeric: true },
  b: { type: "free-form",       prompt: "Easy B", answer: "Cafeteria", alts: ["lunchroom"] },
});
// 22 medium MC
for (let i = 1; i <= 22; i++)
  await addQ({ difficulty: "medium", a: { type: "multiple-choice", prompt: `Med ${i}`, answer: String(50 + i), numeric: true } });
// 22 hard MC
for (let i = 1; i <= 22; i++)
  await addQ({ difficulty: "hard", a: { type: "multiple-choice", prompt: `Hard ${i}`, answer: String(100 + i), numeric: true } });
console.log("  added", 22 + 1 + 1 + 22 + 22, "questions");

// --- 3. info endpoint ---
console.log("\n[3] info endpoint");
r = await info.onRequestGet({ env });
const inf = await r.json();
await check("easy playable",   inf.playable.easy);
await check("medium playable", inf.playable.medium);
await check("hard playable",   inf.playable.hard);
await check("easy counts match", inf.counts.easy === 23 && inf.bonus.easy === 1, JSON.stringify(inf));

// --- 4. quiz start ---
console.log("\n[4] quiz start (easy)");
r = await start.onRequestPost({ request: reqJson("POST", { difficulty: "easy" }), env });
await check("start returns 200", r.status === 200);
const quiz = await r.json();
await check("got 20 regular + bonus", quiz.questions.length >= 20 && quiz.questions.length <= 23, "got " + quiz.questions.length);
await check("Claude was called", claudeCalls > 0, "calls=" + claudeCalls);
const mcs = quiz.questions.filter(q => q.a.type === "multiple-choice");
await check("MC questions have 4 choices", mcs.every(q => q.a.choices && q.a.choices.length === 4));
const tfs = quiz.questions.filter(q => q.a.type === "true-false");
await check("TF questions have True/False", tfs.every(q => q.a.choices && q.a.choices.includes("True") && q.a.choices.includes("False")));
const ff = quiz.questions.filter(q => q.a.type === "free-form");
await check("free-form has no choices", ff.every(q => !q.a.choices));

// --- 5. quiz submit (simulate: pick the correct answer for every question) ---
console.log("\n[5] quiz submit");
// We need to know correct answers — fetch from DB directly.
const correctMap = new Map();
for (const row of env.DB.db.prepare("SELECT * FROM questions").all()) {
  correctMap.set(row.id, row);
}
// First: submit all-correct
const allCorrect = quiz.questions.map(q => {
  const row = correctMap.get(q.id);
  const a = row.a_answer;
  const b = row.b_type ? row.b_answer : undefined;
  return { id: q.id, a, b };
});
r = await submit.onRequestPost({
  request: reqJson("POST", {
    playerName: "Test Player", difficulty: "easy", quickMode: true,
    elapsedSeconds: 200, answers: allCorrect,
  }), env
});
const res1 = await r.json();
await check("all-correct submit 200", r.status === 200);
await check("all-correct percentage = 100", res1.percentage === 100, JSON.stringify({score:res1.score,max:res1.max}));
await check("bonus counted with 2x", res1.score >= res1.questionCount, "score=" + res1.score + " count=" + res1.questionCount);

// Next: submit all wrong / blank
const allWrong = quiz.questions.map(q => ({ id: q.id, a: "definitely not", b: q.b ? "nope" : undefined }));
r = await submit.onRequestPost({
  request: reqJson("POST", {
    playerName: "Wrong Person", difficulty: "easy", quickMode: false,
    elapsedSeconds: 600, answers: allWrong,
  }), env
});
const res2 = await r.json();
await check("all-wrong percentage = 0", res2.percentage === 0);

// Mixed: half right
const mixed = quiz.questions.map((q, i) => {
  const row = correctMap.get(q.id);
  const right = i % 2 === 0;
  return {
    id: q.id,
    a: right ? row.a_answer : "wrong",
    b: row.b_type ? (right ? row.b_answer : "wrong") : undefined,
  };
});
r = await submit.onRequestPost({
  request: reqJson("POST", {
    playerName: "Mixed", difficulty: "easy", quickMode: true,
    elapsedSeconds: 300, answers: mixed,
  }), env
});
const res3 = await r.json();
await check("mixed percentage in (0,100)", res3.percentage > 0 && res3.percentage < 100, "pct=" + res3.percentage);

// --- 6. leaderboard ---
console.log("\n[6] leaderboard");
r = await board.onRequestGet({ env });
const lb = await r.json();
await check("all-time has rows", lb.allTime.length >= 2);
await check("quick easy includes 100% player", lb.quickByLevel.easy.some(x => x.percentage === 100 && x.player_name === "Test Player"));
await check("non-quick board has all attempts", lb.byLevel.easy.length >= 3);
// Tie-breaker: faster wins. Add two 100% attempts at different speeds and verify.
env.DB.db.prepare(`INSERT INTO attempts (player_name,difficulty,quick_mode,score,max_score,percentage,elapsed_seconds,question_count)
  VALUES ('Faster','easy',1,20,20,100,100,20),('Slower','easy',1,20,20,100,400,20)`).run();
r = await board.onRequestGet({ env });
const lb2 = await r.json();
const easyQuickTop = lb2.quickByLevel.easy.map(x => x.player_name);
await check("faster beats slower on ties", easyQuickTop.indexOf("Faster") < easyQuickTop.indexOf("Slower"), easyQuickTop.join(","));

// --- 7. PUT and DELETE question ---
console.log("\n[7] edit + delete");
// list to get an id
r = await qList.onRequestGet({ request: reqJson("GET", null, { Authorization: "Bearer " + token }), env });
const list = (await r.json()).questions;
const editId = list[0].id;
r = await qOne.onRequestPut({
  request: reqJson("PUT", {
    difficulty: "hard",
    a: { type: "free-form", prompt: "edited?", answer: "yes", alts: ["yep"] },
  }, { Authorization: "Bearer " + token }),
  env, params: { id: String(editId) },
});
await check("PUT returns 200", r.status === 200);
r = await qOne.onRequestGet({
  request: reqJson("GET", null, { Authorization: "Bearer " + token }),
  env, params: { id: String(editId) },
});
const edited = (await r.json()).question;
await check("edit took: difficulty", edited.difficulty === "hard");
await check("edit took: type", edited.a_type === "free-form");
await check("edit took: alts saved", JSON.parse(edited.a_alts).includes("yep"));

r = await qOne.onRequestDelete({
  request: reqJson("DELETE", null, { Authorization: "Bearer " + token }),
  env, params: { id: String(editId) },
});
await check("DELETE returns 200", r.status === 200);
r = await qOne.onRequestGet({
  request: reqJson("GET", null, { Authorization: "Bearer " + token }),
  env, params: { id: String(editId) },
});
await check("GET after delete returns 404", r.status === 404);

// --- 8. unauthorized admin endpoints ---
console.log("\n[8] auth");
r = await qList.onRequestGet({ request: reqJson("GET"), env });
await check("admin list without token = 401", r.status === 401);
r = await qList.onRequestPost({ request: reqJson("POST", { difficulty: "easy", a: {} }), env });
await check("admin create without token = 401", r.status === 401);

console.log(`\n=== ${pass} passed, ${fail} failed; Claude calls: ${claudeCalls} ===`);
process.exit(fail === 0 ? 0 : 1);
