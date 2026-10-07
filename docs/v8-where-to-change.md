# V8 の見た目を変えるとき、コードのどこを直すか

- 作成：2026-10-05（オーナー「今後もデザインを変えるかもしれないので綺麗にしておいて」「コードのどこを変えればいいか理解できるように」）
- 決まりの本体は `docs/v8-design-rules.md`。この文書は「どこを直すか」の地図。

## 0. いちばん大事な考え方

見た目は **4つの層** で決まる。**上の層ほど広く効く**。直すときは、できるだけ上の層で直す。

```
① 色・文字の大きさ・角丸などの値（トークン）   … 全画面に効く
② 外側（左メニュー・上の帯）                     … 全画面に効く
③ 型（一覧・作る・詳細・受信箱・設定・分析・ダッシュボード） … その型を使う全画面に効く
④ 部品（ボタン・表・数の帯・検索…）              … その部品を使う全画面に効く
⑤ 画面（src/v8/<機能>/、入口は app/<URL>/page.tsx） … その画面だけ
```

**画面（⑤）の置き場**（2026-10-06 オーナー決定。詳しくは `docs/v8-design-rules.md` §2 と `apps/web/src/v8/README.md`）：
- 新しい V8 の画面は `apps/web/src/v8/<機能>/` に一から書く。`app/<URL>/page.tsx` は入口だけで、v7 と V8 の画面を切り替える。
- 例外：今の `app/**/*-v8.tsx` で絵と 60% 以上合うもの（合格した画面とその続きを含む）は、そのファイルを直し続ける。`src/v8` で始めたものはそのまま続ける。

**画面（⑤）で余白・高さ・文字の大きさを書かない。** 書くと、①〜④を直しても、その画面だけ直らない。
2026-10-05 に、画面ごとの CSS（約4.1万行）が型・部品の直しを打ち消して、絵とずれる一番の原因になっていたことが分かった（`design/v8/WHY-DIFFS.md`）。

## 1. 直したいもの → 直す場所

すべて `apps/web/src/` から見た場所。V8 の指定は `[data-theme='v8']`（または `:global([data-theme='v8'])`）の中に書く。

| 直したいもの | 直す場所 | 効く範囲 |
|---|---|---|
| 主の色・文字の色・線の色・地の色 | `app/globals.css` の `[data-theme="v8"] { … }` の `--color-*` | 全画面 |
| 文字の大きさの段（見出し・本文・小さい字・数の字） | `app/globals.css` の `--text-*`（例：`--text-metric` は数の帯の数） | 全画面 |
| 角丸・影・入力欄の枠 | `app/globals.css` の `--radius-*`・`--shadow-*`・`--color-control-border` | 全画面 |
| 左メニュー（幅・行の高さ・並び・項目） | `components/layout/sidebar.tsx`・`sidebar.module.css` | 全画面 |
| 上の帯（パンくず・アカウントの切り替え・通知・自分） | `components/shell/app-top-bar.tsx`・`components/shell/page-chrome.tsx`・`components/layout/breadcrumb.tsx` | 全画面 |
| 外側の白い板の位置・すき間 | `components/app-shell.module.css` | 全画面 |
| 板の頭（題・説明・右上のボタン）の大きさと余白 | `components/templates/page-frame.tsx`（`PageHeading`）と `components/templates/page-templates.module.css` の `.heading` `.title` `.description` | 型を使う全画面 |
| 一覧の並び（数の帯・道具の段・フォルダの列・表・下） | `components/templates/list-page.tsx` と `page-templates.module.css` の一覧の部分。寸法は `design/v8/LIST-TEMPLATE-SPEC.md` | 一覧の型の画面 |
| 作る・編集の並び（手順の帯・下の保存の帯） | `components/templates/create-page.tsx`・`page-templates.module.css` の create の部分 | 作る型の画面 |
| 詳細・受信箱・設定・分析・ダッシュボード | `components/templates/` の同じ名前のファイル | その型の画面 |
| ボタン | `components/shared/button.tsx`・`button.module.css` | 全画面 |
| 表（見出しの行・行の高さ・線） | `components/shared/table.tsx`（`DataTable`・`Tr`・`Th`・`Td`） | 表を使う全画面 |
| 数の帯（並んだ数のマス） | `components/shared/list-kpis.tsx`・`kpi-band-v8.css`、マス1つは `kpi-card.tsx` | 数の帯を使う全画面 |
| 道具の段・検索・絞り込みの札・並び・件数 | `components/shared/list-toolbar.tsx`・`search-field.tsx`・`filter-chip.tsx`・`select.tsx` | 全画面 |
| フォルダの列 | `components/shared/folder-panel.tsx` | フォルダのある一覧 |
| ページ送り | `components/shared/pagination.tsx` | 全画面 |
| 状態の札（送信済み・下書き…） | `components/shared/status-badge.tsx` | 全画面 |
| ダイアログ・小窓 | `components/shared/dialog.tsx`・`confirm-dialog.tsx` | 全画面 |
| ある1画面だけの中身（列・ボタンの有無・文言） | `src/v8/<機能>/` の画面のファイル。60% 以上合って続けている画面は `app/<URL>/*-v8.tsx`（どちらかは `docs/v8-board-to-code.md` で引く）。`app/<URL>/page.tsx` は入口なので中身を書かない | その画面 |

## 2. デザインを変えるときの手順

1. **Pencil を先に直す。** 部品の絵（V8.pen の共通部品）と、画面の絵（各板）の両方。片方だけ直すと、部品と画面の絵が食い違う（2026-10-05 に見出しの大きさで実際に起きた）。
2. 変わったのがどの層かを決める。色・大きさ → ①、全画面の外側 → ②、同じ型の全画面 → ③、部品 → ④、1画面だけ → ⑤。
3. その層のファイルだけを直す。画面のファイルで上書きして合わせない。
4. 絵と重ねて確かめる（`design/v8/overlay/`・文字の位置のずれ `design/v8/overlay/TEXT-DELTA.tsv`）。±4px。
5. 小分けで入れる（`docs/v8-design-rules.md` の合格の決まり）。

## 3. してはいけないこと（崩れる原因）

- 画面の `*.module.css` に、余白・高さ・幅・文字の大きさ・行の高さを書く。→ 型と部品で決める。どうしても要るときは、型か部品に「変わり形」を足す。
- 色や角丸を数字で直接書く（`#1d1d1f`・`6px` など）。→ `--color-*`・`--radius-*` を使う（試験 `lib/direct-values.test.ts` が見張る）。
- 部品の見た目を、画面の側から className で上書きする。
- 型を使わずに、画面で板の頭・数の帯・表を手で組む。

## 4. 関係する文書

- `docs/v8-design-rules.md`：V8 の決まり（正本の順位・合格の決まり）
- `docs/v8-board-to-code.md`：絵の板 → 画面の URL → 画面のファイル の対応表（自動生成）
- `design/v8/WHY-DIFFS.md`（司令塔の作業場所）：絵とずれる原因の調べ
- `design/v8/LIST-TEMPLATE-SPEC.md`（司令塔の作業場所）：一覧の型の寸法
