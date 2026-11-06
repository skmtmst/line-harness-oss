> 文書：下書き・会話検索・InstagramのAPI｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 下書き・会話検索・InstagramのAPI

管理APIはログイン・可視アカウント・機能権限を確認します。口の一覧はWorkerのOpenAPI、呼び出しと型は `apps/web/src/lib/api.ts`・`packages/shared` を確認します。

## 配信の下書きと会話検索

| 口 | 使い方 |
| --- | --- |
| GET/PUT/DELETE `/api/scenario-drafts/:key` | `api.scenarioDrafts.get/save/delete`。新規はUUIDのkeyと`expectedVersion:0`、以後は返った文字列版をそのまま渡す |
| GET `/api/chats/:friendId/messages/search` | `api.chats.searchMessages`。検索語変更でoffsetを戻す。取消済み・テスト送信は検索と件数から除外 |
| GET `/api/chats/:friendId/messages` | `api.chats.messagesAt`。検索結果の`cursor.at/id`を`cursorAt/cursorId,direction:around`へ渡し、前後のcursorで続きを読む |
| GET/PUT `/api/auto-replies/unmatched-settings` | `api.autoReplyUnmatched.get/save`。`message:null`で停止。新規は版0、以後は読んだ数値版 |

下書きは実際のシナリオ・通を作らず保存できます。配信処理は下書き表を読みません。保存ごとに30日の期限が付き、期限後は取得・更新できません。409では読み直し、古い入力を勝手に上書きしません。

会話本文はNFKCと小文字化で正規化します。初回は未索引の既存本文を500件ずつ処理し、以後は新規・変更分だけ更新します。検索・件数・ページ・前後1件はDBで処理します。

未一致の返事は有効なreplyTokenでLINEのテキストへだけ送ります。一致後に有人対応・期間・連投制限で止めた時は代替返信を送りません。未設定なら送らず未読を残します。共通情報が解決できない時も空文字で送りません。

遅延返信は公開時の本文と待ち時間を使い、送る直前にも本人・公開元・契約・機能・緊急停止を確認します。送達不明と受理後の記録失敗は自動再送せず台帳で確認します。自動送信にmanualヘッダーは付けません。

## Instagram

接続・切断・更新・取得は `/webhooks` の編集権限を持つowner/admin、読取は可視アカウントに限ります。

| `/api/instagram` 以下 | 呼び出し |
| --- | --- |
| GET/DELETE `/connection` | `connection/disconnect` |
| POST `/oauth/start`・GET `/oauth/callback`・POST `/oauth/connect` | `start/callback/connect`。同じ操作者が10分以内にstateを使う |
| POST `/refresh`・`/sync` | トークン更新・取得済みデータの更新 |
| GET `/profile`・`/posts`・`/messages` | 保存済みデータの読取。未設定は正常結果で、profile/postsはnull、messagesは空配列 |
| POST `/messages/:id/reply` | 審査待ちのため403 `meta_review_required` |
| GET/POST `/webhook` | Meta向け。確認トークンと生本文のHMAC-SHA256署名を検証し、有効な契約先へだけ保存 |

設定は `META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_GRAPH_API_VERSION, META_TOKEN_ENCRYPTION_KEY, META_WEBHOOK_VERIFY_TOKEN`。callbackはHTTPS、暗号化鍵は32バイト。ユーザー・ページのトークンと候補をAES-GCMで保存します。外部エラー本文や秘密値は返しません。DM添付は安全なHTTPS URLだけで、DMの保存期限は90日です。期限切れは再接続します。

実際の外部設定は [Meta準備手順](../instagram-meta-app-setup.md) に従います。検証環境のCronは無効です。定期処理の検証は司令塔が許可した方法で行い、配備だけで処理が始まったと判断しません。
