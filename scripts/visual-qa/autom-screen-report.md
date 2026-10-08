# autom 画面レーンの引き継ぎ（2026-10-09）

対象は `/automations`・`/common-actions`・`/pools`。前回 autom が残した未コミット変更を、司令塔の明示的な指示で引き継いで点検・修正した。

大列車 `2a172ca012e74c11c8595c3d6501a07905a4b897` は開始時点で取り込み済み。指定の fetch・merge を実行して確認し、その後 `origin/codex/development` の `ccc594d1f8605351417cd4e07b7842ad1cefc3f7` を merge で取り込んだ。この SHA を検証の土台とした。rebase・push・PR作成・DB更新・配備は実施していない。

## 測定と左右の見比べ

開始値は再開後の初回測定（前回の未コミット変更を含む）。文字の位置は `pencil-texts/<板>.tsv` を正本として ±4px の一致率で測定した。見つからない文字も確認したが、データ違いや API にない項目があるため、100% は全項目の実装完了を意味しない。

| 板ID | 名前 | 開始 % | 最終 % | 左右の見比べで残った違い |
|---|---|---:|---:|---|
| En14p | 一覧・1152 | 93 | 93 | 名前は短文の途中改行禁止を優先して1行省略。絵の2行表示との差が残る。共通フォルダ列の幅も異なる |
| LWQXd | 一覧・1440 | 99 | 100 | 並び順を追加。共通フォルダ列・カードの枠/影との差が残る |
| M4torY | ルールを作る | 100 | 100 | 本文の主要位置はOK。HTMLのカード開始位置と座標表が異なるため座標表を優先。共通カードの枠/影は担当外 |
| S3pdQ | 状態の見本帳 | 判定外（0） | 判定外（0） | 横並びの状態標本で、実画面の構成ではない |
| g98F9 | 動いた記録 | 99 | 99 | データの文言・列の文字幅の差。共通の枠/影は担当外 |
| nH9L8 | 閲覧のみ一覧 | 100 | 99 | 操作ボタンは非表示。管理者板にある並び順がこの板にないため、よく使う絞り込みが176px左へ移る |
| tJqST | 作成・保存競合 | 100 | 100 | 競合の通知と主要位置はOK。共通カードの枠/影との差は担当外 |
| LnGNw | 共通アクション一覧 | 98 | 98 | 絞り込み・表示件数の文字が5px上。共通フォルダ列・表部品との差が残る |
| j2hfkS | 共通アクションを作る | 98 | 98 | 閉じた行の並べ替え・削除を追加。任意札の文字が5px右。共通部品の札とカードを使用 |
| ziSgL | 版と使われている場所 | 99 | 99 | 下書き編集ボタンの文字が9px上。戻るリンクと負の余白を除去。共通ボタンの外観は担当外 |
| D0AOyx | プールを作る | 84 | 96 | 2アカウント選択で絵と同じ2行にして撮影。名前の長さによる説明の改行で、現在の受け入れ先が12px上 |
| u3iab3 | プール管理 | 100 | 100 | 本文の主要位置はOK。左メニュー・共通の枠/影の差は担当外 |

全12枚の design/impl を左右に見比べた。切れ・操作の重なりは見当たらなかった。外側の共通左メニュー（項目・文言・件数）には絵との差がある。タイトルは専用担当が直すため画面側から上書きしていない。最終合格の記録は司令塔が行い、PASSED.tsv は変更していない。

撮影不可の画面はない。S3pdQ は撮影したが、状態の見本帳なので実画面との一致率を判定できない。

測定画像・全差分: `/Users/kentakenta/lh-work/design/v8/overlay/pages-autom/<板>-design.png`・`-impl.png`・`-overlay.png`・`-delta.md`。

再測定:

```sh
MEASURE_MAP="$PWD/scripts/visual-qa/autom-measure-map.json" zsh ~/lh-work/tools/hq/measure.sh autom En14p,LWQXd,M4torY,S3pdQ,g98F9,nH9L8,tJqST,LnGNw,j2hfkS,ziSgL,D0AOyx,u3iab3
```

対応表の本物は変更せず、担当12枚だけの写しをコミットした。D0AOyx は API に存在する2番目のアカウントを選んで足す操作を明記した。測定 JSON の Git SHA は共通撮影ツール側の作業ツリーを示すので、今回の版の根拠は measure.sh の出力 `ccc594d1f8（未コミット変更を含む）` と本レーンのコミットを使用する。

## 司令塔の判断が要るもの

- 同じ一覧の管理者板 LWQXd と閲覧のみ板 nH9L8 で、並び順欄の有無が異なる。利用者権限で並び替え機能を削らず、どちらでも提供した。
- HTML のカード/表開始位置と座標表の位置が食い違う箇所がある。文字の位置は指定どおり座標表を優先した。
- フォルダ列の幅、共通カードの枠/影、外側のメニュー、共通札・ボタンの文字位置は共通担当へ。見た目を画面側から上書きしていない。
- プールの保存帯は共通 SettingsPage に最小の `savePlacement="content"` を足し、本文幅で置けるようにした。他の設定画面は従来の置き方のまま。

## API が必要なもの

- オートメーション/共通アクションの一覧にはフォルダの実際の割り当てがない。意味の異なる値で色を作らず、未分類の丸を表示した。
- 前月比較、共通アクション一覧の処理の内訳、重複実行の見込みは現在の一覧/見込み API で取得できない。別の数を代用していない。
- 版画面のマニュアル導線は登録がある場合だけ既存の仕組みで出る。撮影データにないリンクを作っていない。

## 変更ファイル

- 作成の入力エラーと部品化: `apps/web/src/v8/automations/create/{create.tsx,create.module.css,friend-multi-select.tsx,weekday-select.tsx,validation.test.tsx,BEHAVIOR.md}`。
- 共通アクションの処理行・入力エラー: `apps/web/src/v8/automations/{common-action-new.tsx,common-action-new.module.css,common-action-validation.test.tsx}`。
- 一覧/版の整列: `apps/web/src/v8/automations/{list.tsx,list.module.css,versions.tsx,versions.module.css,BEHAVIOR.md}`。
- プールの入力エラー・説明の折り返し・保存帯: `apps/web/src/v8/settings/pools/{create.tsx,create.module.css,create.test.tsx,BEHAVIOR.md}`。
- 最小の型の口と検証: `apps/web/src/components/templates/{settings-page.tsx,page-templates.test.tsx}`、`apps/web/src/v8/settings/sb-frame/settings-screen.tsx`。
- 担当CSS3件だけの意図した基準更新: `apps/web/src/lib/screen-css-budget-baseline.json`。
- 撮影条件と引き継ぎ: `scripts/visual-qa/{autom-measure-map.json,autom-screen-report.md}`。

機能試験は削除していない。V7 の分岐・試験、API・Worker・DB・Pencil は変更していない。

## 検証

- 型検査: 合格。
- 担当画面・入口・共通の型の試験: 285件。CSS基準検査の1件が当初失敗したため、担当CSS3件だけを確認・更新し、同検査2件を再実行して合格。
- 作成画面の欄への移動・赤枠・エラー重複なしの追加試験: 1件合格。上記と合わせて286件が合格。
- 共通アクションの閉じた行の並べ替え/削除は、保存する処理順まで試験済み。
- ビルド: 合格（既存のlint・リリース履歴の警告あり、エラーなし）。
- ビルド後CSS検査 `pnpm --filter web verify:design`: 456件一致、不一致0、合格。
- 1152・1440・1920幅で10通りの画面状態（合計30回）を実ブラウザーで確認: 横スクロール0、右端のはみ出し0、保存帯は全ケースで表示範囲内。結果は測定出力先の `responsive-check.json`。
- `git diff --check`: 合格。撮影サーバーは `measure.sh --stop autom` で停止済み。
- CSS機械検出: 担当作成画面と変更した SettingsPage は指摘0。

PR番号は未採番。司令塔のPR作成時に反映履歴を足すこと（番号を仮造りしていない）。運用者向けの文案: 「自動化ルールと共通アクション、プール管理の画面を整え、入力不足のときに直す欄へ移るようにした」。

## コミット

- `05425be8ba`: 自動化ルール作成の入力不足を欄で知らせて移動する。
- `72b1734755`: 共通アクションの処理行・入力エラー・版画面を整える。
- `39a120fb8b`: 自動化ルール一覧の並び順・未分類の印・動きの記録。
- `4ed167eff5`: プール作成の入力エラー・本文幅の保存帯と試験。
- この引き継ぎと撮影条件、CSS基準の更新は別の仕上げコミット。
