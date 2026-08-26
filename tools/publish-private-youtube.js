#!/usr/bin/env node
/*
 * SOKUGAN用に生成済みの非公開YouTube教材を、本人のSupabase学習状態へ追加する。
 * Secret API Key はPCローカルの環境変数だけで使い、GitHub PagesやGitには絶対に置かない。
 */
const fs = require("fs");
const path = require("path");

const usage = `使い方:
  SOKUGAN_SUPABASE_URL=... SOKUGAN_SUPABASE_SECRET_API_KEY=... SOKUGAN_USER_ID=... \\
    node tools/publish-private-youtube.js private-imports/sokugan-youtube-YYYYMMDD-VIDEOID.json

必要な環境変数:
  SOKUGAN_SUPABASE_URL              Supabase Project URL
  SOKUGAN_SUPABASE_SECRET_API_KEY   Secret API Key（PCローカルのみ。Gitに保存しない）
  SOKUGAN_USER_ID                   SOKUGANにログインした本人のUUID（未指定時は唯一のAuthユーザーを使う）
`;

function fail(message) { console.error(`ERROR: ${message}\n\n${usage}`); process.exit(1); }
function charCount(s) { return String(s || "").replace(/\s/g, "").length; }
function validPassage(p) {
  return p && p.id && p.title && charCount(p.text) >= 400 && charCount(p.text) <= 700 &&
    Array.isArray(p.questions) && p.questions.length === 3 && p.questions.every(q =>
      q.q && Array.isArray(q.opts) && q.opts.length === 4 && Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4 && q.rationale);
}
function videoIdFromUrl(source) {
  const s = String(source || "");
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : "";
}
function sameVideo(existing, incoming) {
  if (!existing || !incoming) return false;
  if (existing.id === incoming.id) return true;
  const vid = incoming.videoId || videoIdFromUrl(incoming.source);
  return !!vid && (videoIdFromUrl(existing.source) === vid || String(existing.id || "").includes(vid));
}
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function readLesson(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`教材JSONを読めません: ${e.message}`); }
  if (!data || data.schema !== "sokugan-private-youtube-v2" || !Array.isArray(data.passages) || data.passages.length !== 1) {
    fail("新形式のSOKUGAN用YouTube教材ではありません。1動画につきpassagesを1本だけ、schema=sokugan-private-youtube-v2で作成してください");
  }
  const videoId = data.videoId || videoIdFromUrl(data.source);
  if (!videoId || !/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=|^https:\/\/youtu\.be\//.test(String(data.source || ""))) fail("YouTube URLまたは動画IDがありません");
  if (!data.sourceTitle || !data.coreConcept || !data.selectionRationale) fail("sourceTitle、coreConcept、selectionRationaleが必要です");
  if (!validPassage(data.passages[0])) fail("本文400〜700字、3問×4択・自然な設問の教材形式を満たしていません");
  const p = data.passages[0];
  return [Object.assign({}, p, {
    id: `youtube-${videoId}`, kind: "youtube", videoId, source: data.source,
    sourceTitle: data.sourceTitle, coreConcept: data.coreConcept,
    selectionRationale: data.selectionRationale, availableOn: p.availableOn || data.availableOn
  })];
}
async function api(url, key, route, opts) {
  const o = opts || {};
  const res = await fetch(url.replace(/\/+$/, "") + route, Object.assign({}, o, {
    headers: Object.assign({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, o.headers || {})
  }));
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
async function resolveUserId(url, key, configuredUserId) {
  if (configuredUserId) return configuredUserId;
  const result = await api(url, key, "/auth/v1/admin/users?per_page=50", { method: "GET" });
  const users = Array.isArray(result && result.users) ? result.users : [];
  if (users.length === 1 && users[0].id) return users[0].id;
  if (!users.length) fail("SOKUGANで一度メール認証してから、もう一度実行してください");
  fail("Authユーザーが複数いるため、SOKUGAN_USER_IDをPCローカル環境変数に設定してください");
}
async function publish(passages, cfg) {
  const id = encodeURIComponent(cfg.userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await api(cfg.url, cfg.key, `/rest/v1/sokugan_state?user_id=eq.${id}&select=state,rev`, { method: "GET" });
    const row = Array.isArray(rows) ? rows[0] : null;
    const current = (row && row.state) || {};
    const existing = Array.isArray(current.personalLibrary) ? current.personalLibrary : [];
    const handled = new Set();
    let added = 0, updated = 0, removed = 0;
    const next = [];
    for (const oldPassage of existing) {
      const incoming = passages.find(p => sameVideo(oldPassage, p));
      if (!incoming) { next.push(oldPassage); continue; }
      const key = incoming.videoId || incoming.id;
      if (handled.has(key)) { removed++; continue; }
      handled.add(key);
      if (sameJson(oldPassage, incoming)) next.push(oldPassage);
      else {
        next.push(incoming);
        if (oldPassage.id === incoming.id) updated++;
        else { added++; removed++; }
      }
    }
    for (const incoming of passages) {
      const key = incoming.videoId || incoming.id;
      if (!handled.has(key)) { next.push(incoming); handled.add(key); added++; }
    }
    if (!added && !updated && !removed) return { added: 0, updated: 0, removed: 0, total: existing.length };
    const state = Object.assign({}, current, { personalLibrary: next.slice(-120), updatedAt: new Date().toISOString() });
    if (!row) {
      await api(cfg.url, cfg.key, "/rest/v1/sokugan_state", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: cfg.userId, state, rev: 1, device_id: "youtube-importer" }) });
      return { added, updated, removed, total: state.personalLibrary.length };
    }
    const saved = await api(cfg.url, cfg.key, `/rest/v1/sokugan_state?user_id=eq.${id}&rev=eq.${encodeURIComponent(row.rev)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state, rev: Number(row.rev) + 1, device_id: "youtube-importer" }) });
    if (Array.isArray(saved) && saved.length) return { added, updated, removed, total: state.personalLibrary.length };
  }
  throw new Error("他端末との更新競合が続いたため、3回試して保存できませんでした");
}

if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(usage); process.exit(0); }
const file = process.argv[2];
if (!file) fail("教材JSONのパスがありません");
const cfg = { url: process.env.SOKUGAN_SUPABASE_URL, key: process.env.SOKUGAN_SUPABASE_SECRET_API_KEY || process.env.SOKUGAN_SUPABASE_SERVICE_ROLE_KEY, userId: process.env.SOKUGAN_USER_ID };
if (!cfg.url || !cfg.key) fail("Supabaseの接続情報またはSecret API Keyが未設定です");
const passages = readLesson(path.resolve(file));
resolveUserId(cfg.url, cfg.key, cfg.userId)
  .then(userId => publish(passages, Object.assign(cfg, { userId })))
  .then(r => console.log(`OK: 1動画1教材で登録しました（追加${r.added}、更新${r.updated}、旧教材整理${r.removed}、ライブラリ合計${r.total}本）。スマホでSOKUGANを開くと自動同期します。`))
  .catch(e => fail(`自動登録に失敗しました: ${e.message}`));
