# 統括V8 画像比較（「運営による操作」の非表示）

## 2026-10-06 デザイン承認と照合

- 元の指示: 「こちら統括の運営による操作は非表示でお願いします、将来的には使用するかもしれません。」（2026-10-06 利用者）
- 設計の正本: `/Users/masatosakamoto/Documents/LINE-Harness-Design/LINE-Harness-V8-B.pen`
- フレーム: `K7HYu`「統括 統括の情報 V8」。区画 `f51tt` を `enabled:false`（非表示）にし、名前を「運営による操作（2026-10-06 非表示・将来再表示用に残置）」へ変更。**削除していない**ので、戻すときは `enabled` を外すだけでよい
- 統括ホーム `JKjsE`: 元から「運営による操作」の区画が無い。今回の実装でコードが絵に合った（デザイン変更なし）
- 承認版・日時: 2026-10-06 に上記を反映した版
- 利用者の回答: デザイン承認「この姿で承認する」／説明文「デザインの文に揃える（おすすめ）」

### 画像

| 画像 | 内容 |
|---|---|
| `K7HYu-panel-before.png` | 変更前の中身（`K7HYu/jpCyy`）。統括名のカードの下に「運営による操作」の板があり、見出し・説明・3行の記録が出ていた |
| `K7HYu-panel-after.png` | 変更後の中身。統括名のカードだけ。下の板と余白ごと消え、崩れや空き過ぎは無い |
| `K7HYu-screen-after.png` | 変更後の画面全体。左メニュー・頭・統括名カード・保存ボタンの位置は変わっていない |

### 実装との照合（読み取り）

| 絵 | 実装 | 判定 |
|---|---|---|
| `K7HYu` に「運営による操作」の板が無い | `apps/web/src/app/hq/settings/page.tsx` に `<OperatorHistory />` が無い（注記コメントのみ） | 一致 |
| `JKjsE` に同じ板が無い | `apps/web/src/app/hq/page.tsx` に `<OperatorHistory />` が無い（注記コメントのみ） | 一致 |
| 頭の説明文 `gG3Is`「統括の名前です。各アカウントの画面の上と、メンバーへの招待メールに出ます。」 | `ReadonlyHeader` の `description` を同じ文へ変更 | 一致（2026-10-06 に揃えた） |
| 統括名のカード（入力欄＋保存ボタン） | `TenantInfoTab` は無変更 | 一致 |

- 残置の確認: 部品 `apps/web/src/components/hq/operator-history.tsx`、`/api/hq/operator-history`、`platform_audit_logs` への記録づくり、既存試験 `apps/web/src/app/hq/operator-history-v8.react.test.tsx` はすべて残っている
- 試験: `vitest run src/app/hq src/components/hq` 53ファイル / 239件 合格、`tsc --noEmit` 合格

**findings:** 対象2画面に残るP0/P1/P2なし。

final result: passed

> 実機の画面写真は検証環境（staging）へ配備した後にCodexが撮る。ここにあるのは設計画像と読み取りによる照合まで。
