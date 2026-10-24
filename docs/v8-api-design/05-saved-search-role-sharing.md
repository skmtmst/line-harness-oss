# 05 保存した検索の共有を「役割で選ぶ」（saved search role sharing）

大学生向けひとこと: 保存した検索の共有を「全員か自分だけ」の2択から「役割で選ぶ」形にする設計です。今の共有はそのまま動きます。

## 目的

- 現行 `is_shared`（0/1）を壊さず、共有相手を役割で選べるようにする。
- technical role（owner/admin/staff）と画面のroleBundle 5種は別catalogとして扱い、Pencilの役割選択がどちらか未確定な点は設計差として固定する。

## Pencil実ID・画面呼出箇所

- Pencil: `IWnYX`・`AqDWN`（選択肢がtechnical roleかroleBundleか未確定→設計差として司令塔・Pencilへ返す）。
- 画面: 保存検索の一覧・詳細・preview・共有設定ダイアログ、互換saved-views、inboxの検索適用。

## 既存コード/SHAと行根拠（base `4639c6e`・監査05-06取込）

- 順序の維持: 会社→許可LINEアカウント→機能権限→検索ACL（`account-access.ts:16–25,121–177`、`friend-attributes.ts:198–224`。body/URLのaccount/role/creatorを認証代わりにしない）。
- 現行read: creator OR owner/admin OR is_shared。write: creator OR owner/admin。共有設定変更: owner/admin（`friend-attributes.ts:1257–1259,1325–1354,1414–1446`）。
- 役割enum未決定: DB technical roleはowner/admin/staff（`auth.ts:116`、migration `011:6`）。viewerはaccess_level read_only（migration `084`）。画面roleBundleはadministrator/operations/reception/view_only/custom（`staff-permissions.ts:15–29`、`staff.ts:72–86`）。
- ACL適用箇所（全て同じread ACLへ揃える）: `saved-searches.ts:387–408`、一覧二重JS判定 `friend-attributes.ts:1033–1040`、detail/preview `1101–1155`、互換saved-views `friends.ts:222–238`、条件適用 `friends.ts:423–450`、inbox `chats.ts:1420–1435`。
- 既存revision/history: migration `303`、`packages/db/src/saved-searches.ts`（DB699–769相当）。
- 検索条件allowlist: `conditions_json` の形状・演算子・列種validator＋bind＋account predicate（DB132–238、`insights.ts:22–51`、`friends.ts:427–450`）。

## 現在/提案の区別

- 現在: `is_shared` 0/1のみ。現行PATCHはexpectedRevision省略時に現版を使う（任意CAS）。
- 提案: 新 `saved_search_share_roles` 表で役割共有。`is_shared` と両立（移行であって置換ではない）。
  - `is_shared=0` → private、`is_shared=1` → all_allowed（許可account内のみ）。
  - `selected_roles` → `is_shared=1` への逆変換downgradeは閲覧者を増やすため不可。
  - 新契約は02に合わせて `expectedRevision` 必須。旧条件・共有・使用先を保持して409を返す。
  - 役割は `roleKind` を明示する（`technicalRole`: owner/admin/staff、`roleBundle`: administrator/operations/reception/view_only/custom）。混在指定は `400`。catalog確定まで当該共有の有効化はblocked。
  - technicalRoleとroleBundleの混在受付を同一catalogへ正規化しない（意味が失われるため）。server側の実roleBundle判定: staffの保持bundleを `staff.ts:72–86` の定義で解決し、共有rolesとの一致でread可否を決める（機能権限の事前判定を迂回しない）。
  - fallback防護: selected_roles付きデータをflag OFF環境・旧clientで読む場合は `is_shared=0`（private）として扱い、共有範囲を拡大しない。旧PATCH（`is_shared` のみ）はroles行が無い検索では従来どおり。roles存在中の共有変更は409 `ROLE_SHARING_REQUIRES_V8` で拒否し、private→allへの無言拡大やrolesの無言削除をしない。

## method/path/input/output/error JSON例（提案）

共有設定PATCH（owner/admin。creator・URL IDの会社境界照合あり）:

```json
{"mode": "roles", "roleKind": "roleBundle", "roles": ["operations", "reception"], "expectedRevision": 5}
```

- inputのmodeはprivate/all_allowed/roles。roles時のみroleKindと1件以上の重複なしrolesが必須（technical最大3/bundle最大5）。他modeのroles指定やunknown fieldは400。owner/adminの許可account内だけで適用。
- 成功: `200 { "success": true, "data": { "id": "ss-1", "mode": "roles", "roleKind": "roleBundle", "roles": ["operations", "reception"], "revision": 6 } }`
- 混在: `400 { "success": false, "code": "MIXED_ROLE_KIND", "error": "役割の種類をそろえてください" }`
- 競合: `409 { "success": false, "code": "VERSION_CONFLICT", "error": "ほかの人が先に保存しました。再読込してください", "data": { "currentRevision": 7 } }`
- URL IDと認証tenantの不一致は404秘匿（存在漏洩防止）。

## 共有PATCHのexact手順（`PATCH /api/saved-searches/:id/sharing`）

1. 親CAS（全modeで同じUPDATEで一旦is_shared=0・revisionを1増加）: `expectedRevision` で `saved_searches` を条件付き更新（0行→409）。
2. fresh receipt（親CAS直後のchanges()=1でのみ成立）: 候補547 `v8_edit_receipts`（`resource_kind='saved_search'`）へ今回op行を作成。
3. guarded roles置換: 同一batchで旧rolesをDELETEし新rolesをINSERTする（receipt guard付き。子UPDATEによる移動は禁止）。mode=all_allowedの場合は旧roles削除後に同receipt/成功revisionで親is_shared=1へ変更（版は再度増やさない）。private/rolesは0を保持し、historyは最終modeで作る。
4. history snapshot: 置換後のACL `{mode,roleKind,roles}`（置換前は前revisionの履歴を保持） を `saved_search_revisions.share_acl_json`（候補545で追加。過去行NULLはlegacy `is_shared` から解釈）へ、成功した親revisionにguard付きINSERTで保存する。
5. 旧PATCH（`is_shared` のみ）はroles存在時に共有変更を拒否する（triggerまたは同等のserver gate）。

## 権限表

| 操作 | readOnly | owner | admin | staff |
|---|---|---|---|---|
| 共有検索の読取・preview | 許可（共有範囲内＋機能権限あり） | 許可 | 許可 | 共有範囲＋機能権限で許可 |
| 自分の検索の編集 | 403 | 許可 | 許可 | creatorのみ許可 |
| 共有設定の変更 | 403 | 許可 | 許可 | 403 |

## 二重送信/再試行・片成功/補償

- 共有PATCH＋ACL更新＋historyを同一原子的変更へ（02のreceipt guardと同約束）。
- feature flagを閉じてprivateへ安全縮小するか、新ACLを継続して戻す手順を記載（rollback手順に含める）。
- 共有取消時の既存配信・自動処理の扱いは未確定→設計差として返す（無言で決めない）。

## 監査PII防止

- 検索条件の原文・顧客条件をerror・ログに出さない。共有相手の列挙は権限者のみ。

## テスト合格条件

- creator/owner/admin/shared内外のread/write/共有変更の分離。
- 新旧両catalogの役割解決・機能権限の迂回なし・全適用箇所のACL一致。
- 旧 `is_shared` データの互換読取（0→private、1→all_allowed）。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_saved_search_roles`（proposed）。既定off。tenant設定on＋DB候補545・共通編集receipt候補547反映済みでのみ役割共有受付。off時はlegacy is_shared挙動、roles付きはprivateへ縮小し旧clientの共有変更を拒否。

## DB

- 必要。候補545（共有ロール表＋履歴snapshot列。新規表と既存 `saved_search_revisions.share_acl_json`。`is_shared` 列は残す）: `migration-drafts/545_saved_search_roles.sql`（＋rollback）。
  - role値はkind別allowlistをCHECKで制約。同一検索のcatalog混在はtriggerで禁止。
  - roles挿入時は親 `is_shared=0` を要求（trigger）。roles存在中のlegacy `is_shared=1` 変更はtriggerで拒否（同等のserver gateでも可）。公開拡大を防ぐ。
