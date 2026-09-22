#!/usr/bin/env node
/*
 * 変換ロジックの検査 ── 「自然な日本語」と「洞察が残っているか」を機械で落とす。
 *
 * 教材づくりで壊れるのは、だいたい次の2つのどちらかだった。
 *   1. 元の文章を要約しようとして、訳文のような日本語になる（読めるが頭に入らない）
 *   2. 事実だけを残して、なぜそう言えるのかが落ちる（読んでも何も持ち帰れない）
 * ここはその2つを、主観に踏み込まずに検出できる形だけ取り出したもの。
 *
 * 使い方:
 *   const { lintPassage } = require("./insight-lint.js");
 *   node qa/insight-lint.js <教材JSON> [<教材JSON> ...]
 */

// ---------- 自然な日本語 ----------
// 翻訳調の定型句。どれも「日本語で普通にこう言う」に直せる。
const TRANSLATIONESE = [
  ["することが重要", "何をするかを書く"],
  ["することが求められ", "誰が何をするかを書く"],
  ["という点が挙げられ", "そのまま言い切る"],
  ["点において", "「〜では」に直す"],
  ["に関して言えば", "「〜は」に直す"],
  ["を行うことで", "「〜すると」に直す"],
  ["と述べている", "言い切る（誰の考えかは前段で示す）"],
  ["と言っている", "言い切る"],
  ["としている", "言い切る"],
  ["話者", "名前で呼ぶ"],
  ["筆者は", "名前で呼ぶ"],
  ["に他ならない", "普通の断定に直す"],
  ["ものと考えられる", "言い切るか、根拠を書く"]
];
const ABSTRACT = /(性|化|的|論|観|構造|前提|要因|含意|傾向|概念|本質|文脈|機能|認識|範囲|主体|転換|秩序|単位|度合|最適化|可視化)/g;

function sentences(text) {
  return String(text || "").split(/(?<=[。？！])/).map(s => s.trim()).filter(Boolean);
}
function len(s) { return [...String(s || "")].length; }
function tail(s) { return String(s || "").replace(/[。？！]$/, "").slice(-3); }

function naturalJaIssues(text) {
  const issues = [];
  const ss = sentences(text);
  if (!ss.length) return ["本文が空"];

  for (const s of ss) {
    const L = len(s);
    if (L > 60) issues.push(`一文が長い(${L}字): ${s.slice(0, 18)}…`);
    if (L > 45 && !s.includes("、")) issues.push(`読点なしで${L}字: ${s.slice(0, 18)}…`);
    // 連体詞・形式名詞の「の」は数えない（そのもの・このほう などは連結ではない）
    const noChain = s.replace(/(その|この|あの|どの|もの|ため|のに|ので)/g, "＿");
    if (/の[^\s。、]{1,6}の[^\s。、]{1,6}の/.test(noChain)) issues.push(`『の』の多重連結: ${s.slice(0, 20)}…`);
    const abst = (s.match(ABSTRACT) || []).length;
    if (abst >= 5) issues.push(`抽象語が密(${abst}語): ${s.slice(0, 20)}…`);
  }
  const avg = ss.reduce((a, s) => a + len(s), 0) / ss.length;
  if (avg > 48) issues.push(`一文の平均が長い(${Math.round(avg)}字・目安40字前後)`);

  for (const [phrase, hint] of TRANSLATIONESE) {
    if (String(text).includes(phrase)) issues.push(`翻訳調「${phrase}」→ ${hint}`);
  }
  // 同じ文末が3つ続くと、内容に関係なく単調に聞こえる
  let run = 1;
  for (let i = 1; i < ss.length; i++) {
    if (tail(ss[i]) && tail(ss[i]) === tail(ss[i - 1])) { run++; } else { run = 1; }
    if (run >= 3) { issues.push(`同じ文末が3連続: …${tail(ss[i])}。`); break; }
  }
  return issues;
}

// ---------- 洞察が残っているか ----------
const CAUSE = /(なぜなら|だから|そのため|その結果|ために|からだ|からである|ので、|理由は|裏を返せば|つまり)/;
const CONCRETE = /(\d|「[^」]{2,}」|例えば|実際に|[ァ-ヴー]{3,})/;

function keywords(s) {
  const out = new Set();
  for (const m of String(s || "").match(/[一-龥]{2,}|[ァ-ヴー]{3,}|[A-Za-z]{3,}/g) || []) out.add(m);
  return [...out];
}
function coverage(claim, text) {
  const ks = keywords(claim);
  if (!ks.length) return 1;
  const hit = ks.filter(k => String(text || "").includes(k)).length;
  return hit / ks.length;
}

function insightIssues(p, brief) {
  const issues = [];
  const text = String(p.text || "");
  if (!p.author || !p.author.name || !p.author.role) issues.push("author（誰の考えか）が無い");
  if (!CAUSE.test(text)) issues.push("なぜそう言えるかの接続が無い（なぜなら/そのため/つまり など）");
  if (!CONCRETE.test(text)) issues.push("具体（数字・例・本人の言葉）が無い");
  const hook = (p.takeaway || {}).hook || "";
  if (len(hook) < 10 || len(hook) > 70) issues.push(`takeaway.hookが10-70字でない(${len(hook)})`);
  if (!/[うくぐすずつぬぶむるいだたね]$/.test(hook.replace(/[。！？]$/, "")))
    issues.push("takeaway.hookが言い切りで終わっていない（体言止め・助詞止めにしない）");

  if (brief) {
    const sp = (brief.speaker || {}).name || "";
    // 敬称・学位を落とし、いちばん長い語で照合する（Dr. Arthur Brooks → Brooks）
    const spShort = sp.replace(/\b(Dr|Prof|PhD|JD|MD)\.?\b/gi, " ").split(/[,、（(]/)[0].trim();
    const spParts = spShort.split(/\s+/).filter(x => [...x].length >= 2);
    const spHit = !spParts.length || spParts.some(x => text.includes(x) || String((p.author || {}).name || "").includes(x));
    if (spShort && !spHit)
      issues.push(`発信者（${spShort}）が本文にもauthorにも出てこない`);
    const cov = coverage(brief.claim, text);
    if (cov < 0.45) issues.push(`元の論点の要点が落ちている（被覆 ${Math.round(cov * 100)}%・45%以上）`);
    // 線を引いた箇所は複数ある。どれか1つが本文に残っていればよい。
    const hls = brief.highlights || [];
    if (hls.length && !hls.some(h => coverage(h, text) >= 0.4))
      issues.push(`本人が線を引いた箇所が1つも残っていない: ${hls[0].slice(0, 20)}`);
    const url = String(p.source || "") + String(p.sourceUrl || "");
    if (brief.videoUrl && !url.includes(brief.videoUrl.split("v=")[1] || brief.videoUrl))
      issues.push("出典が元動画を指していない");
  }
  return issues;
}

function lintPassage(p, opts) {
  const o = opts || {};
  const errors = [...naturalJaIssues(p.text), ...insightIssues(p, o.brief)];
  // 設問・タイトル・持ち帰りも同じ日本語の基準で見る
  for (const q of p.questions || []) {
    for (const bad of ["ことが重要", "という点", "と述べている", "話者"]) {
      if (String(q.q || "").includes(bad)) errors.push(`設問に翻訳調「${bad}」`);
      for (const opt of q.opts || []) if (String(opt).includes(bad)) errors.push(`選択肢に翻訳調「${bad}」`);
    }
  }
  return errors;
}

module.exports = { lintPassage, naturalJaIssues, insightIssues, coverage, sentences };

// ---------- 単体実行 ----------
if (require.main === module) {
  const fs = require("fs");
  const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
  if (!files.length) { console.error("使い方: node qa/insight-lint.js <教材JSON> [...]"); process.exit(2); }
  let bad = 0, n = 0;
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    const briefs = {};
    for (const b of (data.briefs || [])) briefs[b.id] = b;
    for (const p of (data.passages || [])) {
      n++;
      const brief = p.brief || briefs[p.id] || (data.brief && data.brief.id === p.id ? data.brief : null);
      const errs = lintPassage(p, { brief });
      if (errs.length) {
        bad++;
        console.log(`FAIL | ${p.id} | ${p.title}`);
        for (const e of errs) console.log(`     - ${e}`);
      } else {
        console.log(`PASS | ${p.id} | ${p.title}`);
      }
    }
  }
  console.log(`\n${n - bad}/${n} 本が合格`);
  process.exit(bad ? 1 : 0);
}
