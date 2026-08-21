#!/usr/bin/env node
// =============================================================
// Sokugan QA 自動修復 — daily-content.json の chunks/genre を再生成
// index.html内の chunkText（単一の真実）を抽出して使用する。
// 使い方: node qa/repair-chunks.js
// 終了コード: 0=修復済(直接書込) / 2=.repaired.json に出力(要rm+mv) / 1=エラー
// =============================================================
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// index.html 内の唯一のチャンカー実装を sentinel で切り出して共有（コードの二重化を防ぐ）
const seg = html.split('/*__CHUNKER_START__')[1];
if (!seg) { console.error("chunker抽出失敗 — index.htmlの __CHUNKER_START__ が見つからない"); process.exit(1); }
const block = seg.split('/*__CHUNKER_END__*/')[0];
eval(block.substring(block.indexOf('*/') + 2));

const file = path.join(ROOT, 'daily-content.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const genreGuess = t => /スタートアップ|起業|創業|資金調達|VC/.test(t) ? "スタートアップ" : /AI|技術|テック|半導体|ソフト/.test(t) ? "AI・技術" : /環境|気候|水|規制|政策|脱炭素/.test(t) ? "規制・環境" : /組織|リーダ|人事|経営|戦略|マネジ/.test(t) ? "経営・組織" : /経済|市場|金融|株/.test(t) ? "市場・経済" : "スタートアップ";
let fixedN = 0;
for (const p of d.passages || []) {
  if (!p.genre) { p.genre = genreGuess((p.tag || "") + (p.title || "")); fixedN++; }
  if (!validChunks(p)) { p.chunks = chunkText(p.text); fixedN++; }
  if (!validChunks(p)) { console.error("修復後も不正:", p.id); process.exit(1); }
}
if (fixedN === 0) { console.log("修復不要（全パッセージ正常）"); process.exit(0); }
// バックアップ
const bak = path.join(ROOT, 'archive', (d.date || 'unknown') + '_pre-repair_' + Date.now() + '.json');
try { fs.copyFileSync(file, bak); } catch (e) {}
d.source_note = (d.source_note || "") + " | auto-repaired by QA " + new Date().toISOString().slice(0, 10);
const out = JSON.stringify(d, null, 1);
JSON.parse(out); // self-validate
try {
  fs.writeFileSync(file, out, 'utf8');
  console.log(`修復完了（${fixedN}件） → daily-content.json 直接書込`);
  process.exit(0);
} catch (e) {
  fs.writeFileSync(file + '.repaired.json', out, 'utf8');
  console.log(`権限不足のため daily-content.json.repaired.json に出力。allow_cowork_file_delete を呼んでから:\n  rm daily-content.json && mv daily-content.json.repaired.json daily-content.json`);
  process.exit(2);
}
