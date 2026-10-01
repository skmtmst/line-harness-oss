# 02 版つき保存（競合409・versioned save）

大学生向けひとこと: 保存するとき「読んだときの版番号」を一緒に送り、誰かが先に保存していたら上書きせず教えてくれる仕組みです。時刻だけの判定はしません。

## 目的

- 主要resourceの作成・編集すべてに「読み込んだ版」を付け、先勝ちの保存があれば `409`＋相手の情報・差分を返す。
- 既存のdraft/公開版/version/idempotencyの約束を壊さない。既存version列のある表を一律ALTER・同義置換しない。

## Pencil実ID・画面呼出箇所

- Pencil: 各「（競合）」の板。
- 画面: 主要機能の作成・編集画面の保存ボタン。競合ダイアログ（相手の名前・時刻・差分・再読込ボタン。再読込は入力を捨てる前に選択させる。自動上書きmergeはしない）。

## 版対応表（現行の整数版・監査01-02取込。`updated_at` だけのCASは不可）

同じ時刻の連続保存で取りこぼすため、`updated_at` の一致比較はwinner判定に使わない。整数版列を使う。

| resource/表 | 編集CASの現行版列 | API入力の読取版 | 冪等台帳 |
|---|---|---|---|
| forms | `content_revision` / `expectedContentRevision`（`revision` は削除影響・訪問回答用で別） | `expectedContentRevision` | 管理編集の要求receiptは現行なし（`form_submit_claims` は公開回答submit台帳であり流用不可）。547の `v8_edit_receipts` を使う |
| common_vars＋versions | `version` / `expectedVersion`（routeは影響proofも照合） | `expectedVersion` | 履歴UNIQUE `403:20` |
| tags＋action子/requests | `version` / `expectedVersion`（必須） | `expectedVersion` | 編集は `tag_update_requests`（541）。作成系列とは分離する |
| notification_rules | content version / `expectedVersion`（任意。`isActive` だけは版を上げない） | `expectedVersion` | なし |
| friend_add_rules＋versions | `lock_version` / `expectedVersion`（任意。`version_number` は公開/下書き番号で別） | `expectedVersion` | 308系列 |
| hq_templates | `revision` / `expectedRevision`（必須） | `expectedRevision` | なし |
| staff_members | `policy_version` / `expectedPolicyVersion`（任意） | `expectedPolicyVersion` | permission receipts別 |
| booking settings/menu/resources | `version` / `expectedVersion`（helperにoptionalあり。初回作成はexpected 0） | `expectedVersion` | booking-idempotency |
| templates＋versions | `draft_revision` と `published_version`（保存と公開の両比較値） | 両方 | なし |
| support_marks / friend_fields(+values) / saved_searches / broadcasts / users | `version` / `revision` / `lock_version`（258/259/300〜305） | 各expected | 536/537/540/541系列 |

根拠: 監査01-02 `cas-current-contracts.json`、migration `258/259/274/300/301/302/303/305/308/348/390/403/536/537/540〜543`（base `4639c6e`）。

## 整数版がない主要機能（実装へ進める設計＋DDL案）

整数版CAS列を確認できなかった主要表の扱い（対象外にしない）:

- 候補547で `lock_version` を付ける: `rich_menu_groups`、`event_bookings`、`scenarios`、`auto_replies`（各表の既存意味は変えない。新規列・既定値backfill・既存データ変更なし）。
- `bookings` は現行 `lock_version` あり（298で `bookings_next` に付与後RENAME）のため重複追加しない。
- `auto_reply_versions.version_number` は公開版番号（別意味）のため置換しない。補充のみ。
- `tenants` は544の `revision` が版正本のため547では触らない（二重正本にしない）。
- DDL案: `migration-drafts/547_version_lock_backfill.sql`（＋rollback。`v8_edit_receipts` を含む）。
- `scenarios`/`auto_replies` の公開版ID参照（`current_published_version_id` 等）は内容版と別定義のまま残す。

## method/path（既存methodをresourceごとに保つ）

- `Idempotency-Key` はHTTPヘッダのみ（body fieldではない）。既存のPUT/PATCH/POST区分は変えない。
- 更新は読取版を付ける（列名は表の現行に合わせる。tagsは `expectedVersion`、formsは `expectedContentRevision`、hq_templatesは `expectedRevision`）。
- PATCHの未指定とnullは区別する（未指定＝保持、明示null＝消去。監査01-02受入1）。

PATCHの例（tags。methodと版名はresourceの現行どおり）:

```json
{"name": "新名称", "expectedVersion": 7}
```

成功（版・時刻・更新者は成功更新からserver生成。client名・時刻でwinner判定しない）:

```json
{"success": true, "data": {"id": "tag-1", "version": 8, "updatedAt": "2026-10-01T12:00:00+09:00", "updatedBy": "st-9"}}
```

競合（現行形式を保ちつつ新envelopeへ。`lib/api.ts:2776-2786,2877-2882` の正規化と両対応）:

```json
{"success": false, "code": "VERSION_CONFLICT", "error": "ほかの人が先に保存しました。再読込してください", "data": {"currentVersion": 9, "updatedAt": "2026-10-01T12:01:00+09:00", "updatedByName": "山田", "diff": {"name": {"yours": "新名称", "current": "別名称"}}}}
```

## 409 redaction（監査01-02取込）

- 現行: formsは `data.contentRevision/updatedAt` のみ、commonvarsは最上位 `currentVersion` のみ。名前・全文差分は現実装なし。
- 新envelopeのdiffは明示allowlistのfieldのみ（例 `name`）。秘密値・鍵・token・webhook header・顧客回答・宛先・内部SQLはchanged indicator（変わったかどうかの真偽のみ）か省略。
- 競合相手名は同会社＋本人に表示権限がある場合のみ。それ以外は `updatedByName: null`。scope外・削除済みは404等の現契約を保持。
- 最新内容の読み返しをscope確認前に返さない。書込権限喪失・別account移動は再読込時に再評価する。

## guard（具体的成立証拠。bare EXISTSは使わない）

- 同じUPDATE WHEREにid・tenant・account・非削除・読取版を含め、0行なら成功なし。先読み比較だけでは同時更新を防げない。
- CASの直後に `changes() = 1` を確認できた場合だけoperation receipt行を作る。receiptは今回唯一のopID・hash・version・tenant・account・actor・resource・method・ヘッダIdempotency-Keyを持ち、同scope再送のreplay応答を保存する（候補547 `v8_edit_receipts`。versionは整数・非負CHECK、opIDはNULL禁止）。
- 全後続（子表・history・監査・outbox）のINSERT/UPDATEはreceipt存在を条件にする。単なる `EXISTS(resource id)` はCAS失敗時も真になるためguard不足であり使わない。
- 親CAS＋子表＋history＋idempotency receiptを同一の成功に結び付ける。D1 batch中の0行UPDATEはSQLエラーではないため、後から409を返すだけでは他SQL取消の証明にならない。成立条件不足は実SQLエラー（制約・trigger）でbatch全体をrollbackするか、永続operation状態＋補償で回収する。
- 同一key・同一payloadの再送は同じ成功を返し、同key・異payload・古いeditorの新要求は別契約（409）。操作用keyや実行時生成値を編集版へ置換しない。
- guardの明示条件:
  - readOnly flag: receipt作成・子writeはwrite系のためreadOnlyでは到達しない（auth門で403）。409の再読込GETはreadOnly可。
  - generic bearer（SDK/MCP）tenant: receiptのtenant・accountはserver解決値のみ。bearer指定のtenant切替は受付けない。
  - shared conflict payload: 共有resourceの競合payloadは共有範囲＋機能権限の再評価後に返す。範囲外の相手内容を含めない。

## 要求キーと今回の実行ID（決定）

- request identityは `(tenant, actor, accountScope, resourceKind, resourceId, method, concretePath, Idempotency-Key)`。pathはIDを含む正規化済み実path、queryなし。route templateを保存しない。accountScopeはNULL=`none:`、実ID=`account:`＋ID。
- ヘッダkeyは1〜128文字ASCII、同操作の再試行中は固定。payload hashは検証・既定値反映後の正規化JSON（キー順固定、未指定/nullを区別、expected版を含む）のSHA256。同じscopeを認可後に検索し、同hash・完成responseありならbatch前に200 replay、異hashは409 `IDEMPOTENCY_CONFLICT`。未知keyだけ新しい実行へ進む。
- `op_id` はサーバーが今回生成するfresh UUID。ヘッダkeyと別物で、過去receiptを今回のSQL guardに流用しない。並行同keyのUNIQUE衝突はbatch SQLエラーで取消し、認可済みの確定receiptを読み直してreplay/409へ。
- 新規作成はexpected版0＋存在しない安定IDを条件にINSERT、作成後版1（現行resourceの版初期値に合わせる場合は対応表で明示）。作成IDはサーバーでUUIDv5の固定namespaceとrequest identityのcollection path/keyから決定し、同key再試行で別IDを発行しない。既存専用作成台帳があるresourceはその安定IDを優先。INSERT衝突を更新へ変換しない。既存行を編集する版0とはmethod/pathで区別する。

### 具体SQLの順序例（rich-menu group＋page名。提案で未実装）

以下の4文をこの順番で1つのD1 batchへbindする。`:...` は説明用named bind、実装ではprepare/bindの位置引数へ変換する。`:account`/`:tenant`/`:actor`は認証済みサーバー値。`:op`はfresh ID、`:expected`は今回の読取版。

```sql
UPDATE rich_menu_groups
SET name = :name, lock_version = lock_version + 1, updated_at = :serverTime
WHERE id = :resourceId AND account_id = :account AND lock_version = :expected
  AND EXISTS (SELECT 1 FROM line_accounts
              WHERE id = :account AND tenant_id = :tenant);

INSERT INTO v8_edit_receipts
(op_id, resource_kind, resource_id, tenant_id, line_account_id,
 method, path, idempotency_key, version, request_hash, actor_id, created_at)
SELECT :op, 'richMenuGroup', :resourceId, :tenant, :account,
       'PATCH', :concretePath, :headerKey, :expected + 1, :hash, :actor, :serverTime
WHERE changes() = 1;

UPDATE rich_menu_pages SET name = :pageName, updated_at = :serverTime
WHERE id = :pageId AND group_id = :resourceId
  AND EXISTS (SELECT 1 FROM v8_edit_receipts
              WHERE op_id = :op AND request_hash = :hash
                AND tenant_id = :tenant AND line_account_id = :account
                AND resource_kind = 'richMenuGroup' AND resource_id = :resourceId
                AND version = :expected + 1 AND actor_id = :actor);

UPDATE v8_edit_receipts
SET replay_response_json = (
  SELECT :successJson WHERE EXISTS (
    SELECT 1 FROM rich_menu_pages
    WHERE id = :pageId AND group_id = :resourceId
      AND name = :pageName AND updated_at = :serverTime))
WHERE op_id = :op AND request_hash = :hash AND tenant_id = :tenant
  AND line_account_id = :account AND resource_id = :resourceId
  AND resource_kind = 'richMenuGroup' AND version = :expected + 1 AND actor_id = :actor;
```

- 親CAS0なら今回receipt0・child0。既存receiptがあっても今回op不一致で副作用0、HTTP409へ。CAS成功後child条件不成立は最後のscalar=NULL→receiptのNOT NULL違反でbatch全取消。childの削除/全置換やhistory/outboxも同じfresh guardと完了条件が必要。この4文は全resourceの完成実装を意味しない。
- D1のSQL例外によるbatch取消と、成功扱いの0行更新は別。[公式batch契約](https://developers.cloudflare.com/d1/worker-api/d1-database/)を前提に、resourceごとの必須子行・history/outbox成立条件を実装時に検査する。外部LINE等の通知はDB内intent作成後に別処理とする。

## 更新者と時刻の正本（9resource）

| resource | 現行の編集actor / server時刻 | 新契約での正本 |
|---|---|---|
| forms | actorなし / updated_at | content_revision一致の成功receipt |
| common_vars | updated_by / updated_at | version一致の成功receipt、旧版は現行actor列 |
| tags | updated_by / updated_at | version一致の成功receipt、旧版は現行actor列 |
| notification_rules | actorなし / updated_at | content version一致の成功receipt |
| friend_add_rules | actorなし / updated_at | lock_version一致の成功receipt |
| hq_templates | actorなし / updated_at | revision一致の成功receipt |
| staff_members | 編集actorなし / updated_at | policy_version一致の成功receipt（permission receiptのstaff_idは対象であり変更者ではない） |
| booking settings / menus / resources | settings/menu/resource actorなし、bookingsはupdated_by_staff_id / updated_at | 対応versionの成功receipt。実menu表名はmenus |
| templates | draft編集actorなし / updated_at | draft_revisionと公開版の組に対応する成功receipt |

```sql
SELECT actor_id, created_at FROM v8_edit_receipts
WHERE tenant_id = :tenant AND account_scope = :accountScope
  AND resource_kind = :kind AND resource_id = :id AND version = :currentVersion
  AND replay_response_json != '{"state":"pending"}';
```

- 名称解決は同会社・表示権限付き。actor/timeはこの版を成功させたreceiptだけから返す。resourceの許可field差分のみ返し、相手の全本文は返さない。
- 旧版・feature OFF・未移行writerや手動更新の可能性があるresourceではreceiptを現在のwinnerと認定しない。`updatedByName=null`、確認できる行のserver updated_atだけ（なければnull）。creator/published/test/decided actorを編集者へ流用しない。全writerが新CASを通ることが有効化ゲート。

## 権限表

| 操作 | readOnly | owner | admin | staff |
|---|---|---|---|---|
| 版つき読取（GET） | 許可 | 許可 | 許可 | view以上で許可 |
| 版つき保存（PUT/PATCH＋読取版） | 403 | 許可 | 許可 | edit系キーで許可 |
| 競合情報の閲覧（409） | 許可（読取と同等） | 許可 | 許可 | view以上で許可 |

## 二重送信/再試行・片成功/補償

- 同一内容の同キー再送は既存行を返す。異内容の同キーは409（既存536系列と同一）。
- CASが0件なら副作用ゼロ（後続writeをguardするため、子・通知が「だけ」作られない）。
- batch commit後のJS throwではDBは戻らない。逐次SQLの0行をrollback扱いにしない。

## 監査PII防止

- 409・ログに秘密値・顧客本文・クエリを出さない。氏名は閲覧権限ありのみ。

## テスト合格条件

- 先勝ち保存後の後勝ちPUT/PATCHが409＋相手名・時刻・差分（秘密値なし）。
- CAS 0件時に関連表の行数が増えない（子・receipt・outboxの孤立0）。
- 同一キー再送で同じ行を返し、異内容同キーで409。
- 旧409形式（forms・commonvars）と新envelopeの両対応が `lib/api.ts` 正規化で通る。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_versioned_save`（proposed・既存FeatureIdではない）。既定off。
- 有効化ゲート: tenant設定 `feature.v8_versioned_save` がonのresourceだけ新契約を要求。offのresourceは現行挙動。

## DB

- 条件付きで必要。版列ありresourceは不要。版列なし主要表（rich_menu_groups・event_bookings・scenarios・auto_replies）は候補547で `lock_version` を付ける: `migration-drafts/547_version_lock_backfill.sql`（＋rollback）。bookingsは現行ありのため除外。tenantsは544のrevisionが正本のため除外。
