# 01 閲覧のみ用「読むだけの口」（readonly operations）

大学生向けひとこと: 「見るだけの人」がCSV書き出しや人数の試算を使えるようにする設計です。POST全部開放はしません。

## 目的

- 閲覧のみ（`access_level='read_only'`）の人が「何も変えない」操作（CSV書き出し・人数試算など）を使えるようにする。
- 方法はGETか「変えないと分かる専用の口」。全POST許可は禁止。
- 既存downloadの開放に加え、新専用口2件を設計する（下記）。

## Pencil実ID・画面呼出箇所

- Pencil: `x6QsVz`（友だち一覧V8・閲覧のみ）、`FK5m7/HaFC8`（行の押せない形）、帯 `ThDed`、ふきだし `f6zwfs`。
- 画面: 全画面の帯＋`requiresWrite` ボタン（viewer-readonly.mdの方式）。本草稿はAPI側のみ。UI所有はClaude側と共有のため画面実装は始めない。

## 既存コード/SHAと行根拠（base `4639c6e`）

- `apps/worker/src/middleware/auth.ts:24` — `SAFE_METHODS = GET/HEAD/OPTIONS`。
- `apps/worker/src/middleware/auth.ts:669` — readOnlyの非SAFE_METHODは403（ownerでも同じ。現在）。
- `apps/worker/src/middleware/auth.ts:688` — staffのview権限キーはSAFE_METHODS限定（現在）。
- `apps/web/src/components/auth-guard.tsx:135-144` — `role`・`permissionKeys`・`viewPermissionKeys` を保存するが `readOnly` を保存しない（現在の穴）。
- `routes/broadcasts.ts:992` — `GET /api/broadcasts/:id/preview-count`（人数試算の既存GET。送信と同じ境界で数える。N-060の漏洩防止あり）。
- `routes/account-handovers.ts:200` — `POST /api/account-handovers/:id/preview` は `savePreview`（同 `:254`）で永続化するため非更新allowlistの前例にしない（監査01-02分類 `WRITES_PREVIEW_STATE`）。非更新の前例として使うのは stateless token型（`POST /api/tags/:id/retroactive-preview`。hash＋expiryで永続化しない）に限る。
- `middleware/rate-limit.ts` — 429の既存機構（`check`＋`retryAfter`）。
- `routes/common-var-exports.ts:242` — `GET /api/common-vars/exports/:id/download`（期限切れでjob行をexpiredへUPDATE＋成否いずれもauditLog）。

## 門の定義（exact。共通authの両ゲートより前でregistry参照）

- 共通authが非GETを403してからhandlerへ進むため、handler内のallowlistではreadOnlyのPOSTに到達しない。サーバー登録の信頼済みroute metadataを両ゲートより前で参照する。
  - metadataはコード登録のみ（clientヘッダ不可）。`{ method, path, readonly: true, kind, requiredViewKey }` をroute定義時に静的登録。重複登録はfail-closed。照合はexact method＋anchored path match。
  - readOnlyは全roleと直交（ownerでもreadOnlyなら同じ扱い。画面はroleではなくreadOnlyで決める）。
  - GETだからといって本人権限・tenant・feature・account境界を省略しない。
- readonly門: `allow = SAFE_METHODS || (flagOn && registeredReadonly)`。flag OFF時は現行どおり（SAFEのみ）。
- 権限門: `role ∈ {owner, admin} || editKey || ((SAFE_METHODS || (flagOn && registeredReadonly)) && viewKey)`。routeのowner/admin制限を残す口と新view口を分ける。readOnlyのowner（viewキー空）もroleで通す。非readOnlyのviewスタッフもviewキーで専用口を通す。
- `requiredViewKey` の実値mapping（先頭slash必須）: `GET /api/readonly/friends-export`→`/friends`、`POST /api/readonly/segment-preview`→`/broadcasts`、既存 `GET /api/broadcasts/:id/preview-count`→`/broadcasts`、既存CSV download系→各現行キー。mapping外の口は通さない。
- cookie CSRF（`auth.ts:698-706`）のSAFE分類は不変。readOnlyのPOSTにも維持する。
- 代理ログインのeffectiveReadOnlyは `actor.readOnly || target.readOnly || impersonation.mode === 'read'`（fail-closed）に決定する。既存bearerの範囲は広げない。UIの表示role（`staff/me` のviewer写し）は認可正本にしない。

## 実処理ベースの区別（GET＝無更新と決め打ちしない）

| 口 | method | 実処理の副作用 | 扱い |
|---|---|---|---|
| `GET /api/common-vars/exports/:id/download` | GET | 期限切れ時にjob行をexpiredへUPDATE、成功/失敗/拒否いずれも `auditLog` | 業務データは変えない。readOnly許可可（metadata登録） |
| `POST /api/chats/:id/render-preview` | POST | `routes/chats.ts:385–390` の `INSERT OR IGNORE`＋ `:2096` の解決呼び出しで行作成の可能性 | 読むだけ扱いで開放しない。chat行作成なしの読取専用解決への切替が条件。それまでは403＋画面は押せない形 |
| CSV系の既存POST（job作成型） | POST | job行を書き込む | 開放しない |

- 「副作用なし」とは言わない。再試行にもaudit副作用があるため、正しくは「業務状態不変」（業務表の行数・内容が変わらない。auditLogと期限切れの状態遷移は許容）。
- middleware C（chat系）を通す前にchat行作成は禁止。render-previewの読取専用化は `resolveOrCreateChat` を呼ばない解決（存在しなければ404）に切替えることを確定条件とする。

## 新専用口の具体設計（提案）

### A. CSV書き出し（job作成なし・streaming）

- `GET /api/readonly/friends-export?lineAccountId=<id>&format=csv&tagId=<任意>`（提案）
- fields（query allowlist）: `lineAccountId`（必須）、`format=csv`（固定）、`tagId`/`keyword`（任意。顧客条件はID参照のみ。長い条件式は受けない）。
- 200 response: `200 text/csv; charset=utf-8`（BOM付。`content-disposition: attachment`、`cache-control: private, no-store`）。job行を作らず、1回のResponseとして流す（streamingまたは一括生成。業務表への書込みなし）。
- 制限: 上限行数（10,000行。超過は `400 { code: 'TOO_MANY_ROWS' }`＋絞り込み案内）、1人あたり頻度制限（429＋`Retry-After`）。
- 権限: tenant一致＋account境界（`canAccessAllLineAccounts`）＋friendsのview権限。readOnly許可（metadata登録 `kind: 'export-stream'`）。
- error: `400`（条件不正・上限超過）、`403`（権限なし・readOnly対象外の間は403）、`404`（account不存在は存在秘匿のため404）、`429`（頻度超過）、`503`（生成失敗・再試行可）。

### B. 人数試算（顧客条件が長い場合はPOST）

- 短い条件は既存 `GET /api/broadcasts/:id/preview-count` をreadOnlyに開放（metadata登録。送信と同じ境界で数える現行ロジックを流用）。
- 長い顧客条件（GET queryに入らない場合）は新設 `POST /api/readonly/segment-preview`（提案）。
  - input: `{ "lineAccountId": "<id>", "condition": { "operator": "AND", "rules": [], "groups": [] } }`（rulesはallowlist化した検索条件のみ。検索条件allowlistは05と共有）。
  - output: `200 { "success": true, "data": { "count": 123, "accountId": "<id>" } }`（人数のみ。個人の一覧は返さない）。
  - 業務表への書込みなし（SELECT COUNTのみ）。auditLogは記録する（「業務状態不変」の範囲）。
  - error: `400`（条件不正）、`403`（権限なし）、`429`（頻度超過）、`503`（集計失敗・再試行可）。
  - 権限: tenant一致＋account境界＋segment/broadcastのview権限。readOnly許可（metadata登録 `kind: 'preview-count'`）。

## 維持する既存guard

- role/secret GET guard（`role-guard.ts:65` の `denyReadOnly`）とplatform専用認可は維持する。
- 参照順序: registry照合→readOnly門（`auth.ts:669`）→staff権限門（`:675-693`＋`role-guard.ts:40-43`）→route guard。owner/admin限定routeを閲覧staffへ自動拡張しない。

## CSV・試算payloadのallowlist（具体）

- 試算DTOは `SavedSegmentCondition`（`packages/shared/src/types.ts:658`。`operator: AND|OR`、`rules[]`、`groups?`）の型を使う。新route validatorでtype/value・構造・深さ・件数を検査した後、`buildPublicSegmentQuery`（`packages/db/src/segment-conditions.ts:666`）へ渡す（builder自体をDTO全体validatorと見なさない）。提案の上限: rules 20件・groups深さ3・空ORは無指定扱いで400。
- CSV schema `v8-friends-v1` の固定列は `friendId,displayName,createdAt`。本人が通常の友だち詳細で読める行・項目だけを出す。追加列・電話・メール・metadata・秘密値・個人メモはこの版では出さない。項目非表示の権限があればdisplayNameは空欄（列は保持）、未設定値も空欄。`X-CSV-Schema: v8-friends-v1` と `X-CSV-Masking: omit-unreadable-values` を付ける。CSV本文にマスク説明用の擬似データ行を混ぜない。
- 試算wireの正本は `condition`。unknown top-level key・unknown rule type・不正value・深さ3超・総rules20超・JSON本文32KiB超を400。各ruleのtype/valueは既存 `SavedSegmentRule` enumと既存条件validatorの各rule検査を再利用し、routeの構造validatorを加え、任意SQL/column名は受けない。空ANDは許可account全員、空ORは400。count以外の友だち情報は返さない。keywordは200文字以内、query原文はaccess/errorログに出さずredaction対象とする。
- formula injection: 先頭が `=`/`+`/`-`/`@` のセルは `'` を前置して無害化する。
- stream mid-fail: 事前COUNTで上限超過はheaders確定前に400。送信途中のDB失敗は接続断として扱い、clientは再試行する（途中までの受信分を正規としない）。

## 権限表

| 操作 | readOnly | owner（非readOnly） | admin | staff（権限あり） |
|---|---|---|---|---|
| GET/HEAD/OPTIONS（境界付き） | 許可 | 許可 | 許可 | view以上で許可 |
| metadata登録のA/B口 | 許可 | 許可 | 許可 | view以上で許可 |
| 未登録のPOST/PUT/PATCH/DELETE | 403 | 許可 | 許可 | edit系キーで許可 |

## 二重送信/再試行・片成功/補償

- 読取系のため業務上の片成功はない。再試行はそのまま再送してよい（auditが増えるだけで業務状態は不変）。

## 監査PII防止

- auditLog・errorに顧客本文・秘密値・クエリ原文を入れない（ID・結果・件数のみ）。試算条件の原文はログに出さない。

## テスト合格条件

- readOnlyのownerでmetadata登録口が通り、未登録POSTが403。
- A/B口の前後で業務表の行数・内容が不変（auditLogの増加は許容）。
- 他tenant・他accountの人数・存在が応答に漏れない（404秘匿）。
- 429時に `Retry-After` が返る。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_readonly_ops`（proposed・既存FeatureIdではない）。既定off（`DEFAULT_DISABLED_FEATURES` への新規登録が必要）。
- 有効化ゲート: tenant設定 `feature.v8_readonly_ops` がonのときだけmetadata登録口をreadOnlyに開放。off時は現行どおり（GETのみ）。
- unknown flagを実効と呼ばない。登録前の動作は旧挙動。

## DB

- 不要（本機能にDB変更なし。`migration-drafts/` に01用のSQLは作らない）。
