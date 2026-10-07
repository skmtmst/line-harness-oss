# 提案E：来店スタンプ（2026-10-07）

マイルとは別のカード・残高・台帳です。APIの型は`@line-crm/shared`、管理画面の呼び出しは`visit-stamps-api.ts`、LIFFは`visitStampsApi`です。OpenAPIの`Visit stamps`と`Visit stamps LIFF`に各口を掲載しています。

| 管理API `/api/visit-stamps`以下 | 入力 | 返り値 |
| --- | --- | --- |
| `GET/POST /cards`、`PUT /cards/:id` | 作成・保存は`name, accountIds, active, expectedVersion, settings` | カード（設定・押せる店・版） |
| `GET /cards/:id/wallet` | `accountId, friendId` | `wallet, entries` |
| `POST /cards/:id/grants` | `accountId, friendId, count, reason, requestId, source: manual/paper` | 残高 |
| `POST /entries/:id/reverse` | `reason` | 取消後の残高 |
| `PUT /pins/:staffId` | `accountId, pin`（4桁） | `configured: true`。PINは返さない |
| `GET /paper-requests` | `accountId` | 写真URL・押印数・状態・審査の記録 |
| `POST /paper-requests/:id/review` | `action: approve/reject, reason` | 申請IDと状態 |
| `POST /visits/:kind/:id/checkout` | `amount`（円）。kindはrestaurant/booking | `visitId, amount, recorded` |

LIFF `/api/liff/visit-stamps`以下には、カード一覧・カード詳細・特典選択（`POST /cards/:id/rewards`）・使用（`POST /redemptions/:id/use`）・紙カード申請があります。全て`accountId`と`Authorization: Bearer <LINE Login IDトークン>`が必要です。指定店舗のLoginチャンネルで検証し、友だちIDを本人から確定します。リクエストに友だちIDを指定して他人のカードを使うことはできません。

`settings`は`mode: visit/amount, amountUnit, maxPerVisit, firstVisitBonus, expiryMonths（nullは期限なし）, timezone, multipliers, rankMultipliers, rewards`です。計算順は「基本数→初回ボーナス→期間・曜日・時間の倍率を配列順→該当する最高ランク倍率→切り捨て→1回の上限」。金額方式では会計が必要です。期限は最後の押印から指定月数、月末は翌月の最終日に合わせます。来店の取消・再確認も記録し、同じ来店の押印を増やしません。

特典選択は`rewardId, requestId`を送り、使用前の特典を返します。使用だけは店舗に属する`staffId`と`pin`が必要です。PINはソルト付きPBKDF2で保存し、5回失敗すると15分ロック。残高減算と使用済み更新は同じトランザクションです。使用済み・取消済みは再使用できません。

紙カード申請はHTTPSの`photoUrl, stamps`。同じカード・本人の審査中または承認済み申請は重複不可。承認は一度だけ加算します。店の手入力も理由とrequestIdを残します。

カード作成・設定・PIN・台帳取消はowner/admin。押印・会計・紙カード審査はowner/admin/staff。全て店舗範囲を検証し、閲覧のみは変更不可。来店済みの自動押印は即時処理と定期処理の回収を併用します。氏名・電話だけの来店は自動押印しません。既存の統合済み顧客IDで紐付く友だちはカード残高を共有します。

マイグレーション草稿：596。残高・写真申請・PIN・押せる店の紐付けは顧客削除対象、押印・使用・取消・会計は監査記録として残します。監査の識別番号は削除対象への外部キーを持たせず、顧客削除を妨げません。
