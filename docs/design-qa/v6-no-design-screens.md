# 設計画像が無い15画面

全32機能の設計を撮り直した結果（2026-09-03）、262画面のうち **247枚**が撮れ、
15枚が撮れなかった。

**15枚とも台帳の `status` が `unimplemented`。** 設計の書き出しが漏れていたのではなく、
Pencil に画面そのものが無い。指示書 §2-4「設計画像が無い機能を書き出す」の対象は
**この15枚だけ**で、ほかは揃っている。

| 機能 | Node | 名前 | 台帳の status |
|---|---|---|---|
| 9 | `s9gAx` | 9-1-A 基本設定 | unimplemented |
| 9 | `W1wzCa` | 9-1-B 流入条件 | unimplemented |
| 9 | `K0Dbr2` | 9-1-C 初回案内 | unimplemented |
| 9 | `Q3qP1r` | 9-1-I 削除確認 | unimplemented |
| 10 | `LKuAQ` | 10-1-K 削除確認 | unimplemented |
| 13 | `ava2n` | 13-1-B フォームのデザイン設定 | unimplemented |
| 13 | `gBp2J` | 13-1-E フォームの削除確認 | unimplemented |
| 16 | `QX70l` | 16-1-G アフィリエイターを削除する確認 | unimplemented |
| 16 | `GqFTV` | 16-1-H 支払いを確定する | unimplemented |
| 17 | `s6MBc` | 17-2-A スコアのルール | unimplemented |
| 20 | `URqOA` | 20-1-D 定期レポートをつくる | unimplemented |
| 22 | `hHrz8` | 22-1-A 写真を1枚ずつ見る | unimplemented |
| 22 | `J3Wxl8` | 22-1-C 出しているもの | unimplemented |
| 23 | `bfB50` | 23-1-B 定期便 | unimplemented |
| 23 | `oHAN4` | 23-1-C EC連携のつなぎ先 | unimplemented |

## どう扱うか

台帳の `gap` が片づけ方を持っている。

- `parts` … 既存部品で作れる（`ConfirmDialog` `ListState` など）。**設計を先に描く**
- `build` … 画面を新しく作る。口は既にある
- `api`  … 新しいAPI・DBが要る。Codex側が先
- `drop` … V6から外す候補。**描かない**

削除確認が4枚（`Q3qP1r` `LKuAQ` `gBp2J` `QX70l`）あるが、
要件書はどれも物理削除を禁じているか、削除という考えが無いと書いている。
**設計を描く前に、何が起きる画面なのかを先に決める必要がある。**
