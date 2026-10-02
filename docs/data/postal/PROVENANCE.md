# 郵便番号データの出どころ（F11）

- 取得元（公式）: https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html
- 形式説明: https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html
- 実取得の直URL（配布ページから取得・2026-10-02確認）: https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip

## 実取得の記録（2026-10-02・K作業）

- 由来: https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip
- 入力SHA256: 444881769a631d2c36c644fc041e5ce62fe65d204ff498a601641ba1e66b5955（2135514 bytes）
- 件数: 124525件（除外 1行）/ 2026-10-02T19:00:54+09:00
- 生成: data/postal/manifest.json（版に残す）、data/postal/import-jp-20261002.sql（22MB・置き場のみ）
- 先頭0の保持と複数候補の存在を確認（例: 0600000、4520961は66行）。
- 利用時の検索は取り込んだ `postal_codes` 表だけを読み、外部通信はしない。顧客情報を外へ送らない。
- 7桁は文字列で持つ（先頭0保持）。同じ番号の複数候補は1つに潰さない。該当なし・無効入力・手入力保持をAPIで返す。
- 全量の生CSV・zip・取込SQLはソースへ入れない（.gitignoreのdata/postal*。manifest.jsonだけ残す）。
- 更新手順: `node scripts/fetch-jp-postal-data.mjs --fetch`（直URLは配布ページから確認し--urlで上書き可）→SHA256・件数を控える→検証DBへ取り込み→件数と readiness を確かめる→ここへ取得日・入力SHA・件数・生成物を追記する。
- 現状: 実DB未適用。`GET /api/postal-code/search` は内蔵見本で答え、`readiness.fullDataset: false` を名乗る。実DB適用は番号ごとの明示承認後。
- readinessは件数だけで真にしない。`postal_import_manifest` の完了記録と件数が一致し、由来が公式配布のときだけ全国版と名乗る。部分・見本はfalse。

## 見本fixture

- `apps/worker/src/data/postal-code-sample.json`: 先頭0（0600000）・複数候補（1000001×2件）・該当なし確認用の少数見本。
- `scripts/test-data/jp-postal-sample.csv`: 取込手順の試験用（実配布と同じ15列形）。
