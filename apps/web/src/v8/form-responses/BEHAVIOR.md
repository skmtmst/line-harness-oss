# 集まった回答（V8）の動き

入口：`app/form-submissions/responses/page.tsx`（V8 のときだけ `src/v8/form-responses/responses.tsx`）。v7 の画面・試験は触らない。
絵：まとめて見る `v0SbYR`・1件ずつ見る `MKQyJ`。型と言葉は `summary.ts`（今の response-summary.ts の写し）。

## 受け付ける URL と指定（今と同じ）
- `/form-submissions/responses?id=<フォーム>`

## 呼ぶ口（今と同じ）
- `GET /api/forms/:id`、`GET /api/forms/:id/submissions?page&limit&q`（検索はサーバーで）
- CSV：同じ口を 200 件ずつ全部読む（5,000 件まで）
- 後処理のやり直し：`POST /api/forms/:id/submissions/:submissionId/retry-effects`

## 今の作りと違うところ
- 1件ずつ見るでは、右の詳細に最初の「未完」の回答（無ければ先頭）を出しておく（絵 MKQyJ）
- まとめて見るの上に「後処理が終わっていない回答が N 件あります」の帯。数えるのは読み込んだページの分（全件の数を返す口が無い）。ページが2つ以上あるときはそう書く。「その N 件を見る」で1件ずつ見るへ移り、最初の未完を選ぶ
- 5段階の質問は ★5・★4・★3以下 の3段にまとめる。平均は口の集計（ratingFields）
- 絵の「今月・先月・すべて」は、期間で絞る口が無いので置かず、同じ場所に「全 N 件から、名前と答えで探します」と書く
- 詳細の後処理は、口が「終わっていない工程」だけを返すので、その工程を「未完」で並べる（済んだ工程の一覧は出せない）
