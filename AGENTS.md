# Project Instructions

## 基本

- 親リポジトリ `nen-petfood-eccube` は参照だけ許可する。明示依頼がない限り変更せず、変更が必要なら報告して指示を待つ。
- ゴール外の提案は避け、ゴールへ進む次の行動を示す。回答には必ず「次のタスクはこれ」「今の進捗を全体像から整理するとこれ」を含め、大学生にも分かる言葉で短く説明する。
- クラウド作業前は `bash scripts/codex/doctor.sh`、NodeTerm の `~/lh-work` では `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` を実行する。最終行が「合格」なら着手し、「要確認」なら理由を報告して止める。手元では Cloudflare 検査を省き、lane作業に不要な `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` は未設定でよい（2026-09-06、台帳 #216）。
- LINE Harness Proxy から担当者として1対1返信するときは `X-Line-Harness-Source: manual` を付ける。予約通知など自動送信には付けない。
- Google Meetの個別相談を確定・変更したら、Calendar更新に加えて `POST /api/meet-consultations` へGoogle Calendar event ID・LINE friend ID・日時・Meet URLを登録し、前日・1時間前のLINEリマインドを設定する。キャンセル時は `DELETE /api/meet-consultations/:externalEventId` も実行する。

## 読む文書

- プロジェクト文書の一律必読はこのファイルだけ。ほかは作業内容に関係する箇所を `rg` で探して読む。
- 現在の事実・判断基準: `docs/brain/Memory.md`
- 過去の修正指示・再発防止: `docs/brain/rules/corrections.md`、`docs/brain/rules/mistakes.md`
- V6担当指示・並列計画: `docs/v6-directives.md`、`docs/v6-parallel-plan.md`
- 利用者から訂正・要望を受けたら `corrections.md` に日付・指摘・今後の3行を追記する。同じ失敗を2回指摘されたら `mistakes.md` にも追記する。`Memory.md` の「進行中」が実態と違えば直す。

## SlackとCodex

- 正本はGitHub Issue・仕様書・PR。Slackは状況と会話の共有場所。
- Slackでは本文の実 `@Codex` メンションだけを依頼と扱う。`#line-harness-アイデア` でメンションがない会話から仕様・コードを変更しない。
- `@Codex このスレッドを正本化して`: 目的・決定・未決定・影響範囲・受け入れ条件をIssueか仕様書へ反映し、URLを元スレッドへ返す。
- 実装へ進むのは `@Codex 正本化して実装へ進めて` まで明記された場合だけ。承認ゲートは省略しない。
- PR・エラー・アイデアは1件1親メッセージとし、経過は同じスレッドへ返す。指令塔には判断待ち・競合・完了だけを流す。
- `#line-harness-要対応` は未完了だけを `作業中` / `確認待ち` / `完了` で管理し、完了時は一覧から消して元スレッドへ履歴を残す。
- 新しいCodexタスクの先頭に同じ `TASK-ID` があれば元タスクとSlackスレッドを引き継ぐ。同じPR番号・専用ブランチも同一タスクと扱う。
- 未処理エラーは `#line-harness-エラー報告` と `#line-harness-要対応` へ報告する。顧客本文、URLクエリ、個人情報、秘密値、トークン、パスワードはSlackへ載せない。
- Slack依頼の完了報告は `docs/slack-report-to-claude.md` の項目だけを書く。実装説明・変更ファイル・テスト内容は書かない。

## 機能追加の標準フロー

結果だけを依頼された通常の機能追加は開発・検証環境を対象とし、本番を除外する。追加指示を待たず次を進める。

1. 親・LINE両作業ツリーを確認する。
2. 最新 `codex/development` から `codex/担当者名-作業内容` ブランチを作り実装する。
3. テスト・型検査・ビルド・差分検査後、内容別にコミットする。
4. pushして `codex/development` 宛てPRを作る。競合、必須チェック失敗、秘密情報、意図しない設定変更がなければ既定の統合手順へ進み、ローカルも同期する。
5. 必要な場合だけ、クリーン確認、backup、dry-run、DB更新、コード配備、反映確認を順に行う。

所有者不明の変更、重大な仕様選択、テスト失敗、競合、秘密情報、環境不一致では停止して必要な判断を報告する。明示承認が必要なDB・環境変更は承認段階だけ止め、それ以前の安全な工程は進める。文書だけならDB更新・配備は行わない。本番統合・配備は含めない。`GitHub PR Slack Sync` は参考チェックで、失敗はActionsの警告として残して再照合するが、PR統合は止めない。

## ファイル所有

| 担当 | 所有領域 |
| --- | --- |
| Claude | `docs/v6-requirements/`、`scripts/visual-qa/`、`docs/design-qa/`、`docs/design-reference/`、`apps/web/src/components/shared/`、Pencil |
| Codex | `apps/worker/src/routes/`、`apps/worker/src/services/`、`packages/db/`、`.github/`、`apps/web/src/lib/api.ts` の分割 |

相手の領域を変える前にSlackの対象スレッドで宣言する。

## 同時更新防止

- `codex/development` へ直接commit・pushせず、専用ブランチのPRだけで更新する。履歴改変・force pushは禁止。
- テスト直前に最新 `origin/codex/development` を専用ブランチへ取り込み、そのSHAを記録する。
- PRマージ直前とマージ操作直前にbase SHAを再取得する。変化していれば取り込み、影響するテスト・型検査・ビルド・差分検査をやり直してpushする。
- PRが `CLEAN` / `MERGEABLE`、必須チェックに失敗・保留なし、意図しない差分なしを確認する。同じ箇所の別PR、未解決競合、同時統合があれば止めて順番を調整する。
- マージ後は最新 `codex/development` を同期し、クリーン状態と必要なsmoke testを確認してからDB更新・配備へ進む。

## DBマイグレーション

- 名前は `<番号>_<内容>.sql`。`999` までは3桁ゼロ埋め、`1000` 以降はそのまま使い、番号は数値比較する。
- 作成前とpush直前に、最新baseと公開PRの `packages/db/migrations/` を調べ、未使用の最大番号+1を選ぶ。
- 重複時はpushせず、未共有・未適用の自分のファイルだけを改番する。共有・適用済みファイルは改名・変更しない。
- SQLiteの表再作成には `-- migration-policy: table-rebuild` を書き、一時表を `<表名>_new` または `<表名>_next` とする。印のない `DROP TABLE` / `RENAME TO` は禁止。

## 作業ツリー

- 開始前、commit直前・直後、DB更新直前、配備直前、完了時に `git status --short --branch` を確認する。「次のタスク」だけの指示でも省略しない。親EC内なら親とLINEを別々に確認する。
- 開始時に既存変更・未追跡ファイルがあれば、所有者と用途が分かるまで変更・削除・commitしない。ユーザーの変更を戻さない。
- 生成・テスト・build・dry-run後も再確認し、必要な成果物はcommit、ローカル専用物は内容確認後に `.gitignore` へ追加する。削除や `git stash` で見かけだけ整えない。
- DB更新と配備は別工程。各直前にツリーが完全にクリーンで、HEADがGitHub対象ブランチと一致することを確認する。変更が1件でもあれば実行しない。
- 完了時に変更が残れば、残ったpath・理由・対応案・DB更新/配備の実施有無を報告し、完了扱いにしない。

## 反映履歴

- PRごとに `docs/release-log/unreleased/<PR番号>-<担当>-<内容>.md` を1つ作る。PR前は番号なしの仮名でよく、採番後にファイル名と本文へ番号を足してpushする。`docs/release-log/unreleased.md` には追記しない。
- 見出しは `## 追加` / `## 変更` / `## 修正` のどれか。行は `- 内容 @担当 #PR番号 YYYY-MM-DD HH:MM`（各要素は省略可、日時は日本時間、担当は `kenta` / `masato` など）。管理画面の更新履歴へそのまま出るため、運用者向けの言葉を使い、テーブル名・関数名・ファイル名は書かない。
- 詳細は `docs/release-log/README.md` と `docs/change-log-design.md`。リリース時はREADMEの手順でPR別ファイルを版別履歴へまとめる。

## V6管理画面

- 正本順位は Pencil **★V6 260画面** → `docs/v6-common-rules.md` → `apps/web/src/components/shared/` → 契約テスト。V5は2026-08-26に廃止。判断は `docs/v6-requirements/v6-canonical-design-decision.md` に従う。
- 実装前に `docs/v6-common-rules.md`、`docs/v6-requirements/v6-requirements-master-index.md` が指す該当要件、`v6-implementation-roadmap.md` を読む。要件と実装が違えば要件を先に直す。
- 開始・完了には Pencil MCPの実Node ID、全対象状態、1920px設計画像、同じ状態・幅の実装画像が必要。仮名はNode IDの代わりにならない。`data-design`、文字列/機能テスト、build成功だけでは視覚一致の証拠にならない。
- 設計画像と実装画像を目視比較し、位置・寸法・文字・色・余白・枠・角丸・影・全状態を確認する。共通部品は画像一致を確認できた場合だけ再利用し、機能を残すことと旧表示構造を残すことを混同しない。設計変更はPencilを先に行う。
- V6完了PRは `.github/PULL_REQUEST_TEMPLATE.md` のVisual Parityを埋める。実Node・比較証拠がなければ `blocked` / `unverified` とし、検証済みにしない。
- V3/V4積み残しだけ `docs/pendev-v4-implementation-runbook.md` を使う。新画面へV3/V4を使わない。
- PCは1440px・1920pxで主要情報と操作を横スクロールなしにする。短い文字列は途中改行せず、狭ければ1行省略＋`title`。列が多ければ重複削除、見出し短縮、情報統合、列幅・余白・文字調整、低優先情報のresponsive非表示を先に検討する。
- スマホ、長いURL/秘密値の詳細、欠落できない比較表だけ横スクロールまたは安全な折返しを許可する。詳細は `docs/admin-ui-design-guidelines.md`。

## 要件の正本

- 要件として読むのは `docs/v6-requirements/v6-requirements-master-index.md` が指す34本と§5の横断契約だけ。
- `docs/archive/` は廃止したV2〜V5文書。開かず、引用・実装根拠にしない。git履歴確認だけに使う。
- `docs/lstep-feature-parity-matrix.md` と `docs/lstep-gap-analysis.md` は2026-08-15時点の調査で、約半分が実装済みと後に判明したため「ない機能」の根拠にしない。比較は `docs/lstep-liny-screen-behavior-research-2026-08.md` と `docs/lstep-unverified-assumptions.md` を使う。
- `docs/design-reference/` と `docs/design-qa/` は `-v6` だけを設計比較に使う。`-v2`〜`-v5` は旧設計。
- 実装進捗は `docs/design-qa/v6-progress-ledger.md` を使い、廃止済み `docs/v6-requirements/v6-32-feature-requirements-progress.md` の実装・画像状況を使わない。
