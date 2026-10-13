# M組3回目：窓560と共通部品

## 列車35の取り込み

開始 f4dfc35dd6。本線取得後、指定された codex/kenta-train-35-1014 をmergeで取り込む。

| 競合 | 選択理由 |
|---|---|
| template-edit/frame.tsx | 列車のside(false)/side(true)による狭幅の内容転送と、M2の広い引き出しviewportInsetを両方保持。 |
| Memory.md | M2の進行記録と列車35側の他組の進行記録を両方保持。 |
| mistakes.md | 両側の再発防止の追記を保持。 |
