import { json, errorJson, issueAdminToken, timingSafeEqual } from "../../_shared.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return errorJson("Invalid JSON", 400); }
  const pw = String(body?.password || "");
  const expected = String(env.ADMIN_PASSWORD || "");
  if (!expected) return errorJson("Server has no admin password configured", 500);
  if (!timingSafeEqual(pw, expected)) return errorJson("Wrong password", 401);
  const token = await issueAdminToken(env);
  return json({ token });
}
