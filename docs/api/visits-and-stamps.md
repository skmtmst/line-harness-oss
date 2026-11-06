> 文書：来店とスタンプAPI｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 来店とスタンプAPI

スタンプはマイルと別の残高・台帳です。共通型は `packages/shared`、管理側は `visit-stamps-api.ts`、LIFF側は `visitStampsApi`。`visit_stamps` の機能設定は予約から独立し、管理API・LIFF・自動押印で確認します。

## 来店

`/api/restaurant-test` は店舗の権限と `account_id` が必要です。

| 口 | 入力・動き |
| --- | --- |
| POST `/reservations/:id/visit` | `kind:visited/late/no_show`。lateは`lateMinutes`も必要 |
| DELETE `/reservations/:id/visit` | 来店印を戻す。担当者・時刻の記録は残す |
| POST `/reservations/walk-in` | 店舗・人数・卓、任意の氏名・電話・LINE UID。定員・予約・押さえ・席待ちとの競合は409 |
| GET `/customers/history` | 店舗と電話かLINE UID。`visited`と従来の`seated`を来店済みと数える |

氏名・電話がなくても保存できますが、自動押印には本人を結べるLINEまたは既存の統合顧客IDが必要です。同じ来店の取消・再確認で押印を増やしません。

## 管理API

口は `/api/visit-stamps`。全操作で店舗範囲を確認します。設定・PIN・取消はowner/admin、押印・会計・紙審査はowner/admin/staff、閲覧のみは変更不可です。

| 口 | 入力・返事 |
| --- | --- |
| GET/POST `/cards`・PUT `/cards/:id` | 名前・押せる店舗・有効状態・`expectedVersion`・設定 |
| GET `/cards/:id/wallet` | `accountId,friendId`。残高と記録 |
| POST `/cards/:id/grants` | `accountId,friendId,count,reason,requestId,source:manual/paper` |
| POST `/entries/:id/reverse` | 理由と取消後の残高 |
| PUT `/pins/:staffId` | 店舗と4桁PIN。PIN自体は返さない |
| GET `/paper-requests`・POST `/:id/review` | 店舗の写真・状態・審査理由。承認は1回だけ加算 |
| POST `/visits/:kind/:id/checkout` | 円の会計額。kindはrestaurant/booking |
| GET `/entries` | `accountId`必須。`from,to,friendId,kind,page,pageSize`。開始以上・終了未満、頁は1から、既定50・最大200件 |

kindは `visit/manual/paper/redeem/reverse/expire/restore`。共通カードでも、その店で押した・使った記録だけを返します。記録の識別番号は削除対象の外部キーにせず、顧客の削除を妨げません。

## お客さまのAPI

`/api/liff/visit-stamps` は `accountId` と店舗のLINE Login IDトークンが必要です。本人の友だちIDを確定し、他人のIDを入力して操作できません。

- カード一覧・詳細、POST `/cards/:id/rewards`（`rewardId,requestId`）で特典を選びます。POST `/redemptions/:id/use` は `{pin:'4桁'}` だけで店員を照合し、使用時に残高を引きます。staffIdは入力しません。
- PINは自店の有効で編集可能な店員だけを照合します。重複や曖昧な一致を拒み、店員別と店舗全体の5回失敗・15分ロックを使います。ソルト付きPBKDF2で保存します。
- 紙移行はPOST `/cards/:id/paper-photos` のmultipart `file`。JPEG/PNG/WebPの内容を確認し5MBまで。返ったURLで申請します。同じ本人・カードの審査中または承認済み申請は重複不可です。
- GET `/cards/:id/paper-requests` で本人の審査待ち・承認・却下と理由を読みます。
- 写真は非公開R2。本人用GET `/paper-photos/:id` と、担当店舗用の管理GET `/api/visit-stamps/paper-photos/:id` から認証してBlobで読みます。同じ統合会員でも他店・別の友だちIDの写真は公開しません。

## 計算

設定は来店/金額方式、金額単位、初回ボーナス、月単位の期限、タイムゾーン、期間・曜日・時間・ランク倍率、特典、マス数を持ちます。金額方式は会計が必要です。期限nullは無期限、月末の加算は対象月の末日へ合わせます。

既定の順は基本数＋初回ボーナス→配列順の有効な倍率→有効な最高ランク倍率→切り捨て。`stackingOrder:multipliers_then_bonus` なら倍率後にボーナスです。停止した倍率は使いません。

`maxStackedStamps` があれば `maxPerVisit` は倍率前、その後の上限は `maxStackedStamps`。未設定の旧カードは従来の最終 `maxPerVisit` を使います。`slotCount` はマス数で、特典の必要数と別です。旧カードは特典の最大必要数から補います。残高減算と使用済み更新は同じトランザクションで、使用済み・取消済みは再使用できません。
