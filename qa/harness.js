#!/usr/bin/env node
// =============================================================
// Sokugan QA Harness — コンテンツ品質 + UI描画のE2E自動検査（依存ゼロ）
// 使い方:  node qa/harness.js [--write-report] [--note "..."]
// 終了コード: 0=全PASS / 1=FAILあり
// 検査対象: index.htmlの実JSコードを実行し、実daily-content.jsonで
//           ホーム→ペーサー→瞬間キャッチ→初読→設問→反復→結果 を通す
// =============================================================
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write-report');
const noteIdx = process.argv.indexOf('--note');
const NOTE = noteIdx > -1 ? (process.argv[noteIdx + 1] || "") : "";

const results = []; let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || "") });
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
}
function unesc(t) { return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
// ---- 設問明快さの機械リンター（客観フロア。egregiousな読みにくさを検出） ----
const LINT_ABSTRACT = /(性|化|的|論|観|構造|前提|要因|含意|傾向|概念|本質|文脈|機能|認識|範囲|主体|転換|差別|秩序|依存度|単位|度合)/g;
function charOverlap(a, b) {
  const sa = new Set([...a]), sb = new Set([...b]);
  let common = 0; for (const c of sa) if (sb.has(c)) common++;
  return common / Math.max(sa.size, sb.size, 1);
}
function clarityLint(q) {
  const issues = [];
  const stem = (q.q || "").split(": ").slice(1).join(": ") || (q.q || "");
  if ([...stem].length > 46) issues.push("設問文が長い(" + [...stem].length + ")");
  if (/(ない|なく|ぬ)[^。、]{0,8}(ない|なく|ぬわけ|ぬとは)/.test(stem) || /なくはない|なくもない|ないとは言えない/.test(stem)) issues.push("設問に二重否定");
  for (const o of (q.opts || [])) {
    const L = [...o].length;
    const noCount = (o.match(/の/g) || []).length;
    const abst = (o.match(LINT_ABSTRACT) || []).length;
    if (L > 34) issues.push("選択肢が長い(" + L + "): " + o.slice(0, 14));
    if (noCount >= 4) issues.push("『の』過多(" + noCount + "): " + o.slice(0, 14));
    if (abst >= 4) issues.push("抽象語過多(" + abst + "): " + o.slice(0, 14));
    if (/なくはない|なくもない|ないとは言えない/.test(o)) issues.push("選択肢に二重否定: " + o.slice(0, 14));
  }
  const opts = q.opts || [];
  for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++)
    if (charOverlap(opts[i], opts[j]) >= 0.85) issues.push("選択肢が酷似: " + opts[i].slice(0, 10) + "≈" + opts[j].slice(0, 10));
  return issues;
}

// ---------- ファイル読込 ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const daily = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily-content.json'), 'utf8'));
const js = html.split('<script>')[1].split('</script>')[0];

// ---------- DOMスタブ（要素は永続化しinnerHTMLを保持） ----------
const els = new Map();
function makeEl(id) {
  const e = { id, _h: "", style: {}, textContent: "", disabled: false, className: "", parentNode: null,
    classList: { add(){}, remove(){}, contains: () => false },
    scrollIntoView(){}, appendChild(){}, remove(){} };
  Object.defineProperty(e, 'innerHTML', { get() { return this._h; }, set(v) { this._h = String(v); } });
  return e;
}
global.document = {
  getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  createElement: () => makeEl(""),
  body: { appendChild(){} }
};
global.window = { scrollTo(){}, _quizAnswers: [] };
const store = {};
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] };
global.sessionStorage = { getItem: () => "1", setItem(){} };
global.confirm = () => true;
global.fetch = async (url) => {
  if (String(url).includes('daily-content')) return { ok: true, json: async () => JSON.parse(JSON.stringify(daily)) };
  return { ok: false };
};
const _st = global.setTimeout;
global.setTimeout = (f, d) => _st(f, Math.min(d || 0, 5));
const _si = global.setInterval;
global.setInterval = (f, d) => _si(f, Math.max(1, Math.min(d || 0, 5)));

// ---------- アプリ実コードを実行 ----------
eval(js + "\nglobal.__app = { get state(){return state}, get sess(){return sess}, get content(){return content}, DEFAULT_CONTENT, ANCHOR_POOL, chunkText, getChunks, validChunks, chunkPool, spanTrialSet, pickSessionPassages, startSession, renderShortIntro, renderShortResult, unseenPassages, passageKey, renderHome, contentStatus, renderFreshnessPanel, guardedStart, renderPacer, renderPacerQuiz, answerPacer, renderSpanIntro, answerSpan, finishSpan, renderRead, startReading, finishReading, renderQuiz, finishQuiz, renderReread, startReread, finishReread, renderResult, textStats, adjustSpeed, makeDeepCloze, answerDeepCloze, normalizeNumerals, parseKanjiNum, startAnchor, renderAnchorRead, startAnchorRead, finishAnchorRead, renderAnchorQuiz, answerAnchor, anchorDue, todayMenu, goalProgress, gazeSpan, sessionKeyTerms, passageTakeaway, finishVocab, proceedAfterCloze1, weakestSkill };");

(async () => {
  await new Promise(r => _st(r, 80)); // init完了待ち
  const A = global.__app;
  const screenEl = () => global.document.getElementById("screen")._h;

  // ========== A. コンテンツ品質検査 ==========
  const todayUTC = new Date().toISOString().slice(0, 10);
  check("A1 日付がstaleでない (date >= 実行日UTC)", daily.date >= todayUTC, `date=${daily.date}`);
  check("A2 パッセージ10本（複数セッション用）", (daily.passages || []).length === 10, `n=${(daily.passages || []).length}`);
  let ansDist = [0, 0, 0, 0];
  for (const p of daily.passages || []) {
    const id = p.genre || p.tag || p.id;
    check(`A3 [${id}] genreあり`, !!p.genre, p.genre);
    check(`A3b [${id}] 科学/論文ジャンルでない（ビジネス トップイシュー限定）`, !/科学|研究|論文|認知科学/.test(p.genre || ""), p.genre);
    const len = (p.text || "").replace(/\s/g, "").length;
    check(`A4 [${id}] 本文400-700字`, len >= 400 && len <= 700, `${len}字`);
    const qs = p.questions || [];
    check(`A5 [${id}] 設問3問・4択・ans域内・rationale付き`,
      qs.length === 3 && qs.every(q => Array.isArray(q.opts) && q.opts.length === 4 && q.ans >= 0 && q.ans <= 3 && (q.rationale || "").length >= 20),
      `${qs.length}問`);
    for (const q of qs) if (q.ans >= 0 && q.ans <= 3) ansDist[q.ans]++;
    // 単独最長=正解の禁止
    const longestIsAns = qs.filter(q => {
      const L = q.opts.map(o => o.length), mx = Math.max(...L);
      return L[q.ans] === mx && L.filter(l => l === mx).length === 1;
    }).length;
    check(`A6 [${id}] 単独最長=正解が0問`, longestIsAns === 0, `${longestIsAns}問`);
    // A6b: 設問明快さの機械リンター（長すぎ/の過多/抽象過多/二重否定/選択肢酷似）
    const lintIssues = qs.flatMap((q, qi) => clarityLint(q).map(x => `Q${qi + 1}:${x}`));
    check(`A6b [${id}] 設問明快さリンター（読みにくさフラグ0）`, lintIssues.length === 0, lintIssues.slice(0, 3).join(" / "));
    // チャンク品質（アプリが実際に使う getChunks の出力を検査）
    const ch = A.getChunks(p);
    const joined = ch.join("").replace(/\s/g, "");
    check(`A7 [${id}] チャンク連結=本文`, joined === (p.text || "").replace(/\s/g, ""));
    const lens = ch.map(c => c.length);
    const pct27 = lens.filter(l => l >= 2 && l <= 7).length / lens.length;
    check(`A8 [${id}] 2-8字チャンク率>=75%`, lens.filter(l => l >= 2 && l <= 8).length / lens.length >= 0.75, `2-8字 ${Math.round(lens.filter(l => l >= 2 && l <= 8).length / lens.length * 100)}% / 2-7字 ${Math.round(pct27 * 100)}%`);
    const headParticle = ch.filter(c => /^(?:は|が|を|に|へ|と|も|の|や|か|ね|よ|わ|ぞ)(?:$|[、。！？])/.test(c));
    check(`A9 [${id}] 行頭が格助詞のチャンクなし（語の途中で切れていない証）`, headParticle.length === 0, headParticle.slice(0, 3).join("/"));
    const headPunct = ch.filter(c => /^[、。」』）！？・]/.test(c));
    check(`A9b [${id}] 句読点始まりチャンクなし`, headPunct.length === 0, headPunct.slice(0, 3).join("/"));
    const loneParticle = ch.filter(c => /^[はがをにへとも]$/.test(c) || ["から", "まで", "より", "ので", "のに"].includes(c));
    check(`A9c [${id}] 助詞単独チャンクなし`, loneParticle.length === 0, loneParticle.join("/"));
    // 12字超は「分割不能な単一アトム(長いカタカナ語/英数)」のみ許容
    const isSingleAtom = c => /^[ァ-ヺーヽヾ]+$/.test(c) || /^[A-Za-zＡ-Ｚａ-ｚ0-9０-９.\-＆&％%]+の?$/.test(c) || /^[一-鿿々〆〇]+$/.test(c);
    const tooLong = ch.filter(c => c.length > 12 && !isSingleAtom(c)).length;
    check(`A10 [${id}] 12字超の複合チャンクなし（長い単一語のみ許容）`, tooLong === 0, `${tooLong}個`);
  }
  check("A11 ans分布の極端な偏りなし (各<=12)", ansDist.every(n => n <= 12), JSON.stringify(ansDist));

  // ---------- A4c. 漢数字の数量表記が残っていないか（正規化の回帰防止） ----------
  // 数字始まり・長さ2以上の漢数字連（六千三百/二千二十四 等）は算用数字へ正規化されるべき
  // 正規化対象と同じ集合（数字始まり or 十＋数字始まり、慣用句除く）を検出
  const KNUM_RE = /[〇一二三四五六七八九十百千][〇一二三四五六七八九十百千万億兆]+/g;
  const numIdiom = ["千万", "百千", "万万", "十二分", "十八番"];
  const numResidue = [];
  for (const p of (A.content.passages || [])) {
    const blob = [p.title, p.text, ...(p.questions || []).flatMap(q => [q.q, ...(q.opts || [])])].join(" ");
    const hits = (blob.match(KNUM_RE) || []).filter(x => x.length >= 2 && !numIdiom.includes(x) && A.parseKanjiNum(x) != null);
    if (hits.length) numResidue.push(`${p.genre}:${hits.slice(0, 2).join(",")}`);
  }
  check("A4c 漢数字の数量表記が残っていない（2024年/6,300等に正規化）", numResidue.length === 0, numResidue.join(" / "));

  // ---------- A14. テーマ多様性（AI記事に偏っていないか） ----------
  const AI_RE = /AI|人工知能|生成AI|ＡＩ|LLM|ChatGPT|GPT|エージェント|機械学習|ディープラーニング|大規模言語/;
  const aiCentric = (daily.passages || []).filter(p => {
    if (AI_RE.test(p.title || "")) return true;
    const hits = ((p.text || "").match(new RegExp(AI_RE.source, "g")) || []).length;
    return hits >= 4; // 本文でAI語が頻出＝AI中心
  });
  const genres = new Set((daily.passages || []).map(p => p.genre));
  check("A14 AI中心の記事は2本以下（テーマ多様性）", aiCentric.length <= 2, `AI中心 ${aiCentric.length}/10: ${aiCentric.map(p => p.genre).join(",")}`);
  check("A14b 非AIテーマが8本以上", (daily.passages || []).length - aiCentric.length >= 8, `非AI ${(daily.passages || []).length - aiCentric.length}本`);
  const genreCounts = [...genres].map(g => (daily.passages || []).filter(p => p.genre === g).length);
  check("A14c 5ジャンルを各2本", genres.size === 5 && genreCounts.every(n => n === 2), `${genres.size}種 / ${genreCounts.join(",")}`);
  // 実際に崩れた表現をfixture化。単語境界と意味の閉じ方の両方を固定する。
  const semanticFixtures = [
    ["新たな好奇心の対象が見つかる。", "新たな好奇心の対象が"],
    ["市場への影響を短い時間で見抜く。", "市場への影響を"],
    ["前に読んだ内容はもう一度表示されない。", "もう一度"],
    ["重要なニュースや発見を短い時間で読む。", "短い時間で"]
  ];
  check("A10b 意味単位fixture（修飾句・副詞を孤立/誤結合させない）",
    semanticFixtures.every(([s, expected]) => A.chunkText(s).includes(expected)),
    semanticFixtures.map(([s]) => A.chunkText(s).join("|")).join(" / "));

  // 瞬間キャッチ用プール
  const pool = A.chunkPool();
  const poolOK = [4, 5, 6, 7].every(lv => new Set(pool[lv] || []).size >= 4);
  check("A12 瞬間キャッチ語プール (4-7字で各4語以上)", poolOK,
    [4, 5, 6, 7].map(lv => lv + ":" + new Set(pool[lv] || []).size).join(" "));

  // ---------- A13. 内蔵フォールバック教材（JSON読込失敗時に表示）の健全性 ----------
  const DC = A.DEFAULT_CONTENT;
  check("A13 フォールバック教材が2本以上", (DC.passages || []).length >= 2, `${(DC.passages||[]).length}本`);
  for (const p of DC.passages || []) {
    const id = "fb:" + (p.genre || p.id);
    check(`A13a [${id}] 科学/論文ジャンルでない`, !/科学|研究|論文/.test(p.genre || ""), p.genre);
    check(`A13b [${id}] チャンク連結=本文`, A.getChunks(p).join("").replace(/\s/g, "") === (p.text || "").replace(/\s/g, ""));
    check(`A13c [${id}] 設問3問・4択・rationale付き`,
      (p.questions || []).length === 3 && p.questions.every(q => q.opts && q.opts.length === 4 && (q.rationale || "").length >= 20));
  }

  // ========== B. UI描画検査（実コードのE2E） ==========
  check("B1 コンテンツがJSONからロードされた", A.content && A.content.date === daily.date, A.content && A.content.date);
  A.renderHome();
  check("B2 ホーム: じっくり版・ショート版の開始ボタン描画", screenEl().includes("今日の目標") && screenEl().includes("じっくり版") && screenEl().includes("ショート版"));
  check("B3 ホーム: 成長カーブ描画", screenEl().includes("成長カーブ"));
  // 鮮度ゲート（開始前に最新かを確認できる仕組み）
  check("B3a ホーム: 鮮度ゲート＋更新確認ボタン描画", screenEl().includes("更新を確認") && /fresh (ok|stale|err)/.test(screenEl()));
  const fr = A.contentStatus();
  // 夕方実行では翌日分を先取り生成するため、アプリ設計上の正常状態 isAhead も許容する（isStaleのみNG）
  check("B3b 鮮度判定: 今日(isToday)または先取り翌日分(isAhead)と認識", fr.date !== daily.date ? true : (fr.isToday || fr.isAhead), `date=${fr.date} isToday=${fr.isToday} isAhead=${fr.isAhead}`);
  check("B3c 鮮度パネルに今日のタイトル一覧を表示", A.renderFreshnessPanel(fr).includes(daily.passages[0].title));
  check("B3e 鮮度パネルに設問明快さ点検の表示", A.renderFreshnessPanel(fr).includes("設問明快さ"));
  check("B3d guardedStart が定義されている", typeof A.guardedStart === "function");
  A.startSession();
  check("B4 セッション開始 (warmChunks生成)", A.sess && A.sess.warmChunks.length >= 20, A.sess && A.sess.warmChunks.length + "chunks");
  A.renderPacer();
  const spanTexts = [...screenEl().matchAll(/<span class="chunk" id="ck\d+">([\s\S]*?)<\/span>/g)].map(m => unesc(m[1]));
  check("B5 ペーサーUI: チャンクspan描画数一致", spanTexts.length === A.sess.warmChunks.length, `${spanTexts.length}/${A.sess.warmChunks.length}`);
  check("B6 ペーサーUI: span連結=原文（区切り破損なし）", spanTexts.join("") === A.sess.warm.text.replace(/\s/g, ""));
  A.renderPacerQuiz();
  check("B7 ペーサー確認問題の描画", screenEl().includes("ペース内で意味は取れたか"));
  A.answerPacer(A.sess.warmQ.ans);
  check("B8 ペーサー採点とステアケース動作", typeof A.state.pacerLevel === "number" && A.state.pacerLevel >= 200);
  A.renderSpanIntro();
  check("B9 瞬間キャッチ導入画面", screenEl().includes("瞬間キャッチ") && screenEl().includes("視幅"));
  const trial = A.spanTrialSet(A.state.spanLevel);
  const optsDistinct = trial && new Set(trial.opts).size === trial.opts.length;
  check("B10 瞬間キャッチ出題 (4-6択・正解整合・重複なし)",
    trial && trial.opts.length >= 4 && trial.opts.length <= 6 && trial.opts[trial.ans] === trial.target && optsDistinct,
    trial && `${trial.opts.length}択`);
  // 全レベルで妥当な出題が生成できるか（語プール枯渇しないか）
  let spanOK = true, spanDetail = [];
  for (let lv = 3; lv <= 9; lv++) {
    const t = A.spanTrialSet(lv);
    const ok = t && t.opts.length >= 4 && t.opts[t.ans] === t.target && new Set(t.opts).size === t.opts.length;
    if (!ok) spanOK = false;
    spanDetail.push(lv + ":" + (t ? t.opts.length + "択" : "null"));
  }
  check("B10b 視幅3-9字すべてで妥当な出題", spanOK, spanDetail.join(" "));
  A.sess.spanTrial = trial; A.answerSpan(0, 0, trial.ans);
  const trial2 = A.spanTrialSet(A.state.spanLevel);
  A.sess.spanTrial = trial2; A.answerSpan(1, 1, (trial2.ans + 1) % 4);
  check("B11 視幅ステアケース動作", typeof A.state.spanLevel === "number" && A.state.spanLevel >= 3 && A.state.spanLevel <= 9, `視幅${A.state.spanLevel}字`);
  A.finishSpan(1);
  // 語彙道場フェーズ（keyTermsがある日）を通過
  let vocabShown = screenEl().includes("語彙道場");
  check("B11b 語彙道場: keyTermsがある日は表示される", !((daily.passages||[]).some(p=>(p.keyTerms||[]).length>=2)) || vocabShown, vocabShown ? "表示" : "非表示");
  if (vocabShown) A.finishVocab(2, (A.sess.vocabTerms || []).length || 3);
  check("B12 本文①読書画面 (タイトル表示)", screenEl().includes("初読") && screenEl().includes("計測開始"));
  A.startReading(1); await new Promise(r => _st(r, 12)); A.finishReading(1);
  check("B13 設問画面に遷移", screenEl().includes("設問 1 / 3"));
  check("B13b 設問画面に『わかりにくい』報告ボタン", screenEl().includes("わかりにくい"));
  A.finishQuiz(1, [true, true, true]);
  if (screenEl().includes("深層読解")) { A.answerDeepCloze(0); A.proceedAfterCloze1(); }
  check("B14 反復読画面", screenEl().includes("反復読"));
  A.startReread(1); await new Promise(r => _st(r, 12)); A.finishReread(1);
  check("B15 本文②読書画面", screenEl().includes("本文②"));
  A.startReading(2); await new Promise(r => _st(r, 12)); A.finishReading(2);
  A.finishQuiz(2, [true, true, false]);
  // Deep Cloze 画面が出たら回答して結果へ（本文②に接続表現がある場合）
  let deepClozeShown = screenEl().includes("深層読解");
  if (deepClozeShown) { A.answerDeepCloze(0); A.renderResult(); }
  const resHtml = screenEl();
  check("B16 結果画面: KPIと内訳描画", resHtml.includes("字/分") && resHtml.includes("今日の中身") && resHtml.includes("瞬間キャッチ"));
  check("B16b 結果に難度補正速度を表示", resHtml.includes("難度補正速度"));
  check("B16c 結果に一目量を表示", resHtml.includes("一目量"));
  check("B16d 結果に持ち帰りカード", resHtml.includes("持ち帰り"));
  const last = A.state.history[A.state.history.length - 1];
  check("B17 履歴記録 (速度・理解度・ジャンル別・視幅)", last && last.speed > 0 && last.comprehension > 0 && (last.genreSpeeds || []).length === 2 && typeof last.spanLevel === "number");
  check("B17b 履歴に難度補正速度・難度を記録", last && typeof last.adjustedSpeed === "number" && typeof last.readability === "number");
  const seenBeforeShort = new Set(A.state.seenPassageKeys || []);
  const shortPick = A.pickSessionPassages("short");
  A.startSession("short");
  check("B18 ショート版: 3〜5分導入を描画", A.sess && A.sess.mode === "short" && screenEl().includes("約3〜5分"));
  check("B18b 既読本文を再選択しない", shortPick && !seenBeforeShort.has(A.passageKey(shortPick.p1)), shortPick && shortPick.p1.id);
  A.renderRead(1); A.startReading(1); await new Promise(r => _st(r, 12)); A.finishReading(1); A.finishQuiz(1, [true, true, true]);
  const shortLast = A.state.history[A.state.history.length - 1];
  check("B18c ショート版: 1本文＋3問で結果・履歴まで完走", shortLast && shortLast.mode === "short" && screenEl().includes("SHORT SESSION COMPLETE"));
  check("B18d 既読キーを端末履歴へ永続化", (A.state.seenPassageKeys || []).length >= 4, `${(A.state.seenPassageKeys || []).length}本`);

  // ---------- C. 解析エンジン（難度・Deep Cloze・アンカー） ----------
  const rs = (daily.passages || []).map(p => A.textStats(p.text));
  check("C1 難度スコアが0..1・bucket1-5で算出", rs.every(s => s.readability >= 0 && s.readability <= 1 && s.bucket >= 1 && s.bucket <= 5), rs.map(s => s.bucket).join(","));
  check("C2 難度に差がつく（飽和していない）", (Math.max(...rs.map(s => s.readability)) - Math.min(...rs.map(s => s.readability))) >= 0.05, `range ${(Math.max(...rs.map(s=>s.readability))-Math.min(...rs.map(s=>s.readability))).toFixed(2)}`);
  check("C3 難度補正速度は難度単調（難しい文ほど高い）", A.adjustSpeed(400, 0.7) > A.adjustSpeed(400, 0.4));
  const dcs = (daily.passages || []).map(p => A.makeDeepCloze(p.text)).filter(Boolean);
  check("C4 Deep Cloze: 生成できた本文では4択・正解整合", dcs.length >= 1 && dcs.every(d => d.opts.length === 4 && d.opts[d.ans] === d.correct), `生成 ${dcs.length}/${daily.passages.length}本`);
  check("C5 アンカー教材: 3本以上・各3問4択・rationale付", (A.ANCHOR_POOL || []).length >= 3 && A.ANCHOR_POOL.every(a => a.questions.length === 3 && a.questions.every(q => q.opts.length === 4 && q.ans >= 0 && q.ans <= 3 && (q.rationale || "").length >= 15)));
  check("C5b アンカー genre が科学/論文でない", A.ANCHOR_POOL.every(a => !/科学|研究|論文/.test(a.genre || "")));
  // アンカー転移フローの実描画E2E
  A.startAnchor(); A.renderAnchorRead(); A.startAnchorRead(); await new Promise(r => _st(r, 12)); A.finishAnchorRead();
  check("C6 アンカー設問画面の描画", screenEl().includes("アンカー設問"));
  A.answerAnchor(0, 0); A.renderAnchorQuiz(1); A.answerAnchor(1, 0); A.renderAnchorQuiz(2); A.answerAnchor(2, 0); A.renderAnchorQuiz(3);
  check("C7 アンカー結果に転移速度を表示・履歴記録", screenEl().includes("転移") && (A.state.anchorHistory || []).length >= 1 && typeof A.state.anchorHistory[A.state.anchorHistory.length-1].adjustedSpeed === "number");
  // C8: アンカー記録後にホームへ戻れる（daysBetween未定義によるナビ凍結の回帰防止）
  let navOK = true, navErr = "";
  try { A.anchorDue(); A.renderHome(); } catch (e) { navOK = false; navErr = e.message; }
  check("C8 アンカー実施後もホーム再描画OK（ナビ凍結しない）", navOK && screenEl().includes("今日の目標"), navErr);

  // ---------- E. SOKUGAN 3.0 (語彙道場/持ち帰り/キャッチv3/メニュー/目標) ----------
  const ktPass = (daily.passages || []).filter(p => (p.keyTerms || []).length >= 2);
  check("E1 keyTerms: 10本すべてに2語以上・各語 plain+lures3", ktPass.length === 10 && ktPass.every(p => p.keyTerms.every(t => t.term && (t.plain || "").length >= 15 && (t.lures || []).length >= 3)), `${ktPass.length}/10本`);
  const tkPass = (daily.passages || []).filter(p => p.takeaway && (p.takeaway.hook || "").length >= 10 && (p.takeaway.hook || "").length <= 70);
  check("E2 takeaway: 10本すべてに10-70字のフック", tkPass.length === 10, `${tkPass.length}/10本`);
  // キャッチv3: 選択肢は原則ターゲットと同じ書き出し
  let prefOK = true, prefDetail = [];
  for (const lv of [4, 5, 6]) {
    const t = A.spanTrialSet(lv);
    if (!t) continue;
    const share = t.opts.filter(o => o[0] === t.target[0]).length / t.opts.length;
    prefDetail.push(lv + ":" + Math.round(share * 100) + "%");
    if (share < 0.75) prefOK = false;
  }
  check("E3 キャッチv3: 選択肢の75%以上がターゲットと同じ書き出し", prefOK, prefDetail.join(" "));
  A.renderHome();
  const homeHtml = screenEl();
  check("E4 ホーム: 今日のメニュー表示", /の日/.test(homeHtml) && homeHtml.includes(A.todayMenu().label));
  check("E5 ホーム: 目標セクション（設定済バー or 設定ボタン）", homeHtml.includes("🎯"));
  check("E6 メニューが曜日で定義済み・弱点計算が動く", !!A.todayMenu().id && !!A.weakestSkill().id, A.todayMenu().id + "/" + A.weakestSkill().id);

  // ---------- D. 明快さ監査（clarity-audit.json）が実際に行われ記録されているか ----------
  // 設問の日本語の自然さ・明快さは機械では測りきれないため、LLM監査の実施を「記録・ゲート」で強制する。
  let ca = null;
  try { ca = JSON.parse(fs.readFileSync(path.join(ROOT, "clarity-audit.json"), "utf8")); } catch (e) {}
  const totalQ = (daily.passages || []).reduce((s, p) => s + (p.questions || []).length, 0);
  check("D1 明快さ監査ファイルが存在", !!ca, ca ? "" : "clarity-audit.json なし（QA監督が未実施）");
  check("D2 監査が当日コンテンツを対象", ca && ca.date === daily.date, ca ? `audit=${ca.date} / content=${daily.date}` : "");
  check("D3 監査が全設問をカバー", ca && Array.isArray(ca.items) && ca.items.length === totalQ, ca ? `${(ca.items || []).length}/${totalQ}` : "");
  check("D4 監査ステータスが合格・平均明快さ4以上", ca && ca.status === "pass" && (ca.avgScore || 0) >= 4, ca ? `${ca.status} avg=${ca.avgScore}` : "");
  check("D5 明快さスコア3未満の設問が残っていない", ca && (ca.items || []).every(i => (i.score || 0) >= 3), ca ? (ca.items || []).filter(i => (i.score || 0) < 3).length + "問" : "");

  // ========== 結果 ==========
  const status = failed === 0 ? "pass" : "fail";
  console.log("\n========== QA " + status.toUpperCase() + " : " + (results.length - failed) + "/" + results.length + " checks ==========");
  if (WRITE) {
    const report = {
      date: daily.date, status, checked_at: new Date().toISOString(),
      passed: results.length - failed, total: results.length,
      failures: results.filter(r => !r.ok),
      notes: NOTE
    };
    fs.writeFileSync(path.join(ROOT, 'qa-report.json'), JSON.stringify(report, null, 1), 'utf8');
    console.log("qa-report.json written");
  }
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(1); });
