# 03 フォーム内予約（form booking）

大学生向けひとこと: 回答フォームに「予約を入れる」欄を付け、回答と予約をセットで確実に結ぶ設計です。空き表示は約束しません。

## 目的

- 回答フォームの「予約を入れる」ブロック。空き枠表示・回答と予約IDの結合・二重送信防止・満席競合・片成功（回答だけ通る）の戻し方。
- 現行 `FormInputType` にbooking型なし・`FormAction` に予約操作なし（監査03-04取込）。新ブロック追加が前提。

## Pencil実ID・画面呼出箇所

- Pencil: `ijxur`・`g9osGN`・`aNZKe`。
- 画面: 公開フォーム（LIFF）の予約ブロック、予約候補表示、管理側の回答↔予約の対応表示・再試行入口。

## 既存コード/SHAと行根拠（base `4639c6e`・監査03-04取込）

- 公開フォームは不変公開版を読む: `packages/db/src/forms.ts:258–277`、`routes/forms.ts:2274–2285`。
- 公開版不変trigger: `migrations/390_form_published_versions.sql:69–101`。
- 回答冪等: `routes/forms.ts:2239–2252,2380–2419,2590–2615`、`migrations/348_form_submission_idempotency.sql:19–41`。
- 回答後processing未完は202＋`complete:false`/`pendingEffects`/`retryable:true`、同キー補完・管理側retry-effects入口: `routes/forms.ts:2625–2637,1571–1612,2999–3022`。
- フォーム定員（予約席とは別）: `packages/db/src/forms.ts:1097–1142`、`routes/forms.ts:2707–2740`。
- Webhook outbox: `migrations/348:44–67`、`routes/forms.ts:2777–2850`。
- 予約候補GET・直前再確認・最終席確保・資源snapshot・キー方式・通知: `routes/booking.ts:320–327,553–741,742–829,867–910,669–678,953–964,3629–3650`、`services/booking-resource-capacity.ts:115–157`、`services/booking-idempotency.ts:53–141`。

## 現在/提案の区別

- 現在: フォーム回答と予約は別系統。回答保存前は現在公開版でINSERT（claim表に `form_version_id` 専用列なし。監査03-04必須条件6）。
- 提案: サーバー側の統合受付1口で「回答ID・予約ID・関連行・claim」を安定IDへ固定。ブラウザの2連続呼び出し＋両成功仮定はしない。

## 入力契約（具体。未定義fieldなし）

`POST /api/forms/:formId/bookings`（統合受付。新規。`Idempotency-Key` HTTPヘッダ必須）:

```json
{
  "formVersionId": "fv-公開版ID",
  "blockId": "blk-予約ブロック",
  "menuId": "mn-1",
  "staffId": "staff-9",
  "instant": "2026-10-05T10:00:00+09:00",
  "bookingSettingsVersion": 12,
  "lookupKey": "client-generated-256-bit-base64url-secret",
  "answers": { "q1": "選択肢A" }
}
```

- `formVersionId`: 実公開版ID（既存IDをUUID形式だけに限定しない。受付時に現行公開版と照合。不一致は409＋現行版提示。再試行のすり替わり防止）。
- `blockId`/`menuId`/`staffId`: 予約ブロック由来の許可値のみ（公開版定義に存在するもの。任意値不可）。
- `instant`: UTC instantで保存（店舗TZは表示用）。
- `bookingSettingsVersion`: 予約設定snapshotの版（受付時の根拠版を固定）。
- `answers`: 回答本文（通常の回答バリデーションを通す）。
- 友だち解決はserver側（LINE identity→対象フォーム所属account→同account友だち。clientのfriendIdは信用しない）。
- `requested`/`confirmed` はserverが決定。公開版blockのapproval_modeが明示されていれば優先、省略時は店舗設定snapshotを使い、`automatic`→confirmed / `manual`→requested（店舗既定automatic）。clientのstatus指定は400。
- `GET /api/forms/:formId/booking-slots?formVersionId=<id>&blockId=<id>&date=YYYY-MM-DD&staffId=<id>` を提案。公開版・許可account・blockの選択肢・店舗TZの1日だけを読み、200 `data:{slots:[{instant,staffId,menuId}],bookingSettingsVersion}`。無効公開版/blockは404、date等不正400、上限/頻度429。空き保証ではない。
- 受付成功は201（same-key replayは200）、DB成立・後処理pendingは202。容量/settings版不一致409。未認証LINE identityは401、入力不正400、他社/非公開formは404、feature OFFは403。lookupKeyはclientが初回にcrypto乱数256bitで作って再送中保持し、serverはhashのみ保存する。keyはURL/access/errorログへ載せない。

出力:

```json
{ "success": true, "data": { "claimId": "cl-1", "submissionId": "sb-1", "bookingId": "bk-1", "status": "requested" } }
```

```json
{ "success": true, "data": { "claimId": "cl-1", "submissionId": "sb-1", "bookingId": "bk-1", "complete": false, "pendingEffects": ["notify"], "retryable": true } }
```

```json
{ "success": false, "code": "slot_conflict", "error": "満席になりました。再選択してください", "data": { "alternatives": ["2026-10-05T11:00:00+09:00"] } }
```

## 権限（公開LIFFと管理を混ぜない）

公開提出（LIFF・認証なしLINE identity）:

| 操作 | 可否 |
|---|---|
| 空き候補GET | 許可（account・公開版・設定版の範囲内） |
| 統合受付POST | LINE identity解決できた本人のみ。client指定ID信用なし |
| 対応状態照会POST（業務状態不変） | 所有proof付きのみ（下記）。proofなしは404 |
| 後処理の再実行（retry-effects） | writeのため公開不可。管理側のみ |

管理側:

| 操作 | readOnly | owner | admin | staff |
|---|---|---|---|---|
| 対応状態照会GET | 許可（読取） | 許可 | 許可 | 許可 |
| 後処理の再実行 | 禁止（writeのためreadOnly retry禁止） | 許可 | 許可 | 許可 |

- 公開状態照会POSTの所有proof: 初回にclientが生成した対応照会キー（回答者が初回に生成するlookupKey。連番・推測可能値にしない）。

## 決定：一体batch（D1内）＋outbox補償（D1外）

「SQLエラーか永続stateか」の未決定は残さない。正本は一体batchであり、欠損はSQLエラーで落とす。guard後のJS throwによる取消はしない（batch commit後のthrowでは戻らないため）。

具体batch並び（1つのD1 batch。順序固定）:

1. claim INSERT（候補546 `form_booking_claims`、status pending。受付時の安定snapshotを保持。下記）。
2. 回答INSERT（claimの存在を条件に。重複キーは既存対応を返す）。
3. 予約INSERT（`INSERT ... SELECT` で同staff重複・メニュー定員・店舗容量・設定version・資源容量を最終判定）。
4. 対応づけINSERT（候補546 `form_booking_links`。VALUES＋scalar subqueryで両親・今回receiptを選択。下記SQL）。
5. 通知intent INSERT（既存 `form_submit_outbox` を流用。`kind='booking_notify'`＋安定event_id。下記）。

最終link INSERTの具体形（提案。named bindを実装では位置引数へ変換）:

```sql
WITH current_operation AS (
  SELECT * FROM form_booking_claims
  WHERE id = :claimId AND op_id = :freshOp AND owner = :owner
    AND tenant_id = :tenant AND line_account_id = :account
    AND form_id = :form AND form_version_id = :formVersion AND friend_id = :friend
    AND idempotency_key = :headerKey AND request_hash = :hash
    AND lease_generation = :lease AND version = :claimVersion AND status = 'pending'
    AND submission_id = :submission AND booking_id = :booking
    AND json_extract(steps, '$.submission') = 1
    AND json_extract(steps, '$.booking') = 1
    AND json_extract(steps, '$.resources') = 1
)
INSERT INTO form_booking_links (
  id, claim_id, op_id, tenant_id, line_account_id, form_id, form_version_id,
  friend_id, submission_id, booking_id, idempotency_key, request_hash, status)
VALUES (
  :linkId,
  (SELECT id FROM current_operation),
  (SELECT op_id FROM current_operation),
  (SELECT tenant_id FROM current_operation),
  (SELECT line_account_id FROM current_operation),
  (SELECT form_id FROM current_operation),
  (SELECT form_version_id FROM current_operation),
  (SELECT friend_id FROM current_operation),
  (SELECT s.id FROM form_submissions s JOIN current_operation c ON c.submission_id=s.id
   WHERE s.form_id=c.form_id AND s.form_version_id=c.form_version_id AND s.friend_id=c.friend_id),
  (SELECT b.id FROM bookings b JOIN current_operation c ON c.booking_id=b.id
   WHERE b.line_account_id=c.line_account_id AND b.friend_id=c.friend_id),
  (SELECT idempotency_key FROM current_operation),
  (SELECT request_hash FROM current_operation), 'committed');
```

- 各scalarは同一のfresh op/hash/scope/lease/version/成功工程条件に依存。今回予約INSERT0の場合steps.booking=0となり、旧親IDが残っていてもcurrent_operation空→NOT NULL違反、batch全取消。成功工程は前のINSERTの `changes()` に直接結び、既存行のEXISTSだけで1へしない。
- claim INSERTは通常INSERT（OR IGNORE禁止）。重複keyはbatchを取消して認可済み既存claimを再読。最初の処理で親ID/snapshotを固定し、同hash完成なら新予約を作らず既存セットを返す。異hashは409。replay判定は現在公開版への置換前に行い、成立済み版をすり替えない。
- claim不変性: snapshot・親ID・scope（tenant/account/form/版/friend/key/hash/照会hash）はINSERT後不変。owner・version・lease・steps・statusの更新は `WHERE id/op/owner/version/lease/pending` のCASで管理し、成功時のみversionを上げる。予約本体のcapacity/資源CASとclaimの版は別。
- 回答INSERTの直後に同fresh claimへstep.submission=changes()、予約INSERT直後にstep.booking=changes()を記録する。資源snapshotは既存予約資源snapshotの全必須行を同batchで挿入し、期待数と予約ID一致が確認できた場合だけstep.resources=1（資源なしの場合も明示0件検証）。どの書込みもfresh claim/成立済みlinkのscope guard付き。
- linkの後に通知intentをINSERTし、最後にclaimをcommittedへCAS更新する。stepsに通知intent登録を残す。必須intent行が欠ける場合はNOT NULL等の成立assertをSQLエラーにし、事後JS throwへ依存しない。DB成立statusと外部通知のpendingは別。SQL障害は回答/予約/資源/link/intent/claimを一緒に取消。

公開版固定（安定snapshotの保持）:

- 親保存前のclaim行に `form_version_id`＋`definition_snapshot_json`（予約ブロック定義・設定版・選択肢）を保存する。公開版が途中で変わってもclaimのsnapshotで処理を続ける（すり替わり防止）。
- 既存 `form_submit_claims` は公開版列なし・status値も回答用（in_progress/failed/completed）のため流用しない。予約用に候補546へ `form_booking_claims` を補充する（statusはpending/committed/compensating/failed）。

通知intent（既存outboxで足りるため新表なし）:

- 新kindを既存drainerが処理できるとは主張しない。実装時にdurable workerのbooking_notify drain/retryを追加し、未実装のままflagを有効化しない。intentは同batchで永続化、外部配達は安定event_idを使い冪等に再試行する。
- 既存 `form_submit_outbox` の列（`tenant_id/line_account_id/form_id/friend_id/idempotency_key/kind/event_id/status/payload`）で足りる。`kind='booking_notify'`、`event_id` は安定値（scope＋キー由来の固定UUID）、`status` はpending→delivered/failed。受け側はevent_idで重複除去する。

状態照会キー（決定）:

- clientが初回受付前に照会キーを生成し、claim行にはハッシュ（`lookup_key_hash`）だけ保持する。同キー再送ではclientが同じ照会キーを送る。TTLはclaimの `expires_at` と同一。
- 照会は `POST /api/forms/:formId/booking-status` のbody `{idempotencyKey,lookupKey}` で受ける（新読取registry口として01と同じ業務状態不変・rate-limit契約を使用。公開LIFFの本人境界、管理側はforms view境界を保つ）（URL query・ログにtokenを残さない）。
- 公開照会はLINE identityからserverがtenant/account/friendを再解決し、form path＋idempotencyKeyの複合scopeでclaimを探しlookup hash/TTLを検証する。初回201/202が失踪してclaimId未取得でも、clientが保持したheaderKeyとlookupKeyで照会できる。成功/replayにclaimIdも返す。管理読取は別の `GET /api/forms/:formId/booking-status/:claimId`（forms view・許可account・tenant境界、readonly可）。公開本人認証と管理権限を混ぜない。
- D1外（LINE通知・Calendar・R2）はbatchに参加できないため、上記intent＋後処理pending再実行で補償する。

## 二重送信/再試行・片成功/補償

- 同一内容同キーは同じ回答・予約を返す。異なる内容同キーは409。form複合scope＋hash方式を主とし、内容hashなしのbooking cacheを保証に使わない。
- 空きGETは成立保証しない。最終INSERTで受付期間・営業・メニュー・定員・資源・版を再確認。
- 回答完了・予約requested/confirmed・通知登録/配達を区別して返す。DB成立後の通知失敗で再予約を誘発しない。
- 試しフォームは副作用禁止（本物の席を消費しない試し状態）。

## 監査PII防止

- error・ログに秘密値・回答本文を出さない。再試行キーとIDのみ。

## テスト合格条件

- 容量1の同時2送信で成功セット1組・敗者409・孤立0。
- 容量2の同キー同時送信で1組・同内容replay一致・異内容409。
- guarded INSERT 0行・回答/link/資源SQL例外・成立直後切断の注入で原子性または永続回収。
- 公開版変更直後のretry・別tenant同キー・他人bookingId・試し回答・feature OFFで正しく閉じる。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_form_booking`（proposed）。既定off。tenant設定on＋DB候補546反映済みの環境でのみ受付。off/未反映時の編集・公開・提出は明確に閉じる。

## DB

- 必要。候補546（新規2表。既存表の変更なし）: `migration-drafts/546_form_booking_links.sql`（＋rollback）。
  - `form_booking_links`（回答↔予約対応づけ）。
  - `form_booking_claims`（予約用claim。版固定・snapshot・照会キーハッシュ。既存 `form_submit_claims` は流用しない）。
  - 通知intentは既存 `form_submit_outbox`（`kind='booking_notify'`）で足りるため新表なし。
