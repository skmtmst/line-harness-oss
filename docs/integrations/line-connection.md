---
type: integration
status: 調査済み（設計反映待ち）
date: 2026-10-13
topic: LINE公式アカウント接続（Messaging API / LINE Login / Webhook / LIFF）
tags: [integration, line, account-new]
---

# LINE 接続台帳（アカウント登録ウィザード ②アカウント接続）

今回の目的：登録画面でユーザーに入力させる項目を最小にする。そのために「Webhook URL」「プロバイダーID」「表示名・@ID・アイコン」「アクセストークン」「LIFF」が **APIで自動化できるか** を公式仕様とmusuboの実装で確認した。

- 確認日：2026-10-13
- 対象環境：staging（`stg-admin.musubo.jp` / Worker）。本番への反映は本件の対象外
- 認証：チャネルアクセストークン（Bearer）。発行元はチャネルID＋チャネルシークレット
- 権限：LINE Developers コンソールでチャネルを操作できる権限が利用者側に必要（musuboからは付与できない）
- 秘密値はこのファイルに書かない

## 1. 公式仕様（確認したエンドポイント）

| 操作 | エンドポイント | 要点 |
| --- | --- | --- |
| チャネルアクセストークン発行 | `POST https://api.line.me/v2/oauth/accessToken` | form-urlencoded、`grant_type=client_credentials` ＋ `client_id`（チャネルID）＋ `client_secret`（チャネルシークレット）。`expires_in` 2592000（30日）、更新不可。別方式 `POST /oauth2/v3/token` は15分・失効不可 |
| ボット情報取得 | `GET https://api.line.me/v2/bot/info` | 必須で `userId` `basicId` `displayName` `chatMode` `markAsReadMode` を返す。`premiumId` は任意。例には `pictureUrl` もある |
| Webhook URL 登録 | `PUT https://api.line.me/v2/bot/channel/webhook/endpoint` | Bearer。JSON本体は `endpoint` のみ（必須・HTTPS・500文字以内）。200で `{}`。1,000req/分。不正URLは400 `{"message":"Invalid webhook endpoint URL"}`。反映に最大1分の遅延あり |
| Webhook URL 取得 | `GET https://api.line.me/v2/bot/channel/webhook/endpoint` | `endpoint` と `active` を返す。未設定は404 `{"message":"Webhook endpoint not found"}` |
| Webhook テスト送信 | `POST https://api.line.me/v2/bot/channel/webhook/test` | `endpoint` は任意。`success` `timestamp` `statusCode` `reason`（`OK`／`COULD_NOT_CONNECT`／`REQUEST_TIMEOUT`／`ERROR_STATUS_CODE`／`UNCLASSIFIED`）`detail`。60req/時 |
| LIFF アプリ | `GET`／`POST https://api.line.me/liff/v1/apps`、`PUT /liff/v1/apps/{liffId}` | LINEログインチャネルのトークンで操作 |

### APIが無いもの（＝自動化できない）

- **「Webhookの利用」のON/OFF**：読み取り（上記GETの `active`）だけ。書き込むAPIが無い
- **プロバイダーIDの取得**：APIが無い。LINE Developers コンソールの画面でしか見られない
- **プロバイダーの一致判定**：APIが無い。チャネルは後からプロバイダー間を移動できない（Messaging APIとLINEログインは同じプロバイダー内に作る必要がある）
- **LINEログインチャネルの「リンクされたLINE公式アカウント」指定**：書き込むAPIが無い。コンソールの画面でしか設定できない
- **LINEログインチャネルの「開発中」→「公開済み」**：書き込むAPIが無い。コンソールの画面でしか切り替えられない

エルメッセージ（L Message）がこの2つだけを手作業のチェックボックスにしているのと一致する。
後半2つも同じで、L Message の「Step 4/5 LINEログインチャネルの作成」が確認チェックにしている2項目と一致する（2026-10-13追記）。

## 2. musubo側の実装（根拠のファイル:行）

- 接続の下準備：`apps/worker/src/services/line-account-connect.ts:101-231`（`prepareLineConnection`）。5段階のメッセージは `:32-38`
- 事前チェック：`POST /api/line-accounts/connect/check` → `apps/worker/src/routes/line-accounts.ts:1335-1364`。DB書き込みは無い（`:1334` のコメント）が、**LINE側のWebhook登録とLIFFの作成/更新は走る**
- 本登録：`POST /api/line-accounts/connect` → `line-accounts.ts:1367-1480`（多要素の再認証 `:1369` → `prepareLineConnection` `:1378` → 重複チェック `:1387` → 作成 `:1395` → 友だち取り込み可否 `:1412` → チェック結果保存 `:1421` → 201。失敗時は `deleteUncommittedLineAccount` `:1460` で巻き戻して502）
- 画面の5行の判定：`apps/web/src/v8/account-new/logic.ts:63-94`（`apps/web/src/app/accounts/new/register-v8.tsx:132-175` に写しがある）

| 画面の行 | 判定の元 | 自動化の状況 |
| --- | --- | --- |
| LINEとつながるか | 2チャネルのトークン発行成功（`services/token-refresh.ts:71` を `line-account-connect.ts:120` と `:175` で呼ぶ） | 自動 |
| 同じプロバイダーか | 独立した確認は無く、トークン発行成功を代理にしている（`line-accounts.ts:1312`、コメント `:1254-1260`） | APIが無いため代理判定 |
| Webhook | PUT登録 → GETでURL一致と `active` → テスト送信（`line-account-connect.ts:141` `:149` `:155` `:158` `:161`） | URL登録は自動。3つのスイッチ（利用／再送／エラーの統計情報）だけ利用者の操作が必要 → Step 2/4 で案内 |
| アカウント名・@ID・アイコン | `GET /v2/bot/info`（`line-account-connect.ts:127-137`）→ `line_display_name`／`line_picture_url`／`line_basic_id`／`line_profile_synced_at` に保存（`line-accounts.ts:1406-1409`） | 自動 |
| 友だち追加の窓口（LIFF） | LINEログインのトークンでアプリを検索（`description:'musubo'`）し、無ければ `scope:['openid','profile','chat_message.write']` ＋ `botPrompt:'aggressive'` で作成（`line-account-connect.ts:175-217`） | LIFFの作成は自動。ただし `botPrompt` が効くには、**事前にコンソールでLINEログインチャネルに公式アカウントをリンクしておく必要がある**（APIが無い）→ Step 3/4 の確認チェックで案内 |

### プロバイダーID

- 入力UIはどこにも無い（`apps/web/src` に `providerId`／`provider_id` の入力はゼロ）。案内文だけ：`register-v8.tsx:659-660`、`apps/web/src/v8/account-new/register.tsx:513-515`
- 列は存在する（`packages/db/migrations/284_account_handover.sql:10` の `line_accounts.provider_id TEXT`）が、**書き込む処理が無い**ため常にNULL
- 読む側は `apps/worker/src/routes/account-handovers.ts:139-146` だけで、結果アカウント引き継ぎの `provider_match` は常に `'unknown'`（`284_account_handover.sql:34-39`）

→ ユーザーに入力させる価値が無い。ウィザードからは外し、「Messaging APIと同じプロバイダーの中にLINEログインを作る」という案内文のみ残す。

### LINEログインのID・シークレットが本当に必要な理由（4つ）

1. LIFFアプリの作成・更新（上記）
2. LINEログインの認可コード交換と検証：`apps/worker/src/routes/liff.ts:771-794`（`POST /oauth2/v2.1/token`）、`:809-814`
3. IDトークン検証の `client_id`／`aud`：`routes/visit-stamps.ts:120-124`、`routes/restaurant-customer-booking.ts:55-82`、`routes/affiliate-self.ts:107-120`
4. `liff_id` の接頭辞の整合チェック：`line-accounts.ts:462-477`（登録済みLIFFのエンドポイントを読むAPIが無いため `unknown` で止まる・コメント `:472-473`）

## 3. 設計への反映（2026-10-13）

Pencil：`/Users/masatosakamoto/Documents/LINE-Harness-Design/新規デザイン/2026-10-12_LINE追加画面のアップデート_LINE新規追加/LINE新規追加_v05.pen`

- ステップ②の名前を「チャネル設定」→「アカウント接続」
- 4ステップに分割：`JYfda`（Step 1/4 Messaging APIの2項目）→ `Qgmuw`（Step 2/4 Webhookの設定）→ `a6uesI`（Step 3/4 LINEログインの2項目）→ `QbFhL`（Step 4/4 接続チェック）
- `W7X3D`：接続チェックでなお `active:false` だったときの立て直し案内の状態
- ユーザー入力は4項目のまま（Messaging APIのID・シークレット、LINEログインのID・シークレット）

### Step 2/4「Webhookの設定」を常設にした理由（2026-10-13の利用者指示）

利用者の指示は「WebhookのURLは設定しなくとも入力以外が必要でしたら、…Messaging APIの入力の次にこのページを作成してください、その際添付した画像と同じように確認事項を配置してチェックマーク入れないと次にいけないようにしてください。このボタンから操作してくださいが、ここからLINE DeveloperにいくことでダイレクトにWebhookの設定が表示されているページに飛ぶような設計にしてください。」

- 上の「APIが無いもの」のとおり、Webhookの3つのスイッチ（**Webhookの利用／Webhookの再送／エラーの統計情報**）はLINE側に書き込むAPIが無い。URLは自動登録できるがこの3つだけは残るため、入力欄なしの確認ステップとして独立させた
- 確認事項はチェックボックス3つ。**全部にチェックが入るまで「次のステップへ」はグレー（押せない）**
- エルメッセージにある「Webhook URLを入力した」というチェックは入れない（musuboが `PUT /v2/bot/channel/webhook/endpoint` で自動登録するため）
- 画面には「必ずこのボタンから操作してください」の注意を添える

#### LINE Developers への直リンク（1件未確認）

- 使う形：`https://developers.line.biz/console/channel/{Messaging APIのチャネルID}`。チャネルIDを入れるとそのチャネルの画面に直接入れることはWeb上の案内で確認した
- **未確認**：`/messaging-api/` のようなタブ別サフィックスは公式ドキュメントに記載を見つけられなかった。Webhook設定が見える位置へ正確に着地させられるかは、stagingの実チャネルで実際に開いて確かめる必要がある（Codexの検証項目）
- 現状のコードは汎用URL `https://developers.line.biz/console/` のみ：`apps/web/src/v8/account-new/register.tsx:519`、`apps/web/src/app/accounts/new/register-v8.tsx:662`、`apps/web/src/app/accounts/new/page.tsx:334`

### Step 3/4「LINEログインの情報を入れる」の直リンクと確認チェック（2026-10-13の利用者指示）

利用者の指示は「LINEログインの画面も同じように、LINE Developerのところが直接確認できるダイレクトリンクに設定してください。さらに同じようにチェックボックスで設定手順の確認を追加してください。」

- 直リンクは Step 2 と同じ形で、**ステップ1で入れたMessaging APIのチャネルID**から `console/channel/{チャネルID}` を開く。LINEログインチャネルはこの時点でまだ作られていないため、そのチャネルの直URLは作れない。同じプロバイダーの画面へ着地させ、「プロバイダーやチャネルを探し直す必要はありません」と案内する
- 確認チェックは2つ。上の「APIが無いもの」のとおり、どちらも書き込むAPIが無いため利用者の操作が残る
  1. 友だち追加オプションで、この公式アカウントをリンクした（つないでおかないと `botPrompt` の友だち追加の窓口が正しく動かない）
  2. チャネルを「開発中」から「公開済み」にした（開発中のままだとお客さま側でログイン画面が開かない）
- 2つともチェックが入るまで「次のステップへ」はグレー（押せない）
- 「必ずこのボタンから操作してください」の注意を Step 2 と同じ形で添える

### ②アカウント接続の画面構成（2026-10-13の利用者指示）

- 右パネルは「操作マニュアル」の題と説明文、「途中でやめても大丈夫」の題と説明文を削除し、ボタン3つ（マニュアルを開く／途中保存して閉じる／サポートに開く）と「うまくいかないとき」だけを残す
- **左の統括ナビゲーション（サイドバー）は全画面で残す（確定）**。いったん②アカウント接続の5枚（`JYfda`／`Qgmuw`／`a6uesI`／`QbFhL`／`W7X3D`）で非表示にしたが、同日夜に利用者が「やっぱりサイドバーは残してください」「サイドバーは残します」と回答したため元へ戻した。「メニューを畳む」ボタンも同じく残す
- ①事前確認の10枚は変更していない

### Step 4/4「接続チェック」の操作と状態表示（2026-10-13の利用者指示）

利用者の指示は「接続を確かめるのボタンは上から順に確認しますの文章の下に配置してください。元々あった場所には次へをグレーアウトし、すべてのチェックが完了したら進める設計にしてください。接続を確かめるボタンを押したら、各の確認の枠の右端の方にローディングの動的UIを設置して完了したらOKと表示、問題があった際にはエラーだと分かるように表示して、エラー内容を現在あなたが作成してくれてるデザインのように上部に表示するようにしてください。」

- 「接続を確かめる」は注意文「上から順に確認します。終わるまで10秒ほどかかります。」の直下に置く。実行中はグレー＋`loader-2`＋「確認しています…」、失敗後は緑＋`refresh-cw`＋「もう一度確かめる」、全部OKならグレー＋「確認が終わりました」
- フッターの「次へ」は初期状態・実行中・エラー時はすべて無効（グレー）。**5項目すべてがOKになったときだけ活性**。実装時はこの5項目の結果をそのまま有効条件にする
- 5項目の行の右端に状態を出す。待機中（`circle-dashed`／灰）→ 確認中（行の背景 `$info-soft`・**回るリング**・`$accent-deep`）→ OK（`check-circle-2`／`$success`）／エラー（行の背景 `$danger-soft`・`alert-circle`／`$danger`）。確認は上から順に1件ずつ進める想定で、同時並列ではない。状態の文字と印は行の上下中央にそろえる（下の追加指示A・B）
- エラーの内容はカードの題の直後（Step 2 の青い案内箱 `W7X3D`／`v6h23Z` と同じ位置・同じ形）に赤い箱で出す。中身は `triangle-alert`＋原因の題＋直し方の本文＋「LINE Developers を開く」ボタン。チャネルの作り直しなど利用者の操作が必要なケースのため `$danger` 系にしている
- 検証対象の5項目は `prepareLineConnection`／`verifyLineConnection` 相当の結果に対応させる。エラー文は項目ごとに違うので、実装では項目IDと文言の対応表を持たせる

### ウィザードの段を4段にした（2026-10-13の利用者指示）

利用者の指示は「またこの接続確認はアカウント接続の項目ではなく、ステップ３にしてください。３の基本情報は不要なはずなので削除でお願いします。」

- 画面上部の段は **①事前確認 → ②アカウント接続 → ③接続確認 → ④完了** の4段。「基本情報」の段は出さない
- 接続チェックの画面（`QbFhL`）では段③が活性。②は完了済みの灰色
- アカウント名・@ID・アイコンは接続後に `/v2/bot/info` から取り込むため、利用者が基本情報を入力する段そのものが不要（§2 の `register-v8.tsx` の取り込み処理が該当）
- デザイン側の `GwKE2`（③基本情報の画面）は、利用者の回答「削除する」を受けて 2026-10-13 に**フレームごと削除済み**（ページ内の題 `TKkNK`「基本情報」も消えた）。削除前に `GwKE2` を参照するノードが0件であることを確認済みで参照切れなし。**実装でも基本情報の入力ステップは作らず、`/v2/bot/info` の取り込み結果を④完了の画面で見せる**
- デザイン上の未解決：`qw80E`（接続確認の手動項目の窓）は段が4つしかなく事前確認が無い。`W7X3D` の左の列は5段へ修復済み

### 追加の指示5点（2026-10-14 反映・実装時に扱う）

| | デザイン | 実装でやること |
| --- | --- | --- |
| A | 確認の行20行を上下中央そろえに | CSSのみ（`register.module.css`）。行は `align-items: center` |
| B | 「確認中」をリング状のスピナーへ | `loader-2` アイコンをやめ、`border` または SVG のリング＋`@keyframes spin` に置き換える。色は道が `$control-border`、弧が `$accent-deep`、時計回り |
| C | Step5「友だち追加のテスト」`FopO6` を新設 | QRコード（`https://line.me/R/ti/p/@{basicId}` ＝ §4 の不具合1の修正後の形）を出し、**友だち追加を検知したら自動で次へ**。検知は Messaging API の follow Webhook を受けてポーリングする想定。操作ステップは全4→**全5**へ |
| D | 完了の前に「友だちの引き継ぎ中」`S16DJ` | 事前確認のQ2で「引き継ぐ」を選んだ人だけ通る。進捗（済み人数／総人数）・割合・残り時間・1分あたりの速さ・経過時間をその場で更新し、終わったら自動で④完了へ。引き継ぎなしの人はこの画面を飛ばす。進捗の取得はサーバ側のジョブ状態をポーリングする想定 |
| E | 完了画面 `TvXII` を「早速使ってみる」へ | 「活用設定に進む」を廃止。大きな丸チェック＋「おめでとうございます！」＋`/v2/bot/info` から取り込んだ名前・@ID の箱を出し、ボタンを押すと**接続したアカウントのダッシュボード**（`stg-admin.musubo.jp` の該当アカウント）へ遷移する。既存の「登録したアカウントを見る」ボタンは主ボタンと重複するため出さない |

**承認状態：2026-10-15 に v06 として承認済み**（下の「v06の承認状態」の節に記録）。A〜Eはv06の実装範囲として扱う。

### v06（Kenta版の共通デザイン）に乗り換え、段を5段にした（2026-10-15の利用者指示）

利用者の指示は「共同開発者のKentaが私のデザインを一部共通デザインとして修正しました、まだ完成ではないのですがKentaが作成したpenのファイルを読み込んでください、ここから修正していきます。なお、使い方を選ぶという項目が増えてますので機能を読み込み理解してください。初回のローンチは飲食店のみを選択できるようにしてください」

作業対象は `/Users/masatosakamoto/Documents/LINE-Harness-Design/新規デザイン/2026-10-12_LINE追加画面のアップデート_LINE新規追加/LINE新規追加_v06.pen`（v05はそのまま保持）。

- ウィザードの段は **①事前確認 `p6zMkA` → ②アカウント接続 `Fqy29` → ③接続確認 `Lwxyh` → ④使い方を選ぶ `X0pGdw` → ⑤完了 `Plmq1`** の5段。④がKenta版で増えた段で、上の「4段」の記述はv06では5段に置き換わる
- **④使い方を選ぶ**は、接続後のダッシュボードの見た目・初期メニューを業種別のひな型から選ばせる段。選択肢は飲食店向け `MELvy`／サロン・整体 `J1tGCr`／面談・相談 `U74H4`／ECサイト `Y0ldyt`／教室・レッスン `d0vdd`／標準 `H2d2y` の6つ。フッターは「戻る」／「あとで決める」`gd2P3`／「次へ」`g74i2`
- **初回ローンチは飲食店向けのみ選べる**（利用者指示）。`MELvy` だけを選択済みの見た目（地 `#f1f8f3`・枠 `$accent-deep` 2px）にし、他5つは `$surface-pearl`＋`$hairline` 1px の選べない見た目にして「順次公開」の札（`TAV0d`／`yLzeX`／`qH0LQ`／`W2dJU`／`a7OjmL`）を付けた。案内帯 `Bj6xZ`（`$info-soft`）に「初回は「飲食店向け」だけお選びいただけます。ほかのスタイルは順次公開します。今のダッシュボードのまま始めたいときは［あとで決める］を押してください。」と書き、「あとで決める」は有効のまま残して逃げ道にした。**実装では業種ひな型を機能フラグで持ち、飲食店以外は `disabled` にする**
- 利用者の追加指示「アカウントの接続は３までです。４以降は３の接続確認になりますので修正お願いします。３の接続確認は友だち追加できるか確かめるまでです。つきまして、２枚目の接続確認は不要なので削除してください。」を反映し、**②と③の区切りを変えた**
  - **②アカウント接続＝全3ステップ**：Step1 Messaging API `UVcGA`／Step2 Webhookの設定 `f4AgA`／Step3 LINEログインの2項目 `o3rMF`。左の操作ステップを「全3ステップ」に、段札を「Step N / 3」に直し、ステップ4・5の行は削除した
  - **③接続確認＝全2ステップ**：Step1 接続チェック `EKLKb`／Step2 友だち追加のテスト `mNBXw`。状態の見本4枚（WebhookがOFF `eqJbD`／確認中 `fwhGO`／エラー `Tn6tJ`／すべてOK `V9Jbn`）も③へ移した。移した6枚はウィザードを「②＝済みのチェック印」「③＝現在地」に直し、「musubo が自動で行うこと」も「接続のチェック／アカウント名・@ID・アイコンの取り込み／友だち追加の QR コードの用意。入力は不要です。」へ更新した
  - ③は**友だち追加できるか確かめるまで**で終わり。手動入力の2枚目 `NtjTn` は削除。V8由来の素の接続確認 `K5ZOx` も利用者の「このページは不要になります」を受けて削除した（2026-10-15T20:40:28 保存。V8正本 `LINE-Harness-V8-B.pen` と `LINE-Harness-Latest.pen` は未変更）
- 上の「追加の指示5点」C〜Eはv06でも有効。ただしCの操作ステップ数は「全4→全5」ではなく **②が全3／③が全2** になる

**v06の承認状態：2026-10-15 に利用者が承認した。**

- 対象ワークスペース：`/Users/masatosakamoto/orca/workspaces/然-NEN- EC構築/LINE追加画面のアップデート`
- 承認した .pen（絶対パス）：`/Users/masatosakamoto/Documents/LINE-Harness-Design/新規デザイン/2026-10-12_LINE追加画面のアップデート_LINE新規追加/LINE新規追加_v06.pen`
- 承認した版：2026-10-15T20:40:28 保存の v06（`K5ZOx` 削除後の状態）
- 承認した対象フレーム：5段すべて — ①事前確認 `p6zMkA`／②アカウント接続 `Fqy29`／③接続確認 `Lwxyh`／④使い方を選ぶ `X0pGdw`／⑤完了 `Plmq1`
- 利用者の回答（逐語）：「V06は現状で問題ないです、アカウント画面に進捗と「続きを進める」が無い — いま進捗を見られるのは新規登録の完了画面だけで、そこを抜けると確認する場所がありませんとのことですが、現在のアカウント一覧と同じデザインで入るというボタンを押すと続きから始まる仕組みでお願いします。」
- 同じ回答で追加指定された仕様：引き継ぎの再開は**新しい画面を作らず、現在のアカウント一覧の「入る」ボタンを同じデザインのまま使い、押すと続きから始まる**ようにする
- この承認で `apps/web/src/v8/account-new/` のUI実装に進める。V8正本 `LINE-Harness-V8-B.pen` と `LINE-Harness-Latest.pen` は参照専用のまま未変更

### 友だちの引き継ぎに何分かかるか（10,000人・2026-10-15の利用者質問）

**LINE側の制限ではなく、musubo側の刻み方だけが所要時間を決めていた。** プロフィールは**まとめて引くAPIが無く1人ずつしか引けない**（LINEの `GET /v2/bot/profile/{userId}` 仕様）。ここは仕様なので回避できず、速さは「1回の実行で何人ぶん引くか」で決まる。

LINEの制限は `GET /v2/bot/followers/ids` も `GET /v2/bot/profile/{userId}` も既定の**2,000リクエスト/秒**（公式 https://developers.line.biz/en/reference/messaging-api/#rate-limits 2026-10-15確認）。下の並列数ではまったく届かない。

#### 改修前（2026-10-15 午前まで）

| 段 | 1ステップで処理する数 | 10,000人で必要なステップ数 |
|---|---|---|
| `importing_ids`（IDを集める） | 1,000件（1ページ） | **10** |
| `hydrating_profiles`（名前とアイコン） | 25人（旧 `PROFILE_BATCH_SIZE`、5人ずつ並列で5巡） | **400** |

実際に進めていたのは**背景cronだけ**で、`scheduled-job-isolation.ts:14` の `frequentHeavy = '1-56/5 * * * *'` ＝ **5分おきに1アカウント1ステップ**。410ステップ × 5分 ＝ **約34時間**。

**「画面を開けば約30分」は成り立たなかった。** 画面のポーリング（`register.tsx:186-217` の3秒）は `followerImportState()`＝`GET` の読み取りだけで、`POST .../follower-import/step` を呼んでいない。`POST /step` はサーバ側の経路（`routes/line-accounts.ts:1035`）とクライアント定義（`lib/api.ts:9742`）はあるが、UIからの呼び出し元が1つも無い（`grep -rn 'followerImportStep\|follower-import/step' apps/web/src` のヒットは定義の1件のみ）。前区間に利用者へ伝えた「前景約30分」はこの誤りを含んでいたので、ここで訂正する。

#### 改修後（利用者指示「5分に1回・25人ずつとかしなくて良いです、最速で引き継げる設計でお願いします。」）

1回の実行の中で**時間と人数の予算を使い切るまでページを繰り返す**方式へ変えた。刻みの回数だけ待つ構造をやめた。

| 決めごと | 値 | 置いた場所 | 根拠 |
|---|---|---|---|
| 1ページで読み出す人数 | 200 | `PROFILE_PAGE_SIZE` | D1の1クエリで扱いやすい単位 |
| 同時に走らせる取得本数 | 12 | `PROFILE_CONCURRENCY` | Workersの同時オープン接続は6（「応答ヘッダ待ち」だけを数え、7本目は待つだけでエラーにならない）。本文読み取りと書き戻しで手が空く分を見込んで12本 |
| 1回の実行で引く上限 | 9,000人 | `PROFILE_MAX_PER_RUN` | 有料プランのサブリクエストは**1 invocation あたり10,000回**で、**D1の呼び出しもここに数える**。ページ読み出し（45回）と書き戻し（90回）の分を空けた |
| cronレーン1回の上限 | 9,000人／実時間10分／1アカウント150秒 | `follower-import-background.ts:9-15` | cronは**CPU 30秒／実時間15分**。待ち時間はCPU時間に数えないので実時間で10分に切った |

- 書き戻しは1人ごとの `UPDATE` をやめ、ページ単位の `db.batch`（100件ずつ）にした。D1の呼び出しが人数分からページ数分へ下がり、10,000枠のほぼ全部をプロフィール取得に回せる
- 取得は固定の塊を待ち合わせる書き方をやめ、`runWithConcurrency` のワーカープール12本にした。遅い1本が残りを止めない

**10,000人の所要時間：約5〜6分。**

- プロフィール取得 9,000人 × 150ms ÷ 並列12 ≒ **112秒**（サブリクエストは 9,000＋45＋90 ≒ **9,135** で10,000以内）
- 10,000人は1回の実行枠（9,000人）を1人ぶん超えるので**cron 2ティック**にまたがる。cronは毎分〜5分おきに回るため **約5〜6分**
- 画面を開いているかどうかは速さに関係しない（画面は読み取りだけ）。閉じても戻るボタンを押しても、同じカーソルから続く

**進捗が消えない仕組みは改修後も維持している。**

- 状態（phase・カーソル・件数）は D1 の `account_settings` に `follower_import_v1` キーで保存される。ブラウザは持っていない
- 書き戻しが落ちた塊の行は `display_name IS NULL` のまま残り、カーソルもその手前で止まるので、次の実行が同じ行を引き直す（2026-10-15 の修正後。修正前は書けた塊の件数が落ちていた → 下の「Codexが見つけた取り残しの修正」）
- ロックは「時間予算＋30秒」で押さえ、予算を使い切った直後に解放されるので続きをすぐ拾える。二重実行は楽観ロック（`value = ?` の条件付きUPDATE、`changes === 0` なら busy）で防ぐ
- 進捗はいつでも `GET /api/line-accounts/:id/follower-import` で読める

検証（2026-10-15）：`follower-import.test.ts`（3件）／`follower-import-background.test.ts`（1件）／`line-accounts.test.ts`（76件）＝**80件合格**、`pnpm --filter worker typecheck` 合格。途中で人数の取り分を使い切って止まり、次の呼び出しがカーソルから再開することもテストで押さえた（`stops at the profile allowance and resumes from the stored cursor`）。**実APIでの検証は未実施**（Codexへ引き継ぐ）。

**アカウント一覧の「入る」から続きが始まる（2026-10-15 実装）。**

利用者の指定は「現在のアカウント一覧と同じデザインで入るというボタンを押すと続きから始まる仕組み」。新しい画面は作らず、既にある「入る」ボタン（`apps/web/src/v8/hq/home.tsx:416`）の挙動として足した。見た目・文言・位置は一切変えていない。

- `login()` が `api.lineAccounts.stepFollowerImport(accountId)` を投げてから画面を移す。**答えは待たない**ので入るのが遅くならず、口が転んでも遷移は止まらない
- 投げるのは `canManage`（owner／admin、閲覧のみ・viewer は除く）のときだけ。step 経路の `requireRole('owner','admin')` と一致させている
- 済み（`completed`）・始めていない（`not_started`）アカウントは、サーバがロックも取らず即返る（`follower-import.ts:403-406`）ので、毎回押しても無駄も害も無い
- 画面を閉じられてもこの1回ぶんは走り切る：step 経路を `c.executionCtx.waitUntil(run)` に乗せた（`routes/line-accounts.ts:1044-1052`）。途中で切られてロックだけが残り、続きを拾えるまで待たされるのを防ぐ
- cron も今までどおり回り続けるので、「入る」は**次の刻みを待たずに今すぐ動かす**ためのもの。押さなくても引き継ぎは終わる

検証（2026-10-15）：`home.test.tsx` **8件合格**（押すと口を叩く／口が返らなくても転んでも止まらない／閲覧のみは動かさない）、worker **80件合格**、worker と web の型検査合格。

### Codex独立レビュー（2026-10-15 22:33 JST）— 未合格・配備前にClaude修正へ返却

- 対象：`skmtmst/LINE追加画面のアップデート`、HEAD `217c31ba2a8a26aad31124ce6781b54902b5b4e0` と上記の未コミット差分。事前診断は `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` で合格。親EC作業ツリーは読み取りのみで変更なし。
- 再現：既存の `createTestD1`（SQLite）と実サービスを使用し、200人のプロフィール書き戻しのうち、2回目の100件の `db.batch` だけを故障注入で失敗させた。最初の100人はDBに保存されるが、進捗は0人・カーソルなし。再開後は `display_name IS NULL` が残り100人だけを選ぶため、実際には200人更新済みでも `profilesProcessed=100` / `profilesUpdated=100` / `phase=completed` になった。期待値は200人。`hydrateProfilePage` の複数batchと件数・カーソル更新が一体ではないため、§3の「行はNULLのまま残り、同じページを引き直す」は部分成功時には成立しない。
- 保存時点の確認：201人を処理し、2ページ目の取得開始時に別読み取りしたところ、友だち200人は更新済みなのに保存済み進捗は0人・カーソルなし。ページごとの状態保存はなく、実行終了時の `finally` だけで保存している。実行打ち切り時にも件数とカーソルを維持するには、書き込みと進捗の整合したチェックポイントが必要。
- 固定時計による確認（実際の待機・負荷生成なし）：1アカウントの予算150,000msに対して、最初のプロフィール応答時に時計を200,000ms進めても、残りを含め200人全員を取得した。時刻確認はページ終了後のみで、ネットワーク要求に中止・期限がないため、150秒・ロック余白30秒を越え得る。HTTP側の既定20秒についても同じ構造。`waitUntil` は切断後最大30秒であり、任意に遅いページが必ず走り切る保証ではない。
- 検証コマンド：`pnpm exec tsx /Users/masatosakamoto/Documents/ChatGPT/AI開発設計/.runtime/codex-D4yjml/follower-import-review.ts`（パスは引用符で囲む）。ハーネスの受入条件1・2に故障再現を記録し、進捗件数の一致アサーションで終了コード1。テスト用データだけを使用し、実API・遠隔DBには接続していない。
- 外観差分：`home.tsx` の変更は `login()` 内だけ。JSX・DOM・文言・CSSの変更なしをハーネスの受入条件3に記録。画素比較やブラウザ実動作の合格とは区別する。
- 公式仕様を同日再確認：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) はPaidのサブリクエスト10,000、応答ヘッダ待ち接続6、5分周期cronのCPU30秒・実時間15分、HTTP切断後の `waitUntil` 最大30秒。[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) はPaidのWorker invocationあたり1,000 queriesも別記している。バッチ・ID取り込み・他の同一cronジョブを含む上限の実効計測は未実施。並列12本をそのまま12接続分の速度と見なすこともできず、約5〜6分は未検証の見積のまま。
- 環境上の残件：`wrangler.staging.toml` は意図的にcron無効。配備workflowも `[triggers]` があれば通知事故防止のため拒否する。stagingで本物の `frequentHeavy` を自然発火させる検証は現行構成ではできない。安全ゲートを外さず、この処理だけを検証する方法をClaude側で整理する必要がある。
- Git：最新の `origin/codex/development` はfetch済み、`90e6ff1cbaba9b1f1bb44efd7d73392a49b19f8f`。対象のAPI・一覧ファイルにも本線差分がある。上記の不具合を先に返すため取り込み・コミット・push・PR・CI・マージ・配備は未実施。正式な再検証時は最新本線を取り込んで対象テスト・型検査・ビルドを行う。Claudeの先行テスト結果と、今回の故障注入レビューは別の証拠。
- 次の1手：Claudeで部分成功・途中中断の進捗整合と時間／ロック制御を修正し、回帰テストを追加して再引き継ぎ。Codexは修正を実装していない。本番・stagingとも変更なし、実人数・実所要時間は未測定。

### Codexが見つけた取り残しの修正（2026-10-15 23:06 JST／Claude実装・ローカル検証まで）

上のレビューの3点を直した。どれも「書けた人数と画面に出る人数が合っているか」「取り残したまま終わったことにならないか」の話。

1. **カーソルは引けた人の連続したところまでしか進めない**（`follower-import.ts` の `hydrateProfilePage`）。1ページの中で「書けた」「引けなかった」が確定した行を頭から順に見て、途切れたところで止める。書き戻しの塊が落ちた行や、時間切れで触らなかった行がそこに来るので、その先へは進まない。以前はページの最後の行まで一気に進めていたため、落ちた塊の人が二度と選ばれなかった。
2. **件数は塊ごとに足す**。`db.batch` は1文でも落ちると塊ごと巻き戻るので、`WRITE_CHUNK_SIZE = 100` の塊ごとに成否を見て、成功した塊のぶんだけその場で `profilesUpdated` / `profilesProcessed` に足し、落ちた塊でループを抜ける。以前は全部の塊を書き終えてから足していたため、途中で落ちると書けた100人ぶんが帳簿から消えていた。
3. **ページの途中でも時間を見る**。並列の各レーンがプロフィールを引く前に期限（`Date.now() >= deadlineMs`）を確かめ、過ぎていたらその行を触らずに残す。以前はページが終わってから時刻を見ていたので、200人ぶんの取得が終わるまで止まらず、1アカウント150秒とロック余白30秒を越え得た。なお LINE SDK（`packages/line-sdk/src/client.ts`）には1回ごとの中止・期限が無く、そこは今回も変えていない（共通部品のため別件）。1本が延々と返らない場合の取りこぼしは残る想定。
4. **ページごとに進み具合を保存する**。1ページ書き終えた時点で `saveState` を呼ぶ。実行終了時の `finally` だけに任せると、CPU上限や立ち退きで打ち切られたときにDBには書けているのに件数とカーソルが古いまま残る。ロックの項目は保存する状態に入れたままなので、途中保存でも他の実行は割り込めない。打ち切りで失うのは最大1ページぶんになった。
5. **引けなかった人をもう一度さらう**（`PROFILE_MAX_PASSES = 3`）。取得の失敗はそのページでは「確定」として数えてカーソルを進めるが、`profileFetchFailuresInPass` に覚えておき、失敗が出たまわりでは完了にしない。`profileRetryPass` を1つ上げ、失敗数を0に戻し、カーソルを `null` に戻して `display_name IS NULL` の行だけをもう一度さらう。引けた人はもう条件に合わないので引き直さない。カーソルを戻すのは巻き戻しではない（件数は減らさない）。
   - 承知の上の副作用：`profilesProcessed` は「そのさらいで確定した数」なので、何度も失敗する人は最大3回数えられる。エラーが出たときだけ数が多めに出る。

回帰テスト（`follower-import.test.ts`、新規5件）：

| テスト | 押さえていること |
|---|---|
| `credits only the chunks that were written and does not complete past a failed write` | 150人で2塊目を落とす。1回目は100人ぶんだけ加算・カーソルは `f-099`・`completed` にならない。2回目で150人そろって完了 |
| `sweeps again for a profile that failed once instead of leaving it behind` | 1人が1回だけ429。もう一度さらって3人そろう（`profileRetryPass = 1`） |
| `gives up on a permanently unreadable profile only after the retry passes` | 1人がずっと404。2人ぶんだけ更新し、3回のさらいで打ち切る（`getProfile` 呼び出しは5回） |
| `stops fetching inside a page when the time budget runs out` | 固定時計で予算1秒。30人ぶんを引き切らずに止まり、書けた人数＝加算した人数＝カーソル位置。次の呼び出しで30人そろう |
| `saves the counters and the cursor after every page, not just at the end` | 300人。2ページ目を読みにきた時点の保存済み状態が200人・`f-199`・ロック保持 |

検証（2026-10-15 23:06 JST、すべてローカル）：`pnpm --filter worker test -- follower-import` **9件合格** ／ `pnpm --filter worker test` **966ファイル 11,318件合格・30件skip** ／ `pnpm --filter web test -- src/v8/hq/home.test.tsx` **8件合格** ／ `pnpm --filter worker typecheck`・`pnpm --filter web typecheck` 合格。**実APIでの検証は未実施**。

stagingでcronが無効な件（上のレビューの環境上の残件）への答え：**安全ゲートは外さない。** `wrangler.staging.toml` に `[triggers]` を足さず、配備workflowの拒否も残す。`processPendingFollowerImports` の呼び出し元は cron の scheduled ハンドラ1か所だけ（`apps/worker/src/index.ts:1490-1496`）で、HTTPから叩ける口は無い。足すのは「通知事故防止のため止めている処理を、別の口から動かす」ことになるので足さない。

代わりに、stagingでは既にある `POST /api/line-accounts/:id/follower-import/step` で確かめる。「入る」ボタンが叩いている口で、`processFollowerImportStep` をそのまま呼ぶので、取得の並列・書き戻し・カーソル・ロック・時間予算の切れ方はすべてこの口で観測できる。レーン側（`follower-import-background.ts`）が追加で持っているのは「待っているアカウントを5件まで拾い、9,000人と実時間10分を分け合う」割り振りだけで、これはローカルの `follower-import-background.test.ts` と定数の確認で押さえる。

よってCodexへの再依頼では **cronの自然発火の確認を受入条件から外し**、代わりに次の形にする：
- step の口を叩き、`GET /api/line-accounts/:id/follower-import` の進み具合が巻き戻らず進むこと
- 1回の呼び出しが `budgetMs` の既定（20秒）付近で切れ、続きが次の呼び出しで進むこと
- `Too many subrequests` とD1のエラーがログに出ないこと
- レーンの実時間10分・1アカウント150秒は**ローカルテストと定数の一致確認まで**（stagingでは自然発火させない）

### Codex再レビュー（2026-10-15 23:20 JST）— ロック期限後の旧実行による進捗巻き戻りを再現

- 受け渡し `f7855ca58413cd28db0fce05f61131a0`。ブランチとHEADは依頼どおり `skmtmst/LINE追加画面のアップデート` / `217c31ba2a8a26aad31124ce6781b54902b5b4e0`、8ファイルの未コミット差分 `+551 -62` と本台帳を照合。事前診断合格、親ECは読み取りのみ。
- 前回の同じSQLite故障注入スクリプトを再実行し、部分batch失敗後に実更新200人・進捗200人で一致すること、2ページ目取得開始時に保存済み200人・カーソル・ロックが残ることを確認。期限後の追加取得も200回から1回へ抑制された。ただし1本の応答そのものは期限を超えて返り得るため、厳密な時間上限は未達。
- **新たに再現した配備阻害不具合（受入条件2の不合格）**：201人のうち、先行実行の最初の1人だけ応答をPromiseで保留し、残りを取得待ちにする。時計だけを51秒進める（既定20秒＋ロック余白30秒を超過）。後続の実行は期限切れロックを取得して201人を処理し、`phase=completed` / `profilesProcessed=201` / `profilesUpdated=201` を保存する。その後で先行実行の保留応答を解放すると、古い状態が `phase=hydrating_profiles` / `profilesProcessed=200` / `profilesUpdated=200` として保存され、**完了→処理中、201人→200人へ実際に巻き戻る**。友だちの実更新は201人のまま。
- 原因：ロック取得時の比較更新はあるが、`processFollowerImportStep` のページ保存（538行付近）と `finally` の保存（548行付近）は、まだ自分の `lockToken` が所有者かを検証せず `saveState` する。APIの1本の遅延は単なる速度上の制約ではなく、後続実行の進捗と完了状態を壊せる。共通SDKの期限追加を別件にする場合も、旧所有者が後続の友だち更新・状態保存・ロック解放を行えない仕組みはこのサービスの再開保証に必要。
- 再現コマンド：`pnpm exec tsx '/Users/masatosakamoto/Documents/ChatGPT/AI開発設計/.runtime/codex-D4yjml/follower-import-lock-review.ts'`。実サービスと `createTestD1` を使用。固定時計と制御したPromiseのみで、実待機・CPU負荷生成・実API・遠隔DB操作はなし。ハーネス受入条件2に終了コード1を記録。HTTP状態・request IDはローカル故障注入のため該当なし。
- 最新本線はfetch時点で `e346a93acac35f1882f121f68b622b7bcdf67e69`（#1735）へ進んでいる。不具合を先に返すため、本線取り込み・コミット・PR・CI・マージ・配備を行っていない。最新本線取込み後の全テスト・型検査・ビルドは未実施で、Claudeのローカル合格報告と混同しない。staging実APIと所要時間も未確認。
- 次の1手：Claudeで期限切れ後の旧実行を無効化し、上記の「後続完了→旧応答復帰」回帰テストで進捗・完了状態・ロック・友だち情報が後戻りしないことを確認して再引き継ぎ。Codexは機能コードを変更していない。元の差分を保持し、追記は本台帳だけ。本番とstagingは変更せず、cron安全ゲートもそのまま。

### 旧実行の巻き戻りの修正（2026-10-15 23:35 JST／Claude実装・ローカル検証まで）

上の再レビューで再現した「期限切れロックの旧実行が、続きを引き継いだ新しい実行の進み具合を上書きする」を直した。
変更は `apps/worker/src/services/follower-import.ts` の `processFollowerImportStep` だけ。

- **この実行が入れる書き込みを全部、比較更新（compare-and-swap）にした。** ロックを取ったときの文字列を `currentRaw` に覚えておき、以後の保存は `WHERE ... AND value = ?` にその文字列を渡す `persist()` を通す。別の実行が先に書いていれば `changes === 0` になるので、保存は成立せず、古い内容で新しい進み具合を巻き戻さない。成立したら `currentRaw` を書いた内容へ進める。D1（SQLite）は文の実行を直列化するので、競合した2つの比較更新はどちらか一方だけが通る。
- **書けなかったら、その実行はそこで降りる。** ページ保存が不成立なら `lockLost = true` にしてループを抜ける。自分の手元の状態はもう古いので、`lastError` も書かない。
- **持っていないロックを解除しない。** `finally` のロック解放も `lockLost` のときは行わない。これが無いと、続きを引き継いだ側のロックまで外してしまう。
- **呼び出し側へはDBの最新を返す。** `lockLost` のときは `getFollowerImportState` で読み直し、`busy: true` とともに返す。画面には「201人・完了」が出て、旧実行の「200人・処理中」は出ない。
- 変えていないもの：`detectFollowerImportCapability` と `startFollowerImport` が使う一般の `saveState`（同時にロックを持つ実行がいないため）、`packages/line-sdk/src/client.ts` の1回ごとの中止・期限（共通部品のため別件。1本が延々と返らないこと自体は残るが、戻ってきても他の実行を壊せなくなった）。

**追加した回帰テスト**（`follower-import.test.ts`）

| テスト | 押さえていること |
|---|---|
| `does not roll back a newer run that took over after the lock expired` | 300人。1ページ目を読みにきた時点で、別の実行が「300人・完了・カーソル `f-299`・ロック解放」を書いた状況を作る。旧実行は何も保存せず、保存済みは300人・完了・ロックnullのまま。旧実行の戻り値は `busy: true` で `phase=completed` / `profilesUpdated=300`（自分の古い値を返さない） |

故障注入の口は `makeDb` の `setSetting`（別の実行による横からの書き換え）と既存の `onProfilePageQuery`（割り込む位置の指定）。
モックの `UPDATE account_settings` は元から比較更新なので、修正の有無がそのまま結果に出る。

**検証（2026-10-15 23:31〜23:35 JST、すべてローカル）**

- `pnpm --filter worker test -- follower-import` … **10件合格**（`follower-import.test.ts` 9件＋`follower-import-background.test.ts` 1件）
- `pnpm --filter worker test` … **966ファイル 11,319件合格・30件skip**
- `pnpm --filter web test -- src/v8/hq/home.test.tsx` … **8件合格**
- `pnpm --filter worker typecheck` / `pnpm --filter web typecheck` … 合格
- **実APIでの検証は未実施。** 最新本線（`origin/codex/development`）の取り込みも未実施。コミットしていない。
- 画面の変更なし（`home.tsx` は今回触っていない）。新規Pencil承認は不要。

### Codex再々レビュー（2026-10-15 23:41 JST）— 状態は守れたが友だち情報の旧実行上書きを再現

- 受け渡し `148ae5fbee0e0c2821cfcd1bb6aacff1`、HEAD `217c31ba2a8a26aad31124ce6781b54902b5b4e0`。差分は8ファイル `+652 -67` と本台帳。事前診断合格。親ECは読み取りのみ。本番・staging・cron設定は変更なし。
- 保留Promise・固定時計51秒・実SQLiteによる**前回と同じ競合**を再実行。後続が保存した `201人・完了` は、旧実行の応答が遅れて返っても `201人・完了` のまま。状態への比較更新は効いた。部分batch故障とページ中の保存も前回と同じスクリプトで再検証し、書き戻し200人・状態200人、次ページ読取時に状態200人で一致。
- ただし、同じ競合の最終時点で友だち201人の行を確認すると、**200人の表示名が後続実行の値から、期限切れ旧実行が取得した古い値に上書き**されていた。後続が保存した「201人・完了」は維持されるため、画面の進捗では気づけない。前回の再現スクリプトへ `staleFriendWrites === 0` のアサーションを足し、実際は `staleFriendWrites=200` で終了コード1。実ネットワーク遅延や顧客データを使わない決定的な故障注入である。
- 原因：`processFollowerImportStep` の `persist()` は `account_settings` への状態保存（523行付近）だけを比較更新する。一方で `hydrateProfilePage` の `UPDATE friends` は無条件（401〜405行付近）で、旧実行のページを書き戻した**後**に状態保存が不成立と判定される。状態CASでは友だちの更新を保護できない。旧所有者の友だち更新は、単なる事前SELECTだけでなく、ロック交代と原子的に整合するDBの書き込み条件・トランザクションで防ぐ必要がある。必要ならID取込のINSERT側も同様に点検。
- 再現：`pnpm exec tsx '/Users/masatosakamoto/Documents/ChatGPT/AI開発設計/.runtime/codex-D4yjml/follower-import-lock-review.ts'`（ハーネス受入条件1・3に未合格と記録）。実API通信なしなのでHTTP状態・request IDは該当なし。LINEプロフィールが二度の実行の間に更新された場合などに、旧結果で新しい情報を上書きする危険を示す。
- 対象のワーカー回帰テストはClaude側で10件合格の報告。今回の静的レビューでは不具合を先に見つけたため、最新本線 `origin/codex/development`（受け渡し指定 `e346a93acac35f1882f121f68b622b7bcdf67e69`）の取り込み・コミット・PR・CI・マージ・配備・実APIでの人数時間の測定は行っていない。無関係な§4のURL不一致も変更していない。
- 次の1手：Claudeが状態の比較更新に加え、期限切れの旧実行による**友だち行の上書き0件**を保証し、保留Promiseの故障注入で `201人・完了` と友だち201行の新しい内容の両方を確認する回帰テストを追加。修正後に同じ差分をCodexが再検証する。

### 友だち行の旧実行上書きの修正（2026-10-16 00:05 JST／Claude実装・ローカル検証まで）

上の再々レビューで再現した「状態は守れたが、期限切れの旧実行が取得した古いプロフィールで友だち200人を上書きする」を直した。
変更は `apps/worker/src/services/follower-import.ts` と同テストだけ。画面ファイルは触っていない。

- **所有権の条件を、書き込み文の中に入れた。** ご指摘どおり事前SELECTでは原子的にならない（SELECTとUPDATEの間に交代されうる）ので、`OwnershipGuard` という小さな受け渡し用の型を作り、`EXISTS (SELECT 1 FROM account_settings WHERE line_account_id = ? AND key = ? AND value = ?)` という断片と bind 値を `importIdPage` / `hydrateProfilePage` へ渡す。条件の `value` にはロックを取ったときの文字列（`currentRaw`）を入れる。交代が起きた時点で `account_settings.value` は必ず書き換わっているので、`EXISTS` が偽になり、その文は**1行も書かない**。SQLiteは単一の文を原子的に実行するので、条件の判定と更新の間に割り込まれない。
- **対象は友だちへ書く2つの文の両方。**
  - `hydrateProfilePage` の `UPDATE friends SET display_name = ... WHERE id = ? AND <所有権>`（今回の不具合の本体）
  - `importIdPage` のID取込。こちらは `VALUES` のままでは条件を足せないので `INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT` の形へ変えた（SQLiteはupsertを付けるときSELECT側にWHEREを要求する）。元から新しい表示名を壊す経路ではないが、「期限切れの旧実行は friends に何も書けない」を一本の約束にするため揃えた。
- **塊ごとに実際の更新行数を見る。** D1の `batch` は1回が1トランザクションで、同じ塊の中では所有権の bind 値が同じ。なので交代は「塊まるごと0行」として出る。塊が全部0行で、かつ読み直しても自分の文字列でなくなっていたら `lockLost = true` にしてページを降りる。件数に数えるのは `changes > 0` の行だけ。所有権が生きているのに個別の行が0行になるのは行が消えたときだけで、それは既存のカーソル処理（確定した先頭部分までしか進めない）で扱える。
- **ロックを失ったページは、既存の降り方に合流させる。** `HydratePageResult` に `lockLost` を足し、`processFollowerImportStep` のループで見て抜ける。以後は状態保存をせず、`finally` のロック解放もせず、DBの最新を読み直して `busy: true` で返す（前節で入れた経路をそのまま使う）。

**追加した回帰テスト**（`follower-import.test.ts`）

| テスト | 押さえていること |
|---|---|
| `writes no friend rows at all once a newer run has taken over` | 201人。旧実行が1ページ目（200人）の最後のプロフィールを引いた瞬間に、別の実行が「201人ぶんの新しい表示名・画像」を書き終えて「201人・完了・カーソル `f-200`・ロック解放」を保存する。書き戻しはこの**後**に来る。結果：古い名前の行が**0件**、友だち201行すべてが新しい内容、保存済みは201人・完了・`lockToken` null、旧実行の戻り値は `busy: true` で `profilesUpdated=201` |

- 空振りしないことを明示：同じテストで `expect(client.getProfile).toHaveBeenCalledTimes(200)` を見ている。「取得前に止まったから書かれていない」のではなく、**200人を実際に引き終えてから書き戻しに来て、1行も書けない**ことを確かめている。
- モック側も本物と同じ判定にした（`ownershipHolds`）。所有権の bind は末尾に足されるので、最後の引数が保存済みの状態と一致しなければ `changes: 0` を返す。実装の条件を外すとこのテストは落ちる。
- 既存の部分batch故障注入は、bindの並びが変わったため friends.id の参照位置を末尾から5番目（`args[4]`）へ直した。

**本物のSQLiteでの確認**（`sqlite3 3.51.0`、使い捨てDB。スクリプトは scratchpad の `guard-sql-check.sql`）

| 確認 | 結果 |
|---|---|
| 1. ロックを持っているうちは `UPDATE ... AND EXISTS(...)` が通る | `changes=1 display_name=古い名前` |
| 2. 交代後（`value` が変わった後）は0行。新しい値が残る | `changes=0 display_name=新しい名前` |
| 3. ID取込の `INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT` が文として通り、交代後は0行 | `changes=0 rows=1` |
| 4. ロックを持ち直せば同じINSERTが通る | `changes=1 rows=2` |
| 5. すでにこのアカウントで追従中の行はON CONFLICT側でも触らない | `f-000 display_name=新しい名前` |

bind変数は1文あたり8個で、D1の100個制限に対して余裕がある（塊の大きさは文の数であって bind 数ではない）。

**検証（2026-10-16 00:00〜00:10 JST、すべてローカル）**

- `pnpm --filter worker test -- follower-import` … **11件合格**（`follower-import.test.ts` 10件＋`follower-import-background.test.ts` 1件）
- `pnpm --filter worker test` … 合格
- `pnpm --filter web test -- src/v8/hq/home.test.tsx` … **8件合格**
- `pnpm --filter worker typecheck` / `pnpm --filter web typecheck` … 合格
- **実APIでの検証は未実施。** 最新本線（`origin/codex/development`）の取り込みも未実施。コミットしていない。
- 画面の変更なし。新規Pencil承認は不要。
- Codexの再現スクリプト（`follower-import-lock-review.ts`、`staleFriendWrites === 0` を見る版）はClaude側では実行していない。**再確認をCodexへ依頼する。**

**Codex独立再検証（2026-10-16 JST、配備前）**

- 固定時計を51秒進め、旧実行の200件目のプロフィール応答を保留したSQLite再現：旧実行が実際に200件取得したあとも `staleFriendWrites=0`、友だち201行が新しい内容のまま、保存済み状態は再開実行の「201人・完了」のまま（再現スクリプト終了コード0）。
- 別の独立再現で、部分書き込み後の件数・カーソル、2ページ目開始時の200人保存、時間予算切れ後に追加取得しないことを確認（終了コード0）。
- 以上は使い捨てSQLiteによる再現であり、stagingの実API・所要時間の実測はまだ確認していない。
- 本線 `008063dac1` を取り込んだ後、worker全体986ファイル／11,742件と対象web8件、worker・webの型検査とビルドが合格。後続の本線 `2e2c8ca5` はUber Eats台帳と更新履歴のみの更新で、これも取り込んだ。
- web全体はCI相当の `NEXT_PUBLIC_API_URL` を指定して2,234ファイル／13,317件が合格、**1件はローカルで未合格**。`src/lib/b244-source-rules.test.ts` が日本語を含むワークスペースの `import.meta.url.pathname` をURLデコードせず `scandir` に渡し、`ENOENT` となる既存のパス依存（今回の差分に同テスト・検査スクリプトの変更なし）。PR #1738 の英数字パスで動くCIにて全件確認する。結果が出るまではweb全体を合格扱いにしない。

### 行数ゲートの修正（2026-10-16 01:22）

PR #1738 の必須CI「Repository and shared checks」が `apps/web/scripts/v8-guard/code-size.mjs` で落ちていた。4ファイルが上限超過（`follower-import.ts` 660行／上限400、`line-accounts.ts` +8、`home.tsx` +9、`api.ts` +1）。この上限は下げる方向にしか動かせず（`code-size-baseline.json` への追加・引き上げは検査が弾く）、**直し方はコードを縮めるしかない**。

- `follower-import.ts` を役割で3つに分けた（660行 → 192行）。`follower-import-state.ts`（176行：状態の鍵・型・`OwnershipGuard`・開始と利用可否の判定）、`follower-import-pages.ts`（327行：1ページ分のID取り込みとプロフィール取得）、`follower-import.ts`（192行：時間と件数の予算、刻みの進行、再公開）。**移した中身は読み直して丸ごう写しで、書き換えていない。**
- `./follower-import.js` からの再公開で**公開しているインポート面を変えていない**ため、利用している5ファイルの `import` 文は無修正。
- 残り3ファイルは説明コメントの圧縮と、挙動も見た目も変わらない行のまとめだけ（`home.tsx` 700→691、`line-accounts.ts` 2159→2151、`api.ts` 16612→16611）。リポジトリに行の長さの検査（`max-len`／`printWidth`）は無いことを確認済み。
- 記録ファイル（`code-size-baseline.json`）は触っていない（凍結数は437のまま）。

**検証（2026-10-16 01:10〜01:22 JST、すべてローカル）**

- `node apps/web/scripts/v8-guard/code-size.mjs --base 2e2c8ca5b357aed5374fc96ee9c9613af59e811d` … `2593 body files, 437 frozen, **0 violations**`
- `node --test apps/web/scripts/v8-guard/code-size.test.mjs` … 11件合格（ゲート自体の自己テスト）
- `pnpm --filter worker test` … **986ファイル／11,742件合格**
- `pnpm --filter web test`（CI相当の `NEXT_PUBLIC_API_URL` 指定） … 2,234ファイル／13,317件合格、**既存のパス依存1件のみ未合格**（`b244-source-rules.test.ts`。上の節と同じ原因で、復号したパスでは違反0件。CIの英数字パスでは通る）
- `pnpm --filter web exec vitest run src/v8/hq/home.test.tsx` … 8件合格（アカウント一覧の見た目と挙動）
- `pnpm --filter worker typecheck` / `pnpm --filter web typecheck` … 合格
- **実APIでの検証・staging配備・所要時間の実測は未実施。** コミットもしていない。

### マージとstaging配備は完了・実測はHTTP 401で止まった（2026-10-16／Codex報告とClaudeの原因特定）

- PR #1738 は**マージ済み**（`5ace6976dc Merge pull request #1738 from skmtmst/skmtmst/LINE追加画面のアップデート`）。**staging配備も完了**し、公開ヘルスのSHAが一致。**本番は未配備**（今回の対象外）。
- 受入条件1〜5はマージ済みHEADでCodexが再検証して合格。
- **受入条件6（実APIでの所要時間の実測）は未達。** 止まった原因はHTTP 401が2種類あり、以下のとおりClaudeが根拠を特定した。

#### 401その1：検証用LINEアカウント3件のトークン期限切れ（→ 本人のログイン不要）

- トークンの再発行は `issueLineAccessToken`（`apps/worker/src/services/token-refresh.ts:65-106`）で、LINEの `POST https://api.line.me/v2/oauth/accessToken` を `grant_type=client_credentials` で叩くだけ。**必要なのは `channel_id` と `channel_secret` の2つだけで、LINE Developers のログインもMFAも要らない**（同ファイル先頭のコメント「No refresh_token needed」）。
- その2つはstagingのD1に保管済み（`packages/db/src/line-accounts.ts:31` `channel_secret`、`:33` `channel_secret_encrypted`）。
- **期限切れになった理由が特定できた。** 再発行を呼ぶのは `apps/worker/src/index.ts:2201` の `refreshLineAccessTokens(env.DB)` **だけ**で、これはcronの中にある。stagingは `apps/worker/wrangler.staging.toml:5` のとおり意図的に `[triggers]` を持たないため、**この更新は一度も走っていない**。3件そろって切れていたのは偶然ではなく仕様どおりの結果。
- → 直し方は、stagingの3件について `channel_id` + `channel_secret` からトークンを再発行してD1へ書き戻すだけ。**遠隔環境の操作なのでCodex担当**（Claudeはローカルまで）。`[triggers]` の追加はしない。

#### 401その2：stagingの管理API（→ MFAの設定値を先に読む必要がある）

- `apps/worker/src/index.ts:539` の `authMiddleware` が全APIに掛かり、Bearerは `authenticateApiToken`（`apps/worker/src/middleware/auth.ts:653-695`）で判定される。
- `env.API_KEY` はownerとして通る口があるが（`auth.ts:677-680`）、**`TOTP_ENCRYPTION_KEY` が設定済みで、かつ platform設定 `auth.mfa.required:<統括ID>` が `'false'` 以外のとき `null` を返して弾く**（`auth.ts:678`）。DB登録のAPIキーも同じ条件で弾かれる（`auth.ts:669-672`）。
- つまりstagingの401は「鍵が間違っている」ではなく、**MFA必須の設定が入っているとAPIキーでは入れない**という作りの結果である可能性が高い。`admin-auth.ts` 側の401もすべて期限切れ・2要素・`STEP_UP_UNAUTHORIZED` の系統で、本物のLINEログイン＋TOTPを求めている。
- → 本人のログインを頼む前に、stagingの `TOTP_ENCRYPTION_KEY` の有無と `auth.mfa.required:<統括ID>` の実際の値を読んで確かめる。`'false'` ならAPIキーで通るので本人の操作は不要。必須が入っていた場合だけ、本人のログインか、staging限定で必須を外す許可のどちらにするかを利用者へ1回だけ確認する。

#### 利用者の質問への答えは管理画面を通さなくても測れる

所要時間を決めているのはほぼLINE API側の往復（`/v2/bot/followers/ids` のページ送りと、1人ずつの `/v2/bot/profile/{userId}`）。実装の並列数は `PROFILE_CONCURRENCY = 12`（`follower-import-pages.ts:30`）。再発行したトークンで同じ2つの口を同じ並列数で叩けば、管理画面の認証を通さずに**実測と10,000人換算が出せる**。管理画面経由の「入る」で続きから始まることの確認は、401その2が解けてから行う。

#### staging再検証（2026-10-16 03:35 JST、Codex）

- 対象は既存のstaging検証用3件のみ。D1を読み、3件とも `channel_id` と `channel_secret` が存在し、既存トークンの保存済み期限は2026-10-03（JST）だった。資格情報の値は表示・保存しない。
- LINE公式資料 [Issue channel access token](https://developers.line.biz/en/reference/messaging-api/#issue-channel-access-token)、[Get a list of users who added your LINE Official Account as a friend](https://developers.line.biz/en/reference/messaging-api/#get-follower-ids)、[Get profile](https://developers.line.biz/en/reference/messaging-api/#get-profile) と [Getting user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/) を2026-10-16に確認。発行は `client_credentials`、ID一覧は認証済み・プレミアムの公式アカウントのみ利用可。必要な利用条件の事前確認が不足していた。
- 3件ともLINEの `POST /v2/oauth/accessToken` は **HTTP 200**、有効期間2,592,000秒（30日）で新トークンを発行。ただし、その新トークンで `GET /v2/bot/followers/ids?limit=1000` を実行すると**3件ともHTTP 403**。発生時刻2026-10-16 03:35 JST、request ID（対象ID順）`c7d338ce-03d7-4d83-bc13-4a1a6473cd11`、`5ed894f0-c237-4a2d-a885-c968c5cac86d`、`2c944c0a-fbbe-4c8a-bc03-89f2e1d95d27`。期待値はID一覧HTTP 200、実際は403。種別の制限が有力だが、対象アカウントの認証区分そのものは未確認で、原因確定ではない。取得できたIDは0件、プロフィールへの要求は0件。**友だち総数・経過時間・10,000人換算の実測は出せない。**
- staging Worker secret `TOTP_ENCRYPTION_KEY` は**設定あり**（値は読み出していない）。統括テナント `00000000-0000-4000-8000-000000000001` のplatform設定 `auth.mfa.required:<統括テナントID>` は**行がなく未設定**。`apps/worker/src/middleware/auth.ts:678` では未設定も `'false'` 以外なので、APIキーでの管理API認証は拒否される。MFA設定は変更せず、今回の条件に従いstep・「入る」・画面離脱の操作も実施しない。
- 発行した新トークンはメモリ内でLINEへの読取要求にのみ使い、**D1へは書き戻していない**。作業ツリーにClaude所有の未コミット台帳変更があり、AGENTS.mdの「DB更新前は完全にクリーン」規則に抵触するため。3件の保存済み期限は変わっていない。cron無効、本番・PR・配備には変更なし。次は台帳差分を所有者が整理してクリーンにし、LINE側でID一覧が使える検証用アカウントを確保・確認した上で、staging限定のトークン更新と実測をやり直す。管理API経由の確認にはClaude窓口で正規MFAセッションまたはstagingの設定方針の判断が必要。

#### 403の原因確定と、401その2の確認結果（2026-10-16／Claude）

Codexの再検証で401の原因は2つとも判明したが、stagingの設定と保存済みトークンはまだ変更していない。新トークンを使った一時的な読取では**403が出た**。原因を次のとおり整理した。

**403はLINE側のアカウント種別制限で、実装の不具合ではない。**

- `GET /v2/bot/followers/ids` は**認証済みアカウントまたはプレミアムアカウントだけ**が使える。通常（未認証）の公式アカウントでは使えず、その場合は友だち追加のWebhookで1人ずつ受け取る以外に方法がない（[LINE公式「ユーザーIDを取得する」](https://developers.line.biz/ja/docs/messaging-api/getting-user-ids/)、[Get follower ids](https://developers.line.biz/en/reference/messaging-api/#get-follower-ids)）。stagingの検証用3件はこの条件を満たしていないため、**トークンが正しくても403になる**。Codexが記録した3件そろっての403・request ID付きの結果とも一致する。
- **実装はこの403を正しく扱っている。** `detectFollowerImportCapability`（`apps/worker/src/services/follower-import-state.ts:128-151`）が1件だけの読み取りで利用可否を調べ、403なら `capability = 'unavailable'` にして**エラー扱いにしない**（`:140-142`）。開始側も `capability !== 'available'` なら `FOLLOWER_IMPORT_NOT_AVAILABLE` で止める（`:159-161`）ので、使えないアカウントで無駄な要求を出さない。
- **画面もすでに代替動作を案内している。** `apps/web/src/v8/account-new/register.tsx:668` に「LINE の都合で取り込めないアカウントでは、友だちが話しかけた順に登録されます。」が常時表示され、取り込みの進み具合は `capability === 'available'` のときだけ出る（`:656,665`）。APIも409で「このアカウントでは既存友だち取得を利用できません」を返す（`apps/worker/src/routes/line-accounts.ts:1029`）。
- → **修正は不要。** 実測には**認証済みまたはプレミアムの公式アカウント**が必要で、これはコードでは解決できない（LINE側のアカウント区分）。

**401その2はClaudeの事前仮説どおりだった。**

- Codexがstagingで読んだ結果：`TOTP_ENCRYPTION_KEY` は**設定あり**、platform設定 `auth.mfa.required:00000000-0000-4000-8000-000000000001` は**行がなく未設定**。
- `apps/worker/src/middleware/auth.ts:678` の条件は `!== 'false'` なので、**未設定も「MFA必須」と判定されてAPIキーを拒否する**。鍵の誤りではない。
- → 解き方は、**stagingだけ** `auth.mfa.required:<統括テナントID>` に `'false'` を登録すること。これはコード自身が用意している切り替え口であり、本人のLINEログインもTOTPも不要になる。**本番の設定は触らない。**

**所要時間の見積に使える値（確定ぶん）**

| 要素 | 値 | 根拠 |
| --- | --- | --- |
| ID一覧の1ページ件数 | **1,000件**（10,000人なら10回） | `follower-import-pages.ts:81` の `getFollowerIds(1000, …)`、既定も1000（`packages/line-sdk/src/client.ts:360`） |
| プロフィール取得 | **1人1回**、並列**12** | `follower-import-pages.ts:30` `PROFILE_CONCURRENCY = 12` |
| 1回の実行の時間予算 | 20秒 | `follower-import.ts:34` `DEFAULT_RUN_BUDGET_MS` |
| 1回の実行の人数上限 | 9,000人 | `follower-import.ts:31` `PROFILE_MAX_PER_RUN` |

→ 10,000人の所要時間はほぼ `10,000 ÷ 12 × （プロフィール1回の往復時間）`。往復が0.2秒なら約2.8分、0.3秒なら約4.2分、0.4秒なら約5.6分。**残っている未知の値は「往復時間」だけ**で、これは認証済みアカウントがなくても `GET /v2/bot/info`（通常アカウントでも使える・同じホスト・同じ認証）を複数回叩けば代用の実測が取れる。

#### 本番LINE APIの読み取り実測とstaging認証の再確認（2026-10-16 09:26 JST／Codex）

- 先行するClaude所有の台帳差分を点検し、状況を正確にする2箇所の文言を修正して `f6f9f478ff` にコミット。既存の機能PR #1738・staging配備は再実行していない。
- staging D1の統括テナント設定 `auth.mfa.required:00000000-0000-4000-8000-000000000001` は**未登録**を確認してから `'false'` を1行だけ登録。既存のstaging管理者APIキーをメモリ内で読み、`GET /api/line-accounts` は**HTTP 200**（2026-10-16 09:25 JST、CF Ray `a4b2ed18ff8fd55a-NRT`）。鍵の値は出力していない。本番設定は未変更。
- 本番D1は**読取専用**で照会し、有効なLINE接続は1件。`channel_id` と `channel_secret` はメモリ内でのみ用い、LINEの `client_credentials` で30日トークンを発行。`GET /v2/bot/followers/ids?limit=1` は**HTTP 200**（2026-10-16 09:26 JST、LINE request ID `42b4e551-db03-4bb8-ac6f-79751b860cf2`）。チャネルWebhook設定・本番D1・既存トークンに書き込みなし。
- 同じ新トークンでID一覧（`limit=1000`）の1ページを**93ms／13人**で取得。`GET /v2/bot/profile/{userId}` は最大**12並列**で**13件全件HTTP 200、233ms**。ID一覧からプロフィール完了までの合計は**326ms**。プロフィールの平均往復は**175ms／件**（各通信時間の平均）。ユーザーID・表示名・画像・トークンは出力／保存していない。
- 観測した13件の並列処理の経過時間を単純比例させ、ID一覧10ページ分を足すと10,000人は**約180秒（3.0分）**。これは13人・ID一覧1ページのMacからの通信を引き延ばした**参考換算**であり、Workerからの通信、D1書き込み、20秒の実行予算と再開、レート制限などは未測定。従来の約5〜6分見積より短い可能性はあるが、10,000人規模の完走所要時間とは断定しない。
- stagingでの一時アカウントの作成とstep実行は**未実施**。「実利用者のプロフィール（表示名・画像）を保存しない」という今回の停止条件に対し、stepは取得したプロフィールをstagingの `friends` に書き込む。よって両方を同時には満たせない。作った一時アカウント・友だち行は**0件**で、削除対象もない。画面「入る」と離脱後の継続は**未検証**。
- staging既存3件の保存済みトークンは**更新していない**。3件すべて暗号化トークン列が埋まっており、stagingの暗号鍵はWorker secretでローカルから値を取得できない。D1の平文列だけ更新してもWorkerは古い暗号化列を優先して読んでしまう。既存の管理APIの資格情報更新は本人再確認のstep-up必須で、APIキーだけでは実行できない。暗号化を外す／値を不一致にする更新は避けた。安全に更新する経路はClaudeの設計・実装側で整理する。

### 「3分で終わる計算なのに10分待たされる」原因と修正（2026-10-16 09:50 JST／Claude実装・ローカル検証まで）

上の実測で**LINEとの通信そのものは10,000人で約3.0分**（参考換算）と分かったのに、画面の体感は**約10〜12分**になる。差は通信ではなく**待ち時間**だった。

- 1回の実行は `DEFAULT_RUN_BUDGET_MS = 20_000`（`apps/worker/src/services/follower-import.ts:26`）で区切る。1人あたり約17.9msなら**1回で約1,100人**進む。
- 画面側（登録ウィザードの⑤）は `api.lineAccounts.followerImportState` を**読むだけ**で、3秒ごとに進捗を見ていた。自分では進めないので、次に進むのは自動処理（cron）の順番が来たとき。
- その自動処理は `frequentHeavy = '1-56/5 * * * *'`（`apps/worker/src/services/scheduled-job-isolation.ts:11-23`、呼び出しは `index.ts:1476,1503-1509,2089`）で**5分ごと**。1アカウントに `PER_ACCOUNT_BUDGET_MS = 150_000`（2.5分）を割り当てるので1回で約8,380人進むが、**登録直後の人は最大5分待たされる**。
- つまり利用者指示「5分に1回・25人ずつとかしなくて良いです、最速で引き継げる設計でお願いします。」に対し、worker側は最速になっていたが**画面側が5分刻みを呼び戻していた**。

修正は画面側だけ。⑤の進捗の効果を `api.lineAccounts.stepFollowerImport` に替え、**1回ぶんが終わったらすぐ次を呼ぶ**自己連鎖にした（`apps/web/src/v8/account-new/register.tsx:200-228`）。

- 間隔は `busy ? 3000 : 500`。`busy`（他の経路が同じアカウントを握っている）ときだけ3秒待ち、進んだ直後は0.5秒。**0msにしない**のは、何も進まない応答が続いたときに空回りで熱を出さないため（0.5秒はWorker側の約20秒に対して無視できる）。失敗時は5秒後に再試行。
- 同時に呼ばれても壊れない。ロック期間中は `follower-import.ts:74`、CAS要求が0行なら `:95` が、どちらも**エラーではなく** `{ state, busy: true, profilesFetched: 0 }` を返す。
- 画面を閉じたあとは**今までどおり**自動処理（5分ごと）とアカウント一覧の「入る」が続きを拾う。カーソルはD1に残るので、間違って戻っても続きから始まる（利用者指示「現在のアカウント一覧と同じデザインで入るというボタンを押すと続きから始まる仕組み」）。
- これで10,000人は**約10回 × 20秒 ≒ 3.5分**、待ち時間ゼロになる。
- `DEFAULT_RUN_BUDGET_MS` は**上げない**。20秒・1人17.9msで約1,111人は1 invocationのサブリクエスト上限に近い。台帳として記録しておくが、リポジトリ内に**矛盾**がある（`follower-import.ts:28` は「有料プランは10,000回まで」、`index.ts:2816` は「1kの予算では1k超の積み残しを流しきれない」）。**どちらが正しいか未確定なので、1回の実行量を増やす前提の設計はしない**。
- Worker側は**1行も変えていない**。`/api/line-accounts/:id/follower-import/step` は `await run` のまま `{ state, busy, profilesFetched }` を返す（`apps/worker/src/routes/line-accounts.ts:1036-1053`）。

変えたのは5ファイル（ブランチ `skmtmst/LINE追加画面のアップデート`、基点 `ed421c0b4d9424c052397401da53eccbca1ef8c1`）。

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/v8/account-new/register.tsx` | ⑤の効果を step の自己連鎖へ（本体の修正） |
| `apps/web/src/v8/account-new/BEHAVIOR.md` | 動きの一覧22行目を実装に合わせた |
| `apps/web/src/app/accounts/accounts-setup-visual-parity.test.ts` | 設計ゲートが**ソース文字列**を見ているため、期待値を `stepFollowerImport` へ |
| `apps/web/src/app/accounts/new/register-v8.react.test.tsx` | モック追加と、`step` を呼ぶ／`followerImportState` を呼ばないの検証へ書き替え |
| `apps/web/src/app/accounts/new/wizard.test.tsx` | モック追加と、入れ子の応答形（`{state,busy,profilesFetched}`）へ |

**見た目・文言・配置・操作フローは変えていない**（進捗の表示に使う口だけを替えた）。よって**新規Pencil承認は不要**。

ローカル検証（Claudeの担当範囲）：

- web（登録ウィザード関連25ファイル）**159件 合格**。最初の実行は2件落ちた（`register-v8.react.test.tsx:139`／`wizard.test.tsx:174`、どちらも旧 `followerImportState` をモックしていたため）。モックと検証を直して全件合格。
- worker `follower-import` 10件・`follower-import-background` 1件・`routes/line-accounts` 76件の**87件 合格**（worker無変更の裏取り。背景継続と「入る」が壊れていないこと）。
- `pnpm --filter web --filter worker typecheck` 両方 `Done`（tscエラーなし）。
- worker全件の広い実行では31件落ちるが、落ちているのは `hq_templates` など**この差分と無関係の既存失敗**（差分にworkerファイルは0件）。

**実APIでの確認はまだ**。画面を開いたまま10,000人規模を進める実測と、途中で閉じて「入る」から再開する確認はstagingが必要で、Codexの担当範囲。

## 4. 気づいた不具合（未修正・実装時に扱う）

1. **友だち追加URLの形が他と違う**：`logic.ts:92` と `register-v8.tsx:148,933` は `https://lin.ee/{basicId}` を組み立てているが、他の箇所は `https://line.me/R/ti/p/@{basicId}`（`services/platform-announcements.ts:48`、`routes/liff.ts:1202`、`components/dashboard/qr-dialog.tsx:56`）。`lin.ee` は個別に発行されるもので basicId から導けない（`packages/db/src/line-accounts.ts:64` のコメント、`official_profile_url` 列がその用途）。→ 画面に出すURLが開けない可能性が高い
2. **別名URLが登録時に通らない（推測）**：既存アカウントの再確認は別名を許容する（`acceptedWebhookUrls`、`line-accounts.ts:327-340`）が、新規登録の `prepareLineConnection:155` は完全一致で比較しているため `WORKER_ALIAS_URLS` 等の別名だと不一致になる
3. **`token_expires_at` が登録直後NULL（推測）**：`createLineAccount` のINSERT列（`packages/db/src/line-accounts.ts:228-245`）に含まれていないため、初回の更新判定に影響する可能性

## 5. 残件と次の1手

- 2026-10-14：②アカウント接続と完了まわりの**11枚**（`JYfda`／`Qgmuw`／`a6uesI`／`QbFhL`／`FopO6`／`W7X3D`／`W4q5E`／`hShuH`／`nPpcO`／`S16DJ`／`TvXII`）を、スクリーンショットと変更点5件つきでClaude窓口から利用者へ提示した
- 2026-10-15：利用者の指示でKenta版の共通デザイン `LINE新規追加_v06.pen` へ乗り換え、④使い方を選ぶを飲食店向けのみ選択可にし、②を全3ステップ・③を全2ステップへ作り替え、不要な2枚（`NtjTn`／`K5ZOx`）を削除した。**v06は同日に承認を受けた**
- 2026-10-15：引き継ぎの最速化（25人固定・5分刻みの廃止、1回の実行で予算を使い切るまで進める方式）を `apps/worker/src/services/follower-import.ts` と `follower-import-background.ts` へ実装し、worker 80件のテストと型検査で合格。**画面に影響しない内部変更なので新規Pencil承認は不要**
- 2026-10-15：アカウント一覧の「入る」ボタンに引き継ぎを続きから始める挙動を足した（デザインは変えていない）。`apps/web/src/v8/hq/home.tsx`／`apps/worker/src/routes/line-accounts.ts`／`apps/web/src/lib/api.ts`／`home.test.tsx`。詳しくは §3 の「アカウント一覧の「入る」から続きが始まる」
- 2026-10-15 22:33：Codexの独立レビューで取り残しの不具合3件が再現し、配備前にClaudeへ返却（§3 の「Codex独立レビュー」）
- 2026-10-15 23:06：上の3件を修正し、回帰テスト5件を追加。`follower-import` 9件／worker 11,318件／web home 8件／worker・web 型検査が合格（§3 の「Codexが見つけた取り残しの修正」）。**実APIは未検証**
- 2026-10-15 23:41：Codexの再々レビューで「状態は守れたが友だち200人が旧実行の古い値で上書きされる」を再現し、配備前にClaudeへ返却（§3 の「Codex再々レビュー」）
- 2026-10-16 00:05：上の上書きを修正。所有権の条件を友だちへの書き込み文の中へ入れ（事前SELECTでは原子的にならないため）、交代後は1行も書けないようにした。回帰テスト1件を追加して `follower-import` 11件／worker 全件／web home 8件／型検査が合格。本物のSQLiteでも文の形と0行を確認（§3 の「友だち行の旧実行上書きの修正」）。**実APIは未検証**
- 2026-10-16 01:22：PR #1738 の必須CIが行数ゲートで落ちていたため、`follower-import.ts` を3ファイルへ分け（公開インポート面は不変）、残り3ファイルのコメントを圧縮して**違反0件**にした。ゲート自己テスト11件／worker 11,742件／web home 8件／型検査が合格（§3 の「行数ゲートの修正」）。**実APIとstaging配備は未実施**
- 2026-10-16：PR #1738 は**マージ済み**（`5ace6976dc`）、**staging配備も完了**（公開SHA一致）。**本番は未配備**。受入条件1〜5はマージ済みHEADで合格。受入条件6（実APIでの実測）だけHTTP 401で未達（§3 の「マージとstaging配備は完了・実測はHTTP 401で止まった」）
- 2026-10-16：401は2つとも原因が判明（staging側の設定と保存済みトークンは未変更）。新トークンを用いた `/v2/bot/followers/ids` が**3件そろってHTTP 403**。LINE側のアカウント種別制限（認証済み／プレミアム限定）に合致し、アプリは403を `capability='unavailable'` として扱う。管理APIの401は「TOTP鍵設定済み＋`auth.mfa.required` 未設定」の組み合わせだった（§3 の「403の原因確定と、401その2の確認結果」）
- 2026-10-16 09:26：stagingのMFA設定を `'false'` に変更し、管理APIが既存キーでHTTP 200を確認。本番D1読取だけで実LINE APIの対象1件（友だち13人）を実測し、ID一覧93ms＋最大12並列プロフィール233ms＝合計326ms。10,000人は単純比例で約3.0分だが標本13人の参考値。個人情報は保存せず、本番の設定・DB・Webhook・配備は無変更（§3 の「本番LINE APIの読み取り実測」）。
- 2026-10-16 09:50：**体感10〜12分の原因を特定して直した**。LINEとの通信は約3.0分でも、画面⑤が進捗を**読むだけ**だったため次の自動処理（5分ごと）を待っていた。画面を開いている間は `stepFollowerImport` で続きを自分で進める形に替え、待ち時間をゼロにした（10,000人なら約10回×20秒≒3.5分）。web 159件／worker 87件／型検査が合格。**worker・見た目は無変更＝新規Pencil承認は不要**（§3 の「3分で終わる計算なのに10分待たされる原因と修正」）
- 2026-10-16 11:27：**PR #1751 の必須CIの失敗を直した**。落ちていたのは実行時のテストではなく静的ゲート `Guard newly added source visual contracts (B-273)`（`.github/workflows/required-pr-gate.yml:280`）。原因は、⑤の呼ぶ口の変更に合わせて `accounts-setup-visual-parity.test.ts` の「ソース文字で中身を確かめる並び」を1語だけ差し替えたこと。`scripts/verify-no-source-visual-contracts.mjs:77` の `hit.key` は期待文字の**集合ごと**を含むため、追加でも削除でも「新しいソース契約」と判定される（削除だけにして再実行しても1件のまま残った）。台帳 `docs/qa/match-l2x-counts-1014.md:34` の前例どおり、該当の positive な並びを丸ごと外し、契約を描画の試験へ移した。呼ぶ口は `register-v8.react.test.tsx`（`stepFollowerImport` が呼ばれ `followerImportState` は呼ばれない）、5つの正本ノードは同ファイルに新設した「各段と結果の窓は絵の正本ノードを描く」（DOM の `data-design-node` を①→②→③→④→結果の窓→⑤の順に実測）＋ `scripts/visual-qa/v8-design-map-route-contract.test.ts`（ノードとURLの対応）で担保する。該当3ファイル25件が合格し、同CIステップの4コマンド（自己テスト49件／B-273 **0件**／行数ゲート自己テスト11件／行数ゲート違反0件）もローカルで合格。**本体 `register.tsx` は無変更＝見た目・文言・操作フローも無変更なので新規Pencil承認は不要**
- 次の1手（Codexへ）：上の**テスト2ファイルの差分**を独立レビュー → コミット・PR #1751 の更新 → **必須CI → マージ → staging配備** → 下の実API検証（6a）。ブランチ `skmtmst/LINE追加画面のアップデート`、現在のHEAD `995d147993`（この差分は未コミット）
- **前回の停止条件の衝突を解消した（Claudeの設計）**：前回の依頼文は「実stepを通す」と「実利用者のプロフィールを保存しない」を同時に求めていて両立しなかった（stepは取得したプロフィールを `friends` に書く。`maxProfiles: 0` も `Math.max(1, …)` で1に丸められ、`importIdPage` は友だち行を書く）。今回は条件をこう分ける。
  - **6a 実APIの通し確認（実施する・2026-10-16 経路を差し替えた）**：対象は本番の認証済みアカウント1件（友だち**13人**）。前回ここに書いた「staging の登録ウィザードから新規登録する」は**取り消す**。Codexが「本番LINEチャネルのWebhook宛先とLIFF接続先を書き換えるので停止条件に反する」として実行を断ったのは**正しい判断**で、台帳側の手順が誤っていた。
    - **使わない経路とその理由**
      - staging の**登録ウィザード**は使えない。`apps/worker/src/services/line-account-connect.ts` は**本番チャネルそのものを書き換える**（`:141` Webhook宛先の PUT、`:149` その読み出し、`:180` LIFF一覧、`:191` LIFFアプリの作成、`:208` LIFFアプリの更新）。前回の「新規登録なら正規経路なので暗号化列が正しく作られて回避できる」という理由付けは**誤りだった**（暗号化列の問題は解けるが、本番書き込みが発生する）。
      - `POST /api/line-accounts`（新規作成・`apps/worker/src/routes/line-accounts.ts:1483`）も使えない。`verifyConnection`（`:1607`／定義 `:481`）が、チャネルに登録済みのWebhook宛先が**stagingの** `acceptedWebhookUrls`（`:327`）に含まれることを求めるので400になり、さらに LINE の Webhook テスト（`/v2/bot/channel/webhook/test`）を本番チャネルへ投げる。
      - `PUT /api/line-accounts/:id` も使えない。`line_account.credentials` の更新は本人再確認（step-up）が必須で、`apps/worker/src/lib/step-up.ts` は新しい管理セッションか、`X-Step-Up-Token` ＋同じセッションのハッシュを要求する。CodexはAPIキー認証で管理セッションを持たないため、**原理的に満たせない**。
      - staging既存3件のトークン更新も使えない（3件とも暗号化列が埋まっていて、`decryptLineAccountCredentials` は暗号化列を優先する。stagingの暗号鍵は書き込み専用のWorker secretで値を取り出せない）。
    - **使う経路（本番への書き込みが1つも無い）**
      1. トークン：本番D1を**読取専用**で照会し、`channel_id`＋`channel_secret` をメモリ内だけで使って LINE の `client_credentials` で30日トークンを発行する。**2026-10-16 09:26 に実施済みでHTTP 200**（LINE request ID `42b4e551-db03-4bb8-ac6f-79751b860cf2`）。本番D1・チャネルWebhook設定・既存トークンへの書き込みは無い。残る副作用は、発行がLINE側のチャネル単位トークン集合（上限30本）を1本動かすこと。**ここは提案（確定ではない）**：発行は1本までにし、確認後に `POST https://api.line.me/v2/oauth/revoke` で無効化する。チャネル設定は触らない。
      2. アカウント行：**stagingのD1へ一時行を1件だけ直接insertする**。`channel_access_token` は平文列にだけ入れ、`channel_access_token_encrypted` は**NULL**にする（`packages/db/src/line-accounts.ts:425` の `if (!encrypted) continue;` により平文列がそのまま読まれる。既存3件で詰まったのは暗号化列が埋まっていたからで、新しい行には当てはまらない）。`tenant_id` はstagingのAPIキーのスタッフと同じテナント、`archived_at` は NULL、`is_active` は **0**。見え方の関門は `tenant_id` と `archived_at` だけで（`apps/worker/src/services/account-access.ts:16-26`、`packages/db/src/line-accounts.ts:628-643`、`routes/line-accounts.ts:202-240` のいずれにも `is_active` の条件が無い）、`is_active=0` でも detect・start・step・一覧には出る一方、配信系の経路からは外れる。他の列は既存のstaging行から写してプラン列などの取りこぼしを防ぐ。stagingのD1書き込みは保存済み共通承認の範囲内（同じやり方で `auth.mfa.required` の1行を登録済み）。
      3. 実行：`POST …/follower-import/detect`（`:990`、読み取りのLINE呼び出し1回）→ `POST …/follower-import/start`（`:1015`、LINE呼び出し無し。detect を先に通さないと `FOLLOWER_IMPORT_NOT_AVAILABLE` で409になる）→ `POST …/follower-import/step`（`:1036`）を自己連鎖で呼ぶ。これは上で決めた「『入る』が叩いている口」そのもので、取得の並列・書き戻し・カーソル・ロック・時間予算の切れ方はここで観測できる。間隔は通常500ms／`busy` が返ったら3000ms／失敗は5000ms、終端フェーズで止める。一時行は一覧（`:202`）にも出るので、画面の「入る」からの確認も取れる。
    - **測る数値**：完了までの実時間、step の呼び出し回数、`busy` が返った回数。
    - **保存の許可範囲**：**staging の13行だけ**。確認後に友だち行と一時アカウント行を削除し、**0件になったことを実測**する。**表示名・画像・ユーザーID・トークンは会話・ログ・リポジトリへ出さない**（出力の禁止は維持し、一時的な保存だけを許す）。
    - stagingには**cronが無い**（`wrangler.staging.toml` 5行目「Intentionally has no [triggers] section」。`processPendingFollowerImports` の呼び出し元は cron の scheduled ハンドラ `apps/worker/src/index.ts:1490-1496` だけで、HTTPの入口は無い）。よってstagingでは**画面の連鎖だけが取り込みを進める**ので、受入条件2の確認にちょうど合う。**`[triggers]` は足さない。配備workflowの拒否も外さない。**
    - もし 403（`FOLLOWER_IMPORT_NOT_AVAILABLE`）になったら、LINEのアカウント種別制限で**不具合ではない**。記録して止める。
  - **6b 大量データでの途中再開（実APIでは確認できない）**：使える認証済みアカウントの友だちが13人しかなく、1回のstepで完走するため「途中で閉じて『入る』で再開」を実データでは再現できない。再開そのものは単体テスト（`follower-import.test.ts:354` の予算打ち切りからの再開、および旧実行の巻き戻り・上書き防止の回帰テスト）で担保済み。**実データでの大量件数の再開は未確認のまま残す**と記録し、合格と言わない
- 残件（Claude）：staging既存3件の暗号化トークン列を安全に更新する正式経路。入口の候補は `packages/db/src/line-accounts.ts:926 updateLineAccount`（`:946` `channel_access_token`、`:986-988` `token_expires_at`）と `apps/worker/src/services/line-account-connect.ts:120,175`。**6a は新規登録で回避できるので、この残件は検証の前提ではない**
- 以前の1手（済み・記録用）：Codexへ再検証・コミット・PR・CI・マージ・**staging配備**を引き継ぐ。再現スクリプト（`staleFriendWrites === 0`）での再確認を含む。最新本線 `origin/codex/development`（`e346a93acac35f1882f121f68b622b7bcdf67e69`）を取り込む。**本番は今回の対象外**。cronの自然発火は受入条件から外し、step の口で確かめる（理由は §3 の同節）
- その次：`apps/web/src/v8/account-new/` の**v06実装**（下の実装範囲）
- v06の実装範囲：`apps/web/src/v8/account-new/register.tsx`／`logic.ts`／`register.module.css`／`BEHAVIOR.md` へ反映（①は「事前確認」、②は「アカウント接続」）。実装に含めるもの＝Step 2 のチェック3つ・Step 3 のチェック2つが全部入るまで次へを無効／Step 4 の5項目を上から順に確認する進行と行ごとの待機中・確認中（回るリング）・OK・エラー表示／確認の行は上下中央そろえ／エラー時のカード上部の赤い案内箱／5項目すべてOKのときだけフッターの次へを活性／**Step 5 の友だち追加テスト（QR表示＋追加の検知で自動的に次へ）**／ウィザードを4段にして基本情報の段を経路から外す／**友だち引き継ぎを選んだ人だけ通る引き継ぎ中の画面（進捗・残り時間・速さの更新と、終了後の自動遷移）**／**完了画面の「早速使ってみる」で接続したアカウントのダッシュボードへ遷移**。上記の不具合1は同じPRで直すか別PRにするかを判断する
- 未確認のまま残っている1件：LINE Developers のタブ別サフィックス（`/messaging-api/` 等）。チャネル単位の `console/channel/{チャネルID}` までは確認済み
- 実APIでの接続確認（staging）は未実施。Claudeはローカルまで、実環境の検証・配備はCodexへ引き継ぐ
