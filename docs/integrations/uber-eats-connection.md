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

## 5. いまの実装状況

- 接続情報は Cloudflare Worker の環境変数のみ（`apps/worker/src/index.ts:281-290` の9件）。
  店舗ごとの保存先はまだありません。
- 通知の受け口は `apps/worker/src/routes/restaurant-delivery.ts:1794`
  （`/api/restaurant-test/delivery/webhooks/:service`）。署名の確かめ方は musubo 独自の方式で、
  Uber Eats の仕様に合わせた実装ではありません。
- 設定画面（設定 › デリバリー連携）は**実装済み**。
  `apps/web/src/app/settings/delivery/page.tsx`／`apps/web/src/v8/settings/delivery/delivery.tsx`。
  基準は `新規デザイン/2026-10-12_デリバリー管理_デリバリー連携/デリバリー連携_v03.pen`
  （**2026-10-12 承認済み**・DL-1 `dF4Ov`／DL-2 `OIY4Z`／DL-3 `kJLks`／DL-4 `X5d8UF`）。
  承認された範囲のとおり、3社の「つなぐ」ボタンは**押せない状態**で置いてあり、
  回答が来た会社から中身をつなぎます。飲食店向け（テスト）が使える環境だけに出ます。

## 6. Uber 開発者ダッシュボードの進み（2026-10-12 時点）

利用者がダッシュボードを操作し、こちらは手順をご案内しています。秘密値（`client_secret`）と
Application ID はこの文書にも会話にも書きません。

| 手順 | 状態 |
| --- | --- |
| API Suite の選択（Eats Marketplace） | 済み |
| アプリの登録（musubo POS Integration／TEST APP） | 済み |
| 認証方式の選択（Client Secret） | 選択済み |
| 6手順のうち5つ | 緑（完了） |
| Integration Verification Result | **未完了**（残り1つ） |

## 7. 残件と次の1手

1. ~~利用者が設計案（v03）を承認する。~~ → 2026-10-12 承認済み。設定画面も実装済み。
2. 開発者アカウント登録・NDA・API 利用契約・パートナー担当者の承認（利用者の署名が必要）。
   → ダッシュボード上は 6手順のうち5つが完了。残るのは Integration Verification Result。
3. Sandbox のテスト店舗を Integration Tech Support へ依頼。
4. ログイン連携の裏側（認可画面への受け渡し、戻り先の受け口、トークンの保存と30日ごとの更新、
   店舗一覧の取得、`POST /pos_data`）を実装。
5. 最小の実接続 → アプリ連携 → 異常系 → 検証環境での配備後確認、の順に1操作ずつ確認する。

**まだ実際の接続は1回も成功していません。**
