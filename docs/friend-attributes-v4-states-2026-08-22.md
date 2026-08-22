# 友だち属性V4 追加4状態とLステップ22反映案

## PR #271の範囲

このPRは、Lステップ・Liny分析を反映した静的なVisual QA比較画面と設計資料までを対象とする。
本番 `/tags` へのprops接続、共通サイドバーのV4統一、CSV画面背面の実データ比較は、
[`friend-attributes-v4-production-connection-spec.md`](./friend-attributes-v4-production-connection-spec.md) を正本として別PRで進める。

## 対象と実ノード

| 状態 | 元ノード | 分析反映ノード | 提案ページ | 現在の扱い |
|---|---|---|---|---|
| 友だち情報欄 | `ZAFby` | `C2g1N` | `cZwj6` | 既定値・型固定・削除影響を反映 |
| 対応マーク | `yTPY6` | `S04qZM` | `qJqpV` | 受信時自動変更を反映 |
| 保存した検索 | `cxtem` | `WDAkW` | `e0zeFR` | 15軸・保存条件コピーを反映 |
| CSV操作を開いた状態 | `KPgel` | `sJE2f` | `Q8ZB0` | テンプレート・最大500件・事前検証を反映 |

元ノードの画像は2026-08-22にPen.devから1x PNGで書き出した。分析反映ノードは同日に既存V4を残して複製し、一次資料の差分だけを反映した。

Pen.dev上の配置は、左から次の順で分離した。

1. 分析反映V4
2. 変更・修正・追加の提案ページ
3. 元V4
4. 8/22現行画面（参照用）

V4制作物を8/22現行画面の右側へ追加しない。左側の制作領域には見出しノード `ZTGed`、8/22参照領域には見出しノード `BBTuS` を置いた。

共通の色・文字・ボタン・入力・バッジ・表操作は、基本パーツページ `w2Nv6` を標準候補として参照する。詳細は [`v4-style-guide.md`](./v4-style-guide.md)。

ダッシュボードと受信箱にも、既存V4を残したまま次を追加した。

| 画面 | 分析反映ノード | 提案ページ |
|---|---|---|
| ダッシュボード | `WehYz` | `GrP5M` |
| 受信箱 | `ULA47` | `qftby` |

## 機能監査

- Lステップ22の一次資料と現行コードを照合し、4状態を表示専用のVisual QAへ分離した。
- 現行 `/tags` の取得・追加・編集・削除・並び替え・CSV処理は削除していない。
- 旧V2/V3のJSX、共通表示部品、Tailwindクラスは新しいViewへ持ち込んでいない。
- 実データ接続時は、現行のAPI処理をcontroller側へ残し、このViewへpropsで渡す。
- 詳細な不足一覧は [`lstep-liny-v4-code-audit-2026-08-22.md`](./lstep-liny-v4-code-audit-2026-08-22.md) を正本候補とする。

## 画像証拠

元設計、分析反映設計、1920px・1440pxの実装画像を `docs/visual-qa/friend-attributes-v4-states/` に保存した。

| 状態 | Pen.dev 1920px | 実装 1920px | 比較結果 |
|---|---|---|---|
| 友だち情報欄 | `design-revised-fields-1920.png` | `implementation-revised-fields-1920.png` | 本文の位置・寸法・文言・色・表を確認済み |
| 対応マーク | `design-revised-marks-1920.png` | `implementation-revised-marks-1920.png` | 本文の位置・寸法・文言・色・表を確認済み |
| 保存した検索 | `design-revised-searches-1920.png` | `implementation-revised-searches-1920.png` | 本文の位置・寸法・文言・色・表を確認済み |
| CSV操作 | `design-revised-csv-1920.png` | `implementation-revised-csv-1920.png` | モーダルの流れ・文言・状態を確認済み。背面のタグ一覧は本番接続時に再確認する |

画面共通サイドバーは現行アプリのものを表示しているため、Pen.dev画像との差を残している。本番の共通メニュー統一が終わるまで、グローバルシェルの視覚一致は `unverified` とする。

Chrome DevToolsで4状態を1440px・1920pxの両方で確認し、ページ全体と表の `scrollWidth` が表示幅を超えないことを確認した。

## 確認URL

- `/visual-qa/friend-attributes-v4-states?state=fields`
- `/visual-qa/friend-attributes-v4-states?state=marks`
- `/visual-qa/friend-attributes-v4-states?state=searches`
- `/visual-qa/friend-attributes-v4-states?state=csv`

## 別PRへ分離した本番接続

- 現行機能とのprops接続と機能テスト
- 共通サイドバーを含むグローバルシェルのV4統一
- CSV画面背面のフォルダパネルと実データ一覧の最終画像比較

この3点はPR #271の未完了ではなく、本番画面を置き換える別PRの受け入れ条件とする。
PR #271では本番 `/tags` を変更しておらず、V4置換完了とは扱わない。
