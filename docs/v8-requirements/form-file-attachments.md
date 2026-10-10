# 回答フォームの書類の添付の決まり（B-176）

- 出どころ：オーナー決定 B-176（2026-10-09。migration 621 の 1 行目に記録）。列車13 で実装が本線に入ったが、要件の文書に書かれていなかったため、ここに写す。
- 対象：回答フォームの「ファイル」の質問（写真・PDF・本人確認書類）。
- 除外：ブロック番号を付けない旧経路（`apps/worker/src/routes/forms.ts:2259` 以降。画像だけを `form-uploads/` に保存する）は、この文書の対象外。
- 動きの正本はこの文書。見た目は ★V8 の絵と `docs/v8-design-rules.md` に従う。
- 「食い違い」の節は、依頼に書かれた決定と実装が合わない所を記録したもの。決定の文言は書き換えていない。

## 1. 目的

お客さまが回答フォームから写真・PDF・本人確認書類を送れるようにし、担当者が回答と一緒に確認できるようにする。本人確認書類は見られる人を絞り、保存期限が来たら自動で消す。

## 2. 受け取れる物

| 種類 | 中身 | 形式 | 1ファイルの上限 | 枚数 |
|---|---|---|---|---|
| 写真（image） | 写真 | JPEG・PNG・GIF・WebP・HEIC・HEIF | 10MB | 欄ごとに 1〜10 枚（既定 1） |
| PDF（pdf） | 書類 | PDF | 10MB | 同上 |
| 本人確認書類（identity） | 免許証・保険証など | 写真の形式。PDF は欄の種類に「PDF」を含むときだけ | 10MB | 同上。表と裏のある欄は 2 枚 |

- 上限の根拠：`apps/worker/src/routes/form-documents.ts:21`（`Content-Length` の事前確認）と `:25-31`（読みながら 10,485,760 バイトで打ち切り）。
- 形式の根拠：`apps/worker/src/routes/form-documents.ts:12`（許す形式の一覧）と `:17-18`（欄の種類に無い形式は 400）。
- 空のファイルは受け取らない（`:32`）。
- 表と裏：本人確認書類で「表と裏」を指定した欄だけ、`side` に `front` / `back` を付ける（`:19-20`）。それ以外は `single`。
- 枚数：`apps/worker/src/services/form-documents.ts:13-15`（表と裏は 2、ほかは 1〜10）。欄の設定も 1〜10 に限る（`packages/shared/src/form-layout.ts:1312`）。
- 実装上の注意：保存される `file_kind` は、欄が持つ種類の代表（本人確認 > 写真 > PDF）であり、送られた実際の形式ではない（`packages/shared/src/form-layout.ts:212-216`、`apps/worker/src/routes/form-documents.ts:15,49`）。詳しくは「食い違い」の 4。

## 3. 本人確認書類の扱い

- 見られる人は**オーナーと管理者だけ**。スタッフには、中身もファイル名も出さず「見る権限がありません」と出す（`apps/worker/src/services/form-documents.ts:26-28`、`apps/worker/src/routes/form-documents.ts:73`、`apps/web/src/v8/form-responses/responses.tsx:68`）。
- 表と裏は同じ扱い。
- 保存期限は受け取った時から数える（`apps/worker/src/routes/form-documents.ts:46`）。既定は 90 日（`apps/worker/src/services/form-documents.ts:16-20`）。
- 保存日数の変更はオーナーと管理者だけ。1〜3650 日の整数（`apps/worker/src/routes/form-documents.ts:80-93`、`:90`）。設定は「これから受け取る書類」に使う（`apps/web/src/components/shared/form-document-retention.tsx:30`）。
- 欄の編集画面では、本人確認を含む欄に「オーナー・管理者だけが見られ、保存期限で自動で消えます」と書く（`apps/web/src/v8/form-edit/edit.tsx:16`）。

## 4. 取り込み時の検査

お客さまが送ると、次の順で進む（`apps/worker/src/routes/form-documents.ts:37-66`）。

1. 形式・表裏・サイズを確かめる（`:17-32`）。ここで落ちたものは保存しない。
2. 内蔵の検査（`builtinFileScan`、`:39-44`）。中身の署名（先頭の印）、末尾の余計なデータ、PDF の危険な仕掛け・マクロ・実行ファイルの印を見る（`apps/worker/src/services/file-scan.ts:284-286` ほか）。不合格なら保存せず 422 `file_scan_blocked`。
3. 保存先は `private/form-documents/{店のID}/{ID}.{拡張子}`（`:37`）。R2 に置き、DB に行を作る（`:47-51`）。
4. 外部の検査（設定があるときだけ。`:52-62`）。問題があれば隔離して 422（`:63`）。外部に届かないときは検査中のまま 201 を返す（`:60`）。
5. 問題がなければ clean（`:62`）。

- 検査中（pending）の書類は、回答の送信で使えない（`apps/worker/src/services/form-documents.ts:63`）。LIFF では「（検査中）」と出す（`apps/liff/src/components/forms/controls.tsx:124`）。
- 止まった検査は、cron が 5 分おきに拾って再試行する（`apps/worker/src/index.ts:1514-1516`、`apps/worker/src/routes/file-scan.ts:99-150`、`apps/worker/wrangler.toml:44`）。待ち時間は 1 分→5 分→15 分→1 時間→6 時間で頭打ち（`apps/worker/src/services/file-scan.ts:305-308`）。
- pending を clean に格上げしない。何度再試行しても終わらないときは、自動で却下もしない（「食い違い」の 7）。
- 落ちた書類は回答に付かない。お客さまは別のファイルを選び直す。

## 5. 保存と自動で消す

- 本人確認書類：受け取りから保存日数が過ぎたら、cron が R2 の実体を消し、行に消した印（`deleted_at`、`deletion_reason = 'expired'`）を残す（`apps/worker/src/services/form-documents.ts:85-98`、`apps/worker/src/index.ts:1456-1458`）。
- 回答に付かないまま 1 日経った書類（写真・PDF・本人確認書類のすべて）は、`deletion_reason = 'abandoned'` で消す（`apps/worker/src/services/form-documents.ts:87`）。
- 消す順番は R2 が先。R2 の削除が失敗したら行は消さず、次の cron でやり直す（`:91-95`）。
- 写真・PDF で回答に付いたものの期限は、実装にない（「食い違い」の 2）。
- 退会（友だちの削除）に連動して消す処理は、実装にない（「食い違い」の 3）。
- 中身の配信は必ず API を通す（`apps/worker/src/routes/form-documents.ts:69-79`）。応答は `Cache-Control: private, no-store`、`Content-Security-Policy: sandbox; default-src 'none'`、`X-Content-Type-Options: nosniff`。R2 の鍵は直接見せない。

## 6. 権限ごとの見え方

| 役割 | 回答の一覧・詳細 | 写真・PDF の中身 | 本人確認書類の中身 | 保存日数の設定 |
|---|---|---|---|---|
| オーナー・管理者 | 見える（ファイル名つき） | 見える（検査が clean のとき） | 見える（検査が clean のとき） | 見て、変えられる |
| スタッフ | 見える（写真・PDF はファイル名つき） | 見える（担当するアカウントの中だけ） | 見えない。中身もファイル名も出ない | 見るだけ（保存ボタンは出さない） |

- 担当していないアカウントの書類は 404（`apps/worker/src/routes/form-documents.ts:72`）。
- 回答の一覧の表示根拠：`apps/worker/src/routes/forms.ts:1660,1683,1709`、`apps/worker/src/routes/friends.ts:1296`。

## 7. 失敗したときの動き

| 場面 | 返す | 利用者に出す言葉 |
|---|---|---|
| 欄の種類にない形式 | 400 | この質問で受け取れる形式を選んでください |
| 10MB を超える | 400 | 1ファイル10MBまでです |
| 空のファイル | 400 | ファイルが空です |
| 表か裏の指定が違う | 400 | 表か裏を選んでください |
| 内蔵の検査で不合格 | 422 `file_scan_blocked` | 安全を確認できませんでした。別のファイルを選んでください |
| 外部の検査で問題あり | 422 `file_scan_blocked` | 同上 |
| 検査中の書類を含んだまま送信 | 400 | 添付を検査しています。終わってから送信してください |
| 別の欄・別のフォーム・別のお客さまの書類 | 400 | 書類を送りなおしてください |
| 別の回答にすでに付いている書類 | 400 | この書類はすでに回答に添付されています |
| 枚数が違う | 400 | 添付の枚数を確認してください |
| 本人確認書類の表か裏が揃わない | 400 | 本人確認書類の表と裏を送ってください |
| 期限の過ぎた書類を開く | 410 | 期限で消しました |
| 検査が終わっていない書類を開く（隔離を含む） | 409 | 検査が終わるまで開けません |
| 本人確認書類を、権限のない人が開く | 403 | 見る権限がありません |
| 保存日数が範囲外 | 400 | 保存日数は1〜3650日で入力してください |
| 回答の保存で書類を付ける処理が失敗 | 例外（`document_attachment_failed` / `document_already_submitted`、`apps/worker/src/services/form-documents.ts:80-82`） | 利用者の画面の言葉は未定義（「食い違い」の 9） |

- 管理画面は、期限切れを「期限で消しました」、権限なしを「見る権限がありません」と出す（`apps/web/src/v8/form-responses/responses.tsx:68`）。

## 8. 合格条件

試験で確かめられる形で書く。

- [ ] 10,485,760 バイトちょうどは受け取り、+1 バイトは 400 になり、R2 にも DB にも残らない。
- [ ] 空のファイルは 400。
- [ ] 欄の種類に「PDF」がない欄へ PDF を送ると 400。
- [ ] 内蔵の検査で不合格になった中身は R2 に保存されず、422 `file_scan_blocked` が返る。
- [ ] 外部の検査で問題があった書類は 422 で、回答に付かない。
- [ ] 検査が pending の書類を含む回答は送信できず、clean になってから送れる。
- [ ] 検査の再試行は 1 分→5 分→15 分→1 時間→6 時間の間隔で、pending を clean にしない。
- [ ] 本人確認書類は、スタッフの回答一覧で中身もファイル名も出ず、中身の取得は 403。
- [ ] 保存日数は 1〜3650 の整数だけを受け、既定は 90。
- [ ] 期限の過ぎた本人確認書類は cron で R2 から消え、行は `deleted_at` 付きで残り、取得は 410。
- [ ] 回答に付かないまま 1 日経った書類は cron で消える。
- [ ] 表と裏のある欄は、表か裏が揃わない回答を 400 で止める。
- [ ] 別の回答に付いた書類は、別の回答では使えない。
- [ ] 担当していないアカウントの書類は 404。
- [ ] 閲覧のみの人には保存日数の保存ボタンを出さない（`apps/web/src/components/shared/form-document-retention.tsx:32`）。
- [ ] 上の項目は `apps/worker/src/routes/form-documents.test.ts` のどこかで守られている。守られていない項目は試験を足す。

## 9. 根拠

- オーナー決定 B-176（2026-10-09）。migration 621 の 1 行目のコメント。
- migration：`packages/db/migrations/621_form_submission_files.sql:2-24`（表・上限 10,485,760 バイトの CHECK は `:15`、期限は `:18`、削除の印は `:19-20`）。
- 受け取り・保存・配信：`apps/worker/src/routes/form-documents.ts`（全体）。
- 検査・再試行：`apps/worker/src/services/file-scan.ts:284-286,305-308`、`apps/worker/src/routes/file-scan.ts:87-94,99-150`、`apps/worker/src/index.ts:1456-1458,1514-1516`、`apps/worker/wrangler.toml:44`。
- 状態・権限・期限・削除：`apps/worker/src/services/form-documents.ts`（全体）。
- 回答フォームの経路：`apps/worker/src/routes/forms.ts:2255-2257`（欄の受け取り）、`:2603-2604`（送信時の確認）、`:2873`（回答への紐づけ）、`apps/worker/src/routes/friends.ts:1296`、`apps/worker/src/middleware/feature-enforcement.ts:401`。
- 画面：`apps/liff/src/components/forms/controls.tsx:89-135`、`apps/web/src/v8/form-responses/responses.tsx:68`、`apps/web/src/v8/form-edit/edit.tsx:7-16`、`apps/web/src/components/shared/form-document-retention.tsx:12-33`。
- 共有の型と検査：`packages/shared/src/form-layout.ts:200-216`、`:1135-1139`、`:1309-1313`。
- 試験：`apps/worker/src/routes/form-documents.test.ts`。

## 10. 食い違い

依頼に書かれたオーナー決定の要点は次のとおり。1 ファイル 10MB まで。本人確認書類はオーナーと管理者だけ。90 日で自動で消す（日数は設定）。取り込み時にウイルス検査。

1. **ウイルス検査**：内蔵の検査はウイルス検査ではない。形式の印・末尾の余計なデータ・PDF の仕掛け・マクロ・実行ファイルの印を見る（`apps/worker/src/services/file-scan.ts:284-286`）。ウイルスを見る外部の検査は、管理画面で設定したときだけ動く（`apps/worker/src/routes/form-documents.ts:52-62`）。設定がない店では、ウイルス検査は行われない。
2. **90 日の自動削除の範囲**：実装は本人確認書類だけに期限を付ける（`apps/worker/src/routes/form-documents.ts:46`）。写真・PDF は回答に付いた後、期限なしで残る。決定の「90 日で自動で消す」が全部の書類を指すのか、本人確認書類を指すのかは、まだ決まっていない。
3. **退会時の削除**：実装がない。友だちを削除・退会させる経路は見当たらない（`apps/worker/src/routes/friends.ts` の DELETE はタグの削除だけ、`:1396`）。決定の文言にはないが、保存と自動で消すの一部として確かめた。
4. **種類の代表**：`file_kind` は欄の代表（本人確認 > 写真 > PDF）。PDF を写真と PDF の欄に送ると写真扱いになる。PDF を本人確認の欄に送ると本人確認扱いになり、閲覧の制限と期限がつく（`packages/shared/src/form-layout.ts:212-216`）。決定の文言にはない。
5. **隔離と検査中の表示**：隔離された書類も、管理画面では「検査が終わるまで開けません」の 409 になる（`apps/worker/src/routes/form-documents.ts:75`）。隔離と検査中を分けていない。
6. **外部の検査で問題があった書類**：R2 に残ったまま、回答に付かないので 1 日後に放棄として消える（`apps/worker/src/routes/form-documents.ts:52-63`、`apps/worker/src/services/form-documents.ts:87`）。すぐには消さない。
7. **検査が終わらないとき**：再試行は続くが、回数の上限がない。何度も止まった書類は pending のまま、自動では却下されない（`apps/worker/src/services/file-scan.ts:305-308`）。決定の文言にはない。
8. **LIFF の注記**：`FORM_FILE_NOTE`（`apps/liff/src/components/forms/controls.tsx:90`）は「画像のみ」のままで、PDF を受け取る欄の案内と合わない。この定数は使われていない。
9. **回答の保存で書類を付ける失敗**：利用者の画面に出す言葉が決まっていない（`apps/worker/src/services/form-documents.ts:80-82`）。
