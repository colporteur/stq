import { api, TOKEN_KEY, escapeHtml, setPageActiveNav } from "/assets/app.js";
setPageActiveNav("nav-admin");

const loginCard = document.getElementById("login-card");
const adminArea = document.getElementById("admin-area");
const loginError = document.getElementById("login-error");
const logoutLink = document.getElementById("logout");

// ---- Auth flow ----
async function init() {
  const tok = localStorage.getItem(TOKEN_KEY);
  if (!tok) return showLogin();
  try {
    const r = await api.get("/api/admin/verify", { admin: true });
    if (r && r.ok) return showAdmin();
  } catch {}
  showLogin();
}
function showLogin() {
  loginCard.classList.remove("hidden");
  adminArea.classList.add("hidden");
  logoutLink.classList.add("hidden");
  document.getElementById("pw").focus();
}
function showAdmin() {
  loginCard.classList.add("hidden");
  adminArea.classList.remove("hidden");
  logoutLink.classList.remove("hidden");
  loadQuestions();
  loadResets();
}
document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("pw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});
async function doLogin() {
  loginError.classList.add("hidden");
  const password = document.getElementById("pw").value;
  if (!password) return;
  try {
    const r = await api.post("/api/admin/login", { password });
    localStorage.setItem(TOKEN_KEY, r.token);
    showAdmin();
  } catch (e) {
    loginError.textContent = e.message || "Sign-in failed";
    loginError.classList.remove("hidden");
  }
}
logoutLink.addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});

// ---- Question manager ----
let allQuestions = [];

document.getElementById("filter-difficulty").addEventListener("change", renderList);

document.getElementById("has-part-b").addEventListener("change", (e) => {
  document.getElementById("part-b-block").classList.toggle("hidden", !e.target.checked);
});
document.getElementById("q-a-type").addEventListener("change", () =>
  document.getElementById("q-a-alts-wrap").classList.toggle("hidden",
    document.getElementById("q-a-type").value !== "free-form"));
document.getElementById("q-b-type").addEventListener("change", () =>
  document.getElementById("q-b-alts-wrap").classList.toggle("hidden",
    document.getElementById("q-b-type").value !== "free-form"));
// Initialize alt-fields visibility
document.getElementById("q-a-alts-wrap").classList.toggle("hidden",
  document.getElementById("q-a-type").value !== "free-form");
document.getElementById("q-b-alts-wrap").classList.toggle("hidden",
  document.getElementById("q-b-type").value !== "free-form");

document.getElementById("save-btn").addEventListener("click", saveQuestion);
document.getElementById("cancel-btn").addEventListener("click", resetForm);

async function loadQuestions() {
  try {
    const r = await api.get("/api/admin/questions", { admin: true });
    allQuestions = r.questions || [];
    renderList();
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); return showLogin(); }
    alert("Failed to load: " + e.message);
  }
}
function renderList() {
  const filter = document.getElementById("filter-difficulty").value;
  const filtered = filter
    ? allQuestions.filter((q) => q.difficulty === filter)
    : allQuestions;
  document.getElementById("q-total").textContent = filtered.length;
  const list = document.getElementById("q-list");
  list.innerHTML = "";
  document.getElementById("q-empty").classList.toggle("hidden", filtered.length > 0);
  filtered.forEach((q) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="q-meta">
        <span class="pill ${q.difficulty}">${q.difficulty}</span>
        ${q.is_bonus ? '<span class="pill bonus">BONUS</span>' : ""}
        <span class="pill">${q.a_type}${q.b_type ? " + " + q.b_type : ""}</span>
      </div>
      <div class="q-prompt">${escapeHtml(q.a_prompt)}</div>
      <div class="q-answer">Answer: ${escapeHtml(q.a_answer)}</div>
      ${q.b_type ? `
        <div class="q-prompt" style="margin-top:6px;">Part B: ${escapeHtml(q.b_prompt)}</div>
        <div class="q-answer">Answer: ${escapeHtml(q.b_answer)}</div>
      ` : ""}
      ${q.notes ? `<div class="sub" style="margin-top:6px;">Notes: ${escapeHtml(q.notes)}</div>` : ""}
      <div class="q-actions">
        <button class="btn ghost" data-edit="${q.id}">Edit</button>
        <button class="btn ghost" data-del="${q.id}" style="color:var(--bad);">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
  list.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => editQuestion(parseInt(b.dataset.edit, 10))));
  list.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteQuestion(parseInt(b.dataset.del, 10))));
}

function readForm() {
  const aType = document.getElementById("q-a-type").value;
  const bType = document.getElementById("q-b-type").value;
  const out = {
    difficulty: document.getElementById("q-difficulty").value,
    is_bonus:   document.getElementById("q-bonus").checked,
    notes:      document.getElementById("q-notes").value.trim() || null,
    a: {
      type:    aType,
      prompt:  document.getElementById("q-a-prompt").value.trim(),
      answer:  document.getElementById("q-a-answer").value.trim(),
      numeric: document.getElementById("q-a-numeric").checked,
      alts:    parseAlts(document.getElementById("q-a-alts").value, aType),
    },
  };
  if (document.getElementById("has-part-b").checked) {
    out.b = {
      type:    bType,
      prompt:  document.getElementById("q-b-prompt").value.trim(),
      answer:  document.getElementById("q-b-answer").value.trim(),
      numeric: document.getElementById("q-b-numeric").checked,
      alts:    parseAlts(document.getElementById("q-b-alts").value, bType),
    };
  }
  return out;
}
function parseAlts(s, type) {
  if (type !== "free-form" || !s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

async function saveQuestion() {
  const body = readForm();
  if (!body.a.prompt || !body.a.answer) { setStatus("Part A needs a question and an answer.", "bad"); return; }
  if (body.b && (!body.b.prompt || !body.b.answer)) { setStatus("Part B is enabled but missing fields.", "bad"); return; }
  const id = document.getElementById("q-id").value;
  setStatus("Saving…", "");
  try {
    if (id) {
      await api.put(`/api/admin/questions/${id}`, body);
      setStatus("Saved.", "good");
    } else {
      await api.post("/api/admin/questions", body, { admin: true });
      setStatus("Question added.", "good");
    }
    resetForm();
    loadQuestions();
  } catch (e) {
    setStatus("Save failed: " + e.message, "bad");
  }
}

function editQuestion(id) {
  const q = allQuestions.find((x) => x.id === id);
  if (!q) return;
  document.getElementById("q-id").value = q.id;
  document.getElementById("form-heading").textContent = "Edit question #" + q.id;
  document.getElementById("q-difficulty").value = q.difficulty;
  document.getElementById("q-bonus").checked = q.is_bonus === 1;
  document.getElementById("q-notes").value = q.notes || "";
  document.getElementById("q-a-type").value = q.a_type;
  document.getElementById("q-a-numeric").checked = q.a_numeric === 1;
  document.getElementById("q-a-prompt").value = q.a_prompt;
  document.getElementById("q-a-answer").value = q.a_answer;
  document.getElementById("q-a-alts").value = q.a_alts ? safeParseArr(q.a_alts).join(", ") : "";
  document.getElementById("q-a-alts-wrap").classList.toggle("hidden", q.a_type !== "free-form");

  const hasB = !!q.b_type;
  document.getElementById("has-part-b").checked = hasB;
  document.getElementById("part-b-block").classList.toggle("hidden", !hasB);
  if (hasB) {
    document.getElementById("q-b-type").value = q.b_type;
    document.getElementById("q-b-numeric").checked = q.b_numeric === 1;
    document.getElementById("q-b-prompt").value = q.b_prompt || "";
    document.getElementById("q-b-answer").value = q.b_answer || "";
    document.getElementById("q-b-alts").value = q.b_alts ? safeParseArr(q.b_alts).join(", ") : "";
    document.getElementById("q-b-alts-wrap").classList.toggle("hidden", q.b_type !== "free-form");
  }
  document.getElementById("cancel-btn").classList.remove("hidden");
  document.getElementById("save-btn").textContent = "Save changes";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function safeParseArr(s) { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; } }

async function deleteQuestion(id) {
  if (!confirm("Delete this question?")) return;
  try {
    await api.del(`/api/admin/questions/${id}`);
    loadQuestions();
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

function resetForm() {
  document.getElementById("q-id").value = "";
  document.getElementById("form-heading").textContent = "Add a question";
  document.getElementById("q-difficulty").value = "medium";
  document.getElementById("q-bonus").checked = false;
  document.getElementById("q-notes").value = "";
  document.getElementById("q-a-type").value = "multiple-choice";
  document.getElementById("q-a-numeric").checked = false;
  document.getElementById("q-a-prompt").value = "";
  document.getElementById("q-a-answer").value = "";
  document.getElementById("q-a-alts").value = "";
  document.getElementById("q-a-alts-wrap").classList.add("hidden");
  document.getElementById("has-part-b").checked = false;
  document.getElementById("part-b-block").classList.add("hidden");
  document.getElementById("q-b-type").value = "multiple-choice";
  document.getElementById("q-b-numeric").checked = false;
  document.getElementById("q-b-prompt").value = "";
  document.getElementById("q-b-answer").value = "";
  document.getElementById("q-b-alts").value = "";
  document.getElementById("cancel-btn").classList.add("hidden");
  document.getElementById("save-btn").textContent = "Save question";
  setStatus("", "");
}

function setStatus(msg, kind) {
  const el = document.getElementById("save-status");
  el.textContent = msg;
  el.style.color = kind === "good" ? "var(--good)" : kind === "bad" ? "var(--bad)" : "var(--ink-3)";
}

// ---- Leaderboard reset manager ----
const BOARD_LABELS = {
  "all":          "All-Time",
  "easy":         "Easy",
  "medium":       "Medium",
  "hard":         "Hard",
  "quick-easy":   "Quick · Easy",
  "quick-medium": "Quick · Medium",
  "quick-hard":   "Quick · Hard",
};
const SCHEDULE_OPTS = [
  ["manual",  "Manual"],
  ["daily",   "Daily"],
  ["weekly",  "Weekly"],
  ["monthly", "Monthly"],
  ["yearly",  "Yearly"],
];

document.getElementById("bulk-apply").addEventListener("click", async () => {
  const schedule = document.getElementById("bulk-schedule").value;
  setResetStatus("Applying…", "");
  try {
    await api.post("/api/admin/leaderboard-resets", { board: "all-boards", schedule }, { admin: true });
    setResetStatus(`All boards set to ${schedule}.`, "good");
    loadResets();
  } catch (e) { setResetStatus("Failed: " + e.message, "bad"); }
});

document.getElementById("bulk-reset").addEventListener("click", async () => {
  if (!confirm("Reset every leaderboard right now? Existing attempts stay in the database but will no longer appear on any board.")) return;
  setResetStatus("Resetting…", "");
  try {
    const r = await fetch("/api/admin/leaderboard-resets?action=reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem(TOKEN_KEY) },
      body: JSON.stringify({ board: "all-boards" }),
    });
    if (!r.ok) throw new Error(await r.text());
    setResetStatus("All 7 boards reset.", "good");
    loadResets();
  } catch (e) { setResetStatus("Failed: " + e.message, "bad"); }
});

async function loadResets() {
  const tbody = document.getElementById("reset-tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-row"><div class="spinner"></div><span>Loading…</span></div></td></tr>`;
  try {
    const r = await api.get("/api/admin/leaderboard-resets", { admin: true });
    renderResets(r.boards || []);
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); return showLogin(); }
    tbody.innerHTML = `<tr><td colspan="5" class="banner bad">Failed: ${escapeHtml(e.message)}</td></tr>`;
  }
}
function renderResets(rows) {
  const order = ["all","easy","medium","hard","quick-easy","quick-medium","quick-hard"];
  const byBoard = Object.fromEntries(rows.map(r => [r.board, r]));
  const tbody = document.getElementById("reset-tbody");
  tbody.innerHTML = "";
  for (const b of order) {
    const r = byBoard[b] || { board: b, schedule: "manual", last_reset_at: null, next_reset_at: null };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(BOARD_LABELS[b])}</strong></td>
      <td>
        <select data-board="${b}" class="schedule-select">
          ${SCHEDULE_OPTS.map(([v,lbl]) => `<option value="${v}" ${v === r.schedule ? "selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </td>
      <td class="muted">${r.last_reset_at ? escapeHtml(r.last_reset_at) : "<span class='muted'>never</span>"}</td>
      <td class="muted">${r.next_reset_at ? escapeHtml(r.next_reset_at) : "<span class='muted'>—</span>"}</td>
      <td><button class="btn ghost" data-reset="${b}" style="color:var(--bad);">Reset now</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".schedule-select").forEach((sel) =>
    sel.addEventListener("change", () => setSchedule(sel.dataset.board, sel.value)));
  tbody.querySelectorAll("[data-reset]").forEach((btn) =>
    btn.addEventListener("click", () => resetBoard(btn.dataset.reset)));
}
async function setSchedule(board, schedule) {
  setResetStatus(`Updating ${BOARD_LABELS[board]}…`, "");
  try {
    await api.post("/api/admin/leaderboard-resets", { board, schedule }, { admin: true });
    setResetStatus(`${BOARD_LABELS[board]} → ${schedule}.`, "good");
    loadResets();
  } catch (e) { setResetStatus("Failed: " + e.message, "bad"); }
}
async function resetBoard(board) {
  if (!confirm(`Reset the "${BOARD_LABELS[board]}" leaderboard right now?\nAttempts stay in the database but will no longer appear on this board.`)) return;
  setResetStatus("Resetting…", "");
  try {
    const r = await fetch("/api/admin/leaderboard-resets?action=reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem(TOKEN_KEY) },
      body: JSON.stringify({ board }),
    });
    if (!r.ok) throw new Error(await r.text());
    setResetStatus(`${BOARD_LABELS[board]} reset.`, "good");
    loadResets();
  } catch (e) { setResetStatus("Failed: " + e.message, "bad"); }
}
function setResetStatus(msg, kind) {
  const el = document.getElementById("reset-status");
  el.textContent = msg;
  el.style.color = kind === "good" ? "var(--good)" : kind === "bad" ? "var(--bad)" : "var(--ink-3)";
}

init();
