# 列車16の統合記録（2026-10-10）

## 範囲

`codex/kenta-train-16-1010`、列車15 `3bf6856ae57e62dc5935e2bbeb746d66739e7d73` を起点に merge commit で取り込み。rebase・force・stash は使っていない。push・PR・D1更新・配備は行っていない。

開始時にローカルDoctorは「合格」。列車12・入力の作業ツリー・親ECリポジトリはクリーンを確認。親のファイルは変更していない。列車15 #1687 は開始時OPEN。本線 `41d2589c97fa1b783311081310c6284210235a5a` は地図の枝を取り込んだ後に祖先となり、テスト前のfetchとmergeでも追加差分なし。

## 取り込んだ枝

|順|枝|merge commit|
|---|---|---|
|1|codex/kenta-mapregen-1010|fd5da7bf17|
|2|codex/kenta-formdocs3-1010|d860dfa2c6|
|3|codex/kenta-busy-1010（lh-pages-busy）|6888d74757|
|4|codex/kenta-owners-1010（lh-pages-owners、17コミット）|7940461bcb|
|5|codex/kenta-rest1-1010|e1ae4002a6|

止めた枝なし。固定したPenの写し・入力の失敗表示・共通部品・処理中表示を共存させた。予約の書き込みは `restaurant-fusion-contract.md` のrest1を採用。API/DBの競合では複数卓の占有・version照合・注意情報の写し・来店と退店の分離を残した。

## マイグレーション

626・627を維持。取得した `origin/codex/development` と公開中38PRの追加ファイルを照合し、626・627の使用なしを確認。承認済みの内容は変更せず、ローカル試験のみ実施した。D1には適用していない。

## 競合解消後に直した検査と実装

- 共通部品へのimportを両枝から残して重複をまとめ、取得失敗の再読込でPromiseが共通Buttonへ返るようにした。処理中はbusy/busyLabelに揃え、削除済みの複製ダイアログは復活させていない。
- 単一選択の窓の狭い幅のフック、予約メニューの確認窓のimport、座席の縦位置の入力エラー囲みの閉じタグを補完。
- 読み取り専用の案内の試験は持ち主の共通文言を参照。予約の試験は共通予約盤の列と行の一致を確認し、来店操作・権限の検査を維持。
- 成果地点の作成試験のmockの文末を修正（Vitestの巻き上げ時の構文エラー）。
- ECの実ブラウザ試験はAPI応答を明示的に保留し、処理中の再試行メニューが無効で、アカウント切替後の一覧が固まらないことを確認。共通化後の操作名に追従し、秒数任せの待機を外した。
- 回答フォームの実ブラウザ試験は共有の読込失敗文言に追従し、0件扱いしないこと・再試行・409時の入力保持を維持。
- 持ち主の枝で追加された照合待ち3部品は、値を確定扱いせず調査欄へ移した。設計負債の検査は、調査中でも持ち主が確定した共通部品自身を画面の手書きとして数えない。画面側・担当未定の調査は除外しない回帰試験を追加。

## 理由・担当・期限付きの一時許可

司令塔の今回の指示に従い、写しを古い値へ戻さず必須検査へ対象限定の許可を追加した。期限は **2026-10-17**。対象・値・本文・件数が変わると失敗し、期限切れでも失敗する。許可は生の結果を変えず別欄へ出す。形の不備は許可しない。新しい不一致・同じ対象の件数増加・不正な台帳・期限切れ・別ルートや幅への拡大を検出する14試験が合格。

完全な一覧は [理由付き許可台帳](../scripts/visual-qa/train16-temporary-allowances.json)。設計の全25件はpendecの修正待ち。持ち主の238候補は同じカタログで本線と比較したもの。列車15と比べると8候補だけが追加され、230候補は列車15からの既存分（入力エラーの囲み等で検出文が変わったものを含む）。直書きCSSの新規候補は0。

### 設計値25件（担当 pendec）

1. 不一致: pagination の border-color
2. 不一致: pagination の background
3. 不一致: pagination の color
4. V8不一致: リンク の fw
5. V8不一致: 動きの行 の fw
6. V8不一致: チェックのカード/オン の sw
7. V8不一致: チェックのカード/オン の fs
8. V8不一致: チェックのカード/オン の lh
9. V8不一致: 切り替え（3つ） の fw
10. V8不一致: 削除ボタン の r
11. V8不一致: タブ の fw
12. 固定値不一致: 絞り込みの札/オン background src/components/shared/filter-chip.css [data-theme='v8'] .v6-filter-chip[aria-pressed='true'] background
13. 固定値不一致: 絞り込みの札/オン color src/components/shared/filter-chip.css [data-theme='v8'] .v6-filter-chip[aria-pressed='true'] color
14. 固定値不一致: 絞り込みの札/オン outline-color src/components/shared/filter-chip.css [data-theme='v8'] .v6-filter-chip[aria-pressed='true'] outline-color
15. 固定値不一致: 切り替え（3つ） background src/components/shared/segmented.module.css [data-theme='v8'] .selected background
16. 固定値不一致: 切り替え（3つ） color src/components/shared/segmented.module.css [data-theme='v8'] .selected color
17. 固定値不一致: 表の見出し（B-178） padding src/components/shared/table.module.css [data-theme='v8'] .headRow[data-table-layout='columns'] padding
18. 固定値不一致: ラジオ/オン width src/components/shared/radio.module.css .input width
19. 固定値不一致: ラジオ/オン height src/components/shared/radio.module.css .input height
20. 固定値不一致: ラジオ/オン outline-width src/components/shared/radio.module.css [data-theme='v8'] .input:checked outline-width
21. 固定値不一致: 選ぶカード/オン B-203 background-color src/components/shared/radio-card.module.css .card.checked background
22. 固定値不一致: チェックのカード/オン B-203 background-color src/components/shared/check-card.module.css .card.checked background
23. 固定値不一致: 一斉配信一覧の名前 B-218 src/v8/broadcasts/list.module.css .cellTitle font-weight
24. 固定値不一致: シナリオ一覧の名前 B-218 src/v8/scenarios/list.module.css .cellTitle color
25. 固定値不一致: シナリオ一覧の名前 B-218 src/v8/scenarios/list.module.css .cellTitle font-weight

### 持ち主の候補238件（担当 kenta・持ち主担当）

|型|件数|
|---|---:|
|folder-select|47|
|picker-field|43|
|filter|26|
|field-error|25|
|field|17|
|table|14|
|date-time|9|
|select|9|
|tap-extra|9|
|media-slot|7|
|tap-action|7|
|toggle|7|
|toolbar|4|
|folder-column|3|
|tabs|3|
|detail-panel|2|
|dialog|2|
|list-state|2|
|primary-button|1|
|viewer-band|1|

### 列車15から追加された8候補の理由

- `apps/web/src/v8/restaurant/booking-kit/shell.tsx` / filter・growing-select: rest1の固定Penにあるヘッダーの店舗選択。予約の対象店と見た目をこの統合で維持し、持ち主担当が増える候補の共通部品への移行を絵と照合する。
- `apps/web/src/v8/restaurant/dashboard/dashboard.tsx` / filter・growing-select: rest1の固定Penにあるヘッダーの店舗選択。予約の対象店と見た目をこの統合で維持し、持ち主担当が増える候補の共通部品への移行を絵と照合する。
- `apps/web/src/v8/restaurant/booking-kit/shell.tsx` / picker-field・select-entity: rest1の固定Penにあるヘッダーの店舗選択。予約の対象店と見た目をこの統合で維持し、持ち主担当が増える候補の共通部品への移行を絵と照合する。
- `apps/web/src/v8/restaurant/dashboard/dashboard.tsx` / picker-field・select-entity: rest1の固定Penにあるヘッダーの店舗選択。予約の対象店と見た目をこの統合で維持し、持ち主担当が増える候補の共通部品への移行を絵と照合する。
- `apps/web/src/v8/restaurant/reservations/list.tsx` / select・head-prefix: rest1の固定Penと予約盤の状態フィルターにある「状態：」の選択肢。固定Penの見た目をこの統合では維持し、持ち主担当が選択部品の契約を照合する。
- `apps/web/src/v8/restaurant/tables/tables.tsx` / field・own-count: 卓の配置座標をrows.lengthから算出している数式が文字数の目印に一致。文字数表示の手作りではない。対象の1式だけを許可し、検出側の精度改善まで残す。
- `apps/web/src/v8/contents/list.tsx` / field-error・raw-alert: 列車15の媒体全選択の取得エラー案内を維持し、再読込を共通Buttonの処理中表示へ接続したため検出文が変わった。エラー時の再試行を残し、持ち主担当が案内の共通化を確認する。
- `apps/web/src/v8/webhooks/incoming.tsx` / viewer-band・own-band: ViewerBandのimport文が手書きの帯の目印に一致。実体はwebhooks/shell.tsxで共通ReadOnlyNoticeへ委譲済み。対象のimport1件だけを許可する。

### 一覧骨格6件（担当 kenta・予約盤の持ち主担当）

- `/restaurant-test/reservations?view=list` の1152・1440・1920幅で各2項目：`B-178 一覧の型なし`、`B-178 表の見張り対象なし`。rest1は旧一覧の型ではなく共通予約盤を使い、固定Penの行の寸法も違うため。盤の実体と表の行が無ければ一時許可しない。
- 別の実ブラウザ確認で、3幅とも共通予約盤の一覧・11行を確認。列数のずれ、横スクロール、表の右端越えは0。1152・1440・1920幅の写真も証拠フォルダへ保存した。

## 検証結果

APIのビルド値は `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev`。飲食画面を含めるため `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true` も指定。実ブラウザでは当該URLの通信をローカルの画面確認用APIに差し替えており、検証DBへ書き込んでいない。開発サーバーとPlaywrightは同時に複数走らせず、検査を順番に実施した。

|検査|結果|
|---|---|
|Worker全試験|918ファイル、10,862合格・既存30スキップ|
|Web全試験|2,112ファイル、12,331合格・既存1スキップ・1todo（新規の持ち主/照合待ち回帰試験を含む）|
|DB全試験|374ファイル、2,239合格|
|scripts全試験|99ファイル、903合格（新規の許可方針14試験を含む）|
|LIFF全試験|418合格|
|共有型の別時間帯|Asia/Bangkok、30ファイル・357合格|
|自己更新エンジン・CLI|160・52合格|
|型検査|Worker・Web・DB・共有型・LIFF・scripts 合格|
|ビルド|Worker・Web・LIFF・共有依存 合格|
|DB生成と移行方針|bootstrap整合、525本の方針検査 合格|
|CIのWebhookブラウザ|16合格|
|CIの管理画面ブラウザ|媒体6、EC6、保管済みタグ4、LINE通知と回答フォームの動作検査 合格|
|設計値の照合|503項目、478一致・既知25不一致・形の不備0、一時許可で合格|
|持ち主の検査|本線との差238候補（列車15との差8）、期限付き許可238・未許可0|
|主要画面のはみ出し|12画面×3幅×2指定の72通り、0件|
|入力・表の崩れ|64経路×3幅の192通り、新規0件・既存許可37件。許可は今回変更せず結果JSONへ残す|
|一覧の行|129通り・705行、違反0。5種類の逆変異を検出|
|一覧の骨格|93通り、生の不一致6件だけを一時許可。対象を再実行して確認|
|見出し|182画面、22px/700/32px・測定失敗0|
|速度|11画面の悪化予算 合格。タグの表示1,103msは1秒の絶対目標未達として記録|
|2,000人の友だち|表示271ms・長時間処理0ms。3幅で選択・キーボード・フォーカス・枠外0 合格|
|差分検査|git diff --check 合格、未解決競合0|

失敗した初回検査と修正後の再検査を含めた証拠は `/Users/kentakenta/lh-work/design/v8/review/train16-1010/`。固定した写しと実装の不一致25件はMAPREGENの一覧と同じ対象・値。追加した一時許可は台帳に記載した対象だけで、既存の画面崩れ許可は今回変更していない。速さはCIでも参考扱い。予算は合格だがタグの絶対目標未達を結果に残す。v7の画素比較はV8固定後の参考検査で、今回は実施していない。

この記録は統合と動作・崩れの検査であり、司令塔の462枚の画素照合の合格台帳を更新するものではない。`#0000` は司令塔がPR採番後に実番号へ置き換える。

修正のコミットは `c87bea58c6111a5b362e6f851a0a35f0bb0f87f3`、検査・期限付き許可のコミットは `46d6bcc139daa6d4e9f0ec9d0e234050021d269c`。反映履歴とこの統合記録は別コミットにまとめる。最終SHAは引き渡し時の `git rev-parse HEAD` を参照する。
