# API-9 引き継ぎ（2026-10-07）

## 作業の範囲

列車4の先頭 `cefe57359f06e04769b634546151447feeafc6e8` から `codex/kenta-v8-api-9` で作業。本線の取り込みは司令塔が済ませたため、追加のmergeはしない。参照した本線SHAは`bb3e907abc6b3f4a698facce5ff720355e9513bb`。このSHAは開始点の祖先ではないため、今回の検証基準は司令塔指定の列車4先頭に固定し、追加mergeせずコミットまでとする。手元のdoctorは合格。コミットまで。push・PR・本番・D1適用・配備・外部サービスのログイン／本物の送信はしない。画面・docs/brain・docs/v6-requirementsとAPI-5の旧作業場所は変更していない。

## API-5の未コミット分の照合

旧作業場所のステージ済み・未ステージの差分を読み、依頼書 `~/lh-work/design/v8/CODEX-V8-API-5-20261007.md` と列車4の実装を照合した。通常の88パスは69が同じ、19が違い、別にbootstrapのメタデータ1パスが取り込み中の競合だった。

API-5で依頼された停止理由、時刻の情報欄、外部Webhookの公開版、マイレージ景品の分類、友だち追加の実行集計、ウェビナーのCTA公開版は列車4にある。違う19パスは後続APIの追加・現在の型や実装への統合・生成済みbootstrapと保存期限の一覧・画面の動きの修正。旧差分を上書きすると後続の変更を失うため、取り込まない。旧bootstrapの競合もコピーせず、現在のmigration全体から作り直した。不要として消したファイルはない。旧作業場所を整理する判断は司令塔へ返す。

| 差のあるパス（19＋競合1） | コピーしない理由 |
|---|---|
| `apps/liff/src/lib/api.ts`、`apps/web/src/lib/api.ts`、`apps/web/src/lib/restaurant-test-api.ts`、`packages/db/src/index.ts`、`packages/shared/src/index.ts` | 現在は列車4の後続の型・関数も含む。旧ファイル全体で置き換えると失う。今回必要な口だけ現在の形へ追加した |
| `apps/web/design/design-impact-baseline.txt`、`apps/web/src/app/globals.css`、`apps/web/src/app/unsaved-guard-wiring-contract.test.ts` | 画面側の最新の設計・書きかけの保護を保つ。API-5の不足として戻さず、画面の所有領域には触れない |
| `apps/worker/src/index.ts`、`middleware/auth.ts`、`routes/openapi.ts`、`routes/openapi-coverage.test.ts`、`services/feature-enforcement.ts` | 列車4で追加された経路・認証・機能分類・OpenAPIを保つ。旧配線に戻さない |
| `apps/worker/src/routes/booking.ts`、`routes/restaurant-test.ts`、`routes/restaurant-seat-waitlist-http.test.ts`、`services/restaurant-seat-waitlist.ts` | 列車4の予約・訪問と席待ちの統合を保つ。API-5の依頼機能は現在にもあるため重ねない |
| `packages/db/bootstrap.sql`、`packages/db/bootstrap-meta.json`（旧indexでは競合）、`packages/db/src/data-retention-tables.json` | 旧生成物を取り込まない。現在の全migrationでbootstrapを生成し、新旧両方の保存期限分類を保持する |


## 口と画面から使う関数

管理APIにはログインと可視アカウントの確認が必要。`lineAccountId` はクエリで指定する。

| 機能 | 口 | 管理画面・LIFFの関数 |
|---|---|---|
| 下書き | GET/PUT/DELETE `/api/scenario-drafts/:key` | `api.scenarioDrafts.get/save/delete` |
| 会話検索 | GET `/api/chats/:friendId/messages/search?q=` | `api.chats.searchMessages` |
| 会話の位置 | GET `/api/chats/:friendId/messages` | `api.chats.messagesAt` |
| 全件数 | 上記の`total`、既存GET `/api/chats/:id`の`data.total` | 既存`api.chats.get`の`ChatDetail.total` |
| 予約リンク | GET `/api/liff/restaurant/link/:token` | `restaurantBookingApi.link` |
| 席の空き | GET `/api/liff/restaurant/availability` | `restaurantBookingApi.availability` |
| 仮押さえ | POST `/api/liff/restaurant/holds` | `restaurantBookingApi.hold` |
| 本人の予約 | GET `/api/liff/restaurant/reservations` | `restaurantBookingApi.mine` |
| 予約の操作 | POST `/api/liff/restaurant/reservations/:id/confirm`、`/cancel`、`/reschedule` | `restaurantBookingApi.confirm/cancel/reschedule` |
| 未一致の返事 | GET/PUT `/api/auto-replies/unmatched-settings` | `api.autoReplyUnmatched.get/save` |
| IG接続状態・切断 | GET/DELETE `/api/instagram/connection` | `api.instagram.connection/disconnect` |
| IG接続 | POST `/api/instagram/oauth/start`、GET `/oauth/callback`、POST `/oauth/connect` | `api.instagram.start/callback/connect` |
| IG更新 | POST `/api/instagram/refresh`、`/sync` | `api.instagram.refresh/sync` |
| IG読む | GET `/api/instagram/profile`、`/posts`、`/messages` | `api.instagram.profile/posts/messages` |
| IG返信（停止中） | POST `/api/instagram/messages/:id/reply` | `api.instagram.reply`（常に403） |
| IG受信 | GET/POST `/api/instagram/webhook` | Meta向け。画面は呼ばない |

新しい27操作をOpenAPIへ載せ、記載済み一覧にも追加した。

共有型は `ScenarioDraft/Input`、`ConversationCursor/Message/MessagePage/SearchHit/SearchResult`、`RestaurantCustomerAvailability/HoldInput/Booking`、`InstagramConnectionStatus/OAuthPage/Profile/Post/ReceivedMessage`、`AutoReplyUnmatchedSettings/Input`。

## 画面への接続で守ること

- 下書きの新規は`expectedVersion: 0`。保存後は返ったUUID文字列の`version`を、更新・削除の`expectedVersion`へ渡す。数値には変換しない。409なら再読込し、古い入力を勝手に上書きしない。新規keyは画面がUUIDを作る。既存の通はシナリオIDと通IDからkeyを作り、`scenarioId`・`stepId`も送る。本物のシナリオと通を作らずに保存でき、配信処理はこの表を読まない。
- 検索の`offset`は検索語ごとに戻す。当たりの`cursor.at/id`を`cursorAt/cursorId`に渡して`direction: around`で読む。`beforeCursor/afterCursor`で続きを読む。NFKCと小文字化で本文をそろえる。抜粋も正規化した文字になる。取消済み吹き出しは本文を空にし、検索対象から外す。テスト送信は検索・件数から外す。
- LIFFは既存の関数が`liffId`とIDトークンを送る。対象店舗のLINE Login channelだけで検証し、友だちである本人だけを許す。予約の新規は毎回新しい`requestId`（8〜128文字）を作り、再実行だけ同じ値にする。確定・取消・変更は返った数値`version`を指定する。
- 発行リンクは`available: true`。`/restaurant/reserve/:token`の画面で`link`から店舗を解決し、空きと予約の関数をつなぐ。今回は画面を実装していない。
- Instagramの`connection.state: unconfigured`は正常な読取結果。`profile/posts`は`value:null`、`messages`は空配列を返す。ページ選択までのOAuth stateは同じ操作者が10分以内に使う。プロフィール・投稿は`sync`で取得した保存済みデータを読む。トークン更新は`refresh`。期限切れは再接続。DMは本文とHTTPSの添付URLを返す。添付URLが安全な形でなければnull。返信は`meta_review_required`として案内する。
- 未一致の返事は`message:null`で停止。初回の`expectedVersion:0`、以降は読んだ数値`version`で保存する。

## 今回おすすめとして決めたこと

遅延返信は既存の5分刻みCronでpushする。1分刻みのCronはない。保存した公開版の本文・待ち時間を使い、送る時にも友だち・有効な公開元・契約・機能・緊急停止を確認する。Harness Proxy経由の自動送信とし、manualヘッダは付けない。同じ実行を二度拾わない。送達不明や受理後の記録失敗を自動で送り直さず、台帳で確認する。

検証環境の`wrangler.staging.toml`は安全のためCronを定義していない。今回その設定は変えない。遅延送信・通知の再試行・保存期限の自動消去を検証するときは、司令塔が許可した方法でscheduled処理を起動する。既定の検証環境へ配備しただけでは定期処理は始まらない。

LINEのキーワードに当たらなかったときは、アカウントに設定した返事を有効なreplyTokenで送る。未設定なら送らず、受信箱の未読を残す。有人対応・期間・連投制限などで一致後に止めたものへ代わりの返事を送らない。画像等へ勝手に文章を返さず、メール受信にはつながない。未一致の返事にある共通情報の差し込みも、既存の厳格な解決器を通し、消えた情報を空文字で送らない。

席の標準滞在は既存の席待ちと同じ120分。空きはAPI-8の休業・貸切・配席候補を使い、営業時間と前日の深夜営業、LINE受付枠、予約と未期限切れの仮押さえ、招待した席待ちを重ねる。予約可能日・予約締切・取消締切・仮押さえ時間・開始時刻の刻みは既存のbooking設定を使う。席と本人とLINE受付枠はDBでも検査し、確認LINEは確定した後に送る。媒体を閉じる作業はAPI-7の台帳に作る。通知失敗で予約を戻さず、保存した同じUUID送信キーで再試行する。連続変更では最新の版の通知を送る。

## 権限表

| 対象 | 読む | 書く／送る |
|---|---|---|
| 下書き | `/scenarios`権限＋可視アカウント | 同権限＋owner/admin/staff、閲覧のみ不可 |
| 会話 | `/chats`権限＋本人が見える友だちのアカウント | 今回は読取のみ |
| 未一致設定 | `/auto-replies`権限＋可視アカウント | 同権限＋owner/admin/staff、閲覧のみ不可 |
| Instagram | `/webhooks`権限＋可視アカウント | 接続・切断・取得・更新はowner/admin、閲覧のみ不可。OAuth callbackも同じ制限 |
| IG Webhook | 管理認証の対象外 | 登録時の確認トークン／受信時の生の本文のHMAC-SHA256署名。対応する有効な契約先のIG宛だけ保存 |
| 席予約 | 飲食店機能が有効な検証環境＋対象店舗のLINE IDトークン | 同じ本人の予約だけ。版・状態・期限も検査 |

## Migrationと保存期限

追加番号は601〜604。origin本線・公開PR・列車4の枝を確認して、未使用だった600の次を選んだ。すべて未適用の草稿。オーナーの番号別承認が必要。

| 番号 | 用途 | 保存期限とdata-retention分類 |
|---|---|---|
| 601 | 配信とは別のシナリオ下書き | 保存ごと30日。期限後はGET/更新不可、5分処理で物理削除。`purge`・アカウント単位。実シナリオや通の削除を妨げない |
| 602 | 席予約の版・再実行キー・確認LINEの台帳・同時予約の防止 | 予約と通知は既存の店舗の保存期限に従い`purge`・店舗経由 |
| 603 | InstagramのOAuth・暗号化トークン・DM | OAuthは10分、DMは90日、5分処理で期限消去。接続は切断時に削除。全表`purge`・アカウント単位 |
| 604 | キーワード未一致時の返事の設定 | アカウントの設定として保持、`purge`・アカウント単位 |

全追加表を`packages/db/src/data-retention-tables.json`へ登録。bootstrap.sql/metaはschemaと全migrationから生成する。既存の遅延返信台帳は594をそのまま使う。

## Meta設定

`META_APP_ID`、`META_APP_SECRET`、`META_REDIRECT_URI`（HTTPSのcallback URL）、`META_GRAPH_API_VERSION`、`META_TOKEN_ENCRYPTION_KEY`（base64/base64urlの32バイト鍵）。Webhookには別に`META_WEBHOOK_VERIFY_TOKEN`。未設定・不正な鍵やcallback URLは未設定扱い。AES-GCMでユーザー／ページトークンと選択中の候補を暗号化保存する。APIエラーへMeta本文・トークンを出さない。テストはfetchをすべてモックし、本物のMetaへつながない。

接続の参考はMeta公式の[Instagram API with Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login)。Facebookページに紐づくビジネスアカウントを選び、Meta側の審査・テスター権限を満たした環境で接続を行う。送信の審査は今回実施しない。

## 試験

すべて手元で検査。本物の送信なし。

| 検査 | 結果 |
|---|---|
| Worker全vitest | 859ファイル、9,942件合格、既存の30件skip、失敗0 |
| Workerのtsc | 合格 |
| apps/webのtsc | 更新履歴の生成後に合格 |
| apps/liffのtsc | 合格 |
| packages/db全vitest | 346ファイル、2,123件合格 |
| bootstrap生成物の照合 | 合格。全migrationの再実行と生成物の表・索引・トリガーも一致 |
| `npm run test:scripts` | 71ファイル、671件合格 |
| packages全build、Worker・LIFF build | 合格 |
| OpenAPI・権限の網羅、保存期限分類 | 合格（全体試験に含む） |
| `git diff --check` | 合格 |

境界・閲覧のみ・競合・期限・同時予約・重複Webhook・通知失敗・消えた共通情報を検査した。既存の試験が読むDBモックには新しいCOUNTと未一致設定の読取を追加し、権限・動きのassertは残した。予約リンクの試験だけは今回の仕様に合わせavailable:trueへ変更した。途中の生成物の不一致と追加表の分類も修正し、上記の全体試験を最後に再実行している。

意図的な破壊の確認は5件。下書きの版の条件、会話のNFKCと大小変換、MetaのHMAC署名検証、席予約の本人重複トリガー、未一致設定の判定をそれぞれ一時的に無効にして、対応する試験が失敗することを確認した。各ファイルをバイト単位で元へ戻し、その後の全体試験が合格した。

## コミット

- `bf75c8df27` 下書き・席予約・Instagram・未一致返信の保存と共有型を追加
- `e598a7f50c` 残りのAPIと遅延返信を実装し、境界・競合・期限の試験を追加
- 引き継ぎ文書・更新履歴は別コミット。完了時の履歴から確認する。

## 司令塔に残る工程

画面へ上記の型・関数をつなぐ。migration番号と中身を承認する。PR採番後、更新履歴の仮ファイルをPR番号で改名し本文にも番号を足す。司令塔がpush・PR・統合を行い、承認された検証DB更新と手動配備・反映確認を進める。Meta審査と本物の接続は別途。今回はこれらを行っていない。
