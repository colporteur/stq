// Shared client-side helpers for STQ.
// Exported as window.stq.* and as ES module exports.

export const TOKEN_KEY = "stq.adminToken";
export const NAME_KEY  = "stq.playerName";

function adminAuthHeader() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: "Bearer " + t } : {};
}

export const api = {
  async get(path, { admin = false } = {}) {
    const r = await fetch(path, { headers: admin ? adminAuthHeader() : {} });
    return parseJson(r);
  },
  async post(path, body, { admin = false } = {}) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(admin ? adminAuthHeader() : {}) },
      body: JSON.stringify(body || {}),
    });
    return parseJson(r);
  },
  async put(path, body, { admin = true } = {}) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(admin ? adminAuthHeader() : {}) },
      body: JSON.stringify(body || {}),
    });
    return parseJson(r);
  },
  async del(path, { admin = true } = {}) {
    const r = await fetch(path, {
      method: "DELETE",
      headers: admin ? adminAuthHeader() : {},
    });
    return parseJson(r);
  },
};

async function parseJson(resp) {
  let data;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fmtTime(secs) {
  secs = Math.max(0, Math.round(secs));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function setPageActiveNav(linkId) {
  document.querySelectorAll("header.topbar nav a").forEach((a) => {
    a.classList.toggle("active", a.id === linkId);
  });
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Expose globally as well so plain <script> snippets can use them.
window.stq = { api, fmtTime, escapeHtml, setPageActiveNav, TOKEN_KEY, NAME_KEY };
