# F組6回目・列車31取り込みとY1〜Y4

つかんだ型：私有クラスでなく役目へ／速くなったか：F4比では未達／一番うまくいっていない事：事前の棚卸しと検査の手戻り。

証拠と左右の絵： [F6の全報告](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/F6/final/FINAL.md)、[Penへ返す一覧](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/F6/final/PEN-AND-FEATURES.md)。以下の証拠パスは外部F6/finalを基準に読む。

再確認候補27板・54幅。正式合格は17:43の27板を維持、新規0。コード/静的出力/81場面/保護78場面/左右は4d6a13fa3a、土台b7e54d350c、写し18:17。27板はY1〜Y4・F1〜F9・崩れ・右端・例外0。一般一覧F10は対象外81、1152の独立入力親32組・横配置0。生POST9/guard終了1は保持。保護26板78場面は退行/通信0・終了0。

|結果|証拠|
|---|---|
|全Web13040成功、既存skip/todo各1、型成功|../checks/web-all-final.log・type-final.log（f306の同じtree、../MERGE-1725-PROOF.json）|
|見張り118成功、SVG/背景/実寸の故障対照成功|../checks/guard-fixtures-final.log、../y4/narrow-preview.log（現物54場面、後の取り込みで同じWeb tree）|
|監査新しい候補0・一時許可0・未許可0|../checks/audit-final-correct.log|
|最新本線サイト26成功、静的ビルド成功|../checks/merge1725-related.log・../final-current/BUILD.json|
|全27板の数・1〜4・P〜S|F-PATTERN-COUNTS.tsv・AUDIT-1-4.tsv・PQRS-CHECKS.tsv|
|左右全54、代表/抜き取り10板を両幅で目視|EVIDENCE-INDEX.json・VISUAL-REVIEW.md・sbs-1440/・sbs-1152/|

帳面に足した直し6種類＝Y1行・Y2面・Y3題・Y4印＋端末の描画を測る検査＋狭い行の実描画試験。新規型カード5・既存補足1。修正の予想6回：Y1当たり、Y2初回部分、Y2bビルド外れ、Y2c当たり、Y3当たり、Y4当たり＝4/6 (66.7%)。補助の試験移行1/1は別。Y4の母数2漏れは数え方の診断として残す。

候補をそろえるまで169.21分、6.27分/板（待ち・全試験・取り込み・記録込み）。F4の5.84より遅い。F5の切断込み15.13からは短縮、最後の再開だけ1.30とは対象が違い直接比べない。3枚ごとの撮影時間/率はTIMING-BY-3、全工程とは分ける。次は共通部品の役目・影響するA/D試験・依存一覧を最初にまとめ、別型漏れと全Webのやり直しを先に防ぐ。

Penへ返す物と機能待ちはPEN-AND-FEATURES.md。フォルダ?・来店スタンプ・説明・件数/必須札/FolderSelectの済んだ直しは再計上しない。新しいデータや見本は作り込まない。原本の失敗と版はCOUNT-METHOD.md参照。

次のタスクはこれ：QqER7/CcA4k/d5fmnM（NEXT-FAMILY.md）、そのあと主な141板の残り。F2x115は担当外、受信箱は最後。Pen/migration/DB/配備/push/PR/統合なし。自分のサーバーは終了時に停止し、ソース元の既存NodeTerm2変更/未追跡workspace1は触らない。

## 開始・途中の原記録

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

Y1の32b36bb970静的ビルド・81場面：6→0、元のF/崩れ/右端/例外0。Y2=54/Y3=3/Y4=45はこの版では未修正。生POST9・終了1を保持。新Y4母数へつくって動かすも追加、2回の計数漏れは処理の実態で診断した。

Y2初回a2d4691a55：54→2（u5広幅）、スマホが下まで描かれる4場面のblankが新たに検出。実際の親/端末/scrollをDIAGNOSISで確認し、型の役目へ白い地を渡す＋描かれる端末の箱を内容として数える形へ修正。上限64・許可は不変。故障対照は18成功/新見本1失敗（pのmargin相殺16）、見本のmargin0だけを直し該当1件の再実行で成功。元の失敗は保持、次は全81場面。

Y2bビルド終了1：CSS Modulesのpure指定不足（local classなし）。正の.frameへ条件を限定して修正。plainの古いprivateクラス文字assert1つはcreate-consistencyの実CSS/描画/灰色故障対照へ移し、ルールは保持。新node2件・関連spacing5件が成功。B-274のCURRENTと最新VERDICTSを読み、次の撮影からFRESH.txtとCOPIES-STAMPを保存する。古い写しの位置点は比較・合算しない。

Y2c d40f676242の静的81場面：Y1/Y2=0、Y3=3/Y4=54（未修正）、既存崩れ0。FRESH成功、写し18:17。Y3はIDの有無ではなく下書き/公開の状態から題とパンくずを同じ変数で出す。関連8件・描画故障対照3件成功。B-275以降は司令塔heavy.shを使用。

Y3 abfba66621の81場面はY1〜Y3/既存崩れ0、未修正Y4=54。Y4は通常/分割の帯だけの主保存操作をSaveへ。副操作・次へ・リンク・インラインの別用途を保持。実部品34件/描画故障4件/型成功。最初の関連34件はkey警告が出たためReact.Children.mapへ修正し、同じ34件を再実行して警告なし。保存中/完了/ref/submit/理由/disabled/clickを実DOMで確認。

全Web初回594a215b87：2191ファイル、13038成功/2失敗、skip/todo各1、終了1。失敗は旧ActionRowのCSS文字固定1・Button実利用先一覧の新規1。前者は同じ2ケースを実ActionRow+実CSSの390px描画へ移し、details配置の故障・190+260pxの故障を検出。後者は実際の依存行1だけを記録、許可例外は追加していない。関連7件成功。初回全体失敗を保持し、全件を再実行する。

終了前の本線追加#1726（サービスサイトの登録/ログイン先）を31b6c31a59へmerge。土台aeec934d04、遅れ0、関わるサイト26件成功。撮影済み4d6とWeb/Worker/packages/scripts/.github/型対応表のtree完全一致をF6/MERGE-1726-PROOF.jsonへ。画像/81場面/点の原SHAを変更しない。更新履歴の新行は入ったが、今回の画面の機能/見た目/測る物は不変であるため、済んだWeb全試験や撮影は再実行しない。次の撮影前には31b6以降の静的出力を組み立ててFRESHを通す（確認用サーバーは停止済み）。
