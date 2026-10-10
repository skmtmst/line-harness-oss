# 回答フォームの書類の添付の決まり（B-176・B-213）

- 出どころ：オーナー決定 B-176（2026-10-09。migration 621 の 1 行目に記録）。列車13 で実装が本線に入ったが、要件の文書に書かれていなかったため、ここに写す。
- 対象：回答フォームの「ファイル」の質問（写真・PDF・本人確認書類）。
- 除外：ブロック番号を付けない旧経路（`apps/worker/src/routes/forms.ts`。画像だけを `form-uploads/` に保存する）は、この文書の対象外。
- 動きの正本はこの文書。見た目は ★V8 の絵と `docs/v8-design-rules.md` に従う。
- 更新：オーナー決定 B-213（2026-10-10）。検査の呼び方・期限の範囲・種類の記録・検査失敗時の動きを明確にした。

## 1. 目的

お客さまが回答フォームから写真・PDF・本人確認書類を送れるようにし、担当者が回答と一緒に確認できるようにする。本人確認書類は見られる人を絞り、保存期限が来たら自動で消す。

## 2. 受け取れる物

| 種類 | 中身 | 形式 | 1ファイルの上限 | 枚数 |
|---|---|---|---|---|
| 写真（image） | 写真 | JPEG・PNG・GIF・WebP・HEIC・HEIF | 10MB | 欄ごとに 1〜10 枚（既定 1） |
| PDF（pdf） | 書類 | PDF | 10MB | 同上 |
| 本人確認書類（identity） | 免許証・保険証など | 写真の形式。PDF は欄の種類に「PDF」を含むときだけ | 10MB | 同上。表と裏のある欄は 2 枚 |

- 上限の根拠：`apps/worker/src/routes/form-documents.ts`（`Content-Length`の事前確認と、読みながら10,485,760バイトで打ち切り）。
- 形式の根拠：`apps/worker/src/routes/form-documents.ts`（許す形式の一覧と、欄の種類に無い形式は400）。
- 空のファイルは受け取らない。
- 表と裏：本人確認書類で「表と裏」を指定した欄だけ、`side` に `front` / `back` を付ける。それ以外は `single`。
- 枚数：`apps/worker/src/services/form-documents.ts`（表と裏は 2、ほかは 1〜10）。欄の設定も 1〜10 に限る（`packages/shared/src/form-layout.ts`）。
- `file_kind` は、本人確認を含む欄ならすべて `identity`。それ以外は送られた形式に合わせて写真を `image`、PDF を `pdf` と記録する。写真とPDFの欄へPDFを送っても写真扱いにしない。実際の形式は既存の `mime_type` に別に保存し、見本の写真／PDFの表示に使う。本人確認のPDFも形式はPDF、権限と期限は本人確認の扱い。DBの列追加は不要。

## 3. 本人確認書類の扱い

- 見られる人は**オーナーと管理者だけ**。スタッフには、中身もファイル名も出さず「見る権限がありません」と出す（`apps/worker/src/services/form-documents.ts`、`apps/worker/src/routes/form-documents.ts`、`apps/web/src/v8/form-responses/responses.tsx`）。
- 表と裏は同じ扱い。
- 保存期限は受け取った時から数える（`apps/worker/src/routes/form-documents.ts`）。既定は 90 日（`apps/worker/src/services/form-documents.ts`）。
- 保存日数の変更はオーナーと管理者だけ。1〜3650 日の整数（`apps/worker/src/routes/form-documents.ts`）。設定は「これから受け取る書類」に使う（`apps/web/src/components/shared/form-document-retention.tsx`）。
- 欄の編集画面では、本人確認を含む欄に「オーナー・管理者だけが見られ、保存期限で自動で消えます」と書く（`apps/web/src/v8/form-edit/edit.tsx`）。

## 4. 取り込み時の危ないファイルの検査

内蔵の「危ないファイルの検査」が標準。形式の印・末尾の余計なデータ・PDFの仕掛け・マクロ・実行ファイルの印を確かめる。外部の検査は設定した店だけで追加して使う。

お客さまが送ると、次の順で進む（`apps/worker/src/routes/form-documents.ts`）。

1. 形式・表裏・サイズを確かめる。ここで落ちたものは保存しない。
2. 内蔵の検査（`builtinFileScan`）。中身の署名（先頭の印）、末尾の余計なデータ、PDF の危険な仕掛け・マクロ・実行ファイルの印を見る（`apps/worker/src/services/file-scan.ts` ほか）。不合格なら保存せず 422 `file_scan_blocked`。
3. 保存先は `private/form-documents/{店のID}/{ID}.{拡張子}`。R2 に置き、DB に行を作る。
4. 外部の検査（設定があるときだけ）。問題があれば隔離を記録して実体をすぐ消し、422。外部に届かないときは検査中のまま 201 を返す。
5. 問題がなければ clean。

- 検査中（pending）の書類は、回答の送信で使えない（`apps/worker/src/services/form-documents.ts`）。LIFF では「（検査中）」と出す（`apps/liff/src/components/forms/controls.tsx`）。
- 止まった検査は、cron が5分おきに拾って再試行する（`apps/worker/src/routes/file-scan.ts`）。上限に達した書類の再試行や、隔離した書類を戻す操作は許さない。
- pending を clean に格上げしない。最初の失敗を含め、検査の失敗は最大5回。5回目で `rejected`（却下）にし、次の再試行の時刻を外す。自動再試行は1分→5分→15分→1時間。書類以外の検査の間隔は変更しない。却下後は別のファイルを選ぶ。
- 落ちた書類は回答に付かない。お客さまは別のファイルを選び直す。

## 5. 保存と自動で消す

- 本人確認書類：受け取りから保存日数が過ぎたら、cron が R2 の実体を消し、行に消した印（`deleted_at`、`deletion_reason = 'expired'`）を残す（`apps/worker/src/services/form-documents.ts`、`apps/worker/src/index.ts`）。
- 回答に付かないまま 1 日経った書類（写真・PDF・本人確認書類のすべて）は、`deletion_reason = 'abandoned'` で消す（`apps/worker/src/services/form-documents.ts`）。
- 消す順番は R2 が先。R2 の削除が失敗したら行は消さず、次の cron でやり直す。
- **90日の自動削除の範囲は決定どおり**：本人確認書類だけに期限を付ける。回答に付いた通常の写真・PDFに90日の期限は付けない（B-213）。
- 外部の検査で問題のあった書類は、アップロード時も再試行時もすぐR2から消す。R2の削除が失敗した場合は隔離の記録と鍵を残し、次の書類削除cronで1日を待たず消し直す。削除理由は `unsafe`。
- 削除の経路を調べた結果（B-213）：
  - **LINEのブロック**：`webhook.ts` の `unfollow` は友だちの状態を変更する。データ削除ではなく、書類は消さない（現行動作。ブロックでも消すかは司令塔の確認待ち）。
  - **契約を終えた店舗・統括の退会後**：保存の起点から90日後の顧客データ削除で、添付済み・未添付の書類とR2の実体を消す。列車13の反映履歴 #1685 はこの処理を指す（`tenant-data-purge.ts`、`data-retention-tables.ts`）。
  - **早期のデータ削除の依頼**：`requestTenantDataPurge` が統括の `purge_requested_at` を記録すると、90日を待たず同じ削除cronの対象になる。この依頼を受ける公開APIは現行コードにない。個別のLINE友だちの削除依頼を受けるAPIもない。
  - **回答の削除・個別の友だち削除**：現行のフォーム・友だちAPIにその操作はない。統括のデータ削除では書類→回答→友だちの順で消す。R2から書類を消せない時は行と親の記録を残し、削除完了にせず次回にやり直す。
  - **検査画面から書類を消す**：R2の実体を消した後に削除の印を残す。失敗した場合は503で再試行を促し、鍵と検査記録を残す。
- 中身の配信は必ず API を通す（`apps/worker/src/routes/form-documents.ts`）。応答は `Cache-Control: private, no-store`、`Content-Security-Policy: sandbox; default-src 'none'`、`X-Content-Type-Options: nosniff`。R2 の鍵は直接見せない。

## 6. 権限ごとの見え方

| 役割 | 回答の一覧・詳細 | 写真・PDF の中身 | 本人確認書類の中身 | 保存日数の設定 |
|---|---|---|---|---|
| オーナー・管理者 | 見える（ファイル名つき） | 見える（検査が clean のとき） | 見える（検査が clean のとき） | 見て、変えられる |
| スタッフ | 見える（写真・PDF はファイル名つき） | 見える（担当するアカウントの中だけ） | 見えない。中身もファイル名も出ない | 設定は取得できない（保存ボタンは出さない） |

- 担当していないアカウントの書類は 404（`apps/worker/src/routes/form-documents.ts`）。
- 回答の一覧の表示根拠：`apps/worker/src/routes/forms.ts`、`apps/worker/src/routes/friends.ts`。

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
| 検査中の書類を開く | 409 | 検査中です |
| 隔離した書類を開く | 409 | 危ないファイルのため開けません |
| 5回で検査を却下した書類を開く | 409 | 安全を確認できませんでした。別のファイルを選んでください |
| 本人確認書類を、権限のない人が開く | 403 | 見る権限がありません |
| 保存日数が範囲外 | 400 | 保存日数は1〜3650日で入力してください |
| 回答の保存で書類を付ける処理が失敗・別の回答で使用済み | 409 `document_attachment_failed`（内部の競合も同じ案内） | 書類を回答に付けられませんでした。書類をもう一度選んで、送信してください |

- 管理画面は、期限切れを「期限で消しました」、権限なしを「見る権限がありません」と出す（`apps/web/src/v8/form-responses/responses.tsx`）。

## 8. 合格条件

試験で確かめられる形で書く。

- [ ] 10,485,760 バイトちょうどは受け取り、+1 バイトは 400 になり、R2 にも DB にも残らない。
- [ ] 空のファイルは 400。
- [ ] 欄の種類に「PDF」がない欄へ PDF を送ると 400。
- [ ] 内蔵の検査で不合格になった中身は R2 に保存されず、422 `file_scan_blocked` が返る。
- [ ] 外部の検査で問題があった書類は422で回答に付かず、R2の実体がすぐ消える。再試行中の発見でもすぐ消える。削除失敗は次回のcronでやり直す。
- [ ] 検査が pending の書類を含む回答は送信できず、clean になってから送れる。
- [ ] 検査は1分→5分→15分→1時間で再試行し、5回の失敗で却下する。pending を clean にしない。
- [ ] 本人確認書類は、スタッフの回答一覧で中身もファイル名も出ず、中身の取得は 403。
- [ ] 保存日数は 1〜3650 の整数だけを受け、既定は 90。
- [ ] 期限の過ぎた本人確認書類は cron で R2 から消え、行は `deleted_at` 付きで残り、取得は 410。
- [ ] 回答に付かないまま 1 日経った書類は cron で消える。
- [ ] 表と裏のある欄は、表か裏が揃わない回答を 400 で止める。
- [ ] 別の回答に付いた書類は、別の回答では使えない。
- [ ] 担当していないアカウントの書類は 404。
- [ ] 閲覧のみの人には保存日数の保存ボタンを出さない（`apps/web/src/components/shared/form-document-retention.tsx`）。
- [ ] 写真とPDFの欄のPDFは `pdf`、本人確認の欄は `identity`。実際の形式は別に保存し、表示に使う。
- [ ] 管理画面で検査中・隔離・却下を分け、いずれも中身を取得しない。
- [ ] 統括の期限後・早期削除で書類の実体も消える。他の統括の書類は消さない。R2失敗時は記録を残して再試行する。
- [ ] 書類を回答に付けられない時は、LIFFに選び直す案内を出す。
- 試験：`form-documents.test.ts`、`tenant-data-purge.test.ts`、`forms-submit-idempotency.test.ts`、管理画面の `form-file-attachments.test.tsx`、LIFFの `documents.test.tsx`・`form-submit-flow.test.ts`。

B-213の検証（2026-10-10）：Worker関連105件、管理画面の関連34件、LIFF全体394件、DBの削除分類11件、共有のフォーム定義75件が合格。型検査・Worker／管理画面／LIFFのビルド・差分検査も合格。PDFの分類・検査回数の上限・R2削除の再試行・お客さま向けの案内を一時的に壊す4件の検証で、試験が失敗することを確認して復元した。検証の基準は `origin/codex/development` の `9da94f6fe717f84464b7ca055a0d9eedceb34ae9`。

## 9. 根拠

- オーナー決定 B-176（2026-10-09）。migration 621 の 1 行目のコメント。
- migration：`packages/db/migrations/621_form_submission_files.sql:2-24`（表・上限 10,485,760 バイトの CHECK は `:15`、期限は `:18`、削除の印は `:19-20`）。
- 受け取り・保存・配信：`apps/worker/src/routes/form-documents.ts`（全体）。
- 検査・再試行：`apps/worker/src/services/file-scan.ts`、`apps/worker/src/routes/file-scan.ts`、`apps/worker/src/index.ts`、`apps/worker/wrangler.toml:44`。
- 状態・権限・期限・削除：`apps/worker/src/services/form-documents.ts`（全体）。
- 回答フォームの経路：`apps/worker/src/routes/forms.ts`（欄の受け取り・送信時の確認・回答への紐づけ）、`apps/worker/src/routes/friends.ts`、`apps/worker/src/middleware/feature-enforcement.ts`。
- 管理画面とLIFFでも、内蔵の検査が標準・外部の検査は設定した店だけと案内する。
- 画面：`apps/liff/src/components/forms/controls.tsx`、`apps/web/src/v8/form-responses/responses.tsx`、`apps/web/src/v8/form-edit/edit.tsx`、`apps/web/src/components/shared/form-document-retention.tsx`。
- 共有の型と検査：`packages/shared/src/form-layout.ts`。
- 試験：`apps/worker/src/routes/form-documents.test.ts`。

## 10. 食い違い

残りは次の判断だけ。B-213の1・2・4〜9は本文へ反映済み。3の削除経路は§5に調査結果と修正内容を記録した。

- **ブロック時の削除範囲（旧3）**：現行は友だちの状態変更だけで、書類は消さない。ブロックでも即座に書類を消すかは、司令塔の確認待ち。個別の友だち削除・回答削除のAPIは存在しないため、その経路を実装済みとは記載しない。

LIFFの使われていない `FORM_FILE_NOTE` は削除した。案内は欄の設定に合わせ、受け取れる写真の形式・PDF・容量・枚数を表示する。
