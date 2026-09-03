# lint.md — 週次の点検観点

> 文書は足すだけだと矛盾・重複・古い情報が溜まる。週に 1 回、司令塔がこの観点で点検し、結果を `docs/brain/lint-issues.md` に書く(このファイルは生成物として上書きしてよい)。

## いつやるか

- 毎週金曜の夕方のまとめのあと。または大きな PR(要件の見直し、Pencil の書き出し直し)の直後。

## 点検する範囲

- `docs/v6-requirements/`(要件 34 本と横断契約)
- `docs/v6-*.md`(指示書、並列計画、NodeTerm 設計、Pencil 修正)
- `docs/brain/`(Memory、corrections、mistakes)
- `AGENTS.md`

## 観点

1. **矛盾** — 同じ決めごとが別文書で違う値になっていないか(例: 再試行回数、権限モデル、版の分類、主ボタン色)
2. **古い情報** — Memory.md の「進行中」と実際の PR・台帳がずれていないか。オープン PR 数、一致画面数、決定済み一覧
3. **壊れた参照** — 存在しない文書やパスへのリンク(`grep -rn "docs/" | 実在確認`)
4. **重複** — 同じ指示が corrections.md と AGENTS.md の両方にあり、片方が古くなっていないか
5. **昇格候補** — mistakes.md で定着したルールを corrections.md か AGENTS.md へ移す
6. **archive 候補** — 完了した引き継ぎメモで被参照 0 のもの

## 出力

```markdown
# Lint Issues (YYYY-MM-DD)

## 矛盾
- [ ] 内容(関連: パス A、パス B)

## 古い情報
- [ ] Memory.md の X が古い。正しくは Y

## 壊れた参照
- [ ] ファイル:行 → 存在しないパス

## 重複 / 昇格 / archive 候補
- [ ] ...
```

点検で見つけたものは、その場で直せるもの(リンク、数値)は直し、判断が要るものは GitHub Issue(`blocked`)にする。
