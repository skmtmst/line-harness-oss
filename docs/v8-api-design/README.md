# V8 API・DB 設計草稿 README（Muse担当・設計のみ）

大学生向けひとこと: V8で要る6つの仕組みの「設計図」です。プログラムは書かず、DBも触りません。

- base SHA: `4639c6e9615fbf22f7b2818e9937630aab668d1e`（branch `codex/kenta-v8-api-design`）
- 親リポジトリ変更なし。`packages/db/migrations` に配置なし（下書きは `migration-drafts/` のみ）。
- 本番・検証環境に触らない。D1 remote コマンド実行禁止（今回は未測定）。
- 依頼書の7項目目は scope外。今回は1〜6のみ。7（送信予約の強化）は追加依頼候補として本README末尾に1行だけ記す（設計・SQLなし）。

## 文書一覧（順番どおり）

| # | 文書 | 機能 | DB下書き |
|---|---|---|---|
| 1 | [01-readonly-operations.md](01-readonly-operations.md) | 閲覧のみ用「読むだけの口」 | 不要（明記） |
| 2 | [02-versioned-save.md](02-versioned-save.md) | 版つき保存（競合409） | 条件付き。版列ありresourceは不要。版列なし主要表は候補547（`lock_version` 付与） |
| 3 | [03-form-booking.md](03-form-booking.md) | フォーム内予約 | 候補546（回答↔予約対応づけ表。新規表のみ） |
| 4 | [04-company-branding.md](04-company-branding.md) | 会社名・ロゴ・ログイン前看板 | 候補544（tenantsに表示名・ロゴ参照列） |
| 5 | [05-saved-search-role-sharing.md](05-saved-search-role-sharing.md) | 保存検索の役割共有 | 候補545（共有ロール表＋履歴ACL列。`is_shared`互換維持） |
| 6 | [06-rich-menu-end-time.md](06-rich-menu-end-time.md) | リッチメニュー終了日時 | 不要（実装済み・重複追加禁止） |

## 確認済 / 提案 / blocked の整理

- 確認済（現行が既に持つ・壊さない）: readOnlyのGET以外403（`middleware/auth.ts:669`）、staff view権限のGET限定（同 `:688`）、`/api/auth/session` のreadOnly返却、公開版不変trigger（`390`）、フォーム回答冪等（`348`）、予約の容量最終guard（`services/booking-resource-capacity.ts`）、richmenuのperiod/ends_at・復元捕捉・一覧/取消（`routes/rich-menu-groups.ts:1488〜`）、`is_shared` 既存列（`303`）、tenants正本（`176`）。
- 提案（本草稿）: 読み取り専用allowlist方式、版つき保存の統一契約、フォーム↔予約の一体受付、会社resolver・tenant所有ロゴ、共有ロール表、終了日時の表示/LINE反映の区別表示。
- blocked（承認待ち・未確定）: migration候補544〜547の番号確定・適用、06の復元先の意味、05の役割catalog、04のSVG対応方式（本文に選択肢を記載）。3組のSOURCE監査は取込済み。runtime・Pencil視覚一致は未確認。

## 依存表

| 依存元 | 依存先 | 内容 |
|---|---|---|
| 01 | auth-guard/UI（Claude側所有もあり） | `readOnly` の画面保持と `requiresWrite` 付与は画面実装時に必要。本草稿はAPI側のみ |
| 02 | 各resourceの `updated_at`/版列 | 列がない主要4表は候補547で補う。bookings既存lock_versionとtenants候補544 revisionは重複追加しない |
| 03 | 02の冪等・409約束、容量guard | 03は02の約束をそのまま使う（独自方式を作らない） |
| 04 | media/R2・tenant-scope | ロゴはtenant所有媒体の参照に限定。SVGはPencil要件あり→安全検証＋隔離rasterize後PNG案、または未提供/設計差として明記（無言削除しない） |
| 05 | 02のrequestKey・URL会社境界 | 共有ロール表は `is_shared` と両立（移行であって置換ではない） |
| 06 | 実装済みschedule/cron/outbox | 新SQL・新jobを作らない。表示側だけ設計 |
| 全部 | feature機構 | 下記「旗の名前」ルールに従う |

## migration番号の根拠と手順

- 根拠: repo内の `migration-drafts/number-inventory-snapshot.json`（固定base `4639c6e`、base内490ファイル最大543、open PR 25本調査で最大543、未公開local高番なし。GitHub base `4639c6e` の source リンクで辿れる）。初期候補は544以降。本草稿は544（会社表示）/545（共有ロール）/546（回答予約対応）/547（版lock backfill）を割当て（候補であり確定ではない。promotion前に再確認）。
- 538は拒否済み（apply/reask禁止）。539〜543は未承認。
- D1 remote未反映件数は今回は未測定（オーナーが環境に触らないと指定）。最大番号から件数を推測しない。
- 件数測定と採番maxは独立工程。remoteの `migrations list`（今は実行禁止）の結果件数から番号を付け直さない。存在未確認のflag/API（例：未確認の `--json` 形式）は手順に書かない。promotion前の採番max確認は別工程で行う。
- 各候補の将来の承認文は各SQL下書きの頭コメントに「番号・列/表・既存データ影響・対象環境・バックアップ/戻し方」を具体記載。今回はテンプレートであり、ユーザーへ自動承認要求しない。
- promotion承認前に適用を既定の次taskにしない。今回は草稿PRまで（適用は承認後の別工程）。

## dry-runの手順（今回実行は隔離SQLiteだけ）

1. 番号544/545/546/547ごとに、以下を専用worktreeで行う。実DBファイルを開かず、メモリだけに既存bootstrapと選択した草稿を読み込む。schema/FK・既存行が変わる内容・所属/CAS/旧client境界をレビューし、SQL/根拠baseのSHAを記録する。構文成功はAPI動作成功ではない。

```sh
python3 - 544 <<'LOCAL_DRAFT'
import pathlib, sqlite3, sys
root = pathlib.Path('.')
number = sys.argv[1]
assert number in ('544', '545', '546', '547')
files = [p for p in (root/'docs/v8-api-design/migration-drafts').glob(number+'_*.sql')
         if not p.name.endswith('_rollback.sql')]
assert len(files) == 1
c = sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
c.executescript((root/'packages/db/bootstrap.sql').read_text())
c.executescript(files[0].read_text())
assert not c.execute('PRAGMA foreign_key_check').fetchall()
print(number, 'isolated schema check only; no D1 access')
LOCAL_DRAFT
```

2. 将来の番号ごとの承認・環境確認後、番号重複を再照合し、正式migrationへ移す別PRでbootstrap/markerを再生成する。544と545のAPI有効化は547の共通receiptも必要。SQL草稿の番号候補を環境へ当てる承認と取り違えない。
3. 環境の読取確認まで別途許可された後だけ、既存 `scripts/deploy/migrate.ts` のstatusとapply（**--applyなし**）で件数のdry-runを保存する。これらもremote SELECTに接続するため今回は実行しない。未反映件数・partial/unknown・DB名/config・対象HEAD一致を確認する。`apply --apply` は全pendingを処理するため、番号別承認の代用として使わない。538拒否・539〜543未承認を巻き込まない。

```sh
# 将来の読取確認用。今回は実行禁止。--applyは付けない。
pnpm exec tsx scripts/deploy/migrate.ts status staging
pnpm exec tsx scripts/deploy/migrate.ts apply staging
```

4. rollback草稿はflagを閉じてwriterを止め、処理中操作/outboxを回収し、旧writer互換・保持データを確認する**論理手順**。SQLは利用状況SELECTだけである。物理復元は別承認・保守時間・適用後書込み保全を確認したバックアップ復元であり、今回行わない。未反映0件までコード配備しない。

## 旗の名前ルール（feature flag）

- 既存機構: `FeatureId` カタログ（`routes/feature-settings.ts` の `FEATURE_IDS`）、tenant設定 `feature.<id>`（`featureIsEnabled`）、既定offは `DEFAULT_DISABLED_FEATURES` 登録、有効化ゲートはtenant設定＋route/job manifest参照。
- 本草稿の旗名はすべて提案（proposed）であり、既存FeatureIdではない。unknown flagを実効と呼ばない。各文書に「提案旗名 / 既定off / 有効化ゲート」を記す。
- 提案旗名: `v8_readonly_ops` / `v8_versioned_save` / `v8_form_booking` / `v8_company_branding` / `v8_saved_search_roles` / `v8_richmenu_endtime`（いずれも新規登録が必要。登録されるまでAPIは旧挙動）。

## 監査の取込状況（3stream全部・完了）

- 取込済み: `source-audit-01-02/summary.md`（31口分類・9 resource版対応・受入5件を01・02へ反映）、`source-audit-03-04/summary.md`（必須条件10＋7件を03・04へ反映）、`source-audit-05-06/summary.md`（境界・移行・06既存処理を05・06へ反映）。
- 取込済み（初稿review）: `draft-review01-02/summary.md`（独立指摘を設計へ反映。02全文復旧・handover前例除去・CSRF/registry/CSV allowlist・receipt誤再利用修正・README同期）、`source-audit-03-04/draft-review/summary.md`（03入力契約・04 upload/slug/flag OFF看板を具体化。SQLは本草稿で作成）、`source-audit-05-06/draft-review/summary.md`（roleKind排他・flag OFF縮小・`/schedule` 単数・retry 1/2/4/8・SET NULL保護を反映）。
- R新採番なし。03-04 auditor childのreview依頼はroot側で継続。
- 独立訂正の反映: 01は「GET＝無更新」と決め打ちしない（downloadの期限切れUPDATE＋auditLog、render-previewのINSERT OR IGNOREを区別）。06はSQL/job重複追加なし（DB不要の結論）。

## 7項目目（scope外・追加依頼候補・1行）

- 送信予約の強化（予約に送るものを持たせる・全会話の予約一覧・失敗理由と再送）は今回の対象外。追加依頼が来たら別途設計する。

## 状態（最新へ同期）

- 6文書＋SQL草稿4件（544/545/546/547＋論理rollback）は草稿。固定SHAによる最終reviewの結果はPR本文に記載。01/06はDB不要、02は条件付き、03/04/05は候補あり。
- blockedは残るが「summary待ち」ではない（3stream取込済み）。未確定は設計差として各文書に記載（06復元先の意味・05 catalog・04 SVG案選択）。
- release-logはPR番号採番後のroot依頼で作成（現時点では書かない）。適用は承認後の別工程であり、承認取得→適用を既定の次taskにしない。今回は草稿PRまで。

## 次のタスクはこれ

- 固定SHAでの設計・隔離SQL点検→設計用draft PR。実装・DB反映は別工程。
- 今の進捗を全体像から整理するとこれ: 6文書＋4草稿を用意。API/runtimeや実DBでの動作は未実装・未検証。
