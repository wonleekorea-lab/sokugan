#!/usr/bin/env node
/*
 * Obsidian vault の YouTube リサーチノートを、復習生成が読める場所へ複製する。
 *
 * なぜ要るか。launchd 配下の codex は macOS のプライバシー保護（TCC）で
 * iCloud Drive を読めず、EPERM で止まる。本人の `==ハイライト==` は vault に
 * しか無いので、読めないままだと選定の第一優先が黙って効かなくなる。
 * vault を読める環境（本人のログインセッション、Claude Code など）で
 * これを走らせておけば、夜間の生成はミラーへ落ちて同じ選定ができる。
 *
 * codex にフルディスクアクセスを与えれば、このミラーは不要になる。
 * それまでの保険であって、正本は常に vault のほう。
 *
 * 使い方:  node tools/mirror-vault.js [--vault PATH] [--dry-run]
 * 出力先:  private-imports/vault-mirror/   （gitignore配下・公開しない）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_VAULT = "/Users/wota/Library/Mobile Documents/iCloud~md~obsidian/Documents/Daily Brief/40_Knowledge/YouTube Research";
const MIRROR = path.join(ROOT, "private-imports", "vault-mirror");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const VAULT = arg("vault", DEFAULT_VAULT);
const DRY = process.argv.includes("--dry-run");

function highlightCount(text) {
  const closed = (text.match(/==([^=\n]{2,160})==/g) || []).length;
  const open = (text.replace(/==([^=\n]{2,160})==/g, "").match(/^==([^=\n]{2,160})$/gm) || []).length;
  return closed + open;
}

function main() {
  let files;
  try {
    files = fs.readdirSync(VAULT).filter(f => f.endsWith(".md"));
  } catch (e) {
    console.error(`ERROR: vaultを読めません: ${VAULT}\n  ${e.message}\n` +
      `  → iCloudを読める環境（本人のログインセッション）で実行してください。`);
    process.exit(1);
  }

  let copied = 0, skipped = 0, hl = 0;
  if (!DRY) fs.mkdirSync(MIRROR, { recursive: true });
  for (const f of files) {
    const src = path.join(VAULT, f);
    const dst = path.join(MIRROR, f);
    const text = fs.readFileSync(src, "utf8");
    hl += highlightCount(text);
    let same = false;
    try { same = fs.readFileSync(dst, "utf8") === text; } catch (e) { same = false; }
    if (same) { skipped++; continue; }
    if (!DRY) fs.writeFileSync(dst, text);
    copied++;
  }
  // vaultから消えたノートはミラーからも落とす（古い論点が復習に残り続けないように）
  let removed = 0;
  if (!DRY) {
    for (const f of fs.readdirSync(MIRROR).filter(x => x.endsWith(".md"))) {
      if (!files.includes(f)) { fs.unlinkSync(path.join(MIRROR, f)); removed++; }
    }
  }
  console.log(`vault ${files.length}件 → ミラー（更新${copied} / 変更なし${skipped}${removed ? ` / 削除${removed}` : ""}）`);
  console.log(`ハイライト ${hl}箇所。0なら、読んでいる正本と違う場所を見ている`);
  console.log(`出力先: ${path.relative(ROOT, MIRROR)}`);
}

main();
