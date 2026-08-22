# 友だち属性V4 追加4状態

## 対象と実ノード

| 状態 | Pen.dev実ノード | 設計画像 | 現在の扱い |
|---|---|---|---|
| 友だち情報欄 | `ZAFby` | `V4 4-2 友だち情報欄（1920）.png` | Pen.devへ新規作成、独立Viewへ移植 |
| 対応マーク | `yTPY6` | `V4 4-3 対応マーク（1920）.png` | 既存V4から独立Viewへ移植 |
| 保存した検索 | `cxtem` | `V4 4-4 保存した検索（1920）.png` | 既存V4から独立Viewへ移植 |
| CSV操作を開いた状態 | `KPgel` | `V4 4-1-B CSV操作を開いた状態（1920）.png` | Pen.devへ新規作成、独立Viewへ移植 |

画像は2026-08-22にPen.devから1x PNGで書き出した。画面幅はすべて1920px。

## 機能監査

- 今回はLステップ22の再分析結果を待つため、4状態を表示専用のVisual QAへ分離した。
- 現行 `/tags` の取得・追加・編集・削除・並び替え・CSV処理は削除していない。
- 旧V2/V3のJSX、共通表示部品、Tailwindクラスは新しいViewへ持ち込んでいない。
- 実データ接続時は、現行のAPI処理をcontroller側へ残し、このViewへpropsで渡す。
- Lステップ22の分析で追加要件が出た場合はPen.devを先に更新し、同じノードと同じ状態の画像比較後にViewを更新する。

## 確認URL

- `/visual-qa/friend-attributes-v4-states?state=fields`
- `/visual-qa/friend-attributes-v4-states?state=marks`
- `/visual-qa/friend-attributes-v4-states?state=searches`
- `/visual-qa/friend-attributes-v4-states?state=csv`

## 未完了ゲート

- 1920pxの実装画像とPen.dev画像の横並び比較
- 1440pxで表とページ全体に横スクロールが出ないことの確認
- Lステップ22の再分析を反映した最終V4設計の確定
- 現行機能とのprops接続と機能テスト

この4点が終わるまで、本番 `/tags` のV4置換完了とは扱わない。
