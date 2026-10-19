#!/usr/bin/env node
/*
 * Obsidian の YouTube リサーチノートから「復習教材のもと」を取り出す（決定論）。
 *
 * このツールは日本語を書かない。書くのは生成側（/daily）の仕事で、
 * ここがやるのは「どのノートのどの論点を、今日の復習に回すか」を毎日ぶれずに決めることだけ。
 *
 * 選ぶ順番（上から強い）:
 *   1. 本人が ==ハイライト== を引いた論点          … 読みながら手を動かした箇所が最優先
 *   2. ハイライトのあるノートの、他の論点
 *   3. 新しいノートの論点
 *   4. 最後に出してから45日以上たった論点（間隔をあけた復習）
 *
 * 使い方:
 *   node tools/build-review-briefs.js [--count 3] [--date YYYY-MM-DD] [--dry-run] [--vault PATH]
 * 出力:
 *   private-imports/review-briefs/YYYY-MM-DD.json   （gitignore配下・公開しない）
 *   private-imports/.review-state.json              （出した論点の記録）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_VAULT = "/Users/wota/Library/Mobile Documents/iCloud~md~obsidian/Documents/Daily Brief/40_Knowledge/YouTube Research";
// 本人の ==ハイライト== は vault にしか無い。launchd 配下の codex は macOS の
// プライバシー保護で iCloud を読めない（EPERM）ため、読めたときに作っておいた
// ミラーへ落ちる。生成物フォルダ（youtube_search）で代用すると、ハイライトが
// 無いノートを読むことになり、選定の第一優先が黙って効かなくなる。
const MIRROR = path.join(ROOT, "private-imports", "vault-mirror");
const OUT_DIR = path.join(ROOT, "private-imports", "review-briefs");
const STATE_FILE = path.join(ROOT, "private-imports", ".review-state.json");
const RECALL_DAYS = 45;          // 再登場を許すまでの間隔
const MIN_SECTION_CHARS = 220;   // これ未満の論点は教材1本分の中身が無い

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry-run");
const VAULT = arg("vault", DEFAULT_VAULT);
const COUNT = Math.max(1, Math.min(5, parseInt(arg("count", "3"), 10) || 3));

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const DATE = arg("date", todayJst());
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function charCount(s) { return String(s || "").replace(/\s/g, "").length; }
function slug(s) {
  return String(s || "").normalize("NFKC").replace(/[\s\/\\:*?"<>|]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// ---------- ノートを読む ----------
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const out = { sources: [] };
  let key = "";
  for (const raw of text.slice(4, end).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) { key = m[1]; if (m[2]) out[key] = m[2].replace(/^"|"$/g, ""); continue; }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      const v = item[1].replace(/^"|"$/g, "");
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(v);
    }
  }
  return out;
}

// ==ハイライト== と、閉じ忘れの ==ハイライト（行末まで）の両方を拾う
function highlightsIn(text) {
  const out = [];
  const closed = /==([^=\n]{2,160})==/g;
  let m;
  while ((m = closed.exec(text))) out.push(m[1].trim());
  const stripped = text.replace(closed, "");
  const open = /^==([^=\n]{2,160})$/gm;
  while ((m = open.exec(stripped))) out.push(m[1].trim());
  return [...new Set(out.filter(Boolean))];
}

const SKIP_HEADING = /^(一言でいうと|ほかに触れていたこと|言葉の意味|何を見たか|他に見つかったもの)/;

// ---------- 鋭さを測る（2026-10-14）----------
// これまで選定は、ハイライト・新しさ・再登場の間隔だけを見ていた。
// 節の中身が鋭いかどうかは一度も見ていない。実測すると、同じ日の候補でも
// 反転0・数字1・引用0の薄い節と、反転2・数字4・引用2の濃い節が並んでいた。
// 洞察が宿るのは、読み手の予想を裏切る文、数字の入った文、本人の言葉。
const REVERSAL_LINE = /(ではない|ではなく|に見えて|実は|逆に|裏を返せば|ところが|むしろ|と思われがち|にもかかわらず|どころか|勘違い|誤解|思い込)/;
const QUOTE_LINE = /\*「|^\s*>/;
const NUM_LINE = /\d/;
function lineScore(l) {
  let v = 0;
  if (REVERSAL_LINE.test(l)) v += 3;
  if (NUM_LINE.test(l)) v += 2;
  if (QUOTE_LINE.test(l)) v += 2;
  if (/(だから|なぜなら|からだ|その結果|つまり)/.test(l)) v += 1;
  return v;
}
function cleanLine(l) {
  return l.replace(/^[\s>\-*•]+/, "").replace(/\*\*?/g, "").replace(/^==|==$/g, "").trim();
}
// 節の中から「核になりうる文」を取り出す。書き手はこの中から1つを選んで掘る。
function sharpLinesOf(body) {
  const lines = String(body || "").split("\n").map(cleanLine)
    .filter(l => charCount(l) >= 18 && charCount(l) <= 160 && !/^[|#]/.test(l));
  return [...new Map(lines.map(l => [l, l])).values()]
    .map(l => ({ l, v: lineScore(l) }))
    .filter(x => x.v >= 2)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map(x => x.l);
}
function sharpness(body) {
  return String(body || "").split("\n").reduce((a, l) => a + lineScore(l), 0);
}

// 生成物フォルダのファイル名は `YYYY-MM-DD_テーマ.md`、vault側は日付なし。
// 同じ論点が経路の違いで別IDになると、45日の重複防止が2系統に割れる。
function noteIdOf(file) {
  return path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}_/, "");
}
function parseNote(file) {
  const noteId = noteIdOf(file);
  const text = fs.readFileSync(file, "utf8");
  const fm = parseFrontmatter(text);
  const noteTitle = (text.match(/^#\s+(.+)$/m) || [])[1] || path.basename(file, ".md");
  const body = text.slice(text.indexOf("\n# ") + 1 || 0);

  // 2026-10-19 改訂後のレポートは「## 概要」（表＋段落）で始まり、要点は「## 持ち帰る洞察」に出る。
  // 複数本のときは見出しに「A. 」が付く。旧構成（まず、何の話か／自分の問いに戻ると／Xの考え）も読めるままにする。
  const SEC = "^##\\s*(?:[A-Z][.．｜]\\s*)?[0-9.]*\\s*";
  const overviewRaw = (body.match(new RegExp(SEC + "(?:まず、何の話か|概要)\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n$)", "m")) || [])[1] || "";
  const overview = overviewRaw.split("\n").filter(l => !/^\s*\|/.test(l)).join("\n");   // 表の行は落として段落だけ残す
  const backToQuestion = (body.match(new RegExp(SEC + "(?:自分の問いに戻ると|持ち帰る洞察|全体を通して|付記[：:].*|明日から.*)\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)", "m")) || [])[1] || "";
  const speakerFromHeading = (body.match(/^##\s*[0-9.]*\s*(.+?)の考え\s*$/m) || [])[1] || "";

  // 発信者と「この人は何者か」を拾う（推測で人名を作らない）。
  // 表の向きがノートによって違うので、落とした候補の表（他に見つかったもの）より前だけを見る。
  const mainBody = body.split(/^##\s*[0-9.]*\s*他に見つかったもの/m)[0];
  const rowCell = (label) => {
    const m = mainBody.match(new RegExp("^\\|\\s*" + label + "\\s*\\|\\s*([^|]+?)\\s*\\|", "m"));
    return m ? m[1] : "";
  };
  const linkRow = (mainBody.match(/^\|\s*\[[^\]]+\]\(https?:\/\/[^)]*(?:youtube|youtu\.be)[^)]*\)[^\n]*\|$/m) || [])[0] || "";
  const cells = linkRow ? linkRow.split("|").slice(1, -1).map(c => c.trim()) : [];
  const stripCount = (s) => String(s || "").replace(/[（(][^）)]*[)）]\s*$/, "").trim();

  const videoUrl = (fm.sources || [])[0] ||
    ((mainBody.match(/\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^)]+)\)/) || [])[1] || "");
  const nameCell = rowCell("チャンネル") || rowCell("発信者");
  const channel = stripCount(
    ((nameCell.match(/^\[([^\]]+)\]/) || [])[1]) || nameCell ||
    ((cells[1] || "").match(/^\[([^\]]+)\]/) || [])[1] || ""
  );
  const roleFromRow = rowCell("話者[^|]*");
  // 新構成の縦表「| 話者 | 名前。肩書 |」は、最初の句点までが名前
  const speakerName = speakerFromHeading || (roleFromRow ? roleFromRow.split(/[。．.]/)[0].trim() : "");
  // 横並びの表なら最後のセルが「何者か」。数値だけの列は採らない。
  const lastCell = [...cells].reverse().find(c => [...c].length >= 8 && !/^[\d,.万億\s:分秒年前%*]+$/.test(c)) || "";
  const speakerRole = roleFromRow || (cells.length > 2 ? lastCell : "");

  const noteHighlights = highlightsIn(text);

  // ### 見出し単位で論点を切り出す
  const sections = [];
  const re = /^###\s+(.+)$\n([\s\S]*?)(?=^###\s|^##\s|\Z)/gm;
  let m, n = 0;
  while ((m = re.exec(body))) {
    const heading = m[1].replace(/^\(?\d+[-.)]?\)?\s*/, "").trim();
    const raw = m[2].trim();
    if (SKIP_HEADING.test(heading)) continue;
    if (charCount(raw) < MIN_SECTION_CHARS) continue;
    n++;
    const quotes = (raw.match(/^\*「[^*]+」\*/gm) || []).map(s => s.replace(/^\*|\*$/g, ""));
    sections.push({
      sectionId: `${noteId}#${n}`,
      claim: heading,
      body: raw,
      quotes,
      highlights: highlightsIn(raw),
      sharpLines: sharpLinesOf(raw),
      sharpness: sharpness(raw)
    });
  }

  return {
    noteId,
    notePath: file,
    noteTitle,
    created: fm.created || "",
    question: fm.question || "",
    notebooklm: fm.notebooklm || "",
    videoUrl,
    speaker: { name: speakerName || channel || "", role: speakerRole || "" },
    overview: overview.trim(),
    backToQuestion: backToQuestion.trim(),
    noteHighlights,
    sections
  };
}

// ---------- 状態 ----------
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) { return { used: {} }; }
}

// ---------- 選ぶ ----------
function rank(note, section, state) {
  const last = state.used[section.sectionId];
  const age = last ? daysBetween(last, DATE) : null;
  if (last && age < RECALL_DAYS) return null;            // 間隔が足りない
  let score = 0;
  if (section.highlights.length) score += 100;            // 本人が線を引いた論点
  if (note.noteHighlights.length) score += 30;            // 線を引いたノートの他の論点
  if (!last) score += 20;                                 // まだ一度も出していない
  if (note.created) score += Math.max(0, 20 - Math.max(0, daysBetween(note.created, DATE)) / 3);
  if (last) score += Math.min(15, (age - RECALL_DAYS) / 6);
  if (section.quotes.length) score += 5;                  // 本人の言葉がある＝核の論点
  // 鋭さ。反転・数字・本人の言葉が多い節ほど、掘る価値がある。
  // 上限を付けるのは、長いだけの節が常に勝つのを防ぐため。
  score += Math.min(40, section.sharpness * 2);
  if (!section.sharpLines.length) score -= 25;            // 核になる文が1つも無い節は後回し
  return score;
}

function readable(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
    // iCloud配下はディレクトリ一覧だけ読めても、個別ファイルの本文が
    // TCC/同期状態で読めないことがある。本文まで確認してから採用する。
    for (const f of files) fs.readFileSync(path.join(dir, f), "utf8");
    return true;
  } catch (e) { return false; }
}
function main() {
  let source = VAULT, via = "vault";
  if (!readable(source)) {
    if (readable(MIRROR)) { source = MIRROR; via = "mirror"; }
    else {
      console.error(`ERROR: vaultもミラーも読めません: ${VAULT}\n` +
        `  → 先に node tools/mirror-vault.js を vault が読める環境で実行してください。\n` +
        `  → 生成物フォルダ（youtube_search）で代用しないこと。ハイライトが無く、選定の第一優先が効きません。`);
      process.exit(1);
    }
  }
  const files = fs.readdirSync(source).filter(f => f.endsWith(".md")).map(f => path.join(source, f));
  const state = readState();
  const cands = [];
  const skipped = [];
  for (const f of files) {
    let note;
    try { note = parseNote(f); } catch (e) { skipped.push(`${path.basename(f)}: ${e.message}`); continue; }
    if (!note.sections.length) { skipped.push(`${note.noteId}: 論点(###)が取れない`); continue; }
    if (!note.videoUrl) { skipped.push(`${note.noteId}: 元動画URLが無い`); continue; }
    for (const s of note.sections) {
      const score = rank(note, s, state);
      if (score == null) continue;
      cands.push({ score, note, section: s });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.section.sectionId.localeCompare(b.section.sectionId));
  if (via === "mirror") console.log(`(vaultを直接読めないため、ミラーを使用: ${path.relative(ROOT, MIRROR)})`);
  const withHl = cands.filter(c => c.note.noteHighlights.length).length;
  if (!withHl) console.log("警告: ハイライトのあるノートが1件も無い。読んでいる正本と違う場所を見ている可能性がある");

  // 同じノートから2本以上出さない（同じ話を続けて読まされない）
  const picked = [];
  const usedNotes = new Set();
  for (const c of cands) {
    if (picked.length >= COUNT) break;
    if (usedNotes.has(c.note.noteId)) continue;
    usedNotes.add(c.note.noteId);
    picked.push(c);
  }
  // ノートが足りなければ同一ノートの別論点で埋める
  for (const c of cands) {
    if (picked.length >= COUNT) break;
    if (picked.includes(c)) continue;
    picked.push(c);
  }

  const briefs = picked.map(({ note, section, score }) => ({
    schema: "sokugan-review-brief-v1",
    id: `review-${slug(note.noteId)}-${section.sectionId.split("#")[1]}`,
    date: DATE,
    sectionId: section.sectionId,
    noteId: note.noteId,
    notePath: note.notePath,
    noteTitle: note.noteTitle,
    researchedOn: note.created,
    question: note.question,
    notebooklm: note.notebooklm,
    videoUrl: note.videoUrl,
    speaker: note.speaker,
    overview: note.overview,
    claim: section.claim,
    body: section.body,
    quotes: section.quotes,
    sharpLines: section.sharpLines,
    sharpness: section.sharpness,
    highlights: section.highlights,
    noteHighlights: note.noteHighlights,
    backToQuestion: note.backToQuestion,
    rankScore: Math.round(score),
    lastUsed: state.used[section.sectionId] || null
  }));

  const out = { schema: "sokugan-review-briefs-v1", date: DATE, count: briefs.length, vault: VAULT, briefs };
  if (DRY) { console.log(JSON.stringify(out, null, 2)); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${DATE}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  for (const b of briefs) state.used[b.sectionId] = DATE;
  state.updatedAt = DATE;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

  console.log(`${briefs.length}件を選定 → ${path.relative(ROOT, file)}`);
  for (const b of briefs) {
    console.log(`  [${b.rankScore}] ${b.noteId} / ${b.claim}${b.highlights.length ? "  ★ハイライトあり" : ""}${b.lastUsed ? `  (前回 ${b.lastUsed})` : ""}`);
  }
  if (skipped.length) console.log(`(対象外 ${skipped.length}件)`);
}

main();
