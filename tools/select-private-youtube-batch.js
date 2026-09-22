#!/usr/bin/env node
/*
 * 非公開YouTube教材バッチの候補を、取得順に最大N件だけ選ぶ。
 *
 * このスクリプトは教材本文を作らず、登録済みIDの照合と当日分の取り置きだけを行う。
 * 当日分の取り置きをファイルに残すことで、同じ時刻に二つの実行が重なっても、
 * 一方が次の3本を先取りしないようにする。取り置きは日付単位なので、失敗した候補は翌日に再試行できる。
 */
const fs = require("fs");
const path = require("path");

const TRANSCRIPT_DIR = "/Users/wota/Documents/ChatGPT/Creative/youtube-transcripts";
const IMPORT_DIR = "/Users/wota/Documents/ChatGPT/AI Engineering/sokugan-work/private-imports";
const STATE_FILE = path.join(IMPORT_DIR, ".sokugan-youtube-batch-state.json");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function videoIdFromText(value) {
  const s = String(value || "");
  const direct = s.match(/(?:動画ID|videoId)\s*[:：]\s*`?([A-Za-z0-9_-]{6,})/i);
  if (direct) return direct[1];
  const watch = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
  if (watch) return watch[1];
  const shorts = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i);
  if (shorts) return shorts[1];
  const shortUrl = s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  return shortUrl ? shortUrl[1] : "";
}

function firstMatch(text, pattern) {
  const m = String(text || "").match(pattern);
  return m ? String(m[1]).trim() : "";
}

function parsedTime(value, fallbackMs) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : fallbackMs;
}

function readMarkdown(file) {
  const text = fs.readFileSync(file, "utf8");
  const stat = fs.statSync(file);
  const videoId = videoIdFromText(text);
  if (!videoId) return null;
  const source = firstMatch(text, /(?:動画URL|source)\s*[:：]\s*<?([^>\s]+)>?/i);
  const title = firstMatch(text, /^#\s+(.+)$/m);
  const capturedAt = firstMatch(text, /(?:取得日時|capturedAt)\s*[:：]\s*([^\n]+)/i);
  return {
    videoId,
    transcriptPath: file,
    existingJsonPath: "",
    source: source || `https://www.youtube.com/watch?v=${videoId}`,
    sourceTitle: title,
    orderAt: parsedTime(capturedAt, stat.mtimeMs),
    capturedAt: capturedAt || new Date(stat.mtimeMs).toISOString(),
    origin: "markdown"
  };
}

function readExistingJson(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
  if (!data || data.schema !== "sokugan-private-youtube-v2") return null;
  const videoId = String(data.videoId || videoIdFromText(data.source));
  if (!videoId) return null;
  const stat = fs.statSync(file);
  return {
    videoId,
    transcriptPath: "",
    existingJsonPath: file,
    source: data.source || `https://www.youtube.com/watch?v=${videoId}`,
    sourceTitle: data.sourceTitle || "",
    orderAt: parsedTime(data.capturedAt || data.createdAt, stat.mtimeMs),
    capturedAt: data.capturedAt || data.createdAt || new Date(stat.mtimeMs).toISOString(),
    origin: "json"
  };
}

function collectCandidates() {
  const byId = new Map();
  if (fs.existsSync(TRANSCRIPT_DIR)) {
    for (const name of fs.readdirSync(TRANSCRIPT_DIR).filter(n => n.endsWith(".md"))) {
      const file = path.join(TRANSCRIPT_DIR, name);
      const item = readMarkdown(file);
      if (!item) continue;
      byId.set(item.videoId, Object.assign(byId.get(item.videoId) || {}, item));
    }
  }
  if (fs.existsSync(IMPORT_DIR)) {
    for (const name of fs.readdirSync(IMPORT_DIR).filter(n => n.endsWith("-v2.json"))) {
      const file = path.join(IMPORT_DIR, name);
      const item = readExistingJson(file);
      if (!item) continue;
      const old = byId.get(item.videoId);
      byId.set(item.videoId, Object.assign({}, item, old || {}, {
        transcriptPath: (old && old.transcriptPath) || item.transcriptPath,
        existingJsonPath: item.existingJsonPath,
        source: (old && old.source) || item.source,
        sourceTitle: (old && old.sourceTitle) || item.sourceTitle,
        orderAt: old ? Math.min(old.orderAt, item.orderAt) : item.orderAt,
        capturedAt: old ? old.capturedAt : item.capturedAt,
        origin: old ? "markdown+json" : item.origin
      }));
    }
  }
  return [...byId.values()].sort((a, b) =>
    (a.orderAt - b.orderAt) || String(a.transcriptPath || a.existingJsonPath).localeCompare(String(b.transcriptPath || b.existingJsonPath)) || a.videoId.localeCompare(b.videoId));
}

function videoIdFromLibraryItem(item) {
  const id = String(item && item.id || "");
  const idMatch = id.match(/^youtube-(.+)$/);
  return String(item && (item.videoId || videoIdFromText(item.source) || (idMatch && idMatch[1]) || "")).trim();
}

async function api(url, key, route) {
  const res = await fetch(url.replace(/\/+$/, "") + route, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function resolveUserId(url, key, configured) {
  if (configured) return configured;
  const result = await api(url, key, "/auth/v1/admin/users?per_page=50");
  const users = Array.isArray(result && result.users) ? result.users : [];
  if (users.length === 1 && users[0].id) return users[0].id;
  if (!users.length) throw new Error("SOKUGANで一度メール認証してから実行してください");
  throw new Error("Authユーザーが複数あるため、SOKUGAN_USER_IDを設定してください");
}

async function registeredIds(url, key, userId) {
  const route = `/rest/v1/sokugan_state?user_id=eq.${encodeURIComponent(userId)}&select=state`;
  const rows = await api(url, key, route);
  const state = Array.isArray(rows) && rows[0] && rows[0].state ? rows[0].state : {};
  const library = Array.isArray(state.personalLibrary) ? state.personalLibrary : [];
  return new Set(library.map(videoIdFromLibraryItem).filter(Boolean));
}

function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return data && data.schema === "sokugan-youtube-batch-state-v1" && data.claims ? data : { schema: "sokugan-youtube-batch-state-v1", claims: {} };
  } catch (e) {
    return { schema: "sokugan-youtube-batch-state-v1", claims: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}

function selectBatch(candidates, registered, limit, date, claim, stateInput) {
  const state = stateInput || readState();
  const claimsToday = new Set(Array.isArray(state.claims[date]) ? state.claims[date] : []);
  const pending = candidates.filter(c => !registered.has(c.videoId));
  const selectable = pending.filter(c => !claimsToday.has(c.videoId));
  const dailySlots = Math.max(0, 3 - claimsToday.size);
  const selected = selectable.slice(0, Math.min(limit, dailySlots));
  if (claim && selected.length) {
    state.claims[date] = [...new Set([...claimsToday, ...selected.map(c => c.videoId)])];
    for (const oldDate of Object.keys(state.claims)) {
      if (oldDate < date) delete state.claims[oldDate];
    }
    writeState(state);
  }
  return { pending, selected, remaining: selectable.slice(selected.length), claimsToday: [...claimsToday] };
}

function publicCandidate(c) {
  return {
    videoId: c.videoId,
    transcriptPath: c.transcriptPath,
    existingJsonPath: c.existingJsonPath,
    source: c.source,
    sourceTitle: c.sourceTitle,
    capturedAt: c.capturedAt,
    orderAt: new Date(c.orderAt).toISOString()
  };
}

function selfTest() {
  const items = ["c", "a", "d", "b"].map((videoId, i) => ({ videoId, orderAt: i + 1, transcriptPath: `${videoId}.md`, existingJsonPath: "" }));
  const result = selectBatch(items, new Set(["c"]), 3, "2099-01-01", false);
  const ids = result.selected.map(x => x.videoId).join(",");
  if (ids !== "a,d,b" || result.pending.length !== 3 || result.remaining.length !== 0) fail(`self-test failed: selected=${ids}`);
  const capped = selectBatch(items, new Set(["c"]), 3, "2099-01-02", false, {
    schema: "sokugan-youtube-batch-state-v1",
    claims: { "2099-01-02": ["old-1", "old-2", "old-3"] }
  });
  if (capped.selected.length !== 0) fail(`self-test failed: daily cap=${capped.selected.length}`);
  console.log("SELF_TEST=PASS selected=a,d,b pending=3 daily-cap=3");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) fail("--limitは1〜3の整数で指定してください");
  const claim = process.argv.includes("--claim");
  const verifyArg = process.argv.indexOf("--verify");
  const verifyIds = verifyArg >= 0 ? String(process.argv[verifyArg + 1] || "").split(",").map(s => s.trim()).filter(Boolean) : [];
  const url = process.env.SOKUGAN_SUPABASE_URL;
  const key = process.env.SOKUGAN_SUPABASE_SECRET_API_KEY || process.env.SOKUGAN_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Supabaseの接続情報またはSecret API Keyが未設定です");
  const userId = await resolveUserId(url, key, process.env.SOKUGAN_USER_ID);
  const registered = await registeredIds(url, key, userId);
  const candidates = collectCandidates();
  const result = selectBatch(candidates, registered, limit, todayJst(), claim);
  console.log(JSON.stringify({
    schema: "sokugan-youtube-batch-v1",
    date: todayJst(),
    limit,
    candidateCount: candidates.length,
    registeredCount: registered.size,
    pendingCount: result.pending.length,
    selectedCount: result.selected.length,
    claimedTodayCount: result.claimsToday.length + (claim ? result.selected.length : 0),
    selected: result.selected.map(publicCandidate),
    remaining: result.remaining.map(publicCandidate),
    verification: verifyIds.map(videoId => ({ videoId, registered: registered.has(videoId) })),
    warnings: candidates.filter(c => !c.transcriptPath && !c.existingJsonPath).map(c => `${c.videoId}:入力ファイルなし`)
  }, null, 2));
}

main().catch(e => fail(e.message));
