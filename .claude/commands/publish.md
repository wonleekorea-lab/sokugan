---
description: QA合格を確認して GitHub Pages へ公開する
---

1. `node qa/harness.js` を実行する。
2. **全PASS（終了コード0）でなければ公開せず**、FAIL内容を報告して終了する。
3. 全PASSなら:
```bash
git add -A && git commit -m "publish: $(TZ=Asia/Tokyo date +%F)" && git push origin main
```
4. 公開URLと、反映まで1〜2分かかることを報告する。
