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
- 更新手順: `node scripts/fetch-jp-postal-data.mjs --fetch --url <配布ページで確認した直URL>`（または環境変数 `JP_POSTAL_ZIP_URL`。直URLなしの `--fetch` 単体はRC2で止まる。配布ページの自動解析はしない）→SHA256・件数を控える→検証DBへ取り込み→件数と readiness を確かめる→ここへ取得日・入力SHA・件数・生成物を追記する。

## 取込SQLの分割適用の設計（D1の文長上限対応）

- 公式D1上限（2026-10-02確認、https://developers.cloudflare.com/d1/platform/limits/ ）: 1文の長さは最大100,000バイト、1問合せの束縛変数は最大100個。22MBを1文のINSERTにすると上限を超えるため、生成SQLは1文が80KBを超えないようバイト数で区切った複文にする（文数・上限値は生成manifest.jsonの `importBatches`・`statementByteBudget`・`statementByteLimit` に記録）。
- 適用順は完了記録（`postal_import_manifest` の1文）→本体の複文。どれも `INSERT OR REPLACE` のため再適用は冪等。順に適用し、途中で失敗したら止める。
- 途中失敗時は `postal_codes` の件数が完了記録の `row_count` と合わないため、`readiness.fullDataset` は false のまま（部分適用を全国版と名乗らない）。再適用で最後まで入れ直せば件数が一致し、初めて全国版と名乗る。
- 実D1への適用は番号ごとの明示承認後。適用前の下書き検証はローカルのSQLiteで「全文本数＝完了記録」「各文が100KB以内」「完了記録＋先頭1文だけでは件数不一致（readiness相当がfalse）」を確かめる。
- 現状: 実DB未適用。`GET /api/postal-code/search` は内蔵見本で答え、`readiness.fullDataset: false` を名乗る。実DB適用は番号ごとの明示承認後。
- readinessは件数だけで真にしない。`postal_import_manifest` の完了記録と件数が一致し、由来が公式配布のときだけ全国版と名乗る。部分・見本はfalse。

## 見本fixture

- `apps/worker/src/data/postal-code-sample.json`: 先頭0（0600000）・複数候補（1000001×2件）・該当なし確認用の少数見本。
- `scripts/test-data/jp-postal-sample.csv`: 取込手順の試験用（実配布と同じ15列形）。
