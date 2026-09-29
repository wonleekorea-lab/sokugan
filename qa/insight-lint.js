#!/usr/bin/env node
/*
 * 変換ロジックの検査 ── 壊れた日本語と、浅い作りを機械で落とす。
 *
 * ここは下限であって、良い文章を作る装置ではない。
 * 2026-09-27に「必須項目」を減らした。「因果の接続を1つ以上」を required に
 * していたため、どの本文にも「なぜなら〜からだ」が1回だけ機械的に埋まり、
 * 検査を満たすための作文になっていた。**埋めさせる規則は形式主義を生む。**
 * いまは原則として禁止（落とす）側に寄せ、required は最小限に留める。
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
// 速読の教材なので、記号で圧縮した箇条書き的な書き方を本文に持ち込まない。
// 「背景→感情の上下×実演」のような行は、目で追う訓練にならない。
// 数の範囲の「〜」は普通の日本語なので落とさない（500〜600語/分）。
const SYMBOLS = /[→⇒←↔⇔×＝≒]/;
// 指示・勧誘で締めると、読み手が考える場所が消える。
const IMPERATIVE = /(しよう|しましょう|するとよい|すべきだ|心がけ|を意識する|を心がける|してみよう)/;

function sentences(text) {
  return String(text || "").split(/(?<=[。？！])/).map(s => s.trim()).filter(Boolean);
}
function paragraphs(text) {
  return String(text || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}
// 「誰々が〜を調べた」で始めると、最初の一文が中身ではなく手続きの説明になる。
// 読み手はそこで一度降りる。事実か場面から入る。
// 「Xは、Yを調べた」の形だけを落とす。場面の描写（「教授が何かと聞いた」）は残す。
const META_OPENER = /^[^。]{2,24}は、[^。]{0,40}(調べた|調べている|尋ねた|扱う|扱っている|論じる|論じている|説明する|問い直す)。/;
function len(s) { return [...String(s || "")].length; }
function tail(s) { return String(s || "").replace(/[。？！]$/, "").slice(-3); }

function naturalJaIssues(text) {
  const issues = [];
  const ss = sentences(text);
  if (!ss.length) return ["本文が空"];

  // 文の長さが揃うと、内容に関係なく単調に聞こえて頭に入らない。
  // 読める文章には必ず短い文が混ざる。実測でも、読みづらい教材は短文がゼロだった。
  if (ss.length >= 6 && !ss.some(s => len(s) <= 16))
    issues.push("短い文が1つも無い（全部が同じ長さに見える）");
  if (ss.length && META_OPENER.test(ss[0]))
    issues.push(`冒頭が手続きの説明になっている: ${ss[0].slice(0, 24)}`);
  for (const s of ss) {
    const L = len(s);
    if (L > 52) issues.push(`一文が長い(${L}字): ${s.slice(0, 18)}…`);
    if (L > 45 && !s.includes("、")) issues.push(`読点なしで${L}字: ${s.slice(0, 18)}…`);
    // 連体詞・形式名詞の「の」は数えない（そのもの・このほう などは連結ではない）
    const noChain = s.replace(/(その|この|あの|どの|もの|ため|のに|ので)/g, "＿");
    if (/の[^\s。、]{1,6}の[^\s。、]{1,6}の/.test(noChain)) issues.push(`『の』の多重連結: ${s.slice(0, 20)}…`);
    const abst = (s.match(ABSTRACT) || []).length;
    if (abst >= 5) issues.push(`抽象語が密(${abst}語): ${s.slice(0, 20)}…`);
    if (SYMBOLS.test(s)) issues.push(`記号で圧縮している: ${s.slice(0, 22)}…`);
    // 述語が無い短い断片（引用の切れ端がそのまま地の文に落ちた形）
    if (len(s) <= 8 && !/[うくぐすずつぬぶむるいだたねかよ][。！？]$/.test(s)) issues.push(`文になっていない断片: ${s}`);
  }
  const avg = ss.reduce((a, s) => a + len(s), 0) / ss.length;
  if (avg > 44) issues.push(`一文の平均が長い(${Math.round(avg)}字・目安38字前後）`);
  // 接続詞の機械的な反復。同じ語で論理をつなぐと、読み手は接続を読まなくなる。
  for (const w of ["なぜなら", "だから", "そのため", "つまり", "しかし"]) {
    const n = (String(text).match(new RegExp(w, "g")) || []).length;
    if (n >= 3) issues.push(`接続詞「${w}」が${n}回。文の並びで示す`);
  }
  // 名詞化の多用。「〜ということ」「〜する作業」は、動詞で書けば短くなる。
  const nominal = (String(text).match(/(ということ|というもの|ということが|する作業|する行為)/g) || []).length;
  if (nominal >= 3) issues.push(`名詞化が多い(${nominal})。動詞で書く`);
  // 閉じていない引用は、読点の位置が分からなくなる
  const kagi = (String(text).match(/「/g) || []).length, kagiEnd = (String(text).match(/」/g) || []).length;
  if (kagi !== kagiEnd) issues.push(`かぎ括弧が閉じていない（「${kagi} / 」${kagiEnd}）`);
  if (kagi >= 3) issues.push(`引用が${kagi}箇所。地の文で言い直すか、1つに絞る`);

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

// 被覆は「論の中身が残ったか」を見る。人名の綴りは見ない。
// 本文では人名をカタカナに直す規則があるため、ラテン文字の語で照合すると必ず外れる。
function keywords(s) {
  const out = new Set();
  for (const m of String(s || "").match(/[一-龥]{2,}|[ァ-ヴー]{3,}/g) || []) out.add(m);
  return [...out];
}
function coverage(claim, text) {
  const ks = keywords(claim);
  if (!ks.length) return 1;
  const hit = ks.filter(k => String(text || "").includes(k)).length;
  return hit / ks.length;
}

// 期待を裏切る形。これが無い文章は「知っていることの確認」で終わる。
// 語をひとつに固定すると型になるので、広めに取って「どれも無い」だけを落とす。
const REVERSAL = /(ではない|ではなく|に見えて|実は|逆に|裏を返せば|ところが|ように思えるが|と思われがちだ|どころか|むしろ|それでも|にもかかわらず)/;

// タイトルの語が本文に出てこないと、読み終えても見出しと中身がつながらない。
function titleIssues(p) {
  const issues = [];
  const text = String(p.text || "");
  const ks = [...new Set([...(String(p.title || "").match(/[一-龥]{2,}|[ァ-ヴー]{3,}|\d+/g) || [])])];
  if (ks.length >= 2) {
    const hit = ks.filter(k => text.includes(k)).length / ks.length;
    if (hit < 0.5) issues.push(`タイトルの語が本文に出てこない（${Math.round(hit * 100)}%）`);
  }
  return issues;
}
// 構成を先に決めて JSON に残す。書いたあとで辻褄を合わせると、必ず要約になる。
function outlineIssues(p) {
  const issues = [];
  const ol = p.outline;
  const ps = paragraphs(p.text);
  if (!Array.isArray(ol) || ol.length < 3 || ol.length > 4) {
    issues.push(`outline（構成の骨）が3〜4行でない: ${Array.isArray(ol) ? ol.length : "なし"}`);
    return issues;
  }
  for (const line of ol) {
    const L = len(line);
    if (L < 12 || L > 44) issues.push(`outlineの行が12-44字でない(${L}): ${String(line).slice(0, 18)}`);
  }
  if (ps.length !== ol.length) issues.push(`段落数(${ps.length})とoutlineの行数(${ol.length})が違う`);
  else {
    // 骨と中身が対応しているか。書いた順に並んでいなければ、構成が守られていない。
    ol.forEach((line, i) => {
      const ks = keywords(line);
      if (!ks.length) return;
      const hit = ks.filter(k => ps[i].includes(k)).length / ks.length;
      if (hit < 0.34) issues.push(`第${i + 1}段落がoutlineと対応していない（${Math.round(hit * 100)}%）: ${String(line).slice(0, 16)}`);
    });
  }
  for (const [i, para] of ps.entries()) {
    const L = len(para.replace(/\s/g, ""));
    if (L < 90 || L > 280) issues.push(`第${i + 1}段落が90-280字でない(${L})`);
  }
  return issues;
}
function insightIssues(p, brief) {
  const issues = [];
  const text = String(p.text || "");
  if (!p.author || !p.author.name || !p.author.role) issues.push("author（誰の考えか）が無い");
  if (!CONCRETE.test(text)) issues.push("具体（数字・例・本人の言葉）が無い");
  const hook = (p.takeaway || {}).hook || "";
  if (len(hook) < 10 || len(hook) > 70) issues.push(`takeaway.hookが10-70字でない(${len(hook)})`);
  if (IMPERATIVE.test(hook)) issues.push("takeaway.hookが指示・勧誘になっている（読み手が考える場所を残す）");
  if (!/[うくぐすずつぬぶむるいだたねかよ]$/.test(hook.replace(/[。！？]$/, "")))
    issues.push("takeaway.hookが言い切りか問いで終わっていない（体言止め・助詞止めにしない）");

  if (brief) {
    // 復習教材だけに課す。日次のビッグイシューは事実の伝達が主で、型が違う。
    if (!REVERSAL.test(text))
      issues.push("読み手の予想を裏切る点が無い（知っていることの確認で終わっている）");
    if (IMPERATIVE.test(text))
      issues.push("本文が指示・勧誘になっている（ハウツーの要約ではなく、考えの筋を書く）");
    const sp = (brief.speaker || {}).name || "";
    // 敬称・学位を落とし、いちばん長い語で照合する（Dr. Arthur Brooks → Brooks）
    const spShort = sp.replace(/\b(Dr|Prof|PhD|JD|MD)\.?\b/gi, " ").split(/[,、（(]/)[0].trim();
    const spParts = spShort.split(/\s+/).filter(x => [...x].length >= 2);
    const spHit = !spParts.length || spParts.some(x => text.includes(x) || String((p.author || {}).name || "").includes(x));
    if (spShort && !spHit)
      issues.push(`発信者（${spShort}）が本文にもauthorにも出てこない`);
    // 見出しが短いと語が1つ2つしか取れず、測っても意味がない。
    // その場合は節の本文でよく出る語を物差しにして、話題から外れていないかだけ見る。
    let yard = brief.claim, covKind = "論点";
    if (keywords(brief.claim).length < 3 && !brief.body) {
      // 見出しが「Sungの出発点も同じ」のように短く、節の本文も転記されていない。
      // 物差しが無いので測らない。測れないものを落とすと、書き手が見出しの語を
      // 本文へ無理に押し込むようになる。
      yard = null;
    } else if (keywords(brief.claim).length < 3 && brief.body) {
      const freq = {};
      for (const w of String(brief.body).match(/[一-龥]{2,}|[ァ-ヴー]{3,}/g) || []) freq[w] = (freq[w] || 0) + 1;
      yard = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]).join(" ");
      covKind = "節の話題";
    }
    if (yard) {
      const cov = coverage(yard, text);
      if (cov < 0.45) issues.push(`${covKind}から離れている（被覆 ${Math.round(cov * 100)}%・45%以上）`);
    }
    // ハイライトは本人の読書メモであって、教材に載せるべき中身ではない。
    // 2026-09-27に必須をやめた。選定の signal としては引き続き使う。
    const url = String(p.source || "") + String(p.sourceUrl || "");
    if (brief.videoUrl && !url.includes(brief.videoUrl.split("v=")[1] || brief.videoUrl))
      issues.push("出典が元動画を指していない");
  }
  return issues;
}

function lintPassage(p, opts) {
  const o = opts || {};
  const errors = [...naturalJaIssues(p.text), ...titleIssues(p), ...outlineIssues(p), ...insightIssues(p, o.brief)];
  // 設問・タイトル・持ち帰りも同じ日本語の基準で見る
  for (const q of p.questions || []) {
    for (const bad of ["ことが重要", "という点", "と述べている", "話者"]) {
      if (String(q.q || "").includes(bad)) errors.push(`設問に翻訳調「${bad}」`);
      for (const opt of q.opts || []) if (String(opt).includes(bad)) errors.push(`選択肢に翻訳調「${bad}」`);
    }
  }
  return errors;
}

module.exports = { lintPassage, naturalJaIssues, insightIssues, titleIssues, outlineIssues, coverage, sentences, paragraphs };

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
