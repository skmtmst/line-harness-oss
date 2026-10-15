# Uber Eats 接続台帳

対象：デリバリー受注（`/restaurant-test/delivery`）へ Uber Eats の注文を取り込む連携。
記録日：2026-10-12。秘密値（client_secret・トークン・合言葉）はこの文書に書きません。

## 1. 店舗が自分で鍵を発行できるか

**できません（公式資料に該当する仕組みの記載なし）。**

Uber Eats Manager や加盟店向けポータルから、店舗が APIキー・アクセストークン・連携コードを発行して
第三者の画面に貼り付ける方式は、公式ドキュメントに存在しません。
連携サービス側の資格情報は `client_id` と `client_secret` の1組だけで、これは**連携サービス（musubo）
のアプリ単位**に発行されます。店舗ごとには発行されません。

- https://developer.uber.com/docs/eats/guides/authentication
- https://developer.uber.com/docs/eats/guides/integration-activation-flows

## 2. 店舗が自分で設定画面から連携を完了できるか

**できます。ただし方式は「ログインして許可する」の一通りだけです。**

公式の "Merchant Authentication Workflow" ＋ "Third-Party Activation Workflow"（上記
integration-activation-flows ページ）に、連携サービスの画面から店舗が連携を開始する手順が定義されています。

| 手順 | 操作する人 |
| --- | --- |
| 1. 連携サービスが自分のポータル画面（POS Portal Microsite）を出す | musubo |
| 2. 「Login to UberEats」を押す（権限 `eats.pos_provisioning` の認可画面へ） | 店舗 |
| 3. Uber の画面でログインして許可する | 店舗 |
| 4. 戻ってきた1回だけ使える認可コードをトークンに交換する | musubo（サーバ間） |
| 5. `GET /v1/eats/stores` で店舗一覧を取得する（外部店舗IDは単独の照合キーにしない） | musubo |
| 6. つなぐ店舗を選ぶ（Select Stores to Provision） | 店舗 |
| 7. `POST /v1/eats/stores/{store_id}/pos_data` で有効化する | musubo |
| 8. 解除は店舗が対象を選び、`DELETE /pos_data`（一時停止は `PATCH` で `integration_enabled: false`） | 店舗＋musubo |

状態の変化は `store.provisioned` ／ `store.deprovisioned` の webhook で届きます。
**どの手順にも、店舗が鍵を写して貼る操作はありません。**

このほかに「Uber が加盟店の登録時にあらかじめ紐付ける」「店舗が Uber の Tech Support Form から依頼する」
という経路もありますが、どちらも設定画面からの自己完結にはならないため、必須条件（店舗が自分で
設定画面から連携）を満たすのは上の OAuth ログイン方式だけです。

## 3. musubo 側の事前手続き（1回だけ・店舗ごとではない）

- 開発者アカウント登録（Sandbox から開始）
- NDA と API 利用契約
- Uber Eats のパートナー担当者の承認
- 本番前の Integration Verification（Uber 立ち会いの通し試験）
- 本番アプリの作成と Scope Whitelisting（`client_id` を申請して権限を開放）
- パイロット店舗で**最低3日**の稼働、注文投入成功率 98% 以上、全面展開は1週間前に事前通知

出典：https://developer.uber.com/docs/eats/guides/getting-started ／
https://developer.uber.com/docs/eats/guides/going-live

**この手続きは musubo 1回で済みます。店舗ごとに Uber と打ち合わせる必要はありません。**
手続き後に店舗ごとに必要なのは、上の表の 2・3・6（ログインと店舗選択）だけです。

## 4. 検証環境

Sandbox のテスト店舗は自分で作れず、Integration Tech Support へ依頼して払い出してもらいます。
テスト用アプリの作成と権限付与は自分でできます。
出典：https://developer.uber.com/docs/eats/guides/sandbox

## 5. 公式仕様の要点（実装の根拠）

出典：https://developer.uber.com/docs/eats/guides/authentication ／
https://developer.uber.com/docs/eats/guides/integration-activation-flows ／
https://developer.uber.com/docs/eats/api/webhooks

| 項目 | 仕様 |
| --- | --- |
| 接続先 | **アプリの種類で分かれる**（下の §5-2） |
| 権限（店舗の認可） | `eats.pos_provisioning`（店舗一覧の取得と連携の有効化だけ） |
| 権限（日々の運用） | `eats.store`／`eats.store.status.write`／`eats.order`／`eats.store.orders.read` |
| 2種の認可 | `authorization_code`（店舗の認可）と `client_credentials`（運用）。**権限を混ぜて要求できない** |
| 有効期間 | `expires_in = 2,592,000`（30日） |
| 更新 | **更新用のトークンは返らない**（`refresh_token` は空文字）。切れる前に取り直す |
| 回数の上限 | トークンの口は1時間100回。超えると 429 で、古いトークンが無効になる |
| 受信の署名 | 見出し `X-Uber-Signature`／本文の HMAC-SHA256・鍵は `client_secret`・小文字16進 |
| 受信の応答 | 200 と空の本文。失敗時は 10秒・30秒・60秒・120秒で最大7回届く |
| 店舗一覧 | `GET /v1/eats/stores`（外部店舗IDは変わりうるので単独の照合キーにしない） |
| 連携の操作 | `POST`（有効化・本文なしの200）／`GET`（状態）／`PATCH`（一時停止）／`DELETE`（解除）`/v1/eats/stores/{store_id}/pos_data` |

## 5-2. 接続先は「アプリの種類」で分かれる（2026-10-15 判明）

出典：https://developer.uber.com/docs/eats/guides/sandbox

Uber は審査前の **TEST APP（Sandbox）** と審査後の **PRODUCTION APP** で接続先そのものを分けています。

| | TEST APP（Sandbox） | PRODUCTION APP |
| --- | --- | --- |
| 認証 | `https://sandbox-login.uber.com` | `https://auth.uber.com` |
| API | `https://test-api.uber.com` | `https://api.uber.com` |
| 権限 | Sandbox のホストに限り**自動で付く** | Uber の個別審査が必要 |

公式の注意書き：

- 「トークンを取る先」と「APIを呼ぶ先」は必ず同じ側に揃える。混ぜると認証が落ちる。
- TEST APP は Sandbox のホストを使わなければならない。
- Sandbox が通っても本番が通るとは限らない。

公式の切り分け表は、誤った組み合わせの例として
**「テスト用アプリで `auth.uber.com` を使う」**を名指ししています。

弊社のアプリ（`musubo POS Integration`）は開発者画面の表示が **TEST APP** で、
`Sandbox Access Granted` は済み、`Create Prod App` は押せません。
つまり**いま使える側は Sandbox だけ**です。

### 以前の「解決済み」の訂正

2026-10-13 に「認可画面のURLは `auth.uber.com`、**コードの変更は不要**」と記録しましたが、
**これは誤りでした。** TEST APP と PRODUCTION APP でホストが分かれることを見落としており、
`auth.uber.com` と `api.uber.com` は**本番側の値**です。審査前の弊社アプリから本番側のホストを
呼んでいたため、認証が通らないのは仕様どおりの結果でした（§7-2 のエラーもこれで説明が付きます）。

なお `login.uber.com` が乗り手側の別ホストであることは変わりません。
Sandbox 側の**認可画面**のURLは公式の手引きに載っていないため、認証ホストから組んだ
推定値を使っており、まだ実際には確かめていません（`uber-eats-hosts.ts` の説明書きに明記）。
最初の接続確認は `client_credentials`（トークンの口だけ）で行うため、そこでは推定値を踏みません。

### 以前の未確認点（2026-10-13 解決・Uber への問い合わせは不要）

1. **戻り先URL（`redirect_uri`）は Uber の開発者画面に自分で登録します。** 申請は不要でした。
   利用者が開発者画面で該当欄を見つけて設定済みです（2026-10-13）。
   登録した文字列は上の組み立て結果と同じ
   `https://stg-api.musubo.jp/api/restaurant-test/delivery/ubereats/oauth/callback` のため、
   上書き用の `RT_DELIVERY_UBEREATS_REDIRECT_URI` は**使いません**（未設定のままにします）。

開発者画面で残っているのは **Integration Verification Result**（§7）だけです。

## 6. いまの実装状況

- Uber との通信の層：`apps/worker/src/services/uber-eats.ts`（**追加済み**）。
  認可画面のURL生成・2種のトークン取得・許された権限の確認・30日の期限と取り直しの判定・
  店舗一覧・`pos_data` の有効化／状態／一時停止／解除・受信の署名検証。
  DBを触らず、`fetch` を受け取るだけの層です。試験は `uber-eats.test.ts`（16件）。
- 接続用の設定の受け口（**追加済み**。値そのものは Git にも会話にも書きません）。
  Cloudflare Worker の**暗号化された秘密設定**として環境ごとに入れます。変数名だけ記します。

  | 変数名 | 入れるもの |
  | --- | --- |
  | `RT_DELIVERY_UBEREATS_CLIENT_ID` | Uber の開発者画面の Application ID |
  | `RT_DELIVERY_UBEREATS_CLIENT_SECRET` | 同じアプリの Client Secret（受信の署名の鍵も兼ねる） |

  これに加えて、接続先を選ぶ**秘密でない**設定が1つあります（§5-2）。

  | 変数名 | 入れるもの |
  | --- | --- |
  | `RT_DELIVERY_UBEREATS_ENVIRONMENT` | `sandbox` のときだけ TEST APP 側へ向ける。未設定・`production` は本番側 |

  検証環境（`nen-line-stg`）は弊社アプリが TEST APP のため **`sandbox`** を入れます。
  想定外の文字列（`stg`・`test` など書き間違い）は本番側へ落とさず「連携の設定ができていない」
  として扱い、連携の口を開けません。黙って本番の店舗へ出てしまうより、つながらないことで
  配備の誤りに気づける方を選んでいます。

  **秘密設定として入れるのは上の2つだけです。** 戻り先URLは配備の設定 `WORKER_PUBLIC_URL` と決まった道
  `/api/restaurant-test/delivery/ubereats/oauth/callback` から組み立てます（Google 接続と同じ考え方で、
  呼び出し元のホストからは作りません。入口と戻り先が1文字でも違うと Uber 側ではじかれるためです）。
  検証環境では `https://stg-api.musubo.jp/api/restaurant-test/delivery/ubereats/oauth/callback` になります。
  Uber のアプリ登録が別の文字列のときだけ `RT_DELIVERY_UBEREATS_REDIRECT_URI` で上書きします。

  読み取りは `uberOAuthClient(env)`／`uberWebhookSecret(env)`
  （`apps/worker/src/services/restaurant-delivery.ts`、試験 `src/services/restaurant-delivery.test.ts` 6件）。
  2つそろわない環境、または戻り先が `https://` で始まらない環境では連携の口を開けません。
  静的なトークンの経路（`RT_DELIVERY_*_API_TOKEN`／`_WEBHOOK_SECRET`）とは別の値で、混ぜません。
- 店舗ごとの接続の保存先（**追加済み**）：移行 `packages/db/migrations/636_restaurant_delivery_uber_connections.sql`。
  4つの表を作ります。`rt_delivery_uber_connections`（1店舗1件。暗号化したトークン・期限・
  許された権限・Uber の店舗ID・状態・版）／`rt_delivery_uber_oauth_states`（認可中の一時状態）／
  `rt_delivery_uber_store_candidates`（つなぐ店舗の候補）／`rt_delivery_uber_app_tokens`
  （アプリ単位のトークンの控え）。更新用トークンの欄は作りません（公式仕様どおり返らないため）。
  時刻はミリ秒の整数、トークンは `v1.…` の暗号化した形式だけを保存します。
  4表の退会後の扱いは `packages/db/src/data-retention-tables.json` に登録済みです。
  一時状態と接続はその統括のものとして消し（`account_id` で紐づけ）、店舗の候補は店舗の子として
  店舗より先に消します。アプリ単位のトークンだけは統括に紐づかないので消す対象に入れません。
- 認可の入口と戻り先の受け口（**追加済み**）：`apps/worker/src/routes/restaurant-delivery.ts`。

  | 道 | 役割 |
  | --- | --- |
  | `POST /api/restaurant-test/delivery/ubereats/connect/start` | 認可画面のURLを作って返す。店舗管理者以上だけ |
  | `GET /api/restaurant-test/delivery/ubereats/oauth/callback` | 戻ってきた認可コードをトークンへ交換して保存する |

  入口は `state` を1件作り、1回使い切り・10分で失効させます（Cookie `lh_uber_state` は
  `HttpOnly`／`Secure`／`SameSite=Lax`／`Max-Age=600`）。すでにつながっている店舗からの開始は
  「つなぎ直し」として扱い、行を増やさず同じ1件を書き換えます。
  戻り先の受け口は、`state` が無い・食い違う・期限切れ・使用済み・別の担当者、のいずれでも
  接続せず、符号の交換そのものを試しません。店舗が許可しなかった場合、権限が足りない場合、
  交換に失敗した場合は、接続情報を作らず（または状態を変えず）理由の符号だけを残します。
  サービスからの自由文とトークンは、台帳にも記録にも残しません。
  操作は監査台帳へ `restaurant.delivery.ubereats.connect.start`／`…connect` として残します。
  管理画面へは `/settings/delivery?ubereats=…` の形で結果だけを返します。
  同じ `state` の戻りが同時に二度来ても通るのは片方だけです。使用済みへの更新を
  「まだ使われていない」条件付きで行い、**1件書き換えられたときだけ**符号の交換へ進みます
  （Google Sheets 連携の R448 と同じ形）。更新が0件だった側は交換を試さず `invalid_state` で終わります。
  試験は `src/routes/restaurant-delivery.test.ts`（デリバリー受注と合わせて55件。
  うちログイン連携が16件。同時に来た戻りの試験2件を含む）。
- 通知の受け口は `apps/worker/src/routes/restaurant-delivery.ts:1794`
  （`/api/restaurant-test/delivery/webhooks/:service`）。署名の確かめ方は musubo 独自の方式のままで、
  Uber Eats の仕様に合わせた差し替えはまだ行っていません（層の側は実装済み）。
- 設定画面（設定 › デリバリー連携）は**実装済み**。
  `apps/web/src/app/settings/delivery/page.tsx`／`apps/web/src/v8/settings/delivery/delivery.tsx`。
  基準は `新規デザイン/2026-10-12_デリバリー管理_デリバリー連携/デリバリー連携_v03.pen`
  （**2026-10-12 承認済み**・DL-1 `dF4Ov`／DL-2 `OIY4Z`／DL-3 `kJLks`／DL-4 `X5d8UF`）。
  承認された範囲のとおり、3社の「つなぐ」ボタンは**押せない状態**で置いてあり、
  回答が来た会社から中身をつなぎます。飲食店向け（テスト）が使える環境だけに出ます。

## 7. Uber 開発者ダッシュボードの進み（2026-10-12 時点）

利用者がダッシュボードを操作し、こちらは手順をご案内しています。秘密値（`client_secret`）と
Application ID はこの文書にも会話にも書きません。

| 手順 | 状態 |
| --- | --- |
| API Suite の選択（Eats Marketplace） | 済み |
| アプリの登録（musubo POS Integration／TEST APP） | 済み |
| 認証方式の選択（Client Secret） | 選択済み |
| 6手順のうち5つ | 緑（完了） |
| Integration Verification Result | **未完了**（残り1つ） |

## 7-2. 実機で出た認可エラー（2026-10-13）

staging（`https://stg-admin.musubo.jp/settings/delivery`）で Uber Eats の「つなぐ」を押したところ、
`auth.uber.com` へは遷移しましたが、認可画面ではなくエラー画面になりました。

```
https://auth.uber.com/oauth/errors?error=invalid_client
  &error_description=we+were+unable+to+fetch+client+metadata...
Authorization Error / Invalid client
```

### 切り分け（コードと設定の読み取りのみ。秘密値は見ていません）

| 確認したこと | 結果 |
| --- | --- |
| musubo 側が「設定が無い」と判断していないか | **設定はある**。`oauth_not_configured`（503）が出ず認可URLまで作れている＝`client_id`／`client_secret` は `nen-line-stg` に存在し空でない |
| 認可URLの組み立て | **公式仕様どおり**。`client_id`／`redirect_uri`／`response_type=code`／`scope=eats.pos_provisioning`（＋`state`）。`services/uber-eats.ts` の `buildAuthorizeUrl` |
| 設定の読み取り | **前後の空白は除去済み**（`uberOAuthClient` が `.trim()`）。改行混入による不一致は起きない |
| 戻り先URL | 不一致なら Uber は `redirect_uri` の文言で返すのが通例。今回の文言は「クライアントの情報を引けない」で別の種類 |

公式のエラー表（https://developer.uber.com/docs/eats/guides/authentication）では
`invalid_client` は「client ID または secret が不正。開発者画面で確認する」。
つまり **musubo 側のコードと配備設定の不具合は否定**され（Jev 判定 C＝1%）、
Uber の認可サーバが `client_id` を自分の登録簿から引けていない状態です。

### 残る原因候補（どちらも Uber 開発者画面の確認が必要）

| 候補 | Jev 判定 |
| --- | --- |
| **B：アプリがまだ `authorization_code`／`eats.pos_provisioning` で認可を受けられる状態になっていない**（Integration Verification・Scope Whitelisting 未了のため認可サーバ側にクライアントが未登録） | **64%** |
| A：`RT_DELIVERY_UBEREATS_CLIENT_ID` に入っている文字列が OAuth 用の Client ID ではない（別欄の Application ID をコピー、切れ、別アプリ） | 35% |

公式資料では本番の `eats.pos_provisioning` は「Uber Eats チームの承認とホワイトリスト登録が先」と
明記されており（§3・§5）、§7 の **Integration Verification Result が未完了**であることと符合します。

### 利用者の確認結果（2026-10-13）

Cloudflare の `RT_DELIVERY_UBEREATS_CLIENT_ID` へ入れた値は、Uber 開発者画面の
**`Client ID` という欄**からコピーしたものでした（値は確認していません）。
したがって候補 A（別欄の取り違え）は後退し、**候補 B が残ります**。

### 結論（2026-10-13 時点・この後 2026-10-15 に訂正）

当時は「**musubo 側に直す箇所はありません**。Scope Whitelisting 未了が原因」と判断し、
Integration Tech Support への依頼を次の1手としていました。

### 原因の訂正（2026-10-15）

**上の結論は誤りでした。musubo 側に直す箇所がありました。**

公式の Sandbox の手引き（§5-2）に、審査前の TEST APP は Sandbox のホストを使わねばならず、
**テスト用アプリで `auth.uber.com` を使うのは誤った組み合わせ**だと明記されています。
弊社アプリは TEST APP で `Sandbox Access Granted` が済んでいるため、認可を受けられない状態
ではなく、**向ける先が本番側だったために本番の登録簿から引けなかった**と読むのが筋が通ります。

当時の切り分けで見落としたのは次の2点です。

- 候補を A（値の取り違え）と B（Uber 側の未承認）の2つに絞り、
  **C：アプリの種類と接続先の不一致**を立てていなかった。
- 開発者画面に `Client ID` という欄は無く、あるのは `Application ID` と `Client Secret` です。
  §7-2 の「利用者の確認結果」が指す `Client ID` の欄は実在しないため、候補 A の後退も
  根拠が弱いままでした（なお `client_id` に Application ID を入れる前提自体は変えていません）。

したがって Integration Tech Support への依頼（下の下書き）は、**まず Sandbox で接続を試す前の
必須ではなくなりました**。残る用途は §4 の **Sandbox のテスト店舗の払い出し依頼**だけです。

次の1手は `RT_DELIVERY_UBEREATS_ENVIRONMENT=sandbox` を検証環境へ入れ、
`client_credentials` で Sandbox のトークンを1回取ることです（§8）。

### Integration Tech Support への依頼文（下書き・`<>` は利用者が埋める）

2026-10-13 版の下書きは「権限の許可（whitelisting）と Integration Verification を依頼する」
内容でしたが、原因が接続先の不一致だと分かったため**用途を1つに絞りました**。
いま頼むことは §4 の **Sandbox のテスト店舗の払い出し**だけです。
`Client ID` の欄は開発者画面に存在しないため、`Application ID` と書き換えています。
この依頼は Sandbox の接続確認（§8-6）より先に出す必要はありません。

```
Subject: Request to provision a Sandbox test store

Company / Integrator: musubo (<legal entity name>)
Integration name: musubo POS Integration
App name in Developer Dashboard: <app name> (TEST APP)
Application ID: <paste from Developer Dashboard>
Region / Market: Japan
Contact: <email>

Current status
- API Suite: Eats Marketplace selected
- App registered, authentication method: Client Secret
- Sandbox Access Granted
- OAuth redirect URI registered:
  https://stg-api.musubo.jp/api/restaurant-test/delivery/ubereats/oauth/callback
- Implemented and unit-tested on our side: authorization-code flow (authorize URL,
  callback, token exchange, 30-day re-acquisition), GET /v1/eats/stores,
  POST/GET/PATCH/DELETE /v1/eats/stores/{store_id}/pos_data,
  webhook signature verification (X-Uber-Signature, HMAC-SHA256)
- Our client now targets the sandbox domains (sandbox-login.uber.com /
  test-api.uber.com) for this testing application.

Request
Please provision a Sandbox test store for this application so that we can complete
end-to-end testing (store listing, POS data activation, and order webhooks) before
requesting production access.
```

## 8. 残件と次の1手

1. ~~利用者が設計案（v03）を承認する。~~ → 2026-10-12 承認済み。設定画面も実装済み。
2. 開発者アカウント登録・NDA・API 利用契約・パートナー担当者の承認（利用者の署名が必要）。
   → ダッシュボード上は 6手順のうち5つが完了。残るのは Integration Verification Result。
   **これは本番アカウント（PRODUCTION APP）を開くための手順で、Sandbox の接続確認の
   前提ではありません**（§5-2）。`Sandbox Access Granted` は済んでいます。依頼の口は
   Integration Tech Support Form（`http://t.uber.com/integration-support`）で、
   Uber 立ち会いの通し試験を経て本番アカウントが開きます。
3. Sandbox のテスト店舗を Integration Tech Support へ依頼（上の下書き）。
   店舗一覧・`POST /pos_data`・注文の通知まで通すときに必要になります。
   トークンを1回取るだけの確認（下の 6）には要りません。
4. ログイン連携の裏側（認可画面への受け渡し、戻り先の受け口、トークンの保存と30日ごとの更新、
   店舗一覧の取得、`POST /pos_data`）を実装。
   → **通信の層・設定の受け口・接続の保存先・認可の入口と戻り先まで実装済み**（上の 6 節）。
   (a) 店舗ごとの接続の保存先（移行 `636_restaurant_delivery_uber_connections.sql`：暗号化した
   トークン・期限・権限・Uber の店舗ID・状態・版。更新用トークンの欄は作らない）→ **済み**。
   (b) 1回使い切り・10分で切れる `state` の置き場 → **済み**。
   (c) 認可の入口と戻り先の受け口 → **済み**。
   (d) 受信の署名を Uber の方式へ差し替え（`verifyWebhookSignature` を
   `routes/restaurant-delivery.ts` の受信口に `ubereats` だけ適用する。他社の
   `x-nen-*` 方式は変えない）→ **残り。1操作ずつの原則に従い、実接続のあとで行う**。
   さらに先は、つなぐ店舗を選ぶ画面（`GET /v1/eats/stores` の一覧→選択→`POST /pos_data`）と、
   30日で切れるトークンの取り直し。
5. ~~利用者が Cloudflare の画面で秘密設定**2件**を自分で登録する~~ → **済み**。
   `nen-line-stg` の Settings → Variables and Secrets に **Encrypted** で2件登録済み
   （値はエージェントを通していません。暗号化で入れているので再配備で消えません）。
   Uber のアプリ登録側の戻り先URLも利用者が設定済みで、上の1行と同じ文字列です。
   したがって上書きの変数 `RT_DELIVERY_UBEREATS_REDIRECT_URI` は使いません。
6. 最小の実接続（トークンを1回取得する）→ アプリ連携 → 異常系 → 検証環境での配備後確認、
   の順に1操作ずつ確認する。

   `RT_DELIVERY_UBEREATS_ENVIRONMENT=sandbox` の検証環境への配備は
   **済み**（Worker Version `d74cf03c-0062-4a60-90b5-aa6074ac32aa`）。

   ### 6-1. 接続確認（トークン1回）の口

   Application ID と Client Secret は Cloudflare の暗号化された秘密設定で読み戻せないため、
   外から `curl` で叩くには秘密値を取り出すことになる。取り出さずに
   **「配備先の中から1回だけ送る」** ための口を用意した。画面は持たない。

   - 宛先: `POST /internal/ubereats/sandbox-token-probe`
   - 守り: 合言葉 `RT_DELIVERY_UBEREATS_PROBE_SECRET`（32文字以上）の HMAC-SHA256 署名。
     見出しは `x-nen-timestamp`（通算秒10桁）と `x-nen-signature`（`${timestamp}.${body}` の16進）。
     合言葉が使えないときは 503、署名違い・時刻が5分以上ずれていれば 401 で、送らない。
   - 合言葉が使えない理由は 2026-10-16 に分けた（§6-3）。`probe_secret_missing` は
     その要求を受けた配備先に値が届いていない、`probe_secret_too_short` は値はあるが
     32文字未満。**長さも値も返さない**（この分岐は署名の確認より前に通るため）。
   - 本文が `{"mode":"check"}` のときは**下見**。署名を確かめたあと、Uber へは送らずに
     接続先（`sandbox` / `other` / `unknown`）と OAuth の設定が揃っているかだけを返す。
     トークンの口の回数も冷却時間も使わないので、合言葉と署名の確認を何度でも行える。
   - 接続先が Sandbox でないときは 403 で止める。**本番の Uber へは送らない。**
   - 冷却時間10分。送る**前**に時刻を残すので、途中で落ちても1回分として数える
     （Uber のトークンの口は1時間100回まで）。
   - 返すのは `success` / `environment` / `scope` / 残り秒だけ。失敗時はHTTP状態と
     分類済みの符号だけ。**トークンの値と Client Secret は返さない・記録しない。**
   - 実装: `apps/worker/src/services/ubereats-token-probe.ts`、
     口は `apps/worker/src/routes/restaurant-delivery.ts`。

   ### 6-2. 検証環境で1回実行した結果（2026-10-16 00:21 JST）

   PR #1736 をマージし、Git SHA
   `008063dac1d9fb1c8ed8969f565291b8b7cd7072` を Worker と管理画面へ配備した。
   配備 run は `38758489168` で成功し、両方の公開SHAも一致した。

   検証Workerに32バイトの乱数から作った
   `RT_DELIVERY_UBEREATS_PROBE_SECRET` を暗号化した秘密設定として登録した。
   値は表示・記録していない。登録で作られた Worker Version
   `1e9c043e-7976-4545-a29a-e6b7378a0049` は100%配備中で、読み取り確認では次が揃っていた。

   - 上の Git SHA
   - `RT_DELIVERY_UBEREATS_ENVIRONMENT=sandbox`
   - 既存の Application ID / Client Secret と、新しい probe secret の**名前**

   その直後、本文を `{}` の2文字にし、現在時刻と
   `${timestamp}.{}` の HMAC-SHA256 署名を付けて**1回だけ** POST した。
   応答は次のとおりだった。

   ```json
   {"httpStatus":503,"success":false,"code":"probe_not_configured"}
   ```

   この符号は、署名の検査や Uber への送信より前の「probe secret を使えない」分岐で返る。
   そのため、**Uber のトークン取得口へは到達しておらず、`scope` も未確認**。
   停止条件に従って再送は行っていない。トークン、Client Secret、
   probe secret の値は応答・ログ・リポジトリのどこにも残していない。

   **次の1手**：100%配備中の版に秘密設定の名前がある一方、
   登録直後の実要求だけが未設定応答になった原因を切り分ける。
   原因を確定してから、別の明示的な再検証として次の1回を行う。
   この失敗記録に対して盲目的に再送しない。

   ### 6-3. `probe_not_configured` の切り分け（2026-10-16）

   **コード側は原因ではない**（読み取りで確定）。

   - この符号は `routes/restaurant-delivery.ts` の合言葉の分岐だけが返す
     （文字列はこの口とその試験にしか無い）。したがって要求は新しい束を積んだ
     Worker に届き、飲食店向け（テスト）の判定も通り、合言葉だけが読めなかった。
   - 「`src/index.ts` の環境変数の型に `RT_DELIVERY_UBEREATS_PROBE_SECRET` を
     書き忘れたせいで値が隠れた」という見立ては**外れ**。`src/index.ts` の既定の書き出しは
     `fetch: app.fetch` で、環境をそのまま渡しており絞り込みも作り直しもしていない。
     型の宣言は動くときの振る舞いに影響しない。
   - 残る候補は配備側で、こちらからは読めない。(a) POST の宛先ホストを受けている Worker が
     秘密設定を入れた Worker と別、(b) `wrangler secret put` の直後で版の入れ替わりが
     間に合わず前の版が応答した、(c) 作った値が符号化・空白落としのあと32文字未満、
     (d) 名前の綴り違い。

   **直した内容**：どれが起きているかを応答そのものから分かるようにした。

   1. 503 を `probe_secret_missing`（値が届いていない）と
      `probe_secret_too_short`（32文字未満）に分けた。長さと値は返さない。
   2. 下見の本文 `{"mode":"check"}` を足した。署名を確かめたあと **Uber へは送らず**、
      冷却時間も使わずに接続先と設定の有無だけを返す。これで
      「合言葉と署名は通るのか」を、Uber の1時間100回の口を使わずに確かめられる。

   **次の1回の手順**（Codex 担当・この順で）。

   1. POST と**同じホスト**へ `GET /api/health`。どの Worker が応答しているかを突き合わせる。
   2. `RT_DELIVERY_UBEREATS_PROBE_SECRET`（32文字以上）を入れ直し、版が入れ替わるのを待つ。
   3. 本文 `{"mode":"check"}` で署名付き POST。Uber へは送られず冷却時間も使わない。
      `probe_secret_missing` / `probe_secret_too_short` が返れば上の候補が絞れる。
   4. 3 が `success: true` で `environment: "sandbox"` のときだけ、本文 `{}` で実のトークン取得を1回。
      失敗したら再送せず、HTTP状態と `code` / `uberCode` / `status` を返す。

**まだ実際の接続は1回も成功していません。** 上の試験77件（通信の層16件＋設定の読み取り6件＋
受け口55件）はすべて作り物の応答に対するもので、接続の成功を示すものではありません。
