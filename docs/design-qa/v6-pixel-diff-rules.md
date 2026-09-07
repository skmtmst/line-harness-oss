# V6 画素比較ルール

Pencil の V6 設計画像と、同じ Node・同じ横幅の実装画像を機械比較します。目視判定が `match` でも、画素差が **3%を超えた画面は台帳で「一致」に数えません**。

## 実行順

```sh
node scripts/visual-qa/pixel-diff.mjs
node scripts/visual-qa/ledger.mjs > docs/design-qa/v6-progress-ledger.md
node scripts/visual-qa/ledger.mjs --json > docs/design-qa/v6-progress.json
node scripts/visual-qa/ledger.mjs --html > docs/design-qa/v6-progress.html
```

画素比較は `docs/design-reference/<機能>-v6/<node>.png` と `docs/design-qa/<機能>-v6/<node>-<幅>.png` を使います。比較結果は `docs/design-qa/v6-pixel-diff.json`、赤い差分画像は各機能の `docs/design-qa/<機能>-v6/` に出ます。

## 比較方法

- 左上を揃え、両画像に共通する幅と高さを比較します。
- 画像の高さ・幅の差は画素差率に混ぜず、台帳へ別項目として出します。
- アンチエイリアスだけの差は除外します。
- 差分が最も多い位置を、上・中央・下 × 左・中央・右の9区画で示します。
- 設計画像または実装画像が無い画面は「比較不可」にし、理由を台帳へ出します。

## 判定するときの見方

3%を超えた画面は差分画像を開き、色、余白、高さ、文字、矢印、ヘッダーの順で確認します。差分率だけを理由に `screens.mjs` の目視判定を自動変更せず、台帳が「画素差3%超」として一致から除外します。修正後は実装画像を撮り直し、画素比較と台帳3形式を再生成してください。
