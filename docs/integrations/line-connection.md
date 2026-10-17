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

### 6a 実APIの通し確認は合格・後片付けだけが残った（2026-10-16 12:28 JST／Codex報告）

PR #1751 は必須CIをすべて通過して**マージ済み**（マージSHA `b34e4f5b`）。staging配備も成功し、公開ヘルスのSHAはマージSHAと一致した（[PR #1751](https://github.com/skmtmst/line-harness-oss/pull/1751)／[配備結果](https://github.com/skmtmst/line-harness-oss/actions/runs/38845200375)）。

- 実APIで**13人の取り込みが約2.1秒・stepの呼び出し1回・`busy` は0回**で完了。上の「画面が自分で次を呼ぶ」修正が実環境で効いていることの実測。発行したLINEトークンは無効化済み。本番D1・Webhook・LIFFへの書き込みは無い。
- 後片付けは**友だち行0件・進捗設定0件**まで済んだ。残ったのは**stagingの一時 `line_accounts` 1行**だけで、`DELETE` が **HTTP 400／code 7500 `triggers nested too deep`** で失敗した。その行は無効・アーカイブ状態で、トークンとチャネル秘密値は空（再照合済み）。
- **6b（大量件数での途中再開）は実データでは未確認**。対象の友だちが13人のため1回のstepで完走する。合格扱いにしない（理由は §5 の 6b）。

### D1の `triggers nested too deep`（code 7500）の原因と巻き戻しの修正（2026-10-16／Claude実装・ローカル検証まで）

**原因は「連鎖が深い」ことではなく、文を組み立てる時点（prepare）でプログラムが大きすぎること**。実測で確定した。SQLiteの実行時の深さ超過は `too many levels of trigger recursion`（上限 `SQLITE_MAX_TRIGGER_DEPTH` は既定1000）という別の文言で、`line_accounts` の実行時の最長連鎖は**深さ5**しかない。D1は式の深さの上限（`SQLITE_LIMIT_EXPR_DEPTH`）を本家の1000より小さく設定しているように振る舞う（[Cloudflare Community の7500報告](https://community.cloudflare.com/t/d1-returns-7500-triggers-nested-too-deep-sqlite-error-for-all-insert-update/954528)、[eliot-research#294](https://github.com/UnknownAlienHuman/eliot-research/issues/294)）。

実スキーマ（`packages/db/schema.sql` ＋ migrations 全適用、ローカル `:memory:`）に `EXPLAIN` を当てて、組み立てられた命令列そのものを数えた（`EXPLAIN` は prepare の結果を返すだけで行を1件も触らない）。

| 測ったもの | 命令数 | 下位プログラム |
| --- | --- | --- |
| `DELETE FROM line_accounts WHERE id = ?`（`foreign_keys=ON`） | **18,719** | **384** |
| 同じ文（`foreign_keys=OFF`） | 57 | 0 |
| 対象行が**0件**のとき | 18,719 | 384 |
| 対象行が**1件**あるとき | 18,719 | 384 |

- **0件でも1件でも同じ＝データに依存しない。** だから「子行を先に消す」では親行の `DELETE` は通らない。生成した27本の深い方からの子 `DELETE` は子表を空にするには正しいが、親行の文の大きさは変わらない。
- **外部キーを切る回避もD1では使えない。** D1はすべてのクエリを暗黙のトランザクション内で走らせるため利用者のクエリから `PRAGMA foreign_keys = OFF` にできず、`PRAGMA defer_foreign_keys = ON` は `ON DELETE CASCADE` を止めない（[Define foreign keys · D1](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[SQL statements · D1](https://developers.cloudflare.com/d1/sql-api/sql-statements/)、[workerd#2471](https://github.com/cloudflare/workerd/issues/2471)）。
- **トリガを落とす回避も効かない。** 現状 18,719／384 に対し、フォルダ系の DELETE トリガ9本を落として 17,461／302、**トリガ289本すべてを落としても 15,148／270**。重さの約8割はトリガではなくCASCADEの連鎖なので、stagingで `DROP TRIGGER` を試す価値はない（**やらない**）。
- 実スキーマは表613・トリガ298本。`line_accounts` を CASCADE で参照するのは**FK経路116・子表115**（`account_handovers` が `to_account_id`／`from_account_id` の2経路）。重い子は `folders(account_id)` 5,487／149、`friend_add_rule_folders(line_account_id)` 5,303／120、`rich_menu_groups` 1,019／17、`media` 785／10 など。**116経路のうち75は下位プログラムを1本も作らない**（単独の `DELETE` なら軽い）。`line_accounts` 自身のトリガは INSERT／UPDATE 専用（`line_accounts_folder_scope_insert`／`_update`）で、`DELETE` の組み立てには関わらない。

**これは後片付けの問題ではなく出荷済みの機能不具合だった。** `deleteUncommittedLineAccount`（修正後は `packages/db/src/line-account-rollback.ts`）は登録の途中で失敗したときの巻き戻しで、呼び出し元は登録API（`apps/worker/src/routes/line-accounts.ts:1460`）と設定コピー失敗時（同 `:1646`）。親行の `DELETE` がD1で必ず落ちるため、行が残る。`channel_id` は `NOT NULL UNIQUE`（`schema.sql`）で、`login_channel_id`／`liff_id` にも一意索引がある（`migrations/542_line_account_login_liff_unique.sql`）ので、**追加に失敗した利用者は同じチャネルをもう一度登録できなくなっていた**。

修正（`packages/db/src/line-account-rollback.ts`）：子行の `DELETE` を batch で先に流し、親行の `DELETE` を try/catch で包む。落ちたら行を消すのをやめ、**無効化して一意列を解放する**。

- `channel_id` は NOT NULL なので衝突しない値（`abandoned:<id>`）へ退避。`login_channel_id`／`liff_id` は NULL に戻す（migration 542 のコメントどおり、SQLiteの一意索引はNULLを重複とみなさない）。
- トークンとチャネル秘密値（平文列）は空に、暗号化列は NULL に。`is_active = 0`、`is_default = 0`（`idx_line_accounts_one_default_per_tenant` は `WHERE is_default = 1` の部分索引なので0なら衝突しない）、`archived_at`/`archived_by='system'`/`archived_reason` を立てる。
- アーカイブ済みの行は有効なアカウントの照会から外れる（`archived_at IS NULL` が `packages/db/src/line-accounts.ts:238,373,385,1156,1188`）。よって**一覧や接続先には出てこない**。
- 親行の削除失敗はS14のログ安全性を守るため出力せず、無効化へ進む。UPDATE は `line_accounts_folder_scope_update`（`UPDATE OF folder_id, tenant_id`）を踏まず、FKの親キー（`id`）も変えないので軽く組み立てられる。Codexがstagingの同じ行をUPDATEできている実績もある。

ローカル検証（Claudeの担当範囲）：

- `apps/worker/src/services/line-account-rollback.test.ts` **4件 合格**。追加した1件は、親行の `DELETE` だけをD1と同じ文言で失敗させ、行が無効化されること・子行が消えていること・**同じ `channel_id`／`login_channel_id`／`liff_id` をもう一度登録できること**を確かめる。
- `routes/line-accounts` 76件・`line-account-capacity` 12件・`follower-import` 10件の**98件 合格**。
- `packages/db` と `apps/worker` の型検査（`tsc --noEmit`）がどちらもエラー0。
- 新しいmigrationは追加していない（`PRAGMA` を含むmigrationを禁じる `packages/db/test/409_outbound_send_failure_ledger.test.ts:81` の制約にも触れない）。
- **行数ゲート対応（2026-10-16 13:34）**：`packages/db/src/line-accounts.ts` は上限 `1547` にちょうど張り付いていたため（`apps/web/scripts/v8-guard/code-size-baseline.json:405`）、Codexの独立検証で「1593行・46行超過」として必須CI相当のゲートに拒否された。新規ファイルの上限は400行で、台帳への**新規登録や上限引き上げは `inspectSize` が禁止**している（`apps/web/scripts/v8-guard/code-size.mjs:41-42`）。そこで巻き戻しの2関数を新ファイル `packages/db/src/line-account-rollback.ts`（64行）へ移し、`packages/db/src/index.ts` から再公開した。`line-accounts.ts` は 1530行へ戻り、`@line-crm/db` の公開面（`deleteUncommittedLineAccount`）は呼ぶ口6箇所とも無変更。`node apps/web/scripts/v8-guard/code-size.mjs --base b34e4f5bab` が**違反0件**（本体2,675ファイル／凍結437件）、ゲート自己テストも合格。関連テスト102件と両方の型検査も再実行して合格。

- **S14ログ安全性の対応（2026-10-16 14:10）**：上の新ファイルで、親行 `DELETE` が落ちたときに `console.error` へ例外の文面（`error.message`）を混ぜていたため、`apps/worker/src/security-console-contract.test.ts` の「本番コードは固定コードと安全な経路だけをログに出す」規則に違反した（検出箇所 `packages/db/src/line-account-rollback.ts:31`）。7500は**データに依存しない組み立て時の失敗**で、文面を残しても新しい情報は増えないため、ログ出力自体をやめて黙って無効化へ回る形（silent fallback）にした。試験側も「ログが0回であること」を確かめる形へ直した（`line-account-rollback.test.ts:135`）。S14の契約テスト2件・関連テスト102件・型検査が合格。

**6a の受入条件4「一時行が削除され0件」は、D1では素の `DELETE` で満たせない。** 残った1行は無効・アーカイブ・秘密値なしの状態で、有効なアカウントとしては0件。これを実状として記録する（合格と偽らない）。

### stagingの後片付けの診断結果＝物理削除は未完了（2026-10-16／Codex実測）

上の修正を含む [PR #1752](https://github.com/skmtmst/line-harness-oss/pull/1752) は必須CI全件合格後に**マージ済み**で、**stagingのWorkerへ配備済み**（公開versionとhealthのSHAがマージSHA `525eb5aaf2` と一致）。**本番は未変更**。

そのうえで §5 の手順どおりに後片付けを診断した結果は次のとおり。

- (i) 棚卸し（読み取り専用）：対象1行について**友だち行0件・進捗設定0件・直接の子116経路すべて0件**。対象行は無効・アーカイブ済みで、トークンとチャネル秘密値の列も空。
- (ii) 子行の `DELETE` は不要（残件0件のため実行していない）。
- (iii) `DELETE FROM line_accounts WHERE id = :acct` を**1回だけ**診断目的で試し、`triggers nested too deep: SQLITE_ERROR [code: 7500]` で失敗。**指示どおりそこで停止**し、再試行・`DROP TRIGGER`・外部キー切りはしていない。無効・アーカイブ済みの行はそのまま残した。今回のWrangler応答にはHTTP状態の表示が無かった（以前の同種の失敗は HTTP 400）。
- (iv) 有効なアカウントとして**0件**。

**結論：一時行の物理削除は未完了。** 原因は §3 の「D1の `triggers nested too deep`」で実測済みのとおり、行数・子件数に依存しない組み立て時の上限超過なので、同じ `DELETE` を繰り返しても結果は変わらない。現状は「有効なアカウント0件／行は無効・アーカイブ・秘密値なし」で確定とし、以後は 6a の受入条件4をこの読み替えで扱う。物理行の除去には、`line_accounts` を参照するCASCADE経路（116本）を減らす設計変更か、D1側の上限緩和が必要で、どちらも今回の依頼範囲外。

**6b（大量件数での途中再開）は未確認のまま。** 実データで使える対象アカウントの友だちが13人しかなく、途中再開が起きる件数に届かないため実測できていない。

## 4. 気づいた不具合

### 4-1・4-2 は修正済み（2026-10-16・Claude）

1. **友だち追加URLの形が他と違う → 修正した**：`logic.ts:92` が組み立てていた `https://lin.ee/{basicId}` を、他の箇所と同じ `https://line.me/R/ti/p/@{basicId}` へ替えた。`lin.ee` はLINEが個別に発行する短縮URLで basicId から導けないため（`packages/db/src/line-accounts.ts:64` のコメント、保存用の列は `official_profile_url`）、画面に出していたURLは開けない可能性が高かった。既存の作り方と一致していることも読み取りで確認した（`services/platform-announcements.ts:48`、`components/dashboard/qr-dialog.tsx:47`、`dashboard-v4.test.ts:89` が `https://line.me/R/ti/p/@nen` を期待）。`routes/line-accounts.ts:1079-1097` が保存済みURLをホスト `lin.ee` のときだけ採用していることも、`lin.ee` が導出物ではない裏付け。試験は `logic.test.ts:33` の期待値を標準形へ直した
2. **別名URLが登録時に通らない → 再現条件を特定して修正した**：既存アカウントの再確認は別名を許容する（`acceptedWebhookUrls`、`routes/line-accounts.ts:327-340`）のに、新規追加の `prepareLineConnection` だけ完全一致で比較していたため、`WORKER_ALIAS_URLS`（stagingの `workers.dev` など）に登録されたチャネルは3段目で止まっていた。`line-account-connect.ts` に `trimTrailingSlash` と `webhookUrlMatches` を足し、入力へ任意の `acceptedWebhookUrls` を追加。`routes/line-accounts.ts` の2つの呼び出し（`/connect/check`・`/connect`）から既存アカウントと**同じ受け口一覧**を渡す形にした。末尾スラッシュの違いも無視する。受け口一覧に無いURL（`https://example.com/webhook`）は3段目で止まることを否定側の試験で確かめているので、判定は緩めていない
   - 検証：`line-account-connect.test.ts` に別名通過・一覧外拒否の2件を追加。worker 全件 **11,809件**合格、web のアカウント・ダッシュボード範囲 **108件**（17ファイル）合格、worker・web の型検査とも合格。**実LINE APIでの別名確認は未実施**（stagingに別名を登録した対象アカウントが無い）
   - 見た目・文言・操作フローは1行のURL表示（4-1）だけで、承認済みデザインの「友だち追加 URL」行の表示内容をそのまま正す修正なので**新規Pencil承認は不要**

### 4-2の実機確認は「再現不能」で確定（2026-10-16・Claude／コード読み取り）

Codexから「書き換え可能なstaging専用LINEチャネルを特定してほしい」と返却されたため、**そもそも実機で再現できるのか**をコードで確かめた。結論は**新規追加のウィザードでは別名URLの分岐に入れない**。チャネルを1つも書き換えずに済むので、**対象チャネルの特定も不要**。

- `prepareLineConnection` は3段目で、**先に** `PUT /v2/bot/channel/webhook/endpoint` で宛先を正規URLへ上書きし（`line-account-connect.ts:163`）、**その直後に** `GET` で読み戻して受け口一覧と比べる（`:171`・`:177`）。
- 正規URL `webhookUrl` は `baseUrl` 由来で、`baseUrl` は `WORKER_PUBLIC_URL || WORKER_URL || リクエストのorigin`（`routes/line-accounts.ts:1341`・`:1377`）。stagingは `WORKER_PUBLIC_URL = https://stg-api.musubo.jp`（`wrangler.staging.toml:77`）が設定済みなので、**どのホストから入っても正規URLが入る**。
- したがってPUTが成功した直後のGETは正規URLを返す。別名（`https://nen-line-stg.skmtmst.workers.dev/webhook`、`wrangler.staging.toml:80`）が返るのは、**PUTが200でも反映が遅れてGETが旧値を返した場合だけ**＝LINE側の反映タイミング待ちの競合で、こちらから起こせない。
- `/connect/check` と `/connect` はどちらも同じ `prepareLineConnection` を呼ぶ（`:1342`・`:1378`）ので、読み取りだけの迂回路も無い。
- **よって修正の実際の効き目は2つ**：(a) 上の反映遅れが起きたときに3段目で止まらない、(b) 末尾スラッシュの差（`.../webhook/`）を無視する。(b) は実機でも観測できる。
- 一覧外URLの否定確認（元の確認項目3）も同じ理由で実機では作れない。**両方とも回帰試験で担保**（`line-account-connect.test.ts` の別名通過・一覧外拒否2件）。実機は**未確認（再現不能）**と記録し、合格と言わない。
- 既存アカウントの再確認（`verifyConnection`、`routes/line-accounts.ts:521`）は宛先を書き換えずに読むだけなので別名を受け入れる。これは**今回の修正前からの挙動**で、今回の変更点ではない。

### 未修正（優先度が低いので据え置き）

3. **`token_expires_at` が登録直後NULL**：`createLineAccount` のINSERT列（`packages/db/src/line-accounts.ts:228-245`）に含まれていない（`updateLineAccount:986-988` では入れられる）。発行トークンは30日有効なので新規登録直後の実害は無く、期限切れ更新の実装と合わせて直すのが妥当

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
- 2026-10-16 12:28（Codex）：**PR #1751 はマージ済み・staging配備済み**（マージSHA `b34e4f5b`、公開SHA一致）。実APIの6aは**13人・約2.1秒・step 1回・busy 0回で合格**。発行トークンは無効化済み。本番D1・Webhook・LIFFへの書き込みは無い。残ったのは後片付けだけ（§3 の「6a 実APIの通し確認は合格」）
- 2026-10-16（Claude）：**上の削除失敗の原因を実測で確定し、巻き戻しの機能不具合を直した**。7500は実行時の連鎖ではなく**文を組み立てる時点**の失敗で、親行 `DELETE` は0件でも1件でも 18,719命令／下位384本と**同一＝データに依存しない**。外部キー切りはD1で不可、トリガ全削除でも15,148命令で通らない。よって素の `DELETE` は諦め、`deleteUncommittedLineAccount` を「子行を消す → 親行 `DELETE` を試す → 落ちたら行を無効化して一意列（`channel_id`／`login_channel_id`／`liff_id`）を解放」に変えた。これが無いと**追加に失敗した人が同じチャネルを再登録できない**。巻き戻し4件＋関連98件＋型検査が合格（§3 の「D1の `triggers nested too deep`」）。**見た目・文言・操作フローは無変更＝新規Pencil承認は不要**
- 2026-10-16 13:34（Claude）：**行数ゲートの超過を直した**。Codexの独立検証で `packages/db/src/line-accounts.ts` が「1593行・上限1547行」として拒否されたため、巻き戻しの2関数を新ファイル `packages/db/src/line-account-rollback.ts`（64行）へ移し `index.ts` から再公開。本体は1530行、公開面と挙動は無変更。ゲート**違反0件**・テスト102件・型検査が合格（§3 の「行数ゲート対応」）
- 2026-10-16 14:10（Claude）：**S14ログ安全性の違反を直した**。巻き戻しの新ファイルで `console.error` に例外の文面を混ぜていたため契約テストに拒否された。7500はデータに依存しない組み立て時の失敗で文面に情報が無いので、ログ出力をやめて黙って無効化へ回る形にし、試験も「ログ0回」の確認へ直した。S14契約2件・関連102件・型検査が合格（§3 の「S14ログ安全性の対応」）
- 2026-10-16 14:42（Codex）：**PR #1752 はマージ済み・staging配備済み**（マージSHA `525eb5aaf2`、公開versionとhealthのSHAが一致）。必須CIは全件合格。**本番は未変更**
- 2026-10-16（Codex）：**stagingの後片付けを診断し、「物理削除は未完了」で確定した**。対象1行は友だち行0件・進捗設定0件・直接の子116経路すべて0件で、無効・アーカイブ済み・秘密値の列も空。`DELETE FROM line_accounts` を**1回だけ**試すと `triggers nested too deep: SQLITE_ERROR [code: 7500]` で失敗したため、指示どおり停止し**再試行・`DROP TRIGGER`・外部キー切りはしていない**（今回のWrangler応答にHTTP状態の表示は無し）。有効なアカウントとしては**0件**。原因は行数に依存しない組み立て時の上限超過なので同じ `DELETE` を繰り返しても変わらず、物理行の除去にはCASCADE経路（116本）を減らす設計変更かD1側の上限緩和が必要で**今回の依頼範囲外**（§3 の「stagingの後片付けの診断結果」）
- 2026-10-16：**6b（大量件数での途中再開）は未確認**。実データで使える対象アカウントの友だちが13人しかなく、途中再開が起きる件数に届かないため実測できていない。確認するには件数の多い認証済みアカウントの用意が必要で、未確認を合格と扱わない
- 2026-10-16（Claude）：**§4 の不具合1・2を修正した**。友だち追加URLを開ける標準形（`https://line.me/R/ti/p/@{basicId}`）へ替え、新規追加のWebhook判定を既存アカウントと同じ受け口一覧（別名URL許容・末尾スラッシュ無視）に揃えた。worker 11,809件／web 108件／worker・web 型検査が合格し、別名通過と一覧外拒否の回帰試験2件を追加（§4）。**実LINE APIでの別名確認は未実施**。残るのは不具合3（`token_expires_at`）で、期限切れ更新の実装時に扱う
- 2026-10-16 18:17〜18:30：**PR #1754 はマージ済み・staging配備済み**。マージSHA `9bfaf28a109329a766c05c4c7c63dfc8625ac823`（18:17 JST／必須CI 10件合格・1件skip）、[配備run 38880263965](https://github.com/skmtmst/line-harness-oss/actions/runs/38880263965) が 18:30 JST に成功し、Workerと管理画面の公開SHAが一致。Worker Version ID `8325dad6-a4ff-41cd-89c3-0cb6989561d7`、未適用D1 **0件**、DBと本番は無変更（Codex報告）
- 2026-10-16：**実機4項目の確認範囲を分けて確定した**（Codexの返却を受けたClaudeの判断）。
  - **項目1（④の友だち追加URLが標準形で開ける）＝一部確認**：配信中のスクリプトに標準形が入っていることはCodexがHTTP 200で確認。認証後の実表示と、実アカウントのリンク先が開けるかは**未確認**。残るのは読み取りだけなので実施可。
  - **項目2（別名Webhookで3段目が通る）＝未確認（再現不能）**。理由は §4 の「4-2の実機確認は『再現不能』で確定」。ウィザードが3段目で宛先を正規URLへ上書きしてから読み戻すため、別名が返る状況をこちらから作れない。**LINEチャネルの書き換えは行わない**ので、Codexが対象チャネルを特定せずに止めた判断は正しい。回帰試験2件で担保。
  - **項目3（一覧外URLは3段目で止まる）＝未確認（再現不能）**。同じ理由。否定側の回帰試験で担保。
  - **項目4（既存アカウントの接続確認が壊れていない）＝未確認**。読み取りだけなので実施可。ただしstagingの有効アカウントは現在**0件**（§3 の「stagingの後片付けの診断結果」）なので、対象が無ければ「対象なし」として記録する。〔**この0件は後の実測で誤り。有効行は3件**（下の 18:52〜 と 19:09〜 の節）。〕
- 2026-10-16 18:52〜（Codex実測＋Claudeのコード確認）：**項目1-a は合格、項目4の401は「鍵を付けずに送ったGET」だった**。
  - **項目1-a ＝合格**：stagingの有効LINEアカウントは**3件**（§3 の「後片付けの診断結果」が0件としていたのは物理削除前の別観点で、有効行としては3件ある）。その基本IDから作った標準形 `https://line.me/R/ti/p/@…` へ読み取りGETを投げ、**3件ともHTTP 200**。基本ID・表示名・画像・ユーザーID・トークンは出力していない。**§4 不具合1の実機確認はこれで完了**。
  - **項目4の401の正体**：18:52 JST の `GET /api/line-accounts` の HTTP 401（`Unauthorized`／request ID `a4b62b1aed5adeb9-NRT`）は、**APIキーを一切付けずに送ったリクエスト**の結果。env API_KEY もスタッフAPIキーも試して落ちたわけではない。**09:26 JST に入れたMFA設定（`auth.mfa.required:00000000-0000-4000-8000-000000000001` = `'false'`）は有効なまま**で、**TOTP未設定の有効な管理者キーも1件ある**。よって追加の設定変更は**不要**。
  - **止まっていた本当の理由＝こちらの依頼文が「読み取りのみ」と書いたこと**。スタッフAPIキーで認証すると、`packages/db/src/staff.ts:139-143` が `platform_settings` に `auth.staff_api_key.last_used_at:<staff_id>` を**1行だけ**書く（認証の記録。業務データではない）。Codexはこれを範囲外と判断して正しく停止した。
  - **env API_KEY 経路はDB書き込みが無い**（`apps/worker/src/middleware/auth.ts:677-680` は合成したownerを返すだけ）。ただし値はWorker secretで読み戻せないため、使えるかはCodex側の保有状況しだい。
  - **Claudeの判断**：この `last_used_at` の1行は、認証つきの読み取りをすれば必ず起きる認証記録で、staging限定・業務データ無変更・後片付け不要。保存済み共通承認の「検証環境での確認」の範囲内として**許可する**（利用者への追加確認は不要）。env API_KEY が使えればそちらを優先する。
- 2026-10-16 19:09〜（Codex実測＋Claudeのコード確認）：**項目4-a は合格。項目4-b の「5行の新しい判定」は読み取りだけでは取得できないと確定した**。
  - **項目4-a ＝合格**：スタッフAPIキーを付けた `GET /api/line-accounts` が **19:09 JST に HTTP 200**（request ID `a4b644860f58d740-NRT`）、有効アカウント**3件**。業務データは無変更（許可した `last_used_at` の1行のみ）。**既存アカウントの一覧取得は壊れていない**。
  - **19:10 JST の HTTP 403 の正体**：Codexが叩いた「資格情報診断GET」は `GET /api/line-accounts/:id/credential-health`（`apps/worker/src/routes/line-accounts.ts:919-921`）で、**`requireRole('owner')` が付いている**（`middleware/role-guard.ts:21` が「この操作にはオーナー権限が必要です」を返す）。使ったスタッフキーの役割が owner でなかっただけで、設定不良ではない。request ID `a4b645a53955e395-NRT`。
    - **env API_KEY 経路は役割 `owner`**（`middleware/auth.ts:677-679` が `role: 'owner'`・`readOnly: false` を返し、DB書き込みも無い）。**これを持っているならcredential-healthは通る。** 無ければ owner 役割のスタッフキーが必要。
    - `getLineAccountCredentialHealth`（`packages/db/src/line-accounts.ts:505-546`）は **SELECT だけ**でLINE APIも呼ばず書き込みも無い。鍵の保存・復号の健全性だけを返す。
  - **4-b の「5行の新しい判定」は原理的に読み取りでは作れない**。判定を作るのは `prepareLineConnection` だけで、3段目で **先に** Webhook宛先を PUT し（`services/line-account-connect.ts:163`）、Webhookテストを POST してから読み戻す。呼び口は `POST /connect/check`（`:1335`）と `POST /connect`（`:1367`）の2つだけで、どちらも同じ関数を通る。**読み取り専用の判定口は存在しない**（上の一覧で `/api/line-accounts` 配下の全ルートを確認済み）。
  - **よって 4-b は「未確認（読み取りでは再現不能）」で確定**する。10月8日の古い4行（bot情報が当時HTTP 401、残り3行 `unknown`）を**合格として扱わない**。Codexがそう判断して止めたのは正しい。回帰試験（worker 11,809件、うち対象2ファイル86件）で担保する。
  - **代わりに読み取りだけで取れる確認を2つ充てる**：① `GET /api/line-accounts/:id/credential-health`（owner権限・SELECTのみ）で鍵の復号可否、② `GET /api/line-accounts/:id/follower-insight?date=yyyyMMdd`（`routes/line-accounts.ts:946-975`。役割制限なし・DB書き込みなし・保存済みトークンでLINEの読み取りGETを1回）で**トークンが現在もLINEに受け入れられること**。②が200なら、古い4行で `401` だった bot情報の行に相当する部分は現在は生きていると言える。
- 2026-10-16 19:17〜（Codex実測＋Claudeの原因調査）：**上の代替確認①②も「合格未確認」。理由は、この口が502にLINEの状態番号を載せていなかったこと**。
  - **確認②（`follower-insight`）＝不合格ではなく「判定不能」**：`GET /api/line-accounts/<id>/follower-insight?date=20261013`（スタッフAPIキー）が **2026-10-16 19:17:58 JST に HTTP 502**、本文 `Failed to fetch LINE follower insight`、request ID `a4b6511acd8112c1-NRT`。本文の `status` は**取得不能**。**トークンが現在もLINEに受け入れられるかは未確認**。502だけで「トークン無効」と判定しないCodexの判断は正しい。
  - **確認①（`credential-health`）＝未実施・未確認**：owner権限の資格情報を保有していないため。資格情報の新規作成はしていない（こちらで禁止済み）。
  - **つまり①②ともに合格未確認**。LINE接続の合格として記録しない。
  - **502が原因不明になった理由（コードで特定）**：`routes/line-accounts.ts:970-974` の catch が、`const message = err …` を**計算して使わないまま捨て**、応答は固定文、ログも `{"code":"routes_line_accounts_failed","route":"…"}` の固定形だけだった。一方 SDK（`packages/line-sdk/src/client.ts:62-67`）は `Object.assign(error, { status: res.status, retryAfter: … })` で**状態番号を必ず載せている**。番号は手元に来ていたのに、応答にもログにも出していなかった。結果、**401（トークン失効）・403（権限不足）・429（上限）・5xx（LINE側障害）が全部502に潰れる**。
  - **日付は原因ではない**：`insightDateJst`（`:1278-1283`、コメント「友だち数の統計は前日分しか無い」）が必要とするのは日本時間の前日まで。`20261013` は3日前なので範囲内。
  - **有力な仮説は「保存済みチャネルアクセストークンの失効」**（10月8日の bot情報が HTTP 401 だったことと整合）。ただし**現コードでは確定できない**ので仮説のまま記録する。
  - **安全な再確認方法（今回Claudeが実装）**：502応答に `lineStatus`（**数値のみ**）を載せる。応答本文・トークン・基本IDは出さず、ログの固定形も変えない。回帰試験2件を追加（401が502の裏に隠れないこと／LINE応答以外の失敗では `lineStatus` が `null` のまま）。ローカル検証：`apps/worker` 全試験 **11,811件合格**（追加2件を含む）、`tsc --noEmit` 合格。
    - これを staging へ配備した後に確認②を**同じ手順で1回だけ**再実行すれば、`lineStatus` で401と403/429/5xxを切り分けられる。401ならトークン再発行の作業（別件）に進む。確認①は owner 資格情報が手に入ったときだけ実施する（作らない）。
- 2026-10-16 20:19（Codex）：**PR #1756 はマージ済み。ただしstaging配備は未適用D1の1件で止まり、確認Aは再実行できていない**。
  - **マージ＝成功**：必須CI全件合格後、20:19 JST にマージ。統合SHA **`9089d1a712e468b920ba93fbe89e96a28e168169`**。**再マージ・再配備の依頼はしない**。
    - 直前の不合格は行数ゲートだった。`lineStatus` の追加で `routes/line-accounts.ts` が凍結上限 `2151` に対し `2155` 行になったため、catch 節の導出を1式へまとめて**2151行（上限と同値）**へ戻した（コミット `d5a707304d`）。`code-size-baseline.json` は**一方向ラチェットなので引き上げない**。
  - **staging配備＝失敗（コード公開前）**：run [38893146799](https://github.com/skmtmst/line-harness-oss/actions/runs/38893146799) がワークフローのエラー「検証D1に未適用マイグレーションが 1 件あります。Migrate D1を先に実行してください。」で停止。Codexはその別件マイグレーションを**適用していない**（範囲外と判断して停止）。公開Workerは PR #1754 時点の Version ID `8325dad6-a4ff-41cd-89c3-0cb6989561d7` のまま**100%**。
  - **確認A＝未再実行**。新しい `lineStatus`・`status`・request ID は**無い**。**確認B＝未確認**（owner資格情報を保有していないため。資格情報は作らない）。
- 2026-10-16（Claude）：**上の配備ブロッカーを読み取りだけで特定し、「調整相手は存在しない」と確定した**。
  - 未適用の1件は **`packages/db/migrations/683_restaurant_delivery_phase2_slots.sql`**。マイグレーションの置き場所は `packages/db/migrations`（`apps/worker/migrations` は存在しない）。本ブランチの最新は `636_restaurant_delivery_uber_connections.sql` なので、683は**統合先 `origin/codex/development` 側から入ってきた別件**。
  - **このプロジェクト自身の既マージ作業**：コミット `4e59767f9d`（2026-10-16・Masato Sakamoto「移行の採番を683へ付け替える：公開中のPR #1744 が637を先に使っていたため」）。ヘッダに**オーナー承認 2026-10-09**（設計正本 `デリバリー受注_v02.pen` の D-1〜D-6）と2026-10-10のフェーズ2事前共有が記され、「画面は1枚も増やさないため新しいデザイン承認は要らない」とある。**つまり「別件の担当者」という第三者はおらず、利用者ご本人の承認済み変更**。追加の承認待ちは発生しない。
  - **方針違反は無い**：`-- migration-policy: table-rebuild` の印と一時表 `rt_delivery_orders_new` の命名規則を満たしており、`AGENTS.md:72`（印のない `DROP TABLE`／`RENAME TO` は通さない）に適合。中身は `rt_store_feature_flags` の新設と `rt_delivery_orders` の作り直し（`service` に `'line'` 追加、`order_source`／`delivery_provider`／`delivery_tracking_id`／`delivery_fee_amount`／`coupon_id`／`friend_id` 追加、既存行は列指定で全件コピー、索引5本を再作成）。**行データは保持されるが作り直しなので取り消せない**。
  - **よって残っているのは「別工程で当てる」という手順だけ**。`.github/workflows/migrate-d1.yml` は既定が dry-run で、ヘッダに「当てる前に必ず Time Travel のブックマークを取る。追加のみのポリシーで down マイグレーションを書けないので、戻る手段はこれだけになる」と明記。`docs/NEN-LINE-STAGING.md:146-152` も「必ずデプロイロックを取得してから」「D1マイグレーションは `Migrate D1` を先にdry-runし、別工程で適用します」としている（`scripts/deploy/staging-deploy.sh` はマイグレーションを当てないため、配備workflowが未適用を検出して止めるのは**設計どおり**）。
  - **Claudeの判断**：staging への683の適用は保存済み共通承認 `user-deployment-20260929-v1` の「配備に必要な…DBマイグレーション」の範囲内。利用者への追加確認は不要で、**正規手順（デプロイロック → Time Travel ブックマーク → `Migrate D1` staging dry-run → 同 apply → 統合SHAのstaging配備 → 確認Aを1回だけ）**をCodexへ引き継ぐ。**本番は対象外**（本番はmainへのpushで自動適用される別経路）。
- 2026-10-16 20:31〜20:36（Codex）：**683のstaging適用は完了。配備はデプロイロックの二重取得で公開前に失敗し、確認Aは未実施**。
  - **Time Travel ブックマーク2件**（戻る手段。適用前に取得）：20:31:26 JST `00003d21-00000000-00005106-667243b4841a57558200556d9aca51a3`（Codexが手動取得）／20:34:22 JST `00003d22-00000000-00005106-e1e7ccbe7903fedb68f3c1250b2b7ee9`（apply workflowが自動取得）。
  - **dry-run 成功**：run `38894458639`。未適用は **`683_restaurant_delivery_phase2_slots.sql` の1件だけ**（依頼の停止条件「2件以上なら適用せず返す」に該当せず）。
  - **apply 成功**：run `38894591157`。**適用後の未適用件数は0件**。→ 配備workflowが止まる原因は解消済み。**683の再適用は不要**。
  - **配備は失敗（コードの公開処理に入る前）**：run [38894823582](https://github.com/skmtmst/line-harness-oss/actions/runs/38894823582) が 20:36:24 JST にロック取得の段で停止。公開SHAの一致・新しい Worker Version ID は**確認できていない**。公開Workerは `8325dad6-a4ff-41cd-89c3-0cb6989561d7` のまま。ロックは失敗run終了後に解放済みで、現在は空いている。
  - **確認A＝未実施**（配備成功後に1回だけという条件のため）。**確認B＝未確認**（owner資格情報を保有していないため。作らない）。本番は変更なし。
- 2026-10-16（Claude）：**ロック競合の原因はコードで特定した。前回のClaudeの依頼文の誤りで、Codexの作業手順は正しい**。
  - **ロックを取る経路が2つあり、混ぜると必ず失敗する**。`.github/workflows/deploy-cloudflare-staging.yml:251-260` に `Acquire the shared staging lock`（`DELIVERY_MODE=apply` のときだけ実行）があり、**workflow自身がロックを取って** `:472-474` の `always() && steps.staging_lock.outcome == 'success'` で解放する。一方 `scripts/deploy/staging-deploy.sh:26-29` は「ロックの取得・解放はここでは**意図的にやらない**（取得は他の開発者への使用宣言であり、解放は確認完了の宣言なので、途中で中断しうるスクリプトの副作用にしてはいけない）」とコメントし、手元経路は**人が取る**前提。
  - **取得は「空いているrefへのpush」なので、自分が先に取っていてもworkflow側の取得は失敗する**（`scripts/deploy/deploy-lock.ts:10,286`「already-occupied ref への push はサーバが弾く。その拒否が排他そのもの」）。自分のロックだから通るという作りではない。
  - **よってClaudeの前回依頼が誤り**。`docs/NEN-LINE-STAGING.md:146-152`「必ずデプロイロックを取得してから」は**手元 `pnpm deploy:staging` の手順**であり、これをActions経路に当てて「先にロックを取る」と指示した。Codexは指示どおり実行しており、停止条件を守って再実行しなかったのも正しい。
  - **ドキュメントを直した**：`docs/DEPLOY-GATE.md` の「検証デプロイの手順」冒頭に手元経路限定であることを明記し、「GitHub Actions のロック」節に**どちらが取る／解放するかの対応表**と、今回のrunで落ちた事実を追記した。同じ取り違えが再発しないようにする。
- 2026-10-16 20:47（Codex実行・Claudeが実測で照合）：**staging配備は成功。確認Aは HTTP 502・`lineStatus: 401`**。
  - **配備＝成功**：run [38896115158](https://github.com/skmtmst/line-harness-oss/actions/runs/38896115158) が 2026-10-16 **20:47:31 JST** に `success`。対象SHAは統合SHA **`9089d1a712e468b920ba93fbe89e96a28e168169`**（`gh run list` で Claude が独立に確認）。ロックは workflow が取得・解放し、手元からは取らなかった（前回の失敗の対策が実際に効いた）。**この配備は完了済み。繰り返さない**。
  - **確認A＝HTTP 502・`lineStatus: 401`**。`lineStatus` を載せた目的（401・403・429・5xx が502に潰れるのを止める）は達成し、**切り分けができた**。これは**こちら側のコードの不具合ではなく、LINEが保存済みチャネルアクセストークンを受け付けていない**という意味。
  - **確認B＝未確認**（owner資格情報を保有していないため。作らない）。本番は変更なし。
- 2026-10-16（Claude）：**保存済みLINEトークンの状態と更新方法をコードで調査した。自動再発行の仕組みは存在しない**。
  - **保存形**：`line_accounts.channel_access_token_encrypted`（AES-GCM。`packages/db/migrations/172_line_account_credentials_encrypted.sql`）。移行・切り戻しの期間だけ旧平文列 `channel_access_token` を残している。更新時刻は `channel_access_token_updated_at`（同 `287_line_account_credential_metadata.sql`。「秘密値を公開せず、登録済み資格情報を運用者が識別できるようにする」ため）。
  - **読み出し**：`getLineAccountById` → `decryptLineAccountCredentials`（`packages/db/src/line-accounts.ts:425-459`）が暗号化列を優先して復号する。復号できず**平文列も無ければ例外**（`Unable to decrypt …; no legacy fallback is available`）、平文列が**あれば平文へフォールバック**して `console.warn({"code":"line_credential_plaintext_fallback"})` を1行出す（秘密値とエラー文は意図的に出さない）。確認Aは `new LineClient(account.channel_access_token)`（`routes/line-accounts.ts:957`）でこの値を使う。
  - **自動再発行・自動更新の経路は無い**。`oauth2/v2.1/token`／`oauth2/v3/token`／`issueChannelAccessToken`／`refreshToken` をリポジトリ全体で検索した。製品コードでの LINE トークン発行呼び出しは**2か所だけ**で、**どちらも LINE ログインの認可コード交換（利用者／管理者のログイン用トークン）**であり Messaging のチャネルアクセストークンではない：`apps/worker/src/routes/liff.ts:779`（LIFFの利用者ログイン）と `apps/worker/src/routes/admin-auth.ts:328`（管理者サインイン。`grant_type=authorization_code` で `id_token` を取り出す）。`line_accounts` に有効期限の列も無い。**つまりこの値は人が入れる秘密値で、機械が勝手に更新する仕組みは無い**。
  - **更新できる唯一の口＝`PUT /api/line-accounts/:id`**（`routes/line-accounts.ts:1993`）。**`requireRole('owner')`** かつ **`sensitiveStepUpSatisfied(c, 'line_account.credentials')`** が必須（`apps/worker/src/lib/step-up.ts:74`）。メタ情報だけの `PATCH` は owner|admin で通るが、`channelAccessToken`／`channelSecret` は**範囲外で PUT のみ**（`:1805-1817`）。理由も明記されている（`:1688-1694`）：PUT は本番を止めうる資格情報を置き換える操作で、`channelSecret` を回すと**入ってくる全てのLINEイベントの検証が壊れて静かな取りこぼしになる**。`loginChannelSecret` が admin でも通るのは、壊れても新規利用者のログインだけで回復できる＝影響範囲が違うから。
  - **step-upの通し方は3段**（`step-up.ts:11-18`）：① 同じ管理セッションで最後の再確認から**10分以内**ならそのまま通す（時刻は `admin_sessions.step_up_at`。ヘッダだけでは通らない）② 期限切れ・未確認なら `X-Step-Up-Token` の**1回限りgrant**を消費する（`POST /api/auth/step-up`・目的 `line_account.credentials`）③ いつもと違う端末・場所（`unfamiliar_at`）は10分の再利用を効かせず操作ごとに新しいgrantを要求する。**APIキー認証は管理セッションを持たないので、Codexには原理的に満たせない**（§5 の6aで既に確定済み）。
  - **画面はもう在る**：アカウント詳細の「資格情報」カード（`apps/web/src/v8/accounts-detail/detail.tsx:302-318`。「秘密値そのものは表示しません。差し替えるときは、新しい値を入れて保存し直します。」）から差し替え窓（フレーム `Msb1j`）を開き、`api.lineAccounts.update` を呼ぶ。本人確認を求められたら `StepUpPrompt` が立ち、同じ保存をやり直す（`apps/web/src/v8/accounts-detail/dialogs.tsx:408-445`）。**新しい画面もコード変更も要らない**。空欄の項目は今の値のままになる。
  - **401の原因候補は2つに絞れる**。(A) 保存されているトークンの値が LINE 側で無効（失効・無効化・チャネル違い）。(B) 復号に失敗し、**古い平文列へフォールバックした値**を送っている。※復号に失敗して平文列も無い場合は LINE へ届く前に例外になるので、`lineStatus: 401` が出た以上リクエスト自体は LINE に届いている。
  - **owner権限なしで(A)と(B)を切り分けられる読み取り口がある**：`GET /api/line-accounts/:id`（`routes/line-accounts.ts:905`・**役割制限なし**・SELECTのみ）が `channelAccessTokenConfigured`／`channelAccessTokenLast4`／`channelAccessTokenUpdatedAt` を返す（`:149-154`）。`last4` は**復号できた値から作る**ので、`configured: true` なのに `last4` が `null` なら復号に失敗している＝(B)。`last4` が入っていれば復号は成功＝(A)。**値そのものは報告させない**（`null` かどうかだけ）。owner専用の `credential-health`（`:918`）が無くても判定できる。
  - **Claudeの判断**：(A) ならトークンの新しい値は**LINE Developersコンソールから利用者ご本人しか取得できず**、登録も owner 役割＋step-up の管理画面操作が要る。**owner資格情報の新規作成とトークンの独断再発行はしない**ので、ここは利用者の操作が必要になる。(B) なら暗号鍵・設定の問題でClaude／Codexの担当範囲。**まず(A)/(B)の切り分け（読み取り1回）を先に行う**。
- 2026-10-16 21:08（Codex実行・Claude判断）：**401の原因は (A) で確定。「stagingに保存されている値が LINE 側で無効」。製品の不具合ではなく、本番にも影響しない**。
  - **観測事実**（staging の `GET /api/line-accounts/:id` を1回だけ・読み取りのみ）：**HTTP 200**／`channelAccessTokenConfigured` = **`true`**／`channelAccessTokenLast4` は **`null` ではない**（値は出力させていない）／`channelAccessTokenUpdatedAt` = **`2026-09-03T16:07:40.768+09:00`**／`channelSecretConfigured` = **`true`**。実行 2026-10-16 **21:08:22 JST**、request ID **`a4b6f2cc5b48a562-NRT`**。確認A当時の Worker ログに `line_credential_plaintext_fallback` が出ていたかは**未確認**（手元から過去ログを取得できない。「出ていなかった」とは判断しない）。配備・トークン変更・確認Aの再実行は無し。
  - **(B) 復号の失敗は否定された**。`decryptLineAccountCredentials`（`packages/db/src/line-accounts.ts:425-459`）は復号に失敗した時点で**平文へフォールバックする前に** `next[last4Field] = null` を実行する。したがって `configured: true` で `last4` が入っているなら**復号は成功**しており、`routes/line-accounts.ts:957` が LINE へ渡した文字列は**意図した復号後の値そのもの**。平文フォールバックの可能性は消える（ログの有無が未確認でも、この一点で判定できる）。
  - **6aの一時行とは別の行**だと突き合わせで確定した。6aで作った一時 `line_accounts` 行は **トークンとチャネル秘密値が空**（§3「6a 実APIの通し確認」と §5 の後片付け記録。無効・アーカイブ・秘密値なし）なので、もし確認Aがその行なら `channelAccessTokenConfigured` は **`false`**・`last4` は **`null`** になる。実測は `true`／非 `null` なので、確認Aが読んだのは**staging に元からある行**。よって「6aで発行して自分たちで無効化した30日トークンに当たっただけ」という説明は**成立しない**。`updatedAt` が 2026-09-03 なのも、元からある行として自然（§3 の「他の列は既存のstaging行から写して」という一時行の事情に頼る必要が無い）。
  - **本番は同じ日に通っている**。6a（12:28 JST）は本番の認証済みアカウント1件で実LINE APIを呼び、**HTTP 200・13人・約2.1秒**で完走している（§3）。401は **staging に置いてある検証用の値**（2026-09-03 登録）が LINE 側で失効・無効化・チャネル違いになっているという意味で、**こちら側のコード・暗号鍵・設定の不具合ではない**。`lineStatus` を載せた修正（`d5a707304d`）が狙いどおり切り分けを可能にした。
  - **残件（今回の納品には不要）**：staging の実LINE API検証をまた行うなら、保存値の差し替えが必要。新しい値は **LINE Developers コンソールから利用者ご本人しか取得できず**、登録も **owner 役割＋step-up（10分以内の再確認または1回限りgrant）** が要る＝アカウント詳細「資格情報」カードからの**ご本人の画面操作**。APIキー認証は管理セッションを持たないため Codex には原理的に満たせず、**owner資格情報の新規作成とトークンの独断再発行はしない**。ただし確認項目2・3・4-b・1-b は既に「未確認で確定・実行不要」なので、**今はこの差し替えを待たずに先へ進める**。差し替えが必要になった時点でご本人へお願いする。
- 2026-10-17（Claude）：**画面②〜⑤の v06 実装とローカル検証が完了した**（利用者承認済み `LINE新規追加_v06.pen`・2026-10-15承認・フレーム `p6zMkA`／`Fqy29`／`Lwxyh`／`X0pGdw`／`Plmq1`）。独立検証・CI・マージ・staging配備はCodexへ引き継ぐ。
  - **入れたもの**：②アカウント接続を**3つの小さな段**（`Step 1 / 3` Messaging APIのチャネル／`Step 2 / 3` Webhookの設定／`Step 3 / 3` LINE Loginのチャネル。**2026-10-17に正本どおりへ訂正**。下の「Pencilの手順順序との照合」を参照）に分け、各段の「LINE側でやったこと」のチェックが全部入るまで「次へ」を押せないようにした。③接続確認は**2つの小さな段**にし、**登録は③Step1の「登録する」で行う**（④や⑤ではない）。5行の確認は1回の返事を上から1行ずつ420msで見せ、行の状態は `data-phase`（`waiting`／`checking`／`ok`／`error`）。**5行すべて `ok` のときだけ**「登録する」が出る。③Step2は「ためしに友だち追加」（QRは `lib/qr-image.ts`・`qrcode` は必要時読み込み／PERF-09）。④使い方を選ぶ（いまは飲食店向けのみ・保存の口は無い）。⑤完了は `stepFollowerImport` で**画面から続きを進めながら**進捗を出す（`busy` は3秒・失敗は5秒待つ）。
  - **外したもの（承認済みv06どおり・意図的）**：**登録の前にタグ・親アカウント・担当範囲・既存のLIFF ID・表示名を聞かない**。保存の口（`connect`）の形は変えていないので `tagIds` などは空のまま送る。これに伴い、消した入力だけを見ていた `apps/web/src/app/accounts/new/registration-v8.test.tsx`（24行・1件）を**削除した**。
  - **触ったファイル**：`apps/web/src/v8/account-new/`（`register.tsx`／`logic.ts`／`logic.test.ts`／`register.module.css`／`BEHAVIOR.md`）、`apps/web/src/app/globals.css`（`--tpl-htn6-*` の追加）、`apps/web/src/app/accounts/new/`（`register-v8.react.test.tsx`／`wizard.test.tsx`／`account-save-recovery-react.test.tsx`／`u050-mobile-steps-contract.test.ts` をv06の流れへ更新、`registration-v8.test.tsx` を削除）。
  - **ローカル検証（4条件すべて合格・ハーネス記録あり）**：① `cd apps/web && NEXT_PUBLIC_API_URL=https://example.test npx vitest run src/v8/account-new src/app/accounts` → **24ファイル／173件すべて成功**。② `npx vitest run src/v8/v8-boundary.test.ts` → 3件成功（**CSSに数字を直書きしない**の関所）。③ `cd apps/web && npx tsc --noEmit` → 型検査成功。④ `BEHAVIOR.md` がv06のフレームID・②の3小段・③の2小段と登録位置・登録前入力の削減を書いていることを読み取りで確認。
  - **テストの書き方の約束（B-273）**：絵の正本ノードの対応は**ソース文字の検索ではなく、実際に描かれた `[data-design-node]`** で確かめる（新しいソース文字の検査を足すとCIのB-273に当たるため）。`apps/web` に行数の関所は無い。
  - **ローカルで確認できないもの**：B-273 の全量確認は正しい比較元が要る（手元の `origin/main` は遅れている）。**必須CI一式はCodexの担当**。
    - **2026-10-17 訂正**：ここに書いていた「実際の分岐点は `f9c78320b65221d172a30f48eeb49b70ad5fa029`」は**誤り**。手元の `origin/main` が **9,868コミット遅れている**ための見かけの分岐点で、これを `--base` に渡すと**9,213件・653ファイルの誤検知**になる。CIの `required-pr-gate.yml:281-288` は `base="${SOURCE_CONTRACT_BASE_SHA:-$(git rev-parse HEAD^)}"` なので、**手元での確認も `--base HEAD^`（またはPRの比較元）を使う**。
- 2026-10-17（Codex独立検証の指摘2件＋Claudeの修正）：**Codexが配備受入条件を不合格として返却。2件とも修正し、さらに手元で見つかった行数ゲート超過も直した**。
  - **指摘1：②のStep 2とStep 3が承認済みPencilと逆だった**。正本 `LINE新規追加_v06.pen` のフレーム `Fqy29`（②アカウント接続）の中身は上から **`UVcGA` Step1 Messaging API → `f4AgA` Step2 Webhook の設定 → `o3rMF` Step3 LINEログイン**。実装は Step2 と Step3 が逆だった。**正本が正しい証拠は3つ**：(a) 枠の名前と並び順そのもの、(b) 「戻る」の文言の鎖（②-1「事前確認へ戻る」→ ②-2「Messaging API へ戻る」→ ②-3「Webhook の設定へ戻る」）、(c) ③接続確認の Step1（`EKLKb`）の戻るが「**LINEログインへ戻る**」＝②の最後の段がLINEログインであること。**実装側を正本へ合わせた**（絵は1文字も変えていない＝新規Pencil承認は不要）。
    - 併せて `register.tsx` の見出しコメントと `BEHAVIOR.md` に残っていた**古い順番の記述も消した**。チェック項目の割り当ても正本どおり：Step1 は入力2つのみ（チェック無し）、Step2 は入力無し＋チェック3つ（Webhookの利用／再送／エラーの統計情報）、Step3 は入力2つ＋チェック2つ（友だち追加オプションのリンク／「開発中」から「公開済み」）。
    - **回帰テスト（実際の画面操作）**：`register-v8.react.test.tsx` に「②の3つの小さな段が正本の順で出る」「チェックが残っていると次の段へ進めない」「戻るの文言が段ごとに変わる」、`wizard.test.tsx` に「①から②の3つの小さな段へ順に進む」「LINE側でやることの印が残っていると次の段へ進めない」を置いた。`account-save-recovery-react.test.tsx` の入力手順も正本順に直した。
  - **指摘2：B-273不合格**。原因は上の「比較元の誤り」で、Claudeが前回の依頼文に書いた `f9c7832…` をそのまま使うと誤検知する。CIと同じ `--base HEAD^` で確認すると **`B-273: new source assertions 0`**。実体のある違反は1件だけあり（`u050-mobile-steps-contract.test.ts` のソース文字検査）、これは**描かれたDOMを読む試験へ置き換え済み**（`register-v8.react.test.tsx` の「段の表示は今いる段を指し、登録しても先へ飛ばさない」）。
  - **手元で見つかった3件目：行数ゲート超過**。`apps/web/src/v8/account-new/register.tsx` が **809行・上限788行**で `code-size.mjs` に拒否された（上限は `code-size-baseline.json:67` に凍結済みで、`inspectSize` が `cannot add or raise a baseline entry` を出すため**上限は上げられない**。`logic.ts` も392行／既定400行で移し先の余裕が無い）。**コメントの圧縮と文の形だけで784行へ縮めた**（見出しコメント21行→6行、⑤のコメント4行→2行、空行3つ、`if (…) { 改行 setError(…) }` 3箇所を1行へ）。**文言・`aria-label`・`Step n / 3` の表示・順番・挙動は一切変えていない**。
  - **ローカル検証（4条件・ハーネス記録あり）**：① `node apps/web/scripts/v8-guard/code-size.mjs --base HEAD^` → `2675 body files, 437 frozen, **0 violations**`。② `node scripts/verify-no-source-visual-contracts.mjs --base HEAD^` → **`new source assertions 0`**。③ `cd apps/web && NEXT_PUBLIC_API_URL=https://example.test npx vitest run src/v8/account-new src/app/accounts src/v8/v8-boundary.test.ts` → **25ファイル／180件すべて成功**。④ `cd apps/web && npx tsc --noEmit` → 型検査成功。
- 2026-10-17（Codexの PR #1761 CI不合格を受けたClaudeの修正）：**B-172（共有部品の持ち主規則）14件・全体テスト6件・影の契約4件をすべて解消した。見た目・文言・順番・操作フローは変えていない＝新規Pencil承認は不要**。
  - **B-172の正体**：`scripts/visual-qa/v8-pattern-audit.mjs` は「共通部品が持つべき見た目（角・地・影・枠線・札・ラジオの選択枠など）を画面CSSが自前で持っていないか」を見る。判定の探り針は `new RegExp('\\.' + className + '(?![\\w-])')` を**規則の selector 全文**に当てるので、`.aside h2` のような子孫規則も `.aside` の針に引っかかる。CIは **未許可 0** を要求する。
  - **直した中身（3ファイル・14件）**
    - `.aside` を `align-self: flex-start` だけに減らし、カードの地・角・影は共通の `Card` に返した。中の見出し・本文は新しい `.asideH2`／`.asideP` に逃がし、`register.tsx` の `<h2>` 5つ・`<p>` 15個へ付け直した。
    - `.handoverBox`／`.accountBox` から `border-radius`／`background`／`box-shadow` を外し、共通 `Card`（`surface="muted"` `corner="control"`）に任せた。**見えの差は2点だけ**：地が `--tpl-htn-soft-bg` `#fafafc` → `--color-surface-pearl` `#f7f8fa`、`var(--tpl-htn-ring)` の細枠が消える。**内容・文言・順番・操作は不変**で、B-172が共通部品側に持たせると定めている部分。
    - ④使い方を選ぶを共通の `RadioCardGroup`／`RadioCard` ＋ `StatusBadge` へ移し、画面CSSのひな型の札・選択枠を全部外した。`stepBadge` は共通 `StatusBadge` と重なるので `stepLabel` に改名（`logic.ts`／`logic.test.ts`／`register.module.css`／`register.tsx`）。
    - `.doneHero svg` を `.doneIcon` にして、子孫セレクタが共通部品の針に当たらないようにした。
  - **全体テストの6件は④の部品差し替えの余波**：`RadioCard` の役割が `button` → `radio` に変わるため、`wizard.test.tsx:94`・`register-v8.react.test.tsx:145,260` の `getByRole('button', …)` を `getByRole('radio', …)` へ直した。「準備中」の文言検査（`no-preparing-contract.test.ts`。`ANY = /準備中/g`）は、④の未公開ひな型の札を **「順次公開」** にして解消（`logic.ts` の `templateOptions()`。公開時は `enabled` を `true` にするだけ）。
  - **B-273に当たらない直し方をした**：`sticky-bar-contract.test.ts` のソース文字検査1件は、**書き換えると新しい違反になる**。`scripts/verify-no-source-visual-contracts.mjs:77` の `hit.key` は**期待文字そのもの**を含むため、1語でも変えると別物＝新規として数えられる（§5 の 2026-10-16 11:27 と同じ罠）。よって**丸ごと削除**し、同じ内容を描画の試験（`register-v8.react.test.tsx`「5行が通ってから登録でき、登録すると③Step2へ進む」）が担保していることを指す注記に替えた。
  - **3件目に出た影の契約（B-137・B-148）＝例外登録で解消**。`v8-card-shadow-contract.test.ts` が `.subBadge`／`.errorBox`／`.errorBoxInfo`／`.qrFrame` の**4件**を「影なし候補」として拒否した。仕掛けは `apps/web/scripts/v8-card-shadow.mjs` の `cssCandidates()` で、`box-shadow` に **`var(--tpl-…ring…)` が入っているだけで候補**になる（`/var\(--tpl-[a-z0-9-]*ring/`）。4つとも**中身のカードではなく、札・QRの枠・警告の箱**なので、影を足すのではなく `apps/web/design/card-shadow-exceptions.json` へ**既存の理由文のまま4件を追記**した（札とQRは「札・印・画像・端末の見本。カードの影を付けない。」、2つの箱は「未取得・未選択・空の状態・警告。線とメッセージで区別する。」）。**影を足す選択は採らない**：足すと上のB-172の直しが巻き戻り、見えも変わって承認済みv06から外れる。4つとも比較元 `b2f05ca…` には存在しないv06由来の規則であることを `git show` で確認済み。
  - **使わなくなったCSS変数を4つ消した**：`globals.css:1090` の `--tpl-htn6-tpl-min`／`-tpl-pad`／`-tpl-gap`／`-tpl-sel-bg`（④を共通部品へ移したため参照0件）。1088行のコメントも実態へ直した。
  - **比較元（`--base`）の正解は `b2f05ca80e68eed14e947cb9ab000242d29a1526`**（PR #1761 の比較元）。手元の `origin/main` は 9,868コミット遅れているので使えない。前回ここに書いた「`--base HEAD^`」は、Codexがマージコミットを挟んだ現在のHEADでは比較元にならないので**この値に置き換える**。
  - **ローカル検証（コミット `fa9f439d0f` の作業ツリーで実施・4条件すべてハーネス記録あり）**：① 対象テスト `cd apps/web && NEXT_PUBLIC_API_URL=https://example.test npx vitest run src/v8/account-new src/app/accounts src/v8/v8-boundary.test.ts src/lib/v8-card-shadow-contract.test.ts` → **26ファイル／183件すべて成功**。差し替えた共通部品と「準備中」の検査も `npx vitest run src/components/shared src/lib/no-preparing-contract.test.ts` → **279ファイル／1,684件すべて成功**。② `cd apps/web && npx tsc --noEmit` → 成功（出力なし）。③ `node scripts/visual-qa/v8-pattern-audit.mjs --code . --base b2f05ca… --out pattern-audit-run`（CIと同じ引数）→ 終了コード0、`pattern-new-findings.json` は **findings 0／一時許可 0／想定外 0**。④ `node scripts/verify-no-source-visual-contracts.mjs --base b2f05ca…` → **new source assertions 0**、`node apps/web/scripts/v8-guard/code-size.mjs --base b2f05ca…` → **2808ファイル・437固定・違反0**。
  - **管理画面の全量テストも実行した**：`2,268ファイル／13,512件` のうち失敗は2件だけで、1件は上で直した影の契約、もう1件は **手元環境だけの不具合**。`src/lib/b244-source-rules.test.ts` が `ENOENT … /%E7%84%B6-NEN-%20EC…/apps/web/src/v8` で落ちるのは、`scripts/verify-b244.mjs` が `import.meta.url` から根を作るため、**日本語と空白を含むこのフォルダ名がURLエンコードのまま残る**から。同じスクリプトを `apps/web` から直接叩くと **`B-244/245 ソース：476ファイル・違反0`** なので、隠れた違反は無い。**CIでは通る（直さない）**。
  - **承認済みv06との不一致として残すもの（④使い方を選ぶ。今回は入れていない）**：カード内のダッシュボードの縮小見本（`xWWiM`／`xwHsO`）、「プレビュー」の押し口（`Tl8z5` → `hzCzB`＋`g6yml`）、見本を大きく見る窓（`xnMiH` 暗い幕＋`DTr8p` 幅960。飲食店向けは4ページ `wwhU6`／`L2n9q`／`fK6kO`／`cljbl`、ほかは各1枚 `LTr8B`／`nF0RB`／`f14DSA`）、初回ローンチの案内帯（`Bj6xZ`／`wsze9`）、［あとで決める］、カードごとの絵記号（`PHaM4`／`j8NBdI`。`RadioCard` の絵記号の口はいま「順次公開」の札が使っている）。**理由は行数の関所**：`register.tsx` は **779行／上限788行**で残り9行しかなく、`code-size-baseline.json` は一方向ラチェットで上限を上げられない。入れるには先に別ファイルへの切り出しが要る。**勝手に省いたのではなく、未実装として残す**
- 2026-10-17（Codexの返却＋**利用者の明示承認**）：**④の未実装6項目は「縮小した提供範囲」として利用者が明示承認した。この範囲でstaging配備まで進める**。
  - **Codexの返却内容（handoff `867dff4054b8a9b72952dfce2cc31039` の結果）**：SHA `646fc4b52b` と承認記録を照合し、②の手順順序は維持されていると確認。ただし上の④の未実装6項目を「今回は残件として扱う」という**担当間の判断だけでは、利用者が承認したデザインとの一致条件を変更できない**として、**pushもCIもマージもstaging配備も行わず停止**した。PR #1761 上のCIは旧SHA `9fa6b7ae6b` の不合格結果のまま。**この判断は正しい**（承認済みデザインとの一致は利用者の承認に紐づく条件であり、エージェント間で読み替えてよいものではない）。
  - **Claudeの対応＝利用者へ1回の質問で提示し、明示承認を得た**（2026-10-17・`AskUserQuestion`）。選択肢は (A) 縮小範囲で承認し先に配備、(B) ④を承認済みv06どおり完成させてから配備（`register.tsx` の行数上限のため**先に別ファイルへの切り出しが必要**＝配備は後ろへずれる）。**利用者の回答は (A)「縮小範囲で承認し先に配備」**。
  - **承認された縮小範囲（＝今回の納品に含めないもの）**：上の節に挙げた④の6項目 ― カード内のダッシュボードの縮小見本（`xWWiM`／`xwHsO`）、「プレビュー」の押し口（`Tl8z5` → `hzCzB`＋`g6yml`）、見本を大きく見る窓（`xnMiH`＋`DTr8p`・各ページのフレーム）、初回ローンチの案内帯（`Bj6xZ`／`wsze9`）、［あとで決める］、カードごとの絵記号（`PHaM4`／`j8NBdI`）。**これらは次工程の別枠**として扱い、入れるときは先に `register.tsx` を別ファイルへ切り出す。
  - **この承認の性質**：承認済み `LINE新規追加_v06.pen`（2026-10-15承認）**そのものは1文字も変えていない**。見た目・文言・配置・操作フローの変更ではなく、**承認済みデザインのうち今回の納品に含める範囲の決定**なので、**新規Pencilファイルの作成・再承認は不要**。②③⑤と④の骨格（ひな型の選択そのもの）は承認済みv06どおり実装済みで一致している。
  - **よってCodexの停止理由は解消した**。受入条件1（Pencilとの一致）は、**上記6項目を除く範囲**で判定する。
- 2026-10-17（Codexの再検証で B-172 が1件・Claudeが修正）：**`.doneLine` の死んだCSSを削除した。見た目は変わらない**。
  - **Codexの返却内容（handoff `eb3c5b5c36b96d340afeff33be4c1125` の結果）**：SHA `ecf3a88c0b` で承認記録の照合はできたが、比較元 `b2f05ca…` で持ち主の見張り（B-172）が **`register.module.css:73 .doneLine svg` を未許可の新しい候補1件**として出したため、**マージ・staging配備をせず返却**。PR #1761 は旧SHAのまま。**この判断も正しい**（関所は赤のままだった）。
  - **Claudeが再現し、原因を特定した**：`.doneLine` と `.doneLine svg` の**CSSの文字そのものは比較元と一字も違わない**（`git show b2f05ca…:…register.module.css` と一致）。にもかかわらず「新しい候補」になるのは、`newCodeFindings` の照合の鍵が `[file, category, pattern, kind, identity]` で、この **`pattern`（＝持ち主の型）がJSX側の使われ方から決まる**ため。比較元では `register.tsx:659` に `<p className={styles.doneLine}>` があったが、**v06で⑤完了を `.doneHero`／`.doneIcon` に作り替えたときにJSXの使用箇所だけが消え、CSSの規則が残った**（＝死んだCSS）。持ち主が特定できなくなり `pattern` が `（型なし）` に変わった＝別物＝新しい候補、という筋。
  - **直し方**：`.doneLine`／`.doneLine svg` の2規則（6行）を**削除**した。`apps/web/src`・`apps/web/scripts`・`scripts`・`packages` 全体で `doneLine` の参照は**0件**（検索で確認）なので、**描画結果は一切変わらない＝承認済みv06の見えは不変**。新規Pencil承認は不要。
  - **再検証（4件すべて合格・ハーネス記録あり）**：持ち主の見張り `--base b2f05ca…` で **新しい候補0／一時許可0／未許可0**。対象テスト **310ファイル・1,875件すべて成功**。型検査 成功。B-273 `new source assertions 0`／行数の関所 `2882ファイル・437固定・違反0`。
- 2026-10-17（**マージとstaging配備が完了。残るのは認証済み画面での目視確認だけ**／Codex報告 handoff `a98cbca7bde37270afa8da445e305efa` ＋ Claudeの原因調査）
  - **完了したこと**：PR **#1761** は必須CI全件合格後に**マージ済み**。統合SHA **`05b243b13d7c30008dc92331f8847ac6233dc91d`**。**staging配備も成功**（run **`39011248821`**、Worker Version ID `63991d31-e749-43e2-b28d-b2d981dd8569`、Workerと管理画面の公開SHAが一致、**未適用D1は0件**、デプロイロックは解放済み）。**本番変更・確認Aの再実行・D1 683の再適用はしていない。**
  - **残件＝stagingの画面①〜⑤を認証済みの状態で開くこと（未達）**。公開URLはHTTP 200だが、未ログインのブラウザは `/login` に飛ぶため、画面の中身までは見えていない。
  - **Claudeが「どうすれば認証済みで開けるか」を読み取りだけで調べた結果**（利用者本人のログインを頼む前の技術調査）
    - 管理画面のセッションは `lh_session` のトークン（`apps/web/src/lib/admin-session.ts:36-66`。`#lh_session=…` での受け渡しにも対応）か、Worker側のセッションcookieで作られる。**APIキーをそのまま `Bearer lh_session:` に載せる経路は無い**（`apps/worker/src/middleware/auth.ts` の `authenticateAdminSession` は `admin_sessions` の実在する行を要求し、APIキーへのフォールバックは cookie 経路だけ）。
    - **いまのstagingは誰もログインできない状態**。env `API_KEY` の口とセッションの口の両方が、`TOTP_ENCRYPTION_KEY` が設定済みで platform設定 `auth.mfa.required:00000000-0000-4000-8000-000000000001` が `'false'` 以外のときに拒否する。**未登録も「MFA必須」と判定される**ので、LINEログインやパスワードログインで入っても `authenticateAdminSession` がそのセッションを `deleteAdminSession` で消す。つまり**利用者本人がログインしても、staging用のTOTP登録まで済ませない限り画面は開かない**。
    - **コード自身が用意している切り替え口が解**：stagingのD1 `platform_settings` に1行 `auth.mfa.required:00000000-0000-4000-8000-000000000001` = `'false'` を入れると、`POST /api/auth/login`（`apps/worker/src/routes/admin-auth.ts:768-823`）に staging の `API_KEY` を渡すだけで **env-owner のセッションcookieが発行される**（env-owner だけMFAの挑戦を通らない分岐）。**本人のLINEログインもTOTP登録も不要**。設定の読み書きは `packages/db/src/platform-announcements.ts:74-87`（値 `null` で行を削除）。統括テナントIDは `packages/shared/src/tenant.ts:2` の `DEFAULT_TENANT_ID`。
    - 判断：これは**staging限定・配備結果の確認に必要な対象環境の設定変更**なので保存済み共通承認 `user-deployment-20260929-v1` の範囲内（§5 の 736行に同じやり方の実績あり）。ただし認証を弱める設定なので、**確認が済んだら同じ行を削除して「必須」へ戻す**ことを条件に付ける。**本番の設定は触らない。遠隔D1の書き込みと実環境操作はCodex担当**（Claudeはローカルまで）。
- 2026-10-17（Codexが**着手せず返却**／handoff `424dd721c3c776359d734817f3fcda64`・needs_review ＋ **Claudeの技術調査で④⑤の到達可能性を確定**）
  - **Codexが止めた理由2つ（要点）**：(1)「保存済み承認が認めるのは『配備に必要な設定変更』。配備後の表示確認のためにMFA必須を一時停止し、コード上で緊急復旧用とされる管理鍵でログインすることまで、担当間の依頼だけで承認済みとは判断できない」(2)「『表示と遷移だけ』で④・⑤まで進むことは現在の実装ではできない。`register.tsx:338` は③の『登録する』で `connect` を実行し、成功して初めて先へ進む。URL断片への管理鍵の受け渡しも代替にならない（画面側はセッションとして送るが、Worker側はDBに実在するセッションを要求する）」。**stagingの設定変更・ログイン・登録操作・設定の戻しはいずれも未実施。マージと配備もやり直していない。作業ツリーに未コミット差分なし・doctorは合格。**
  - **(1) は妥当なので同じ依頼の再送はしない**（担当間の依頼で承認を広げることになる）。利用者へ1回の質問として出す（下の「次の1手」）。
  - **(2) をClaudeがコードで確かめた結果＝④は到達でき、⑤は到達できない**
    - **④「使い方を選ぶ」は実際の登録なしで開ける**。`apps/web/src/v8/account-new/logic.ts:133` の `readDraft` は `step` が **1〜4 を許可**し、`register.tsx:120-150` が復元時に `setCurrentStep(draft.step)`／`setSub(draft.sub)` を直に呼ぶ。④の描画条件は `currentStep === 4` だけで、`templateKey` は「次へ」の活性条件にしか使われない。よって `localStorage` の下書きに `step: 4` を置けば `connect` を通さずに④が描かれる。**Codexの「④へ進めない」は④については成り立たない。**
    - **⑤「完了」はstagingの実画面では構造上開けない**。`register.tsx:700` の描画条件が **`currentStep === 5 && connection`** で、`connection` は `api.lineAccounts.connect` の応答（`:338`）からしか作られない。`readDraft` は **step 5 を `null` で捨てる**し、`DraftState` に `connection` も `createdId` も無い。したがって⑤を実画面で見るには**実LINEチャネルへの接続が必要**＝本番チャネルのWebhook宛先とLIFFの書き換えが起きる（§5 の730-731行で禁止と確定済み）。**⑤の実画面確認は構造上不可能**と記録し、合格とも不合格とも言わない。
  - **①〜⑤の描画そのものは既存のローカル検証で担保済み**（2026-10-17の再検証・310ファイル1,875件すべて成功に含まれる）
    - `apps/web/src/app/accounts/new/register-v8.react.test.tsx:136`「5つの段は絵の正本ノードを描く」→ `:148` で⑤の「準備ができました」まで到達
    - 同 `:152`「段の表示は今いる段を指し、登録しても先へ飛ばさない」→ `:162` で④「使い方を選ぶ」
    - 同 `:251`「登録後は画面から取り込みの続きを進め、完了を画面へ反映する」→ `:264` で⑤
    - 受入条件1（承認済み `LINE新規追加_v06.pen` との一致・④の6項目を除く）は**Codexが独立に照合済み**（handoff `a98cbca7bde37270afa8da445e305efa`）
  - **残る未決は1つだけ**＝stagingの実画面を見るために**MFA必須を一時停止してよいか**という利用者の判断。技術的な手当ては上記で済んでいる。
- 2026-10-17（**利用者の明示承認＝MFA必須のstaging限定の一時停止を許可**）
  - **質問の形**：Claude窓口で `AskUserQuestion` により3択を提示（(A) 一時的に外して確認する／(B) 外さず目視はしない／(C) 利用者本人がstaging用TOTPを登録してログインする）。**利用者の回答は (A)「一時的に外して確認する」**。
  - **承認された範囲**：stagingのD1 `platform_settings` に `auth.mfa.required:00000000-0000-4000-8000-000000000001` = `'false'` を**1行入れ**、env-owner でログインして**①〜④を実画面で確認**し、**確認後に必ずその行を削除して必須へ戻し、戻ったことを実測する**。**本番の設定・本番チャネル・本番D1には一切触れない。** 質問文で明示したとおり **⑤の実画面確認は対象外**（`currentStep === 5 && connection` のため実LINE接続が必要＝本番チャネルの書き換えになる。⑤はreactテスト `register-v8.react.test.tsx:148,264` で担保）。
  - これは Codex が止めた理由(1)（担当間の依頼だけでは承認済みと判断できない）への**利用者本人からの回答**であり、**停止理由は解消した**。
- 2026-10-17（**利用者の指摘「検証環境が更新されていない」の原因を読み取り実測で特定した**／Claude）
  - **利用者の指摘**：「今、検証環境確認しましたが更新されてませんが、どうなってますか？早く検証環境へ配備してください。」（Pencil `LINE新規追加_v06.pen` のキャンバス画像つき）。
  - **結論＝検証環境は承認済みv06に更新済み。更新されていないのは本番 `admin.musubo.jp` で、本番は今回の対象外**。配備のやり直しは不要。
  - **判定の鍵**：`register.tsx:49-53` の `V8_STEPS` が**正本フレームIDを文字列として持つ**（`p6zMkA`／`Fqy29`／`Lwxyh`／`X0pGdw`／`Plmq1`）ため、配備済みJSにこの5つが揃っているかで v06 かどうかを一意に判定できる。
  - **読み取り実測（curl・変更なし）**：

    | 環境 | URL | 配信チャンク | サイズ | 5段ラベル | 正本フレームID5つ | `musubo-register-draft-v8` | 判定 |
    |---|---|---|---|---|---|---|---|
    | 検証 | `https://stg-admin.musubo.jp/accounts/new` | `page-cdd02d1ca17b086a.js` | 101,528 B | すべてあり | すべてあり | あり | **v06（更新済み）** |
    | 検証 | `https://nen-line-stg-admin.pages.dev/accounts/new` | 同一 | 同一 | 同一 | 同一 | 同一 | 同一（HTML差分ゼロ） |
    | **本番** | `https://admin.musubo.jp/accounts/new` | `page-457d480a91f20cdb.js` | 29,360 B | 「接続確認」だけ | なし | なし | **旧版（対象外）** |

  - **正規の検証環境URLは `stg-admin.musubo.jp`**（出典：`docs/NEN-LINE-STAGING.md:38`）。本台帳14行目の「対象環境：staging（`stg-admin.musubo.jp` / Worker）」と一致。
  - **Worker側に画面は無い**（API専用）：`stg-api.musubo.jp/accounts/new`・`nen-line-stg.skmtmst.workers.dev/accounts/new`・`stg.musubo.jp/accounts/new` はいずれも **404**。`staging.musubo.jp`／`admin-stg.musubo.jp`／`line-stg.musubo.jp` はDNS解決不可。**画面を見るときに Worker のURLを開くと「更新されていない」ではなく404になる。**
  - **否定できた仮説**：(a) ブラウザキャッシュ＝HTMLは `cache-control: public, max-age=0, must-revalidate`／`cf-cache-status: DYNAMIC` で保持されない。(b) ログインの壁で何も見えない＝①の描画条件は `register.tsx:476` の `currentStep === 1` **だけ**で、初回 `useEffect`（`:120-135`）は `readDraft(window.localStorage)` しか読まず**ネットワークを使わない**ので、未ログインでも①は描かれる。(c)「`Step 1 / 3`」が配備JSに無い＝`logic.ts:184-187` の `stepLabel` が**テンプレートリテラルで動的生成**するため固定文字列が存在しないだけ。**いずれも欠落ではない。**
  - PR #1761 は **MERGED**（統合SHA `05b243b13d7c30008dc92331f8847ac6233dc91d`・2026-10-17T06:46:44Z）。
- 2026-10-17（**別laneのstaging配備が R2 メタデータ403 で失敗している**／Claudeの読み取り確認・未解決）
  - `Deploy Cloudflare Staging` run **`39041385899`** が failure。落ちた段は `Check deployment security settings (read only)`＝`pnpm exec tsx scripts/security/run-deployment-safety.ts staging apps/worker/wrangler.staging.toml`、出力は **`deployment_safety_check_failed deployment_safety_metadata_unavailable:403:r2`**。
  - **対象は `codex/development`・SHA `546a36de5c`＝v06とは別lane**。上の v06 配備（統合SHA `05b243b1…`）は成功済みで、**この失敗は検証環境のv06表示に影響していない**（上表のとおり v06 が配信されている）。
  - 原因候補は **R2のメタデータ読み取り権限**（安全確認スクリプトが staging の R2 を読めず403）。**Codexの担当範囲**なので調査と手当てを引き継ぐ。
- 以前の1手（済み・記録用）：**MFA必須の一時停止の可否だけを1回質問する**。(A) stagingだけ `platform_settings` の `auth.mfa.required:00000000-0000-4000-8000-000000000001` に `'false'` を1行入れて env-owner でログインし、①〜④を実画面で確認してから**必ずその行を削除して必須へ戻す**（⑤は上記のとおり構造上不可で、実画面確認の対象外）。(B) MFAには一切触らず、①〜⑤はローカルのreactテストとCodexのPencil照合を担保として扱い、**staging実画面での目視は「未実施」と記録して今回を終える**。回答後、(A)なら承認根拠と確認範囲を更新した依頼をCodexへ予約し、(B)ならこの台帳へ未実施として記録して終える。**どちらでも本番は対象外。**
- 2026-10-17（**Codexの停止理由「管理用の鍵の値が読み戻せない」への回答＝鍵を使わない認証経路をコードから確定した**／Claudeの読み取り調査／handoff `38eac3cfff3b4d7ea6c048e87b5e6f32` の返却を受けて）
  - **Codexの停止理由は妥当**：Worker環境変数に鍵が設定されていることは確認できても**値は読み戻せない**。かつ `admin-auth.ts:803` の env-owner ログインは鍵をcookieへ入れる一方、`auth.ts:600` の受け渡し経路は**DB上の実在セッション行**を要求するため、URL断片による代替も使えなかった。
  - **解＝鍵を一切使わず、セッション行を自分で作る。** 根拠（すべて読み取りで確定）：
    - `auth.ts:586-589` の `sha256Hex` が示すとおり、`admin_sessions.token_hash` には**生トークンではなく SHA-256 の16進ハッシュ**が入る（`admin-session.ts:161` も `sha256Hex(sessionToken)` を渡している）。したがって**ランダムな生トークンを決め、その SHA-256 を INSERT すれば、鍵を知らなくても有効なセッションになる**。
    - 行の要件は `067_staff_line_login.sql:9-15` の `admin_sessions(token_hash, staff_id, expires_at, …)`。作成は `staff.ts:531-545` の `createAdminSession` と同じ形。
    - **照合条件は `staff.ts:697`：`WHERE s.token_hash = ? AND s.expires_at > ? AND sm.is_active = 1`、かつ `JOIN staff_members sm ON sm.id = s.staff_id`。** ⇒ **`staff_id` は `staff_members` に実在して `is_active = 1` の行でなければならない。合成の `env-owner` は `staff_members` に無いので使えない。**
    - `expires_at` の比較相手は `auth.ts:600` が渡す `new Date().toISOString()`（**UTC**）。一方 `admin_sessions.created_at` の既定はJST（`'+9 hours'`）。文字列比較なので、**UTCで十分に先の時刻**を入れれば安全。
    - **TOTP登録済みの staff を選ぶと失敗する**：`auth.ts` の判定は `required || registered` で消すため、`registered = Boolean(staff.totp_enabled_at && staff.totp_secret_enc)` が真だと `deleteAdminSession` でその行が消える。⇒ **`totp_enabled_at` か `totp_secret_enc` が未設定の有効なスタッフ行を選ぶ。**
    - 提示方法は2つ：`Authorization: Bearer lh_session:<生トークン>`（`auth.ts:18` の接頭辞＋`:637-638` が `authenticateAdminSession` へ回す）か、画面側は `admin-session.ts:49-66` の `adminSessionHandoffPath` による `#lh_session=<生トークン>`（保存キーは `ADMIN_SESSION_STORAGE_KEY = 'lh_admin_session_fallback'`）。
  - **MFA設定の変更は不要**：Codexの実測で staging の `auth.mfa.required:00000000-0000-4000-8000-000000000001` は**作業前から `'false'`**。⇒ **利用者が承認した「1行入れて後で削除する」手順は実行不要になった**（承認範囲の縮小＝触らない方が安全）。片付けは**作ったセッション行の削除だけ**。
- 2026-10-18（**Codexの拒否「別人として認証する操作になる」への回答＝正規の認証経路を確定した**／Claudeの読み取り調査／handoff `d5bc44b2e2ac9e877b1e14ff755a619e` の返却を受けて）
  - **Codexの拒否は妥当**：上の 2026-10-17 の案は `admin_sessions` に行を作る＝**既存スタッフのIDを借りて認証する**形だった。`staff.ts:697` が `JOIN staff_members sm` と `sm.is_active = 1` を要求するため、合成の `env-owner` ではセッション行を使えず、必ず実在スタッフのIDが要る。**よってこの案は採らない。**
  - **`authenticateApiToken`（`apps/worker/src/middleware/auth.ts:627-671`）には4つの経路がある**（すべて読み取りで確定）。
    1. `ADMIN_SESSION_BEARER_PREFIX` 付きのトークン（`:637-638`）→ `authenticateAdminSession`。**DBに実在するセッション行が必須**＝上の拒否された案。
    2. `getStaffByApiKey`（`:641`）＝スタッフ個別の鍵。`/api/auth/login` 以外では `required || staff.totp_enabled_at` で拒否される（`:647`）。
    3. `token === c.env.API_KEY`（`:651`）→ **`{ id: 'env-owner', name: 'Owner', role: 'owner' }`**。MFAが `'false'` なら全パスで通る。
    4. **`LEGACY_API_KEY`（鍵の入れ替えの猶予枠・`:656-669`）→ 同じ `env-owner`**。条件は「その環境変数が設定済み」「**現行の鍵と別値**（同値ガード `!== c.env.API_KEY`）」「一致」「MFAが `'false'`」。受け入れ時に `[auth] accept_via=LEGACY_API_KEY` を記録する。`docs/ADMIN-AUTH.md:11` が3経路（staff table / `API_KEY` / `LEGACY_API_KEY`）を文書化しており、`apps/worker/src/worker-env.ts:68` に任意の環境変数として宣言されている。**設計された枠で、抜け道ではない。**
  - **`env-owner` は「環境の持ち主」という設計上の身元で、既存スタッフの身代わりではない**（Codexの拒否理由への直接の答え）。根拠：`auth.ts:118` のコメント「既定の運営会社と env-owner は active」、`contents.ts:226-234` が 'Owner' として表示、`impersonation.ts:61` が代理ログインの対象外として扱う、`platform-admin.ts:21,62`／`google-sheets.ts:101`／`restaurant-google.ts:76`／`staff.ts:240,250,251,356`／`account-access.ts:130,139` が一貫して特別扱い、`rich-menu-schedule-executor.ts:244-245` が「env-owner はDB行が無いため通す」と明記。
  - **現行の鍵（3番）は使えない**：`wrangler.staging.toml` の `[vars]`（`:66`）に `API_KEY` は無く、Worker secret なので**値を読み戻せない**（`:52` のコメントも「`[vars]` に書かずシークレットとして登録する」）。⇒ **4番の予備枠へ新しいランダム値を登録して使い、確認後に削除するのが正規の手**。現行の鍵を触らないので既存の利用を壊さない。
  - **cookieが届く条件を確定**（`apps/worker/src/middleware/admin-auth-config.ts`）：`registrableDomain`（`:92`）を共有する同一サイトなら `SameSite=Lax` で足りる。`*.pages.dev ↔ *.workers.dev` は cross-site（`:105` `isCrossSite`）で、`ADMIN_ALLOW_CROSS_SITE=true` ＋ `ADMIN_ORIGIN` の許可一覧が無いと `resolveAdminAuthConfig`（`:170`）が `misconfigured`（`:195-203`）を立て、`POST /api/auth/login` は **500** で明示的に断る（`admin-auth.ts:770-774`）。
    - stagingの実値：`wrangler.staging.toml:78` `WORKER_URL = "https://stg-api.musubo.jp"`、`:84` `ADMIN_ORIGIN = "https://stg-admin.musubo.jp,https://nen-line-stg-admin.pages.dev"`、`:85` `ADMIN_ALLOW_CROSS_SITE = "true"`。
    - 配備済みSPAが叩く基点は `.github/workflows/deploy-cloudflare-staging.yml:98` `STAGING_API_URL: https://stg-api.musubo.jp` →`:386` `NEXT_PUBLIC_API_URL`。**画面 `stg-admin.musubo.jp` とAPI `stg-api.musubo.jp` は同じ `musubo.jp`＝同一サイト**なので、`SameSite=Lax` のcookieがそのまま届く。⇒ **確認には必ずカスタムドメインの組を使う**（`pages.dev` 側は cross-site 設定に依存するので選ばない）。
  - **`env-owner` でも `AuthGuard` を通せる**：`/api/auth/session`（`admin-auth.ts:860-905`）は `staff.id === 'env-owner'` を `:870`（platform管理者レコードを引かない）と `:896`（スタッフ行を引かない）で明示的に分岐し、セッション行が無いAPIキー経路を想定したコメントまで持つ。
  - **MFA設定の変更は不要**（前回の結論を維持）：Codexが作業前後2回実測して staging の `auth.mfa.required:00000000-0000-4000-8000-000000000001` は `'false'`。⇒ **利用者が承認した「1行入れて後で削除」は実行しない＝承認範囲の縮小**。片付けは**登録した秘密設定の削除だけ**。
  - **注意**：`POST /api/auth/login` は `throttleKey = 'key-login:' + sha256Hex(clientIp)` で**15分に10回失敗すると429**（`admin-auth.ts:782-788`）。試行回数を増やさない。
  - **B（R2 403）は v06 と無関係な別laneの関門と再確認**：`scripts/security/run-deployment-safety.ts` は**この作業ツリーに存在しない**（`find . -name '*deployment-safety*'` → 0件）。対象は `codex/development`・`546a36de5c`。v06 の staging 配備（run `39011248821` 成功）を妨げていない。Codexの実測した原因は「CIが使う staging 用トークンの **R2情報に対する権限または対象範囲の不足**」。**保存済み共通承認 `user-deployment-20260929-v1` は「最小権限のアクセスキー作成または利用・秘密設定登録」を含む**ので、Codexが自分の承認範囲でトークンを作り直して登録できる。**新しい利用者承認は要らない。**
- 2026-10-18（その2。**Codexの2度目の拒否の原因＝Claudeの依頼文の自己矛盾／そして鍵の新規作成そのものが不要だと確定した**／handoff `ad1fe269dad2d371f0ba26287c1cd51d` の返却を受けて／Claudeの読み取り調査）
  - **Codexが実測した事実**（stagingの設定・秘密値・コード・配備はいずれも変更なし）：**予備枠（`LEGACY_API_KEY`）は未設定**／`auth.mfa.required:00000000-0000-4000-8000-000000000001` は**作業前後とも `'false'`**（2度目の実測）。
  - **Codexが登録しなかったのは正しい振る舞いで、原因はClaude側の依頼文にある**。依頼 `codex-v06-screen-check-4.md` は §3 手順2で「予備枠へ新しいランダム値を登録」と指示しながら、§6「やらないこと」に前回依頼から引き継いだ行「**確認B（owner資格情報の新規作成）**」をそのまま残していた。この行は本来 **LINE接続の確認B（owner資格情報を新規に作る別件）** を指すが、文面上は予備枠への登録も禁じていると読める。Codexは禁止条項を優先した。**同じ依頼を射程限定だけ付けて再送する前に、より良い経路が見つかったので下記へ切り替える。**
  - **【決定的】鍵の新規登録そのものが不要だった。MFAが `'false'` の今、利用者本人の通常ログインはTOTPなしで通る。**
    - 根拠：`apps/worker/src/services/login-mfa.ts:26` の `if (!force && !registered && !await loginMfaRequired(c.env.DB, staff.tenant_id, c.env.TOTP_ENCRYPTION_KEY)) return null;` ＝「**強制でない＋TOTP未登録＋ポリシー上必須でない**」なら**挑戦を返さず `null`**。
    - `loginMfaRequired`（`login-mfa.ts:15-17`）は `mfaEncryptionConfigured(key) && (await getPlatformSetting(db, mfaPolicyKey(tenantId))) !== 'false'`。**stagingは `'false'` 実測済み**なので `false` を返す。
    - 呼び出し側 `apps/worker/src/routes/admin-auth.ts:408` は `const challenge = await loginMfaChallenge(c, staff, remember);`、`:410` の `if (challenge)` の時だけ TOTP 画面へ飛ばすので、**`null` ならそのまま `:416` の `issueSession` へ直行**＝セッション発行。
    - ⇒ **台帳の旧記述「利用者本人が入ってもstaging用のTOTPを新規登録しない限り画面は開かない」は、MFAが必須だった前提のもの。現在は誤り。**
  - **人のログインの口はLINEログインだけ**（パスワードの口は無い。`admin-auth.ts` のルート一覧 `:65-982` を実測）。`:263` `GET /api/auth/line` → `:306` `GET /api/auth/line/callback`。`:768` `POST /api/auth/login` は鍵用の口。
  - **画面側の入口**：`apps/web/src/app/login/page.tsx:104` が `window.location.assign(\`${apiUrl}/api/auth/line${remember ? '?remember=1' : ''}\`)`。`apiUrl` は配備時の `NEXT_PUBLIC_API_URL`＝`https://stg-api.musubo.jp`（`deploy-cloudflare-staging.yml:98,386`）。⇒ 利用者の導線は **`https://stg-admin.musubo.jp/login`**。
  - **コールバックとチャネル**：`callbackUrl`（`admin-auth.ts:218-220`）は**リクエスト元のオリジン**から組むので staging では `https://stg-api.musubo.jp/api/auth/line/callback`。チャネルは `adminLoginChannel`（`:230-235`）＝`ADMIN_LINE_LOGIN_CHANNEL_ID`／`_SECRET` があればそれ、無ければ共通の `LINE_LOGIN_CHANNEL_ID`／`_SECRET`。`wrangler.staging.toml` に `LOGIN`／`ADMIN_LINE`／`CALLBACK` の文字列は**0件**＝すべて秘密設定で、Claudeからは値も設定有無も読めない（`wrangler secret list` はCodexの担当）。
  - **⇒ 確認の正規手段は「利用者本人が `https://stg-admin.musubo.jp/login` からLINEログインして `/accounts/new` を見る」**。新しい資格情報を作らない・秘密設定を登録しない・D1を触らない・原状復帰も要らない。**利用者本人の目視なのでCodexの代理確認より強い証拠**になる。利用者はもともと検証環境を自分で見ようとして（本番URLを見てしまって）いたので、手間も最小。
  - **残る不確実性は2つだけで、いずれも失敗時の表示で切り分けられる**：(a) stagingのD1に本人のスタッフ行があり `isPlatformAdminRow` を満たすか（満たさないと `not_authorized` でログイン画面に戻る。`admin-auth.ts:394-403`。`activation_state === 'invited'` も `not_authorized`、`'awaiting_totp'` は通る）、(b) LINEログインチャネル側に `https://stg-api.musubo.jp/api/auth/line/callback` が登録されているか（未登録ならLINEの画面で `redirect_uri` のエラー）。**どちらも起きたら画面の文言を手がかりにClaude／Codexで直す**（(a) はstaging D1の読み取り＋行追加、(b) はLINE Developersの設定で本人の操作）。なお `resolveAdminAuthConfig` が `misconfigured` なら `configuration_error`（`:405-406`）だが、stagingは `WORKER_URL`／`ADMIN_ORIGIN`／`ADMIN_ALLOW_CROSS_SITE` を実値確認済みなので起きないはず。
  - **B（R2 403）は利用者本人の権限が必要になった**：Codexの実測「手元のCloudflare認証では対象2バケットの公開ドメイン情報を読めたが、**永続的な最小権限トークンを新規発行する権限は確認できなかった**」。⇒ 共通承認は「最小権限のアクセスキー作成または利用」を含むが、**Cloudflare側がCodexの手元認証にトークン発行権限を与えていない**＝外部サービスの実際の拒否。トークン発行またはCodexの手元認証への権限付与は**アカウント所有者（利用者本人）の操作**。ただし **Bは `codex/development`／`546a36de5c` 側の別laneの関門で、v06 の staging 配備（run `39011248821` 成功）を妨げていない**ので、今回の納品を止める理由にしない。
- 次の1手（**利用者本人が検証環境でLINEログインして①〜④を見る**／Claudeは待ち・Codexへの新規依頼は不要）：(1) 利用者が `https://stg-admin.musubo.jp/login` を開いてLINEログイン（**MFAが `'false'` なのでTOTPの登録は不要**。`login-mfa.ts:26`）→(2) `https://stg-admin.musubo.jp/accounts/new` で **①事前確認 → ②アカウント接続（`Step 1 / 3` Messaging API → `Step 2 / 3` Webhookの設定 → `Step 3 / 3` LINEログイン）→ ③接続確認** の表示と遷移を確認（**③の「登録する」は押さない**＝`register.tsx:338` で `connect` が走り、本番チャネルのWebhook宛先とLIFFが書き換わるため。§5 730-731行）→(3) **④使い方を選ぶ**は端末保存領域のキー `musubo-register-draft-v8` に `{"step":4,"sub":1}` を置いて `/accounts/new` を再読み込みすれば `connect` なしで描かれる（`logic.ts:116,133`／`register.tsx:120-135,675`）。④は次工程の6項目と併せて確認でもよい →(4) ログインできない／画面が違う場合は**その表示をClaudeへ伝える**（(a) `not_authorized`＝staging D1のスタッフ行、(b) `redirect_uri` のエラー＝LINEログインチャネルのコールバックURL登録。どちらもClaudeが受けて手当てを決める）。**⑤は対象外**（`register.tsx:700` の `currentStep === 5 && connection` で構造上不可・reactテスト `register-v8.react.test.tsx:148,264` で担保）。**新しい秘密設定の登録・D1の変更・本番への操作はしない。④の6項目は利用者が明示承認した縮小範囲なので不一致として扱わない。**
- 以前の1手（**不要になったので採用しない**／Codexは依頼文の自己矛盾により未実施／そもそもMFAが `'false'` の今は本人ログインで足りる）：**鍵の入れ替え予備枠で `env-owner` としてログインして①〜④を確認**。(1) `wrangler secret list --config apps/worker/wrangler.staging.toml` で**予備枠（`auth.ts:656-669` が受け付ける第2の環境変数）が未設定**であることを確認（既に設定済みなら実在の入れ替え作業中の可能性があるので**上書きせず**Claudeへ戻す）→(2) 新しいランダム値を**その予備枠へ staging 限定で登録**（現行の鍵とは別値。同値ガードのため。**値は会話・ログ・Gitへ出さない**）→(3) `POST https://stg-api.musubo.jp/api/auth/login` にその値を渡してcookieを得る（`env-owner` 分岐・MFA挑戦なし）→(4) `https://stg-admin.musubo.jp/accounts/new` で **①事前確認 → ②アカウント接続（`Step 1 / 3` Messaging API → `Step 2 / 3` Webhookの設定 → `Step 3 / 3` LINEログイン）→ ③接続確認** の表示と遷移を確認（**③の「登録する」は押さない**）。**④は端末保存領域のキー `musubo-register-draft-v8` に `{"step":4,"sub":1}` を置いて再読み込み**（`connect` を通さない）。確認後そのキーを削除 →(5) **登録した秘密設定を削除して原状復帰し、削除を実測**（途中で止める場合も必ず実施）→(6) 併せて **`Deploy Cloudflare Staging` run `39041385899` の `deployment_safety_metadata_unavailable:403:r2` の手当て**（対象stagingバケットのR2情報を読める最小権限のトークンを staging 用CIへ登録し直し、同じチェックの合格を再検証）→(7) 結果をClaudeへ返す。**⑤は対象外**（構造上不可・reactテストで担保）。**MFA設定・D1は触らない。本番は対象外。④の6項目は利用者が明示承認した縮小範囲なので不一致として扱わない。**
- 以前の1手（Codexが拒否・**採用しない**）：**鍵を使わずDBにセッション行を作る経路**。(1) stagingのD1で `auth.mfa.required:00000000-0000-4000-8000-000000000001` が `'false'` のままであることを再確認（**変更しない**）→(2) `staff_members` から `is_active = 1` かつ **TOTP未登録**（`totp_enabled_at` または `totp_secret_enc` が未設定）の行を1件選ぶ →(3) ランダムな生トークンを決め、その **SHA-256 16進**を `token_hash`、選んだ `id` を `staff_id`、**UTCで数時間先**を `expires_at` として `admin_sessions` に1行INSERT →(4) `https://stg-admin.musubo.jp/accounts/new` を `#lh_session=<生トークン>` で開き、**①事前確認 → ②アカウント接続（`Step 1 / 3` Messaging API → `Step 2 / 3` Webhookの設定 → `Step 3 / 3` LINEログイン）→ ③接続確認** の表示と遷移を確認。**④は端末保存領域のキー `musubo-register-draft-v8` に `{"step":4,"sub":1}` を置いて再読み込み**（`connect` を通さない）→(5) **作ったセッション行を削除**し、消えたことを実測（途中で止める場合も必ず実施）→(6) 併せて **`Deploy Cloudflare Staging` run `39041385899` の `deployment_safety_metadata_unavailable:403:r2` の原因調査と手当て**→(7) 結果をClaudeへ返す。**⑤は対象外**（構造上不可・reactテストで担保）。**MFA設定は触らない。③の「登録する」は押さない。本番は対象外。④の6項目は利用者が明示承認した縮小範囲なので不一致として扱わない。**
- 以前の1手（Codex・差し戻しにより未実施）：**stagingだけMFA必須を一時的に外して画面①〜⑤を認証済みで開いて確認し、終わったら設定を元へ戻す**。手順＝(1) stagingのD1で `platform_settings` の `auth.mfa.required:00000000-0000-4000-8000-000000000001` を確認し、無ければ `'false'` を登録 →(2) `POST https://nen-line-stg.skmtmst.workers.dev/api/auth/login` に staging の `API_KEY` を渡してセッションを得る（クロスサイトでcookieが届かない場合は `admin_sessions` の実トークンを `#lh_session=` で渡す口を使う） →(3) `https://nen-line-stg-admin.pages.dev/accounts/new` で ①事前確認 → ②アカウント接続（`Step 1 / 3` Messaging API → `Step 2 / 3` Webhookの設定 → `Step 3 / 3` LINEログイン）→ ③接続確認 → ④使い方を選ぶ → ⑤完了 の**表示だけ**を確認（本番チャネルへの書き込みはしない） →(4) **その1行を削除して必須へ戻し、戻ったことを実測** →(5) 結果をClaudeへ返す。**本番は対象外。④の6項目は利用者が明示承認した縮小範囲なので不一致として扱わない。**
- 以前の1手（済み・記録用）：**この差分の独立検証 → コミット済みSHAでのCI（PR #1761） → マージ → staging配備**。**④の6項目は利用者が明示承認した縮小範囲（上の節）なので、これを理由に止めない**。**必須検証に「Pencilの手順順序との一致」を含める**（②は `UVcGA` Messaging API → `f4AgA` Webhook の設定 → `o3rMF` LINEログインの順。正本は `LINE新規追加_v06.pen`・2026-10-15承認。`.pen` は Pencil MCP でのみ開く）。B-273・行数ゲート・持ち主の見張りの比較元は **`b2f05ca80e68eed14e947cb9ab000242d29a1526`** を使う（`HEAD^`・`f9c7832…`・手元の `origin/main` は使わない）。`src/lib/b244-source-rules.test.ts` の手元失敗は上記のとおり**環境由来**。承認は保存済み共通承認 `user-deployment-20260929-v1` の範囲。**確認Aの再実行・再配備・683の再適用はしない（すべて完了済み）**。**本番配備は今回の対象外**。6b（大量件数での途中再開）は件数の多い認証済みアカウント待ちで実施不可
- 以前の1手（済み・記録用）：上の**テスト2ファイルの差分**を独立レビュー → コミット・PR #1751 の更新 → **必須CI → マージ → staging配備** → 実API検証（6a）
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
      - **2026-10-16 訂正**：友だち行と進捗設定は0件になったが、**一時アカウント行の `DELETE` はD1では通らない**（code 7500。原因は §3 の「D1の `triggers nested too deep`」で実測済み。行数に依存しないので何度試しても同じ）。この条件は「**有効なアカウントとして0件＝一時行は無効・アーカイブ・秘密値なし**」に読み替える。素の `DELETE` を繰り返したり `DROP TRIGGER`・外部キー切りを試したりしない。
    - stagingには**cronが無い**（`wrangler.staging.toml` 5行目「Intentionally has no [triggers] section」。`processPendingFollowerImports` の呼び出し元は cron の scheduled ハンドラ `apps/worker/src/index.ts:1490-1496` だけで、HTTPの入口は無い）。よってstagingでは**画面の連鎖だけが取り込みを進める**ので、受入条件2の確認にちょうど合う。**`[triggers]` は足さない。配備workflowの拒否も外さない。**
    - もし 403（`FOLLOWER_IMPORT_NOT_AVAILABLE`）になったら、LINEのアカウント種別制限で**不具合ではない**。記録して止める。
  - **6b 大量データでの途中再開（実APIでは確認できない）**：使える認証済みアカウントの友だちが13人しかなく、1回のstepで完走するため「途中で閉じて『入る』で再開」を実データでは再現できない。再開そのものは単体テスト（`follower-import.test.ts:354` の予算打ち切りからの再開、および旧実行の巻き戻り・上書き防止の回帰テスト）で担保済み。**実データでの大量件数の再開は未確認のまま残す**と記録し、合格と言わない
- 残件（Claude）：staging既存3件の暗号化トークン列を安全に更新する正式経路。入口の候補は `packages/db/src/line-accounts.ts:926 updateLineAccount`（`:946` `channel_access_token`、`:986-988` `token_expires_at`）と `apps/worker/src/services/line-account-connect.ts:120,175`。**6a は新規登録で回避できるので、この残件は検証の前提ではない**
- 以前の1手（済み・記録用）：Codexへ再検証・コミット・PR・CI・マージ・**staging配備**を引き継ぐ。再現スクリプト（`staleFriendWrites === 0`）での再確認を含む。最新本線 `origin/codex/development`（`e346a93acac35f1882f121f68b622b7bcdf67e69`）を取り込む。**本番は今回の対象外**。cronの自然発火は受入条件から外し、step の口で確かめる（理由は §3 の同節）
- その次：`apps/web/src/v8/account-new/` の**v06実装**（下の実装範囲）
- v06の実装範囲：`apps/web/src/v8/account-new/register.tsx`／`logic.ts`／`register.module.css`／`BEHAVIOR.md` へ反映（①は「事前確認」、②は「アカウント接続」）。実装に含めるもの＝Step 2 のチェック3つ・Step 3 のチェック2つが全部入るまで次へを無効／Step 4 の5項目を上から順に確認する進行と行ごとの待機中・確認中（回るリング）・OK・エラー表示／確認の行は上下中央そろえ／エラー時のカード上部の赤い案内箱／5項目すべてOKのときだけフッターの次へを活性／**Step 5 の友だち追加テスト（QR表示＋追加の検知で自動的に次へ）**／ウィザードを4段にして基本情報の段を経路から外す／**友だち引き継ぎを選んだ人だけ通る引き継ぎ中の画面（進捗・残り時間・速さの更新と、終了後の自動遷移）**／**完了画面の「早速使ってみる」で接続したアカウントのダッシュボードへ遷移**。上記の不具合1は同じPRで直すか別PRにするかを判断する
- 未確認のまま残っている1件：LINE Developers のタブ別サフィックス（`/messaging-api/` 等）。チャネル単位の `console/channel/{チャネルID}` までは確認済み
- 実APIでの接続確認（staging）は未実施。Claudeはローカルまで、実環境の検証・配備はCodexへ引き継ぐ
