# ③-2 画面列車：統合と検査（2026-10-17）

## 取り込み

開始HEAD e7cbcf22c6はA/B/C取り込み済み、Dのmerge途中。MERGE_HEAD b22c695089から今回の司令塔回答を適用して再開した。
F土台を保持し、D e17fea9be2、E 0d88aa3ab2、gap3 112de8816b、最新本線 ab3d2eda63をすべて--no-ffで包含。
API列車origin/codex/kenta-apitrain-1016 3bc9359966はgap3に包含済みで追加mergeは不要だった。
検査のbaseはorigin/codex/development b2f05ca80e68eed14e947cb9ab000242d29a1526。

- 回数券・月謝はpassesに一本化。旧ticketsは他のqueryを保ってpassesへreplace。Fの一覧/作成、Dの共通案内帯/空一覧案内とpaymentsを保持。
- E/DのLIFFは同意/カード登録・追加メニュー・戻る時の応答世代管理を保持。実際のunmountと登録した戻る処理の両方を試験。
- ページ入口は実数203と契約の203を一致させ、取り込み分を落としていない。
- 追加migrationは36本、番号686〜725の範囲。既存の歴史上の番号重複は変更せず、今回追加分の重複0。公開中PR37件の全files APIを照合して同範囲の追加0。SQL作成/改番/DB適用0。

## 初回の失敗と修正

- 初回ci-local：ログ `/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-224529-ab3d2eda63-45384/`、標準出力 `/tmp/lh-gapuitrain-ci-1017.log`。
- 共通部品の新規候補142件：表/カード/数の帯/案内/選択/件数を正の部品へ接続。共通のRadioGroup/HeatmapTable/StepSectionは実装を持つ所有部品として対応表JSONへ登録。既存PeriodPickerの所有も登録。許可・閾値・検出器・基準値の追加/変更0。
- 大きくなった19ファイルは、独立した型/日時処理/画像表示/選択操作/窓を同じ機能の小ファイルへ分割。exportの入口と内容を保持。行数上限を上げず、追加生成物の例外も作らない。
- 新規ソース断定2件：channelsの同じkey/label/nodeを実際のタブ定義で照合。詳細条件のuseOverlayLayerという内部名の断定は、既存の実操作試験（窓のrole/焦点/Escape/入れ子の解除順）で継続して検査。操作の対象や期待する結果は削除しない。
- scripts全試験の失敗1件：LIFFの取得失敗を空配列へ置換する3か所を、共通の失敗表示と再読込へ。失敗から回復する2試験を追加。
- Web型：返金APIが必須の入力を受ける変更に、画面の金額/理由/通知選択/同じ操作の再送キーを接続。
- lint：A/B結果のanyを返事の形を表す型へ。
- 作成画面から一覧へ戻る操作は別ページへの遷移なのでpushを維持。同じ画面内のタブ変更/旧URL補正はreplace。既存試験の期待値は維持。
- 作業ツリーの共有package生成物が未作成だった最初の関連試験は準備失敗。pretest/buildを実施した再検査だけを成功に数える。

## 確認済み（最終集計は追記）

- pnpm全typecheck終了0。分割後のWeb/LIFF型も終了0。
- 共通部品の新規指摘0・許可0、ソース断定の追加0、code-size違反0、entity-picker違反0。
- 回数券の旧/新URLと一覧/案内を含む関連7件、変更した8ファイル26件、LIFF読み込み失敗の見張り7件/回復2件は成功。
- 初回DB全試験、更新処理、セットアップ、共有、LIFF全試験と型、scripts型、Worker型は成功。Worker全試験と初回CI後半は進行中。
- 全体lintのエラーはany2件のみ。修正ファイルのlint終了0。既存の警告は別に保持。
- 反映履歴はpending-kenta-gapui-integration.md。#PR番号は司令塔の採番後に置換する。
- docs/v8-pattern-catalog.mdは保護対象のため変更しない。追記案はgapuitrain-pattern-catalog-proposal-1017.mdへ保存し、司令塔の正規経路に渡す。

push/PR作成・DB適用・配備・実送信・実決済は行わない。
