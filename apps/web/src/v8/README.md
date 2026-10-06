# V8 の画面（一から書く場所）

2026-10-06 オーナー決定：V8 の画面は、古い画面ファイルを直さず、ここに**新しいファイルで一から書く**。
機能（データの読み書き・権限・失敗時の扱い）は今のものを使い、見た目だけを Pencil の絵どおりに作る。

## 合格した画面はそのまま（2026-10-06 オーナー）
design/v8/PASSED.tsv の画面（リマインダ一覧 apLqS・自動応答の作る① K7HWG・リマインダを作る① VE1u5・リッチメニューを作る① JeINq）は今のファイルのまま。
合格した画面と**同じファイルの続き**（同じウィザードの手順②以降など）は、そのファイルで続けてよい。

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
**v7 の画面ファイル・v7 の試験は触らない**（本番は全画面が V8 で合格するまで v7）。本番を切り替える日に、古い画面ファイルと v7 の試験をまとめて消す。

## 進め方（1画面ずつ）
1. Pencil の絵（`design/v8/pencil-texts/<板>.tsv`・html）と、要件（`docs/v6-requirements/` の動き）を読む
2. 型と部品だけで絵どおりに書く。合格した見本：`src/app/auto-replies/edit/wizard-v8.tsx`（作る）・`src/app/reminders/list-v8.tsx`（一覧）
3. 今の画面の**動き**（どの API を呼ぶ・保存・権限・失敗時・読み直し）を一覧にし、全部を新しい画面に持ってくる（落とさない）
4. `measure.sh` で 90% 以上・目視で崩れなし → 申告

## 切り替えの日に困らないために（2026-10-06）
- **同じ URL と同じ指定を受け付ける**：今の画面が読んでいる `?id=` `?tab=` `?step=` `?folder=` などの指定は、新しい画面でも同じ名前・同じ意味で読む。BEHAVIOR.md に「受け付ける URL と指定」の節を作って書き出す
- **同じ保存先・同じ API**：localStorage の名前、呼ぶ API、送る形は今と同じにする（変えるなら BEHAVIOR.md に理由）
- 準備表：`design/v8/SWITCH-READINESS.md`（全ページの入口に V8 の画面があるか・合格したか）。本番の切り替えは、絵のあるページがすべて合格してから、環境変数 `NEXT_PUBLIC_ADMIN_THEME=v8` で一度に行う（外せば v7 に戻る）
