# 司令塔へ：型の対応表への追記案

保護された `docs/v8-pattern-catalog.md` はこの枝から変更しません。コード側の登録と実装を検査したうえで、司令塔の正規経路で次を追記してください。

## ③-2の画面列車：共通の受け口（2026-10-17）

- 濃淡の表：`shared/heatmap-table.tsx` の `HeatmapTable`。行・列・人数・選択を渡す。濃淡・未取得・読み上げと選択の形は部品が持つ（G5-1）。
- 開閉する作成の段：`templates/steps.tsx` の `StepSection`。段番号・題・要約・開閉と入力内容を渡す。面は既存Cardが持つ（B2-2）。
- 行内の選択群：`shared/radio.tsx` の `RadioGroup` とRadio。群の名前と選択肢を渡し、入力・ラベル・読み上げを共通化する。
- 集計期間：既存の `shared/period-picker.tsx` のPeriodPickerを対応表へ登録。券の有効期限とは別の役目。
- 比較の表と保存の衝突判定は既存table/save-conflictへ接続する。許可・閾値の追加なし。
