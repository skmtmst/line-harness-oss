# V6 画素比較ルール

Pencil の V6 設計画像と、同じ Node・同じ横幅の実装画像を機械比較します。画素差は人が再判定するための情報で、`screens.mjs` の判定と一致数は自動変更しません。当面は **10%超に警告印**を付けます。

## 実行順

```sh
node scripts/visual-qa/pixel-diff.mjs
node scripts/visual-qa/ledger.mjs > docs/design-qa/v6-progress-ledger.md
node scripts/visual-qa/ledger.mjs --json > docs/design-qa/v6-progress.json
node scripts/visual-qa/ledger.mjs --html > docs/design-qa/v6-progress.html
```

- 通常実行は差分更新です。実装画像が無い画面と `--node` / `--feature` の指定外は、既存の比較結果を消さずに保持します。
- 保持した結果には元の計測日時を `retainedFrom` に残し、台帳では差分率へ「前回値」と表示します。
- 全画面を完全に撮り直した場合だけ `--fresh` を使います。範囲指定との併用や、実装画像が欠けた状態での全消しはできません。

画素比較は `docs/design-reference/<機能>-v6/<node>.png` と `docs/design-qa/<機能>-v6/<node>-<幅>.png` を使います。比較結果は `docs/design-qa/v6-pixel-diff.json`、赤い差分画像は各機能の `docs/design-qa/<機能>-v6/` に出ます。

`shots` 指定画面は、同じ状態の Playwright snapshot があれば最優先で使います。
snapshot が無い環境では、追跡済みの `docs/design-qa/<機能>-v6/<node>-<幅>.png` を使います。
台帳の「実装画像」列には、実際に使った出典を `snapshot` または `docs` で残します。

## 比較方法

- 左上を揃え、両画像に共通する幅と高さを比較します。
- 画像の高さ・幅の差は画素差率に混ぜず、台帳へ別項目として出します。
- アンチエイリアスだけの差は除外します。
- 差分が最も多い位置を、上・中央・下 × 左・中央・右の9区画で示します。
- 設計画像または実装画像が無い画面は「比較不可」にし、理由を台帳へ出します。

## 判定するときの見方

10%を超えた画面は差分画像を開き、色、余白、高さ、文字、矢印、ヘッダーの順で確認します。差分率だけを理由に `screens.mjs` の判定を変更せず、各レーンの切り分け票で人が確認してから判定します。修正後は実装画像を撮り直し、画素比較と台帳3形式を再生成してください。
