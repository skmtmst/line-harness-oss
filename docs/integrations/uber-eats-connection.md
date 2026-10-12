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
| 認可画面 | `https://auth.uber.com/oauth/v2/authorize` |
| トークンの口 | `https://auth.uber.com/oauth/v2/token` |
| API の土台 | `https://api.uber.com` |
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

### Uber へ確認が必要な2点（コードでは解けない）

1. 認可画面のURLが、資料によって `auth.uber.com` と `login.uber.com` で食い違っています。どちらが正か。
2. 戻り先URL（`redirect_uri`）の事前登録の手順が公式資料に書かれていません。
   アプリ登録側に登録が必要か、申請が必要か。

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

  **入れるのはこの2つだけです。** 戻り先URLは配備の設定 `WORKER_PUBLIC_URL` と決まった道
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

## 8. 残件と次の1手

1. ~~利用者が設計案（v03）を承認する。~~ → 2026-10-12 承認済み。設定画面も実装済み。
2. 開発者アカウント登録・NDA・API 利用契約・パートナー担当者の承認（利用者の署名が必要）。
   → ダッシュボード上は 6手順のうち5つが完了。残るのは Integration Verification Result。
   依頼の口は Integration Tech Support Form（`http://t.uber.com/integration-support`）で、
   Uber 立ち会いの通し試験を経て本番アカウントが開きます。
3. Sandbox のテスト店舗を Integration Tech Support へ依頼。
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
5. 利用者が Cloudflare の画面で秘密設定**2件**を自分で登録する（値はエージェントを通しません）。
   Workers → `nen-line-stg` → Settings → Variables and Secrets → **Encrypted**。
   あわせて Uber のアプリ登録側の戻り先URLを上の1行に合わせる
   （2026-10-12：利用者がダッシュボードに戻り先URLの欄があることを確認済み。
   したがって上書きの変数 `RT_DELIVERY_UBEREATS_REDIRECT_URI` は使いません）。
6. 最小の実接続（トークンを1回取得する）→ アプリ連携 → 異常系 → 検証環境での配備後確認、
   の順に1操作ずつ確認する。

**まだ実際の接続は1回も成功していません。** 上の試験77件（通信の層16件＋設定の読み取り6件＋
受け口55件）はすべて作り物の応答に対するもので、接続の成功を示すものではありません。
