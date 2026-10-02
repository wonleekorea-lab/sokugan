#!/usr/bin/env node
/*
 * 「公開できたか」ではなく「本人のアプリに並ぶか」を確かめる。
 *
 * 夜間の生成は、QA合格・push成功・Pages更新まで確認して完了と報告していた。
 * それでも2026-10-02に、届いた復習3本が当日のうちに一覧から消えていた。
 * 公開は成功していて、アプリ側の既読判定で落ちていたからだ。
 * 公開の成否と、本人の画面に出るかは別の問いなので、ここで後者だけを見る。
 *
 * 実アプリのコードをそのまま読み込み、本人のクラウド状態を入れて数える。
 * 判定ロジックを書き写さない（写すと必ずアプリ側とずれる）。
 *
 * 使い方:
 *   set -a; . .sokugan-private.env; set +a
 *   node tools/health-check.js [--json]
 * 終了コード: 0=正常 / 1=本人の画面に出ない問題がある
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const PAGES = "https://wonleekorea-lab.github.io/sokugan/daily-content.json";

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---------- 実アプリを読み込む（harness と同じ手口） ----------
function loadApp(daily) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const js = html.split("<script>")[1].split("</script>")[0];
  const els = new Map();
  const makeEl = (id) => {
    const e = { id, _h: "", style: {}, textContent: "", disabled: false, className: "",
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {}, appendChild() {}, remove() {} };
    Object.defineProperty(e, "innerHTML", { get() { return this._h; }, set(v) { this._h = String(v); } });
    return e;
  };
  global.document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: () => makeEl(""), body: { appendChild() {} }
  };
  global.window = { scrollTo() {}, _quizAnswers: [] };
  const store = {};
  global.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => store[k] = v, removeItem: (k) => delete store[k] };
  global.sessionStorage = { getItem: () => "1", setItem() {} };
  global.confirm = () => true;
  global.fetch = async (url) => String(url).includes("daily-content")
    ? { ok: true, json: async () => JSON.parse(JSON.stringify(daily)) } : { ok: false };
  const _st = global.setTimeout;
  global.setTimeout = (f, d) => _st(f, Math.min(d || 0, 5));
  global.setInterval = (f, d) => _st(f, 5);
  eval(js + "\nglobal.__app = { get state(){return state}, set state(v){state=v}, get content(){return content}," +
    " unseenPassages, unseenStock, isReviewPassage, isPassageSeen, isStaleReview, personalPassages, defaultState };");
  return new Promise((r) => _st(() => r(global.__app), 120));
}

async function remoteState() {
  const url = (process.env.SOKUGAN_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SOKUGAN_SUPABASE_SECRET_API_KEY || process.env.SOKUGAN_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const rows = await fetch(url + "/rest/v1/sokugan_state?select=state,rev", { headers: { apikey: key, Authorization: "Bearer " + key } }).then(r => r.json());
  const row = Array.isArray(rows) ? rows.find(x => x && x.state && (x.state.personalLibrary || []).length) : null;
  return row ? row.state : null;
}

(async () => {
  const today = todayJst();
  const issues = [], notes = [];
  const daily = JSON.parse(fs.readFileSync(path.join(ROOT, "daily-content.json"), "utf8"));

  // 1. 公開物が古くないか
  if (daily.date < today) issues.push(`daily-content.json が古い（${daily.date} < ${today}）`);
  try {
    const pub = await fetch(PAGES, { cache: "no-store" }).then(r => r.json());
    if (pub.date !== daily.date) issues.push(`公開JSONがローカルと違う（公開 ${pub.date} / 手元 ${daily.date}）`);
    else notes.push(`公開JSON ${pub.date}・${(pub.passages || []).length}本`);
  } catch (e) { issues.push(`公開JSONを取得できない: ${e.message}`); }

  // 2. 本人の画面に何本並ぶか（ここが本題）
  const state = await remoteState();
  if (!state) {
    notes.push("Supabaseの接続情報が無いので、本人の在庫は見ていない");
  } else {
    const A = await loadApp(daily);
    A.state = Object.assign(A.defaultState(), {
      personalLibrary: state.personalLibrary || [],
      seenPassageKeys: state.seenPassageKeys || [],
      shownOn: state.shownOn || {}
    });
    const visible = A.unseenPassages();
    const reviews = visible.filter(p => A.isReviewPassage(p));
    const stock = A.unseenStock();
    notes.push(`一覧 ${visible.length}本（論点${visible.length - reviews.length}・復習${reviews.length}）／控え ${Math.max(0, stock.length - visible.length)}本`);
    if (visible.length < 5) issues.push(`一覧が5枠を埋めていない（${visible.length}本）`);
    if (reviews.length < 1) issues.push("復習が1本も並んでいない");

    // 今日届いた復習が、その日のうちに消えていないか
    const arrived = (state.personalLibrary || []).filter(p => (p.availableOn || "") === today);
    const swallowed = arrived.filter(p => A.isPassageSeen(p));
    if (arrived.length && swallowed.length === arrived.length)
      issues.push(`今日届いた復習${arrived.length}本が全部すでに既読扱い（${swallowed[0].id}）`);
    else if (arrived.length) notes.push(`今日届いた復習 ${arrived.length}本（うち既読扱い ${swallowed.length}本）`);
    else notes.push("今日届いた復習は0本");

    // 明日の朝7時に何が出るか。ここが空なら、明日の朝は入れ替わらない。
    // toISOString はUTCに戻すので、JSTの日付を足すときに1日ずれる。
    // 日本時間で数え直す（ここを間違えて「明日の分」を今日の分で数えていた）。
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.parse(today + "T12:00:00+09:00") + 86400000));
    const nextIssues = (daily.passages || []).filter(p => p.addedOn === tomorrow).length;
    const nextReviews = (state.personalLibrary || []).filter(p => (p.availableOn || "") === tomorrow).length;
    if (nextIssues < 2) issues.push(`明日(${tomorrow})の論点が仕込まれていない（${nextIssues}本）`);
    if (nextReviews < 1) issues.push(`明日(${tomorrow})の復習が仕込まれていない（${nextReviews}本）`);
    if (nextIssues >= 2 && nextReviews >= 1) notes.push(`明日7時に出る分 論点${nextIssues}・復習${nextReviews}`);
  }

  const out = { date: today, ok: issues.length === 0, issues, notes };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else {
    for (const n of notes) console.log("  " + n);
    for (const i of issues) console.log("NG " + i);
    console.log(issues.length ? `\n不具合 ${issues.length}件` : "\n本人の画面に出る状態になっている");
  }
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.error("health-check が失敗: " + e.message); process.exit(1); });
