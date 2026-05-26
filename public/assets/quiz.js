// Quiz page logic — loads a quiz, runs the timer, collects answers,
// submits, and shows the results screen.
import { api, NAME_KEY, fmtTime, escapeHtml } from "/assets/app.js";

const QUICK_SECONDS = { easy: 20 * 60, medium: 10 * 60, hard: 5 * 60 };

const params = new URLSearchParams(location.search);
const level = (params.get("level") || "").toLowerCase();
const quickMode = params.get("quick") === "1";
const playerName = localStorage.getItem(NAME_KEY) || "Anonymous";

if (!["easy","medium","hard"].includes(level)) {
  showError("Missing or invalid difficulty.");
}

document.getElementById("header-tag").textContent =
  capitalize(level) + (quickMode ? " · Quick" : "");

const state = {
  questions: [],
  current: 0,
  answers: [],     // [{ id, a, b }]
  startTs: 0,
  endTs: 0,
  countdownLimit: 0,    // seconds for quick mode (0 if disabled)
  timerHandle: null,
  expired: false,
};

if (level) loadQuiz();

async function loadQuiz() {
  try {
    const data = await api.post("/api/quiz/start", { difficulty: level });
    state.questions = data.questions || [];
    if (state.questions.length === 0) throw new Error("No questions returned.");
    state.answers = state.questions.map((q) => ({ id: q.id, a: null, b: null }));
    state.startTs = Date.now();
    state.countdownLimit = quickMode ? QUICK_SECONDS[level] : 0;
    document.getElementById("view-loading").classList.add("hidden");
    document.getElementById("view-quiz").classList.remove("hidden");
    document.getElementById("q-total").textContent = state.questions.length;
    document.getElementById("quick-mode-label").classList.toggle("hidden", !quickMode);
    document.getElementById("quick-meta-piece").classList.toggle("hidden", !quickMode);
    renderQuestion();
    startTimer();
  } catch (e) {
    showError(e.message || String(e));
  }
}

function renderQuestion() {
  const i = state.current;
  const q = state.questions[i];
  document.getElementById("q-index").textContent = i + 1;
  document.getElementById("quiz-bar-fill").style.width =
    `${(i / state.questions.length) * 100}%`;

  document.getElementById("q-part-a-prompt").textContent = q.a.prompt;
  document.getElementById("q-part-a-body").innerHTML = "";
  renderPart(q.a, "a", document.getElementById("q-part-a-body"));

  const bWrap = document.getElementById("q-part-b");
  if (q.b) {
    bWrap.classList.remove("hidden");
    document.getElementById("q-part-b-prompt").textContent = q.b.prompt;
    document.getElementById("q-part-b-body").innerHTML = "";
    renderPart(q.b, "b", document.getElementById("q-part-b-body"));
  } else {
    bWrap.classList.add("hidden");
  }
  updateNextEnabled();
}

function renderPart(part, side, container) {
  if (part.type === "free-form") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type your answer";
    input.autocomplete = "off";
    input.value = state.answers[state.current][side] || "";
    input.addEventListener("input", () => {
      state.answers[state.current][side] = input.value;
      updateNextEnabled();
    });
    container.appendChild(input);
    return;
  }
  // multiple-choice or true-false: render choice buttons
  const choices = part.choices || [];
  const wrap = document.createElement("div");
  wrap.className = "choices";
  choices.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice";
    btn.textContent = text;
    if (state.answers[state.current][side] === text) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      state.answers[state.current][side] = text;
      wrap.querySelectorAll(".choice").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      updateNextEnabled();
    });
    wrap.appendChild(btn);
  });
  container.appendChild(wrap);
}

function updateNextEnabled() {
  const q = state.questions[state.current];
  const a = state.answers[state.current];
  const aDone = !!(a.a && String(a.a).trim() !== "");
  const bDone = !q.b || !!(a.b && String(a.b).trim() !== "");
  const ready = aDone && bDone;
  const nextBtn = document.getElementById("next-btn");
  nextBtn.disabled = !ready;
  nextBtn.textContent = state.current + 1 >= state.questions.length ? "Submit ✓" : "Next →";
  document.getElementById("answer-status").textContent = ready ? "" : "Pick an answer to continue.";
}

document.getElementById("next-btn").addEventListener("click", () => {
  if (state.current + 1 >= state.questions.length) {
    submit();
  } else {
    state.current += 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

function startTimer() {
  state.timerHandle = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.startTs) / 1000);
    document.getElementById("time-elapsed").textContent = fmtTime(elapsed);
    if (quickMode) {
      const left = state.countdownLimit - elapsed;
      const tl = document.getElementById("time-left");
      tl.textContent = fmtTime(Math.max(0, left));
      tl.classList.toggle("urgent", left <= 30);
      tl.classList.toggle("warning", left > 30 && left <= 60);
      if (left <= 0 && !state.expired) {
        state.expired = true;
        clearInterval(state.timerHandle);
        submit({ timedOut: true });
      }
    }
  }, 250);
}

async function submit({ timedOut = false } = {}) {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.endTs = Date.now();
  const elapsed = Math.round((state.endTs - state.startTs) / 1000);
  document.getElementById("view-quiz").classList.add("hidden");
  document.getElementById("view-loading").classList.remove("hidden");
  document.getElementById("loading-msg").textContent = "Scoring your quiz…";
  try {
    const result = await api.post("/api/quiz/submit", {
      playerName,
      difficulty: level,
      quickMode,
      elapsedSeconds: elapsed,
      answers: state.answers,
    });
    document.getElementById("view-loading").classList.add("hidden");
    showResults(result, timedOut);
  } catch (e) {
    showError("Couldn't submit: " + e.message);
  }
}

function showResults(r, timedOut) {
  document.getElementById("view-results").classList.remove("hidden");
  document.getElementById("r-pct").textContent = `${Math.round(r.percentage)}%`;
  document.getElementById("r-score").textContent = `${r.score} of ${r.max} points`;
  document.getElementById("r-time").textContent = `${fmtTime(r.elapsedSeconds)} elapsed`;
  let msg = "";
  if (timedOut) msg = "Time's up! Here's how you did before the buzzer:";
  else if (r.percentage === 100) msg = "Perfect score!";
  else if (r.percentage >= 90)   msg = "Great job!";
  else if (r.percentage >= 70)   msg = "Solid effort.";
  else if (r.percentage >= 50)   msg = "Keep practicing!";
  else                           msg = "Plenty of room to improve. Try again!";
  if (r.bonusCount > 0) msg += `  (You also faced ${r.bonusCount} surprise bonus question${r.bonusCount > 1 ? "s" : ""}.)`;
  document.getElementById("r-message").textContent = msg;

  const det = document.getElementById("r-details");
  det.innerHTML = "";
  r.details.forEach((d, idx) => {
    const wrap = document.createElement("div");
    const aRight = d.a.correct;
    const bRight = d.b ? d.b.correct : true;
    wrap.className = "detail " + (aRight && bRight ? "right" : "wrong");
    wrap.innerHTML = `
      <div class="d-prompt">${idx + 1}. ${escapeHtml(d.a.prompt)} ${d.isBonus ? '<span class="pill bonus">BONUS</span>' : ""}</div>
      <div class="d-line">Your answer: ${escapeHtml(d.a.submitted || "(blank)")} ${aRight ? "✓" : "✗"}</div>
      ${aRight ? "" : `<div class="d-line">Correct: ${escapeHtml(d.a.answer)}</div>`}
      ${d.b ? `
        <div class="d-prompt" style="margin-top:6px;">Part B: ${escapeHtml(d.b.prompt)}</div>
        <div class="d-line">Your answer: ${escapeHtml(d.b.submitted || "(blank)")} ${bRight ? "✓" : "✗"}</div>
        ${bRight ? "" : `<div class="d-line">Correct: ${escapeHtml(d.b.answer)}</div>`}
      ` : ""}
    `;
    det.appendChild(wrap);
  });
}

function showError(msg) {
  document.getElementById("view-loading").classList.add("hidden");
  document.getElementById("view-quiz").classList.add("hidden");
  document.getElementById("view-error").classList.remove("hidden");
  document.getElementById("error-message").textContent = msg;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }
