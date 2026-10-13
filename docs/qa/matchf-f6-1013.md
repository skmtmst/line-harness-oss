# F組6回目・列車31取り込みとY1〜Y4

開始7ab08ac3b3、本線b56967dbb2。未コミット0、doctor合格、空き33GB。

## 競合の選択理由

- .github/workflows/required-pr-gate.yml：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/scripts/v8-guard/fix-patterns-browser.mjs：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/scripts/v8-guard/fix-patterns.test.mjs：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/scripts/v8-guard/layout-defects.mjs：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/app/auto-replies/edit/wizard-v8.module.css：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/app/auto-replies/edit/wizard-v8.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/app/rich-menus/new/create-v8.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/components/templates/create-parts.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/components/templates/page-templates.module.css：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/affiliate-offer-new/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/affiliates/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/automations/create/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/conversions/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/events/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/friend-add/editor.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/mileage/earning-rule-new/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/mileage/reward-edit.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/mileage/reward-partial-save.test.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/tags/field-editor.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/tags/mark-basic-fields.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/template-edit/message.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- apps/web/src/v8/webhooks/create.tsx：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。
- docs/brain/Memory.md：本線の非競合差分を保持。追記両方を保持し重複段落をまとめた。
- docs/brain/rules/corrections.md：本線の非競合差分を保持。追記両方を保持し重複段落をまとめた。
- docs/v8-pattern-catalog.md：本線の非競合差分を保持。追記両方を保持し重複段落をまとめた。
- scripts/visual-qa/v8-pattern-audit.test.ts：本線の非競合差分を保持。F5の入力共通化・描画検査・理由の接続を保持。

- friend-add：本線の閲覧のみで差し込み操作を隠す変更を採用。
- CreateSummaryCard：F5のleadingと本線beforeRows両方の口を保持。
- 型CSS：本線の一覧/列配置とFのfieldsetを保持、fieldsetの重複だけ除去。
- 型監査：Fの説明/行うことと本線の件数の故障対照を3件とも保持。
- guard/CI：F1/F2の子文字検査、全入力列、理由の接続と本線kpimenu/道具検査を保持。

取り込み検証：Web型終了0、関連42件、guard51件、型監査25件成功。共有元の既存NodeTerm2変更とworkspace未追跡1は前回の用途のまま未変更。

本線取り込み後の既存合格26板78場面：崩れ/F1〜F10/例外/横はみ出し/更新API0。27板81場面のY変更前：Y1=6・Y2=54・Y3=3。Y4初期の対象不足は原本のまま残し、登録/公開の主操作も含め数え直す。Y1の故障対照は成功（元の広い名前枠＋大きな値を入れると検出）。赤/緑の最初の2要求は共有枠待ちで取り消し・未開始、成功へ数えない。
