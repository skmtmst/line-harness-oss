# 郵便番号データの出どころ（F11）

- 取得元（公式・司令塔が存在確認済み）: https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html
- 形式説明: https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html
- K作業時（2026-10-02）の確認: 砂場からの直接取得はSSL検証で届かず、内容の照合は未了。司令塔の存在確認を根拠にする。
- 利用時の検索は取り込んだ `postal_codes` 表だけを読み、外部通信はしない。顧客情報を外へ送らない。
- 7桁は文字列で持つ（先頭0保持）。同じ番号の複数候補は1つに潰さない。該当なし・無効入力・手入力保持をAPIで返す。
- 全量の生CSVはソースへ入れない。生成物は取り込み用SQLと見本fixtureだけ。
- 更新手順: `scripts/fetch-jp-postal-data.mjs --fetch` で取得→SHA256・件数を控える→検証DBへ取り込み→件数と readiness を確かめる→ここへ取得日・入力SHA・件数・生成物を追記する。
- 現状: 全量未取り込み。`GET /api/postal-code/search` は内蔵見本で答え、`readiness.fullDataset: false` を名乗る。実DB適用は番号ごとの明示承認後。

## 見本fixture

- `apps/worker/src/data/postal-code-sample.json`: 先頭0（0600000）・複数候補（1000001×2件）・該当なし確認用の少数見本。
