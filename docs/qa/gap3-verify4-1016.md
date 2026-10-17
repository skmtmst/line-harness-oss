# B-349：21:27 JST依頼の4項目（2026-10-16）

開始HEAD：`6b280d003f`。開始時の未コミット変更0。doctorは合格。
検証前に本線をfetchし、`origin/codex/development=9089d1a712e468b920ba93fbe89e96a28e168169` を確認。既に包含済み（mergeはAlready up to date）。

| 項目 | 確認 | API・画面用関数 |
|---|---|---|
| 1 会員証の割合 | あった | `GET /api/liff/member-card?liffId=...`、本人のBearer token。`data.next.progress:number`（0〜1）、最上位は`next:null`。`memberRanksApi.card` |
| 2 友だちの4条件 | あった | `GET /api/friends?lineAccountId=...&conditions=<JSON>`。既存の`all/any`内に`{kind,op,value}`。`memberActivityFriendsApi.list` |
| 3 受け取り変更の履歴 | 保存済みの履歴を返す口を作った | `GET /api/friends/:id/delivery-consents/history?purpose?&cursor?&limit=10|20|50`。`friendDeliveryConsentHistoryApi.list` |
| 4 残数・期限の知らせ | 作った（模擬専用） | 設定、記録、模擬処理の4口。`bookingPassNoticesApi.settings/save/list/simulate` |

## 1・2の既存契約と追加試験

- `visit_count` / `purchase_amount`：`op:'between',value:{min?,max?}`。
- `last_activity_at`：`op:'between',value:{from?,to?}`。
- `member_tier`：`op:'eq',value:tierId`。
- 来店数・購入金額は365日の控え。最後の来店/購入は期間外も保持。同じ判定を配信の`segment_v1`でも使う。
- 既存の会員証・4条件AND・本人拒否を再確認し、各条件を単独で一致/不一致にする4試験を追加。既存の版や公開範囲を変えていない。

## 3の返す形・権限

`data:{items:[{id,purpose,operation,before,after,actor:{kind,id},reason,createdAt}],total,nextCursor}`。

- `before/after`：`{state,reason,source,updatedBy,updatedAt,version}|null`。初回の前はnull、削除の後はnull。
- `actor.kind`：本人のLIFF操作は`self`、店の手動操作は`store`、移行などは`system`。削除操作の担当者・理由は既存台帳に無いため`unknown/null`とし、以前の変更者を削除者と偽らない。
- owner/admin/staff。閲覧のみ・代理は読むだけ。担当外の友だちは404、他店の同意履歴は混ぜない。応答は`Cache-Control:no-store`。入力不正400。
- 番号追加なし。既存637の監査トリガーで保存された履歴を読むだけ。

## 4の口・権限・動き

| メソッド・パス | 入力 | `data` |
|---|---|---|
| GET `/api/booking/admin/pass-plans/:id/notice-settings` | `account_id` | `{remainingOne,expiry14Days,version,testMode:true,deliveryAvailable:false}` |
| PUT 同上 | `account_id`、`{remainingOne:boolean,expiry14Days:boolean,expectedVersion,testMode:true}` | 更新後の設定。券種の版を共有し、古い版は409 |
| GET `/api/booking/admin/pass-notices` | `account_id,planId?,offset?,limit=10|20|50` | `{items:[{id,entitlementId,planId,kind,purpose,messages,scheduledAt,status,processedAt,testMode}],total,sent:false,testMode:true}` |
| POST `/api/booking/admin/pass-notices/simulate` | `account_id`、`{testMode:true}` | `{processed,sent:false,testMode:true}` |

- 予約の閲覧権限で設定・記録を読める。変更/模擬操作はowner/admin、閲覧のみ・代理不可。担当外404。本人向けの管理履歴公開は追加していない。
- 両方とも初期オフ。オンにしても以前の「残り1回」をさかのぼって作らない。停止中の券種の保有者も、券が有効なら対象。
- 残数は実際の予約確定の消費履歴と同じトランザクションで予定を保存。同じ券では1回だけ。申込中・手動の残数調整は通知を作らない。通知記録失敗では予約確定・残数・消費履歴も戻る。
- 期限は店のタイムゾーンで14日前の朝8時。券と期限の一意キーで1回だけ。期限延長後は古い予定を使わず、新しい期限で判定。夏時間も店の現地時刻で判定する。
- 21〜8時は朝8時へ。予定から3時間を超えた古い知らせは除外し、夜の古い予定を今日へ復活させない。1店1回の処理で期限候補100件・予定100件まで、続きは次のtick。
- 処理直前の同じUPDATEで、設定オフ・券取消/期限/残数の回復・支払停止/猶予切れ・ブロック/非表示/宛先なし・店と組織の停止・取引目的の受取停止を確認する。宣伝目的だけの停止は取引通知を止めない。実送信は一切しない。
- 既存の毎分の`restaurantMinute`レーンへ模擬処理を接続。実送信数・messages_logへ加算しない。

## DB・統合

承認済みでDB未適用の **724** に`booking_pass_plans.notify_remaining_one/notify_expiry_14_days`、`booking_entitlement_notices`、確定時の記録トリガーを追記。新しい番号は0。`test_mode=1`以外はDB制約でも拒否する。bootstrap、保存期限の分類、友だち削除の分類も更新。本人を削除したら本人の通知だけを消し、他人・券種・匿名化した券の履歴は保持。

本線と公開中PR #1744/#1138を確認し、724の重複なし。push前の再確認は司令塔。今回の724は未適用の作成物であり、適用済みのDBへ上書き適用する手順を追加していない。

前段のAPI一覧照合では、既存第3弾77口のOpenAPI記載と、既存5口の記載済み一覧への登録が不足していた。`gap3-openapi.ts`へ実装の契約を記載し、今回の新規5口と合わせて一覧へ追加。本人認証が必須のLIFF口を認証の照合へ追加。allowlist・上限・検査条件は緩めていない。

## 故障対照

11種類すべて終了1かつAssertionErrorを確認し、元のバイト列へ復旧した。

1. `next.progress`を0へ固定。
2. 来店回数の判定を無視。
3. 購入合計の判定を無視。
4. 最後の活動日の判定を無視。
5. 会員ランクの判定を無視。
6. 変更履歴の前の値をnullへ固定。
7. 残数通知の設定を常にオンと表示。
8. 確定時の通知保存トリガーを無効化。
9. 14日前の通知予定を保存しない。
10. 取引目的の受取停止を無視。
11. 実scheduledハンドラから残数・期限の処理を外す。

生ログ・故障前のバックアップ・復旧印：`~/lh-work/design/v8/review/gap3-verify4-1016/`。検証の入口：`/tmp/gap3-verify4-final.sh`（heavy.sh経由）。最終の件数・終了値は検証終了後に追記する。

DB適用・配備・push・PR・実送信・実決済・外部書込0。B8は対象外。実Stripe Checkout等の外部アダプターは引き続き未提供。

## 最終検証

- 関連Worker：31ファイル179件成功。定時接続の関連3ファイル4件も成功（計34ファイル183件、Worker全体試験ではない）。
- DB：bootstrap・差分・保存期限の3ファイル17件成功。
- Webクライアント：3ファイル8件成功。
- shared/DB/Worker/Webの型検査、変更したWebクライアントのlint、bootstrap整合、724のmigration方針、行数上限（違反0）、差分検査、Worker/Webのビルドは終了0。管理画面に既存のlint警告・Workerのbundle警告は残し、設定で隠していない。
- 定時接続の追加試験後はWorker型を再検査し、故障対照後の同じ定時3ファイル4件を再実行。故障状態の残り0。
- 11種類の故障対照はAssertionErrorで検出し、元のバイト列へ復旧。最終の23ソースの指紋をビルド後にも照合し、全件一致した。生ログ・バックアップ・復旧印・最終HEADは外部の`gap3-verify4-1016/`へ保存。
- 開始時の4項目の不足は解消。実送信への接続、DB適用・配備、push・PRは実施していない。反映履歴のpendingファイルへ2行追記済み。採番後の番号記載は司令塔。

## コミット

- 残数・期限の模擬通知：`4c75db6fb6`。
- 目的別の受け取り変更履歴と4条件の単独試験：`754b03f279`。
- 第3弾のOpenAPIと本人確認の照合：`8706b886a5`。
- この記録を保存した最終HEADとクリーン確認は外部の`gap3-verify4-1016/RESULT.md`およびAPI-CONTRACT-GAP3.mdへ記録する。
