#!/usr/bin/env node
/*
 * SOKUGANの日次教材生成に、本人が保存した読後・設問評価だけを渡す。
 * 本文、タイトル、ユーザーID、認証情報は出力しない。
 */
const usage = `使い方:
  set -a; . .sokugan-private.env; set +a
  node tools/export-content-feedback-profile.js

オプション:
  --self-test   通信せず集計ロジックだけを検証する`;

const GENRES = ["スタートアップ・新規事業", "社会・価値観", "市場・経済・地政学", "経営・リーダーシップ", "未来の兆し"];
const QUESTION_FIT = new Set(["easy", "just_right", "hard", "unclear"]);
const MIN_SAMPLES = 3;

function fail(message) { console.error(`ERROR: ${message}\n\n${usage}`); process.exit(1); }
function avg(xs) { return xs.length ? +(xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(2) : null; }
function recentFeedback(rows) {
  return (Array.isArray(rows) ? rows : []).filter(x => x && GENRES.includes(x.genre) && Number.isInteger(x.rating) && x.rating >= 1 && x.rating <= 5)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 60);
}
function preferenceFor(scores) {
  if (scores.length < MIN_SAMPLES) return "insufficient";
  const score = avg(scores);
  if (score >= 4) return "prioritize";
  if (score <= 2.5) return "vary_angle";
  return "neutral";
}
function questionRecommendation(counts) {
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  if (total < MIN_SAMPLES) return "keep_standard";
  if (counts.unclear || counts.hard > counts.just_right) return "make_clearer";
  if (counts.easy > counts.just_right) return "increase_inference";
  return "keep_standard";
}
function buildProfile(rows) {
  const feedback = recentFeedback(rows);
  const genres = Object.fromEntries(GENRES.map(genre => {
    const scores = feedback.filter(x => x.genre === genre).map(x => x.rating);
    return [genre, { samples: scores.length, averageRating: avg(scores), instruction: preferenceFor(scores) }];
  }));
  const questionFit = { easy: 0, just_right: 0, hard: 0, unclear: 0 };
  feedback.forEach(x => { if (QUESTION_FIT.has(x.questionFit)) questionFit[x.questionFit]++; });
  return {
    schema: "sokugan-content-feedback-profile-v1",
    feedbackCount: feedback.length,
    minimumSamplesPerSignal: MIN_SAMPLES,
    genres,
    questionFit: Object.assign(questionFit, { instruction: questionRecommendation(questionFit) }),
    guardrails: [
      "ジャンルの本数配分とAI上限は変えない",
      "samplesが3未満のジャンル評価は選定を変えない",
      "本文、タイトル、ユーザーIDは出力しない"
    ]
  };
}
async function api(url, key, route) {
  const res = await fetch(url.replace(/\/+$/, "") + route, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
async function resolveUserId(url, key, configuredUserId) {
  if (configuredUserId) return configuredUserId;
  const result = await api(url, key, "/auth/v1/admin/users?per_page=50");
  const users = Array.isArray(result && result.users) ? result.users : [];
  if (users.length === 1 && users[0].id) return users[0].id;
  if (!users.length) fail("SOKUGANで一度メール認証してから、もう一度実行してください");
  fail("Authユーザーが複数いるため、SOKUGAN_USER_IDをPCローカル環境変数に設定してください");
}
async function main() {
  if (process.argv.includes("--self-test")) {
    const fixture = [
      { date: "2026-09-03", genre: GENRES[0], rating: 5, questionFit: "easy" },
      { date: "2026-09-02", genre: GENRES[0], rating: 4, questionFit: "easy" },
      { date: "2026-09-01", genre: GENRES[0], rating: 4, questionFit: "just_right" },
      { date: "2026-08-31", genre: GENRES[1], rating: 2 }
    ];
    const profile = buildProfile(fixture);
    if (profile.genres[GENRES[0]].instruction !== "prioritize" || profile.genres[GENRES[1]].instruction !== "insufficient" || profile.questionFit.instruction !== "increase_inference") throw new Error("self-test failed");
    console.log("OK: content-feedback profile self-test passed");
    return;
  }
  const cfg = { url: process.env.SOKUGAN_SUPABASE_URL, key: process.env.SOKUGAN_SUPABASE_SECRET_API_KEY || process.env.SOKUGAN_SUPABASE_SERVICE_ROLE_KEY, userId: process.env.SOKUGAN_USER_ID };
  if (!cfg.url || !cfg.key) fail("Supabaseの接続情報またはSecret API Keyが未設定です");
  const userId = await resolveUserId(cfg.url, cfg.key, cfg.userId);
  const rows = await api(cfg.url, cfg.key, `/rest/v1/sokugan_state?user_id=eq.${encodeURIComponent(userId)}&select=state`);
  const state = Array.isArray(rows) && rows[0] && rows[0].state ? rows[0].state : {};
  const profile = buildProfile(state.contentFeedback);
  profile.generatedAt = new Date().toISOString();
  console.log(JSON.stringify(profile, null, 2));
}

main().catch(e => fail(`評価プロファイルの取得に失敗しました: ${e.message}`));

module.exports = { buildProfile, recentFeedback };
