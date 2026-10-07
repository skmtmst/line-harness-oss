# V8 の画面（一から書く場所）

2026-10-06 オーナー決定：V8 の画面は、古い画面ファイルを直さず、ここに**新しいファイルで一から書く**。
機能（データの読み書き・権限・失敗時の扱い）は今のものを使い、見た目だけを Pencil の絵どおりに作る。

## 今の V8 ファイルを直すか、ここに一から書くか（2026-10-06 オーナー・同日更新）
画面ごとに、今の点で決める。
- 今の V8 ファイル（`app/**/*-v8.tsx`）で絵と **60% 以上**合う → そのファイルをそのまま細かく直す（合格した画面 `design/v8/PASSED.tsv` と、その同じファイルの続き＝同じウィザードの手順②以降なども同じ）
- **60% 未満**・V8 なし・自前の枠だらけ → ここ（`src/v8`）に一から書く
- `src/v8` で始めたものは続ける

## 今までの作業から写してよい
今までの V8 の作業（`app/**/*-v8.tsx`・`*-v8.module.css`・各担当の枝の直し）で使えるものは**写して**よい（import は不可）。写すときは、型・部品・変数で書き直せる所は書き直す。

## 置き場所
`src/v8/<機能>/<画面>.tsx`（例：`src/v8/rich-menus/list.tsx`、`src/v8/rich-menus/create.tsx`）。
見た目は同じ名前の `.module.css`。動きの試験は同じ場所に `*.test.tsx`。

## 使ってよいもの
- 型：`@/components/templates`（ListPage・CreatePage・DetailPage など）と `create-parts`
- 部品：`@/components/shared/*`、`@/components/ui/*`
- 機能：`@/lib/*`（api・権限・アカウント）、`@/hooks/*`、`@/contexts/*`
- 印：`lucide-react`

## 使ってはいけないもの（試験 v8-boundary.test.ts が見張る）
- `@/app/...` や `../app` など**古い画面ファイルの import**（古い画面の部品を持ってくると、古い作りごと持ってくることになる）
- `useAdminTheme` での v7/v8 の分け（ここは V8 だけ。分けるのは入口の page.tsx）
- CSS の数字の直書き（余白・高さ・文字は `var(--tpl-*)`・`var(--text-*)`、色は `var(--color-*)`。0 と 1px の線だけ可）

## 入口
各ルートの `app/<route>/page.tsx` で `theme === 'v8' ? <新しい画面 /> : <今の v7 の画面 />`。
**v7 の画面ファイル・v7 の試験は触らない**（本番は全画面が V8 で合格するまで v7）。本番を切り替えた1週間後の別の PR で、古い画面ファイルと v7 の試験をまとめて消す。

## 進め方（1画面ずつ）
1. Pencil の絵（`design/v8/pencil-texts/<板>.tsv`・html）と、要件（`docs/v6-requirements/`・`docs/v8-requirements/` の動き）を読む
2. 型と部品だけで絵どおりに書く。合格した見本：`src/app/auto-replies/edit/wizard-v8.tsx`（作る）・`src/app/reminders/list-v8.tsx`（一覧）
3. 今の画面の**動き**（どの API を呼ぶ・保存・権限・失敗時・読み直し）を一覧にし、全部を新しい画面に持ってくる（落とさない）
4. 合格＝絵の文字の位置が ±4px で 90% 以上合う（`measure.sh`、幅 1440 と 1152）＋重ねた絵を目で確かめる → 申告（`docs/v8-design-rules.md` §3）
5. 閲覧のみの人には押せないボタンを隠す（閲覧のみの帯は出す）。フォルダの列がある一覧は名前の前にフォルダの色の丸

## 切り替えの日に困らないために（2026-10-06）
- **同じ URL と同じ指定を受け付ける**：今の画面が読んでいる `?id=` `?tab=` `?step=` `?folder=` などの指定は、新しい画面でも同じ名前・同じ意味で読む。BEHAVIOR.md に「受け付ける URL と指定」の節を作って書き出す
- **同じ保存先・同じ API**：localStorage の名前、呼ぶ API、送る形は今と同じにする（変えるなら BEHAVIOR.md に理由）
- 準備表：`design/v8/SWITCH-READINESS.md`（全ページの入口に V8 の画面があるか・合格したか）。本番の切り替えの条件と手順は `docs/v8-requirements/v8-switch.md` が正（管理画面 434 枚の合格・環境変数 `NEXT_PUBLIC_ADMIN_THEME=v8` で一度に・外せば v7 に戻る・v7 の画面は1週間後に消す）
