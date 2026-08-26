#!/usr/bin/env node
/*
 * SOKUGAN用に生成済みの非公開YouTube教材を、本人のSupabase学習状態へ追加する。
 * service_role key はPCの環境変数だけで使い、GitHub PagesやGitには絶対に置かない。
 */
const fs = require("fs");
const path = require("path");

const usage = `使い方:
  SOKUGAN_SUPABASE_URL=... SOKUGAN_SUPABASE_SERVICE_ROLE_KEY=... SOKUGAN_USER_ID=... \\
    node tools/publish-private-youtube.js private-imports/sokugan-youtube-YYYYMMDD-VIDEOID.json

必要な環境変数:
  SOKUGAN_SUPABASE_URL              Supabase Project URL
  SOKUGAN_SUPABASE_SERVICE_ROLE_KEY service_role key（PCローカルのみ。Gitに保存しない）
  SOKUGAN_USER_ID                   SOKUGANにログインした本人のUUID
`;

function fail(message) { console.error(`ERROR: ${message}\n\n${usage}`); process.exit(1); }
function charCount(s) { return String(s || "").replace(/\s/g, "").length; }
function validPassage(p) {
  return p && p.id && p.title && charCount(p.text) >= 400 && charCount(p.text) <= 700 &&
    Array.isArray(p.questions) && p.questions.length === 3 && p.questions.every(q =>
      Array.isArray(q.opts) && q.opts.length === 4 && Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4 && q.rationale);
}
function readLesson(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`教材JSONを読めません: ${e.message}`); }
  if (!data || data.schema !== "sokugan-private-youtube-v1" || !Array.isArray(data.passages) || !data.passages.length) fail("SOKUGAN用の非公開YouTube教材JSONではありません");
  if (!data.passages.every(validPassage)) fail("本文400〜700字、3問×4択の教材形式を満たしていません");
  return data.passages.map(p => Object.assign({}, p, { kind: "youtube", availableOn: p.availableOn || data.availableOn }));
}
async function api(url, key, route, opts) {
  const o = opts || {};
  const res = await fetch(url.replace(/\/+$/, "") + route, Object.assign({}, o, {
    headers: Object.assign({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, o.headers || {})
  }));
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
async function publish(passages, cfg) {
  const id = encodeURIComponent(cfg.userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await api(cfg.url, cfg.key, `/rest/v1/sokugan_state?user_id=eq.${id}&select=state,rev`, { method: "GET" });
    const row = Array.isArray(rows) ? rows[0] : null;
    const current = (row && row.state) || {};
    const existing = Array.isArray(current.personalLibrary) ? current.personalLibrary : [];
    const known = new Set(existing.map(p => p && p.id));
    const added = passages.filter(p => !known.has(p.id));
    if (!added.length) return { added: 0, total: existing.length };
    const state = Object.assign({}, current, { personalLibrary: [...existing, ...added].slice(-120), updatedAt: new Date().toISOString() });
    if (!row) {
      await api(cfg.url, cfg.key, "/rest/v1/sokugan_state", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: cfg.userId, state, rev: 1, device_id: "youtube-importer" }) });
      return { added: added.length, total: state.personalLibrary.length };
    }
    const saved = await api(cfg.url, cfg.key, `/rest/v1/sokugan_state?user_id=eq.${id}&rev=eq.${encodeURIComponent(row.rev)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state, rev: Number(row.rev) + 1, device_id: "youtube-importer" }) });
    if (Array.isArray(saved) && saved.length) return { added: added.length, total: state.personalLibrary.length };
  }
  throw new Error("他端末との更新競合が続いたため、3回試して保存できませんでした");
}

if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(usage); process.exit(0); }
const file = process.argv[2];
if (!file) fail("教材JSONのパスがありません");
const cfg = { url: process.env.SOKUGAN_SUPABASE_URL, key: process.env.SOKUGAN_SUPABASE_SERVICE_ROLE_KEY, userId: process.env.SOKUGAN_USER_ID };
if (!cfg.url || !cfg.key || !cfg.userId) fail("Supabaseの接続情報または本人のuser_idが未設定です");
const passages = readLesson(path.resolve(file));
publish(passages, cfg).then(r => console.log(`OK: YouTube教材を${r.added}本追加しました（ライブラリ合計 ${r.total}本）。スマホでSOKUGANを開くと自動同期します。`)).catch(e => fail(`自動登録に失敗しました: ${e.message}`));
