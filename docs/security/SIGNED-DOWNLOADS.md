> 文書：添付・支払明細の取得と取り直し（B-351/4）｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# 添付・支払明細の取得と取り直し（B-351/4）

2026-10-16 / kenta・Codex。DBの追加・変更、鍵の登録、配備はしていない。

## お客さまの使い方

LINEで受け取る**本文中のリンクは、期限のない本人確認の入口**。開くたびにLINEで本人を確かめ、その場で最長15分の取得URLを作る。ファイルの保存期限は延長しない。書類の保存期限は従来の30日、写真・動画は従来の保存期間を保つ。

- 書類の返信本文は `https://<Worker>/liff/files/<添付UUID>`。名前・大きさ・本人確認の案内も送る。署名URLは本文に入れない。
- 写真・動画はLINE内の表示を保ち、同じpushに「後から開く場合はこちら」と上記の入口を添える。予約送信にも添える。履歴・引用・再実行キーは従来の扱いを保つ。
- 支払明細の発行通知は `https://<Worker>/liff/statements/<明細ID>`。既存の一覧にも `renewalUrl` を添える。通知の再送条件は変えず、新規発行時だけ通知する。
- Workerの入口は、保存物の所属する店の `liff_id` だけを使って `https://liff.line.me/<LIFF ID>/files/?id=<UUID>&liffId=<LIFF ID>` または `/statements/?id=<明細ID>&liffId=<LIFF ID>` へ303で案内する。外から渡された遷移先・認証情報・署名・URLのクエリは引き継がない。停止した店/統括・削除済み・LIFF未設定は、中身を返さず410の問い合わせ案内。
- 入口は取得権限ではない。他の人へ転送しても新しいURLを作れない。

LIFFの取得画面は `apps/liff/src/pages/file-open.tsx` と `StatementOpen.tsx` に接続されている。本人用の認証付きfetchとBlob表示を使い、期限切れ・別人・削除済みは取得成功にしない。実際のLINE内での操作、配備先の鍵・保存物・期限の確認は[点検表](SECURITY-CHECKLIST.md)に残す。

## 画面に渡すAPI

共通：HTTPSのみ。応答は `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`。LINEの認証情報をquery、本文リンク、Slack、ログに載せない。ブラウザはヘッダー付きfetchで取得し、成功したBlobだけを画面で開く/保存する。応答URLは設定済みWorkerのoriginと所定のpathであることを照合してから認証情報を付ける。任意の外部URLへ送らない。

| 操作 | メソッド・パス・受け取り | 返す形・権限 |
| --- | --- | --- |
| 添付の取り直し | `GET /api/liff/files/:id/download`、`Authorization: Bearer <liff.getIDToken()>` | `{success:true,data:{id,url,expiresAt,filename,mimeType,size,kind}}`。kindはimage/video/file、sizeはbyte。R2の持ち主→店/統括の稼働状態→その店のLINE LoginチャネルでID token検証→友だち台帳の本人と店→存在と保存期限を確認。友だちID・店IDは受け取らない |
| 添付の取得 | 応答の `/images/chat-attachments/:id?expires=...&signature=...`、同じ本人のID tokenのBearer | 本文またはRange応答。用途 `chat-attachment-self` の署名と、現在の本人・店・統括・R2の所有と保存期限をもう一度照合。URLだけ・別人・別店は403。元が削除済みなら404 |
| 明細の一覧 | `GET /api/liff/affiliate/statements`、`Authorization: Bearer <liff.getAccessToken()>` | 従来の `{success:true,data:[明細...]}` に各明細の `renewalUrl` を追加。LINE本人と紹介者・店/統括を照合 |
| 明細の取り直し | `GET /api/liff/affiliate/statements/:id/download?issue=1`、同じaccess tokenのBearer | `{success:true,data:{url,expiresAt}}`。本人の有効な明細・所属・R2の存在を確認。本文は読まない。明細自体の期限が15分より先に来る場合はその期限まで |
| 明細の取得 | 応答の同じdownloadパスへ署名queryと同じaccess tokenのBearer | 本人・所属・有効な明細と署名を再確認しPDFを返す。認証情報queryによる代用は禁止 |

添付の認証は **ID token**、既存の明細APIは **access token**。混ぜない。管理者のAPIキー・代理ログインは使えない。

### 失敗の文言と画面の状態

| 添付の応答 | code / error | 画面でやること |
| --- | --- | --- |
| 401 | `LINE_AUTH_REQUIRED` / LINEでログインして、もう一度お試しください | LIFFログイン後に再試行。queryから認証しない |
| 404 | `DOWNLOAD_UNAVAILABLE` / このファイルは利用できません。お店へお問い合わせください | 別人・別店・削除・保存期限切れ・停止中を同じ文で表示。ファイル名も出さない |
| 502 | `DOWNLOAD_RETRY` / 取得できませんでした。時間をおいて、もう一度お試しください | 再試行ボタン |
| 503 | `DOWNLOAD_UNCONFIGURED` / ただいま取得できません。お店へお問い合わせください | 問い合わせ案内 |
| 429 | しばらく待つ案内と `Retry-After` | 指定秒数後に再試行。入口・添付発行は認証情報/IDを替えても同じIPの100回/分の枠を共有（Workerインスタンス内の混雑抑制。分散の厳密な上限ではない） |
| 取得時403 | 取得用URLが無効か期限切れです | 再発行APIを呼んで取り直す。保存期限を延長しない |

明細は既存契約を保つ：認証なし400、無効なLINE access token401、別人/別店・停止/期限切れ/削除済み明細404、署名不正/期限切れ403、統括停止503、鍵なし503。画面は「LINEでログイン」「明細を利用できません」「もう一度取得」を状態に合わせて表示する。認証なしの古い直接リンクだけは下の案内にする。

画面の型だけ決める：LIFFの既存の1枚の案内画面を使う。状態は「本人確認中→取得準備中→取得できます」、保存するボタン、期限切れ時の「もう一度取得」、失敗時の案内と再試行。名前・大きさは本人確認後だけ表示。詳しい見た目はClaude担当が★V8の型・共通部品で決める。今回は新しい画面の部品・Pencil・CSSを作らない。

管理画面用の新しいapi関数は不要。LIFF側の添付用関数は画面担当がこの契約で接続する（現時点では未作成）。明細は既存の `apps/liff/src/lib/affiliate-self-api.ts` の `affiliateSelfApi.statements()` / `download(id)` を利用できる。後者は発行→同origin/同path確認→Bearer付き取得まで行う。取り直しの入口で受け取るidを `download(id)` へ渡す。

## 古いリンクの扱い

- `GET /images/chat-attachments/:id` に署名の2項目がなければ、保存物の有無に関係なく上記 `/liff/files/:id` へ303。本文は返さない。元のqueryは捨てる。削除済みもいきなり404にしない。
- `GET /api/liff/affiliate/statements/:id/download` にAuthorization・署名・発行指定がなければ `/liff/statements/:id` へ303。昔の `lineAccessToken` queryがあっても認証には使わず、次のURLへも渡さない。
- 改ざん/期限切れの署名を署名なし扱いにして本文を返すことはない。APIの認証なし発行も許可しない。

## 鍵とLINE内の画像・動画表示

既存のsecret binding `API_KEY` でHMAC-SHA-256。用途・資源ID・持ち主・期限をまとめて署名し、添付/明細/本人用の用途を相互流用できない。15分より長い期限・改ざん・期限ちょうど以降・鍵不足を拒否。鍵を変えると発行済みURLは失効。個別失効は元の削除・持ち主変更・明細停止/保存期限切れを使う。新しい失効台帳は作らない。

**LINEサーバーが取得する画像・動画は、本人のBearerを付けられない。** LINE内表示用は従来の用途 `chat-attachment` の署名を使い、15分内なら転送されたURLでも取得できる制約を保つ。本文中の後日取得リンクはLIFF、本人向け発行は別用途の署名＋Bearerにして、この制約を引き継がせない。管理画面で会話を読むときの署名更新・店/統括・会話・閲覧権限の照合、動画Range、固定見本PNGを保つ。手動返信だけのmanual区分も保つ。

secretの存在/型はオーナーが値を出さず確認する。LINE/LIFFの設定・鍵登録・DB適用・配備は今回行わない。

## 試験

- `routes/customer-downloads.test.ts`：実SQLite/R2代替と架空LINE検証。本人・別人・別店・認証query拒否・削除・所属変更・停止/不明統括・保存期限・再取得時本人・改ざん・期限ちょうど・更新・古い入口・query除去・全Workerでの到達。
- `routes/chat-attachments.test.ts`：送信本文がLIFF、画像/動画の再取得案内、予約・再試行・引用/履歴の既存保護、署名・Range。
- `routes/affiliate-self.test.ts` / `affiliate-payouts.test.ts`：明細発行通知のLIFF入口、古いquery認証の拒否と案内、本人結合・削除した明細の発行拒否・明細間署名流用の拒否。
- `middleware/rate-limit.test.ts` / `routes/openapi-coverage.test.ts`：IP枠・API契約。

この続きの検査結果は [SECURITY-DOWNLOAD-RENEWAL.md](../document-archives.md#s05)。前回のCSP/短命署名の検査は [SECURITY-B351-CONTINUATION.md](../document-archives.md#s05) に別の版として残す。
