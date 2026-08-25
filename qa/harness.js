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
eval(js + "\nglobal.__app = { get state(){return state}, set state(v){state=v}, get sess(){return sess}, get content(){return content}, get syncState(){return syncState}, DEFAULT_CONTENT, ANCHOR_POOL, chunkText, getChunks, validChunks, chunkPool, spanTrialSet, pickSessionPassages, startSession, abortSession, renderShortIntro, renderShortResult, unseenPassages, passageKey, passageKeys, isPassageSeen, markPassagesSeen, markPassageRead, textFingerprint, sourceUrlKey, renderHome, renderHistory, contentStatus, renderFreshnessPanel, guardedStart, renderPacer, renderPacerQuiz, answerPacer, renderSpanIntro, answerSpan, finishSpan, renderRead, startReading, finishReading, renderQuiz, finishQuiz, renderReread, startReread, finishReread, renderResult, textStats, adjustSpeed, makeDeepCloze, answerDeepCloze, normalizeNumerals, parseKanjiNum, startAnchor, renderAnchorRead, startAnchorRead, finishAnchorRead, renderAnchorQuiz, answerAnchor, anchorDue, todayMenu, goalProgress, gazeSpan, sessionKeyTerms, passageTakeaway, finishVocab, proceedAfterCloze1, weakestSkill, feedbackGenreScore, preferByFeedback, recordContentFeedback, renderContentFeedback, contentFeedbackKey, defaultState, newSessionId, stampField, saveState, mergeStates, unionBy, histKey, syncCfg, syncEnabled, signedIn, loadAuth, saveAuth, syncNow, pullRemote, pushRemote, scheduleSync, flushSyncQueue, syncStatusText, renderSyncCard, renderSyncLine, syncSignOut, KEY, AUTH_KEY };");

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
    // A9d: 促音・撥音・拗音・長音で始まるチャンクは日本語の語頭になり得ない。
    // 「上が|った」「だ|った。」のような活用語尾の断裂を検出する（A9では捕まらない）。
    const badHead = ch.filter(c => /^[っッんンぁぃぅぇぉゃゅょゎァィゥェォャュョヮー]/.test(c));
    check(`A9d [${id}] 語頭になり得ない文字で始まるチャンクなし（活用語尾の断裂）`,
      badHead.length === 0, badHead.slice(0, 3).join("/"));
    // 15字超は「分割不能な単一アトム(長いカタカナ語/英数)」のみ許容。
    // 上限が12→15なのは、連体修飾の孤立を解消する結合（A10c）に幅が必要なため。
    // 長いチャンクの乱造を防ぐ密度上限は A10d が担保する。
    const isSingleAtom = c => /^[ァ-ヺーヽヾ]+$/.test(c) || /^[A-Za-zＡ-Ｚａ-ｚ0-9０-９.\-＆&％%]+の?$/.test(c) || /^[一-鿿々〆〇]+$/.test(c);
    const tooLong = ch.filter(c => [...c].length > 15 && !isSingleAtom(c)).length;
    check(`A10 [${id}] 15字超の複合チャンクなし（長い単一語のみ許容）`, tooLong === 0, `${tooLong}個`);
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

  // ---------- A10c/A10d. 「単独で意味が閉じないチャンク」の全文スキャン ----------
  // 語中分割(A9系)とは別の欠陥。連体修飾だけが単独チャンクとして残ると、
  // 「ニューメキシコ州の」のように読み手が次を見るまで意味を確定できない。
  // 結合すれば15字以内に収まる＝回避可能な孤立は1件でもFAILにする（見逃しを防ぐ）。
  // 結合すると15字を超える組み合わせは物理的に回避不能なので、件数だけ上限管理する。
  const DANGLE_RE = /(?:の|な|という|による|における|への|ための|といった|に対する|としての)$/;
  let avoidableDangle = [], unavoidableDangle = [], allChunkN = 0, over12 = 0;
  for (const p of (daily.passages || [])) {
    const ch = A.getChunks(p);
    allChunkN += ch.length;
    for (let i = 0; i < ch.length; i++) {
      if ([...ch[i]].length > 12) over12++;
      if (i === ch.length - 1) continue;
      if (!DANGLE_RE.test(ch[i]) || /[、。！？]$/.test(ch[i])) continue;
      const joined = [...ch[i], ...ch[i + 1]].length;
      (joined <= 15 ? avoidableDangle : unavoidableDangle).push(`${p.id}:${ch[i]}|${ch[i + 1]}`);
    }
  }
  check("A10c 回避可能な『意味が閉じないチャンク』が0（結合すれば15字以内に収まる孤立修飾）",
    avoidableDangle.length === 0,
    avoidableDangle.length ? avoidableDangle.slice(0, 4).join(" / ") : `回避不能な残り ${unavoidableDangle.length}件`);
  check("A10c2 回避不能な孤立修飾は2件以下（結合すると15字超になる組み合わせ）",
    unavoidableDangle.length <= 2, unavoidableDangle.join(" / "));
  // 上限緩和（12→15字）を悪用して長いチャンクが量産されていないか
  check("A10d 12字超チャンクは全体の2%以下（長文チャンクの乱造防止）",
    over12 / Math.max(allChunkN, 1) <= 0.02, `${over12}/${allChunkN} = ${(over12 / Math.max(allChunkN, 1) * 100).toFixed(1)}%`);

  // ---------- A15. archive直近30日との重複（既報の言い換えを配信しない） ----------
  // /daily の指示だけに頼ると「同じ出来事の言い換え」がすり抜ける。機械的に照合する。
  const archDir = path.join(ROOT, "archive");
  const norm = (t) => String(t || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const fp = (t) => { const s = norm(t); let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length + "-" + h.toString(36); };
  let archTitles = new Map(), archFps = new Map(), archUrls = new Map(), archDays = 0;
  try {
    const cut = new Date(Date.parse(daily.date + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(archDir).filter(x => x.endsWith(".json")).sort().reverse()) {
      const d = f.replace(/\.json$/, "");
      if (d < cut || d >= daily.date) continue;
      archDays++;
      let a = null;
      try { a = JSON.parse(fs.readFileSync(path.join(archDir, f), "utf8")); } catch (e) { continue; }
      for (const p of (a.passages || [])) {
        if (p.title) archTitles.set(norm(p.title), d);
        if (p.text) archFps.set(fp(p.text), d);
        const u = String(p.source || "").match(/https?:\/\/[^\s、。）)"']+/);
        if (u) archUrls.set(u[0].toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, ""), d);
      }
    }
  } catch (e) {}
  const dupTitle = [], dupText = [], dupUrl = [];
  for (const p of (daily.passages || [])) {
    if (archTitles.has(norm(p.title))) dupTitle.push(`${p.id}=${archTitles.get(norm(p.title))}`);
    if (archFps.has(fp(p.text))) dupText.push(`${p.id}=${archFps.get(fp(p.text))}`);
    const u = String(p.source || "").match(/https?:\/\/[^\s、。）)"']+/);
    if (u) { const k = u[0].toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, ""); if (archUrls.has(k)) dupUrl.push(`${p.id}=${archUrls.get(k)}`); }
  }
  check("A15 archive直近30日と同一タイトルの再配信なし", dupTitle.length === 0, `照合${archDays}日 / ${dupTitle.join(" ")}`);
  check("A15b archive直近30日と同一本文の再配信なし", dupText.length === 0, dupText.join(" "));
  check("A15c archive直近30日と同一出典URLの再配信なし", dupUrl.length === 0, dupUrl.join(" "));
  check("A15d 照合対象のarchiveが十分にある（30日分を参照できている）", archDays >= 20, `${archDays}日分`);

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

  // B18e: 選択前に正答だけが濃く見えるネイティブfocusを防ぐ（keyboard focusは青で明示）
  check("B18e 選択肢の未回答focusは中立の青アウトライン（正答色を使わない）",
    /\.opt:focus\{outline:none\}/.test(html) && /\.opt:focus-visible\{outline:2px solid var\(--blue\)/.test(html) && /\.opt\.correct\{border-color:var\(--green\)/.test(html));

  // B18f: 中断でも読了済み本文だけを部分記録。PB/目標/streakを汚さない
  A.state = A.defaultState();
  A.startSession("short"); A.renderRead(1); A.startReading(1); await new Promise(r => _st(r, 12)); A.finishReading(1);
  global.window._quizAnswers = [true]; A.abortSession();
  const partial = A.state.history[A.state.history.length - 1];
  check("B18f 中断は測定済み本文を部分記録し、KPIには使わない",
    partial && partial.mode === "partial" && partial.completed === false && partial.passagesRead === 1 && partial.valid === false && partial.questionsAnswered === 1);

  // B18g: 読後評価は保存・同期対象で、次回の未読選択にジャンル優先度として反映される
  const rated = daily.passages[0];
  A.recordContentFeedback(rated, 5);
  const feedback = A.state.contentFeedback[0];
  const preferred = A.preferByFeedback([daily.passages[1], rated]);
  check("B18g 読後評価を保存し、次回選定のジャンル優先度へ反映",
    feedback && feedback.passageId === rated.id && feedback.rating === 5 && A.feedbackGenreScore(rated.genre) === 5 && preferred[0].genre === rated.genre);

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
  // キャッチ: 合成した文字列を使わず、選択肢のすべてが本文から得た自然なチャンクである
  let naturalSpanOK = true, naturalSpanDetail = [];
  const sourceChunks = new Set(Object.values(A.chunkPool()).flat());
  for (const lv of [4, 5, 6]) {
    const t = A.spanTrialSet(lv);
    const ok = t && t.opts.every(o => sourceChunks.has(o));
    naturalSpanDetail.push(lv + ":" + (ok ? "本文由来" : "不正"));
    if (!ok) naturalSpanOK = false;
  }
  check("E3 瞬間キャッチ: 全選択肢が本文由来の自然なチャンク（合成語なし）", naturalSpanOK, naturalSpanDetail.join(" "));
  A.renderHome();
  const homeHtml = screenEl();
  check("E4 ホーム: 今日のメニュー表示", /の日/.test(homeHtml) && homeHtml.includes(A.todayMenu().label));
  check("E5 ホーム: 目標セクション（設定済バー or 設定ボタン）", homeHtml.includes("🎯"));
  check("E6 メニューが曜日で定義済み・弱点計算が動く", !!A.todayMenu().id && !!A.weakestSkill().id, A.todayMenu().id + "/" + A.weakestSkill().id);

  // ========== G. 既読管理・ショート版（読んだ本文を再表示しない） ==========
  const stateBackup = JSON.parse(JSON.stringify(A.state));
  const restore = () => { A.state = JSON.parse(JSON.stringify(stateBackup)); };
  const wait = (ms) => new Promise(r => _st(r, ms || 12));

  // G1: 開始時点で既読化すると、中断した本文まで在庫から消える（3.1の不具合）
  restore();
  A.state.seenPassageKeys = [];
  const unseenBefore = A.unseenPassages().length;
  A.startSession("full");
  const unseenAfterStart = A.unseenPassages().length;
  check("G1 セッション開始だけでは未読を消費しない（中断で在庫が減らない）",
    unseenAfterStart === unseenBefore, `${unseenBefore}本 → ${unseenAfterStart}本`);
  const startedP1 = A.sess && A.sess.p1;
  A.markPassageRead(startedP1);
  check("G1b 通読し終えた本文だけが既読になる",
    A.unseenPassages().length === unseenBefore - 1, `${A.unseenPassages().length}本`);

  // G2: 既読は日付をまたいで保持される（当日セッションの日付リセットに巻き込まれない）
  A.state.seenPassageKeys = ["persist-test-key"];
  A.saveState();
  let savedRaw = null;
  try { savedRaw = JSON.parse(global.localStorage.getItem(A.KEY)); } catch (e) {}
  check("G2 既読キーがlocalStorageへ永続化される（日付をまたいで保持）",
    !!savedRaw && (savedRaw.seenPassageKeys || []).includes("persist-test-key"));
  A.state.todaySession = { date: "2000-01-01", count: 9, usedPassageIds: ["x"] };
  A.renderHome();   // ensureTodaySession が日付リセットを行う経路
  check("G2b 日付が変わっても既読はリセットされない",
    (A.state.seenPassageKeys || []).includes("persist-test-key"),
    `${(A.state.seenPassageKeys || []).length}件`);

  // G3: IDだけに頼らない同一判定（正規化タイトル / 本文fingerprint / 出典URL）
  const gp = daily.passages[0];
  check("G3 既読キーが複数系統で生成される（タイトル＋本文fingerprint）",
    A.passageKeys(gp).length >= 2 && A.passageKeys(gp).some(k => String(k).startsWith("t:")),
    A.passageKeys(gp).map(k => String(k).slice(0, 18)).join(" , "));
  A.state.seenPassageKeys = []; A.markPassagesSeen([gp]);
  const reworded = Object.assign({}, gp, { id: "reworded_x", title: "見出しだけ差し替えた同一記事" });
  check("G3b タイトルを変えた同一本文を既読と判定（言い換え再配信の排除）", A.isPassageSeen(reworded));
  const urlA = { id: "u1", title: "記事A", text: "本文はまったく別です。", source: "https://example.com/news/1?utm_source=x" };
  const urlB = { id: "u2", title: "記事B", text: "本文もまったく別です。", source: "取材元 https://example.com/news/1/ ほか" };
  A.state.seenPassageKeys = []; A.markPassagesSeen([urlA]);
  check("G3c 出典URLが同じ記事を既読と判定", A.isPassageSeen(urlB), A.passageKeys(urlB).join(" , "));

  // G4: 未読が尽きたら既読へ黙って戻さず「本日分を完走」を出す
  A.state.seenPassageKeys = []; A.markPassagesSeen(daily.passages);
  check("G4 未読枯渇時は既読へフォールバックせずnullを返す",
    A.pickSessionPassages("short") === null && A.pickSessionPassages("full") === null);
  A.renderHome();
  check("G4b ホームに『本日分を完走』を明示（黙って再表示しない）", screenEl().includes("本日分を完走"));
  A.startSession("short");
  check("G4c 枯渇時にショート版を押しても既読本文を出さない", A.sess === null || A.sess.mode !== "short");

  // G5: ショート版の再挑戦（隙間時間に何度でも）
  restore();
  A.state.seenPassageKeys = []; A.state.history = [];
  let shortDone = 0;
  for (let i = 0; i < 2; i++) {
    A.startSession("short");
    if (!A.sess || A.sess.mode !== "short") break;
    A.renderRead(1); A.startReading(1); await wait(12); A.finishReading(1); A.finishQuiz(1, [true, true, true]);
    if (screenEl().includes("SHORT SESSION COMPLETE")) shortDone++;
  }
  check("G5 ショート版を連続2回完走できる（再挑戦）", shortDone === 2, `${shortDone}/2回`);
  check("G5b 連続実行で履歴が2件・既読も2本増える",
    A.state.history.length === 2 && A.state.history.every(h => h.mode === "short"),
    `history=${A.state.history.length}`);
  check("G5c ショート版でも理解度ゲート・持ち帰りを維持",
    A.state.history.every(h => typeof h.comprehension === "number" && typeof h.valid === "boolean")
    && !!A.state.lastTakeaways);
  check("G5d 履歴にsessionIdが入る（同期の重複排除キー）",
    A.state.history.every(h => typeof h.sessionId === "string" && h.sessionId.length > 5),
    A.state.history.map(h => h.sessionId).join(","));

  // ========== F. 端末間同期（ローカルファースト + 決定論マージ） ==========
  // F1: 既定（設定なし）ではアプリは同期抜きで完全に動く
  check("F1 設定が無ければ同期は無効・localStorage単独で動作",
    A.syncEnabled() === false && A.syncStatusText().label === "同期未設定");
  check("F1b 未設定でもデータ管理UIが描画できる（壊れない）",
    A.renderSyncCard().includes("未設定") && A.renderSyncLine().includes("同期"));

  // ---- マージ規則（純関数）----
  const mk = (o) => Object.assign(A.defaultState(), o);
  const LA = mk({ updatedAt: "2026-08-23T10:00:00Z",
    history: [{ sessionId: "A1", date: "2026-08-20", speed: 400, valid: true }, { sessionId: "S1", date: "2026-08-21", speed: 420, valid: true }] });
  const RB = mk({ updatedAt: "2026-08-23T11:00:00Z",
    history: [{ sessionId: "S1", date: "2026-08-21", speed: 420, valid: true }, { sessionId: "B1", date: "2026-08-22", speed: 450, valid: true }] });
  const M1 = A.mergeStates(LA, RB);
  check("F2 history: union＋sessionIdで重複排除", M1.history.length === 3,
    M1.history.map(h => h.sessionId).join(","));
  check("F3 端末Aと端末Bの記録がどちらも残る（片側上書きなし）",
    M1.history.some(h => h.sessionId === "A1") && M1.history.some(h => h.sessionId === "B1"));
  check("F2b sessionId無しの旧記録も内容キーで重複排除",
    A.mergeStates(mk({ history: [{ date: "2026-08-20", speed: 400, comprehension: 0.8 }] }),
                  mk({ history: [{ date: "2026-08-20", speed: 400, comprehension: 0.8 }] })).history.length === 1);
  const M3 = A.mergeStates(
    mk({ seenPassageKeys: ["k1", "k2"], wins: [{ date: "d1", text: "w1", ico: "x" }], clarityFlags: [{ date: "d1", genre: "g", q: "q1" }], anchorHistory: [{ date: "d1", anchorId: "a1" }] }),
    mk({ seenPassageKeys: ["k2", "k3"], wins: [{ date: "d1", text: "w2", ico: "x" }], clarityFlags: [{ date: "d1", genre: "g", q: "q2" }], anchorHistory: [{ date: "d2", anchorId: "a2" }] }));
  check("F4 seen/wins/flags/anchorはunion＋重複排除",
    M3.seenPassageKeys.join(",") === "k1,k2,k3" && M3.wins.length === 2 && M3.clarityFlags.length === 2 && M3.anchorHistory.length === 2,
    `seen=${M3.seenPassageKeys.length} wins=${M3.wins.length} flags=${M3.clarityFlags.length} anchor=${M3.anchorHistory.length}`);
  const MFb = A.mergeStates(
    mk({ contentFeedback: [{ date: "2026-08-20", passageId: "p1", genre: "社会・価値観", rating: 5, title: "A" }] }),
    mk({ contentFeedback: [{ date: "2026-08-20", passageId: "p1", genre: "社会・価値観", rating: 5, title: "A" }, { date: "2026-08-21", passageId: "p2", genre: "未来の兆し", rating: 4, title: "B" }] }));
  check("F4b 読後評価は端末間でunionし、重複計上しない", MFb.contentFeedback.length === 2);
  const M4 = A.mergeStates(
    mk({ vocabBook: [{ term: "利回り", level: 1, date: "2026-08-20" }, { term: "系統連系", level: 3, date: "2026-08-20" }] }),
    mk({ vocabBook: [{ term: "利回り", level: 3, date: "2026-08-22" }, { term: "福利厚生", level: 2, date: "2026-08-21" }] }));
  check("F5 vocabBookはterm単位で高い習得度を採用",
    M4.vocabBook.length === 3 && M4.vocabBook.find(v => v.term === "利回り").level === 3,
    M4.vocabBook.map(v => v.term + ":" + v.level).join(" "));
  const M5 = A.mergeStates(mk({ bestSpeed: 520, maxStreak: 7, xp: 100 }), mk({ bestSpeed: 480, maxStreak: 11, xp: 90 }));
  check("F6 自己ベスト・最大連続・XPはmax（片方の記録が消えない）",
    M5.bestSpeed === 520 && M5.maxStreak === 11 && M5.xp === 100, `PB=${M5.bestSpeed} streak=${M5.maxStreak}`);
  const Lold = mk({ updatedAt: "2026-08-23T09:00:00Z", pacerLevel: 400, spanLevel: 5 });
  const Rnew = mk({ updatedAt: "2026-08-23T12:00:00Z", pacerLevel: 460, spanLevel: 6 });
  check("F7 設定型（ペーサー速度・視幅）はupdatedAtが新しい側",
    A.mergeStates(Lold, Rnew).pacerLevel === 460 && A.mergeStates(Lold, Rnew).spanLevel === 6);
  check("F7b fieldTsがあれば項目別の更新時刻を優先",
    A.mergeStates(mk({ updatedAt: "2026-08-23T09:00:00Z", fieldTs: { pacerLevel: "2026-08-23T23:00:00Z" }, pacerLevel: 400 }), Rnew).pacerLevel === 400);
  const M8 = A.mergeStates(
    mk({ updatedAt: "2026-08-23T10:00:00Z", ratchet: { target: 500, missStreak: 0, clearedDates: ["2026-08-20"] }, goal: { target: 600, hit: [25] } }),
    mk({ updatedAt: "2026-08-23T11:00:00Z", ratchet: { target: 520, missStreak: 1, clearedDates: ["2026-08-21"] }, goal: { target: 600, hit: [50] } }));
  check("F7c ratchetのクリア日と目標の到達閾値はunion（両端末の実績を残す）",
    M8.ratchet.clearedDates.length === 2 && M8.ratchet.target === 520 && M8.goal.hit.join(",") === "25,50",
    `cleared=${M8.ratchet.clearedDates.join("/")} hit=${M8.goal.hit.join("/")}`);
  const M9 = A.mergeStates(
    mk({ todaySession: { date: "2026-08-23", count: 2, usedPassageIds: ["p1"] } }),
    mk({ todaySession: { date: "2026-08-23", count: 3, usedPassageIds: ["p2"] } }));
  check("F7d todaySession: 同日はcount最大・使用本文はunion",
    M9.todaySession.count === 3 && M9.todaySession.usedPassageIds.length === 2);
  const once = A.mergeStates(LA, RB), twice = A.mergeStates(once, RB);
  check("F8 マージは冪等（同じ入力で結果が変わらない）",
    JSON.stringify(once.history) === JSON.stringify(twice.history) && JSON.stringify(once.seenPassageKeys) === JSON.stringify(twice.seenPassageKeys));
  check("F8b deviceIdは自端末のものを保持（他端末IDに乗り換えない）",
    A.mergeStates(mk({ deviceId: "d-local" }), mk({ deviceId: "d-remote" })).deviceId === "d-local");

  // ---- ネットワークmockでの同期E2E ----
  const REAL_FETCH = global.fetch;
  function installSyncMock(opts) {
    const o = Object.assign({ row: null, failPatch: 0, offline: false, calls: [] }, opts);
    global.window.SOKUGAN_CONFIG = { supabaseUrl: "https://mock.supabase.co", supabaseAnonKey: "anon-public-test-key" };
    global.fetch = async (url, init) => {
      const u = String(url), m = (init && init.method) || "GET";
      if (u.includes("daily-content") || u.includes("qa-report") || u.includes("clarity-audit")) {
        return u.includes("daily-content")
          ? { ok: true, json: async () => JSON.parse(JSON.stringify(daily)) } : { ok: false };
      }
      o.calls.push(m + " " + u.replace("https://mock.supabase.co", ""));
      if (o.offline) throw new Error("Failed to fetch");
      if (u.includes("/rest/v1/sokugan_state")) {
        if (m === "GET") return { ok: true, status: 200, json: async () => (o.row ? [{ state: o.row.state, rev: o.row.rev }] : []) };
        if (m === "POST") { o.row = { state: JSON.parse(init.body).state, rev: 1 }; return { ok: true, status: 201, json: async () => [] }; }
        if (m === "PATCH") {
          const body = JSON.parse(init.body);
          const rm = /rev=eq\.(\d+)/.exec(u);
          const want = rm ? Number(rm[1]) : null;
          if (o.failPatch > 0) { o.failPatch--; return { ok: true, status: 200, json: async () => [] }; } // 0件=rev衝突
          if (o.row && want !== o.row.rev) return { ok: true, status: 200, json: async () => [] };
          o.row = { state: body.state, rev: body.rev };
          return { ok: true, status: 200, json: async () => [{ rev: body.rev }] };
        }
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    return o;
  }
  const AUTH = { access_token: "tok-test", refresh_token: "ref-test", user_id: "11111111-1111-1111-1111-111111111111", email: "won@example.com" };

  // F9: 初回同期 = ローカルをクラウドへ移行。空のクラウドでローカル履歴を消さない
  restore();
  A.state.history = [{ sessionId: "LOCAL1", date: "2026-08-20", speed: 400, comprehension: 0.8, valid: true }];
  A.state.seenPassageKeys = ["local-seen-1"];
  A.state.bestSpeed = 470;
  const mk1 = installSyncMock({ row: null });
  A.saveAuth(AUTH);
  check("F9pre 設定＋ログイン後は同期が有効", A.syncEnabled() === true && A.signedIn() === true);
  const r1 = await A.syncNow("test-migration");
  check("F9 初回同期: クラウドが空ならローカルを移行（履歴を消さない）",
    r1.ok === true && r1.migrated === true && !!mk1.row &&
    (mk1.row.state.history || []).length === 1 && mk1.row.state.history[0].sessionId === "LOCAL1",
    `ok=${r1.ok} migrated=${r1.migrated} pushed=${mk1.row ? (mk1.row.state.history || []).length : "none"}件`);
  check("F9b ローカル履歴が同期後も残っている", A.state.history.some(h => h.sessionId === "LOCAL1"));

  // F10: 2端末競合 — スマホとPCの両方で増えた分をどちらも残す
  const mk2 = installSyncMock({
    row: { rev: 5, state: Object.assign(A.defaultState(), {
      updatedAt: "2026-08-23T12:00:00Z",
      history: [{ sessionId: "DEV_B", date: "2026-08-22", speed: 450, comprehension: 0.9, valid: true }],
      seenPassageKeys: ["remote-seen-1"], bestSpeed: 600, maxStreak: 3 }) }
  });
  A.state.history = [{ sessionId: "DEV_A", date: "2026-08-21", speed: 410, comprehension: 0.8, valid: true }];
  A.state.seenPassageKeys = ["local-seen-1"];
  A.state.bestSpeed = 500; A.state.maxStreak = 9;
  A.state.updatedAt = "2026-08-23T10:00:00Z";
  const r2 = await A.syncNow("test-conflict");
  const ids = A.state.history.map(h => h.sessionId).sort().join(",");
  check("F10 2端末競合: 双方の履歴が残る（上書きしない）", r2.ok === true && ids === "DEV_A,DEV_B", ids);
  check("F10b 競合時 PBはmax・既読はunion",
    A.state.bestSpeed === 600 && A.state.maxStreak === 9 &&
    A.state.seenPassageKeys.includes("local-seen-1") && A.state.seenPassageKeys.includes("remote-seen-1"),
    `PB=${A.state.bestSpeed} streak=${A.state.maxStreak} seen=${A.state.seenPassageKeys.length}`);
  check("F10c revが進み、マージ後の状態が保存された", mk2.row.rev === 6, `rev=${mk2.row.rev}`);

  // F11: rev衝突（pullとpushの間に他端末が書いた）→ 再pullして再試行
  const mk3 = installSyncMock({ row: { rev: 9, state: A.defaultState() }, failPatch: 1 });
  const r3 = await A.syncNow("test-rev");
  check("F11 rev衝突を検知して再pull→再マージで成功",
    r3.ok === true && r3.conflicts === 1, `ok=${r3.ok} conflicts=${r3.conflicts}`);

  // F12: オフラインはエラーにせずキューへ。再接続で送信
  const mk4 = installSyncMock({ row: null, offline: true });
  const r4 = await A.syncNow("test-offline");
  check("F12 オフライン: 失敗ではなくキューに積む（練習は継続可能）",
    r4.ok === false && r4.reason === "offline" && A.syncState.status === "offline" && A.syncState.pending === true,
    `status=${A.syncState.status} pending=${A.syncState.pending}`);
  mk4.offline = false;
  await A.flushSyncQueue("test-reconnect");
  check("F12b 再接続でキューが送信され同期済みになる",
    A.syncState.status === "ok" && !!mk4.row && A.syncState.pending === false,
    `status=${A.syncState.status}`);

  // 後片付け: 以降の検査に同期モックを持ち込まない
  A.saveAuth(null); global.fetch = REAL_FETCH; global.window.SOKUGAN_CONFIG = undefined;
  check("F13 ログアウトで同期は停止し要ログイン表示に戻る", A.signedIn() === false);

  // ---- 設定・SQLの安全性 ----
  const cfgSrc = fs.readFileSync(path.join(ROOT, "sokugan-config.js"), "utf8");
  // コメント（「service_role keyは置くな」という注意書き）を除いた実コードだけを見る
  const cfgCode = cfgSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("F14 設定ファイルの実コードに秘密情報が無い（anon keyのみ）",
    !/service_role|SUPABASE_SERVICE|secret|password/i.test(cfgCode),
    cfgCode.replace(/\s+/g, " ").trim().slice(0, 80));
  check("F14c 設定キーは supabaseUrl / supabaseAnonKey の2つだけ",
    (cfgCode.match(/^\s*[A-Za-z_$][\w$]*\s*:/gm) || []).length === 2,
    (cfgCode.match(/^\s*[A-Za-z_$][\w$]*\s*:/gm) || []).map(x => x.trim()).join(" "));
  check("F14b 設定ファイルは既定で空（未設定でも動く既定値）",
    /supabaseUrl:\s*""/.test(cfgSrc) && /supabaseAnonKey:\s*""/.test(cfgSrc));
  const sqlSrc = fs.readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");
  check("F15 RLSが有効化されている", /enable row level security/i.test(sqlSrc));
  check("F15b select/insert/update/delete の4ポリシーが自分の行に限定",
    ["select", "insert", "update", "delete"].every(c => new RegExp("for " + c, "i").test(sqlSrc)) &&
    (sqlSrc.match(/auth\.uid\(\)\s*=\s*user_id/g) || []).length >= 4,
    `auth.uid()照合 ${(sqlSrc.match(/auth\.uid\(\)\s*=\s*user_id/g) || []).length}箇所`);
  check("F15c anonロールにはテーブル権限を与えていない", /revoke all on public\.sokugan_state from anon/i.test(sqlSrc));
  check("F16 index.htmlが設定ファイルを読み込む", html.includes("sokugan-config.js"));

  // ========== H. PWA・自動更新の配線 ==========
  const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  check("H1 swのキャッシュ名がアプリ版と一致（更新が端末へ届く）",
    /sokugan-v3\.2/.test(swSrc) && html.includes("SOKUGAN 3.2"), (swSrc.match(/sokugan-v[\d.]+/) || [])[0]);
  check("H2 swが旧バージョンのキャッシュを削除する",
    /caches\.keys\(\)/.test(swSrc) && /caches\.delete/.test(swSrc));
  const wfDaily = fs.readFileSync(path.join(ROOT, ".github/workflows/sokugan-daily.yml"), "utf8");
  const wfQa = fs.readFileSync(path.join(ROOT, ".github/workflows/sokugan-qa.yml"), "utf8");
  check("H3 毎日18:00 JST(09:00 UTC)のcronが定義されている", /cron:\s*"0 9 \* \* \*"/.test(wfDaily),
    (wfDaily.match(/cron:.*/) || [])[0]);
  check("H3b 実行主体がClaude Code（claude-code-action）である",
    /anthropics\/claude-code-action/.test(wfDaily) && /anthropics\/claude-code-action/.test(wfQa));
  check("H3c QA監督は19:00 JST(10:00 UTC)に走る", /cron:\s*"0 10 \* \* \*"/.test(wfQa));
  check("H3d 認証Secret未設定時は原因の分かるエラーで落ちる",
    /CLAUDE_CODE_OAUTH_TOKEN/.test(wfDaily) && /::error/.test(wfDaily));
  // H4: index.htmlが参照するローカル資産が .gitignore で除外されていないか。
  // このリポジトリの .gitignore は「全部無視して必要な物だけ許可」方式なので、
  // 新しいファイルを足すと公開対象から漏れ、GitHub Pagesで404になる（実際に起きた）。
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map(m => m[1])
    .filter(f => !/^https?:/.test(f));
  const { execFileSync } = require("child_process");
  const missing = [], ignored = [];
  for (const f of new Set(refs)) {
    if (!fs.existsSync(path.join(ROOT, f))) { missing.push(f); continue; }
    try {
      execFileSync("git", ["check-ignore", "-q", f], { cwd: ROOT, stdio: "ignore" });
      ignored.push(f);   // 終了コード0 = 無視されている
    } catch (e) { /* 非0 = 追跡対象。正常 */ }
  }
  check("H4 index.htmlが参照するローカル資産が実在する", missing.length === 0, missing.join(" "));
  check("H4b 参照資産が .gitignore で公開対象から漏れていない（Pagesで404にならない）",
    ignored.length === 0, ignored.length ? "除外されている: " + ignored.join(" ") : `${new Set(refs).size}件を確認`);

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
  // D3b〜D3d: 件数だけ合っていれば通る抜け道を閉じる。
  // 実際に「passage未指定の項目15件」で件数だけ合わせ、5本が未監査のまま
  // D3をPASSしていた（過去editionの監査で代替）。実在IDへの紐づけを必須にする。
  const paIds = new Set((daily.passages || []).map(p => p.id));
  const orphan = ((ca && ca.items) || []).filter(i => !i.passage || !paIds.has(i.passage));
  check("D3b 監査項目すべてが実在する本文IDに紐づく（未指定・架空IDなし）",
    !!ca && orphan.length === 0, `孤立 ${orphan.length}件`);
  const perPassage = {};
  for (const i of ((ca && ca.items) || [])) if (i.passage) perPassage[i.passage] = (perPassage[i.passage] || 0) + 1;
  const uncovered = (daily.passages || []).filter(p => (perPassage[p.id] || 0) !== (p.questions || []).length);
  check("D3c 全10本が各3問ずつ監査されている（1本も素通りしていない）",
    uncovered.length === 0, uncovered.map(p => p.id + ":" + (perPassage[p.id] || 0)).join(" "));
  // 監査対象が実際にその設問か（stemの実体照合）。IDだけ付け替える偽装を防ぐ
  const stemMismatch = [];
  for (const i of ((ca && ca.items) || [])) {
    const p = (daily.passages || []).find(x => x.id === i.passage);
    if (!p) continue;
    const q = (p.questions || [])[(i.q || 1) - 1];
    if (!q || !String(q.q || "").includes(String(i.stem || " "))) stemMismatch.push(i.passage + "#" + i.q);
  }
  check("D3d 監査項目のstemが実際の設問文と一致する", stemMismatch.length === 0, stemMismatch.slice(0, 4).join(" "));

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
