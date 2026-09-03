# V6 第 2 ラウンド 並列作業計画(2026-09-03)

目的: 262 画面を Pencil ★V6 と一致させ、「準備中」を 0 にし、動かない操作は文言で理由が出る状態にする。目標 9 月末。
体制: 撮影側 Claude を 4 セッション(S0 共通部品 + S1〜S3 機能担当)、Codex 1 セッション、Pencil の修正は Claude(Pencil の AI)。モデルは全セッション Opus 5。

## 1. 順番(衝突しないための決めごと)

1. **S0 が先に走る(第 1 週前半)。** 共通部品を直すと全画面が変わるので、S1〜S3 が同時に画面を触ると衝突する。S0 の 4 本の PR がマージされるまで、S1〜S3 は「撮影と判定」だけを行い、画面のコードは触らない。
2. **Pencil の修正 50 件は S0 と並行**(人が Pencil の AI に `docs/v6-pencil-fix-prompt.md` を貼る)。反映された機能から S1〜S3 が設計を書き出し直す。
3. **S0 完了後、S1〜S3 が機能ごとに画面を直す。** 1 機能 1 PR、当日マージ。

## 2. 所有範囲(この外を触るときは Slack で宣言)

| セッション | 担当 | 所有するパス |
|---|---|---|
| S0 共通部品 | 部品と土台 | apps/web/src/components/shared/、apps/web/src/components/layout/、apps/web/src/components/shell/、apps/web/src/app/globals.css、apps/web/src/components/app-shell.tsx、scripts/visual-qa/(ハーネス本体) |
| S1 | 機能 1〜5(ダッシュボード、受信箱、友だち、友だち属性、シナリオ配信。68 画面) | apps/web/src/app/{page.tsx, chats, friends, tags, scenarios, duplicates, users}、apps/web/src/components/{dashboard, chats, friends, friend-fields, scenarios}、docs/design-qa と docs/design-reference の {dashboard, inbox, friends, friend-attributes, scenarios}-v6、screens.mjs の該当区画 |
| S2 | 機能 6〜13(一斉配信、リマインダ、自動応答、友だち追加時配信、ウェビナー、テンプレート、リッチメニュー、回答フォーム。86 画面) | apps/web/src/app/{broadcasts, reminders, auto-replies, friend-add-settings, webinars, templates, rich-menus, forms}、対応する components、design-qa と design-reference の同名 -v6、screens.mjs の該当区画 |
| S3 | 機能 14〜32(共通情報、メディア、成果、マイル、流入、コンバージョン、分析、NEN、写真審査、EC、LINE 通知、オートメーション、外部連携、予約 3 種、ログインユーザー、機能設定、運用状態。108 画面) | apps/web/src/app/{contents, media, affiliates, conversions, mileage, inflow-links, analytics, nen, photo-review, ec-commerce, line-notifications, automations, webhooks, booking, events, staff, settings, emergency}、対応する components、同名 -v6、screens.mjs の該当区画 |
| Codex | API・性能・段取り | apps/worker、packages/db、.github、ツール設定 |
| pen(Pencil デザイン修正、Opus 5 + Pencil MCP) | Pencil ★V6 の修正 50 件と設計画像の書き出し | Pencil の .pen、docs/design-reference/*-v6、docs/v6-requirements/v6-32-feature-cross-review.md §7 の反映日 |
| fix(Codex エラー修正) | 品質チェックとステージングで見つかった不具合を 1 件 1 PR で直す | 指摘されたファイル(所有パスの例外。司令塔が Issue で承認) |
| qa(品質チェック ×4、Codex、読み取り専用) | エラー / コード / 速度 / セキュリティの定時検査。直さず起票する | 読み取りのみ。書くのは line-harness-board の Issue だけ |

- `scripts/visual-qa/screens.mjs` は 1 ファイルだが、各セッションは自分の機能の区画だけを編集する。区画をまたぐ変更(共通の定数や関数)は S0 だけが行う。
- `docs/design-qa/v6-progress-ledger.md` と `v6-progress.json` は生成物。**手で直さず、PR の最後に `node scripts/visual-qa/ledger.mjs` で再生成する。** 競合したら相手の変更を取り込んでからもう一度生成する。
- ブランチ名は `codex/kenta-r2-s1-<機能番号>` のように、セッションと機能を入れる。base は常に codex/development。別の PR の上に PR を作らない。

## 3. 各セッションの開始手順(全セッション共通)

```
1. git worktree add ../lh-<セッション名> -b codex/kenta-r2-<セッション名>-<機能> origin/codex/development
2. pnpm install --frozen-lockfile
3. 手元テストは NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 を付ける
4. 撮影は node scripts/visual-qa/mock-api.mjs と pnpm qa:web を起動してから capture-screens.mjs
5. 毎朝 git merge origin/codex/development。1 日の終わりに PR をマージし、翌日に下書きを残さない
6. 反映履歴は docs/release-log/unreleased/<PR番号>-kenta-<内容>.md。PR 番号は採番してから書く
```

## 4. そのまま貼る指示

### S0 共通部品(Opus 5)

```
目的: 共通部品を Pencil ★V6 に合わせ、全画面を一度に変える。担当は部品と土台だけ。機能の画面は触らない。
所有: apps/web/src/components/shared、layout、shell、app-shell.tsx、globals.css、scripts/visual-qa。
正本: Pencil ★V6 → docs/v6-common-rules.md → 要件書 → 契約テスト。

順番(1 部品 1 PR、当日マージ):
1. list-toolbar.tsx の「準備中」を全廃。フォルダ・並び順・表示件数・保存した条件は、動くまで描かない(v6-common-rules §5-5)。どうしても位置を見せる場合は BlockedAction(not-connected.tsx)で理由を本文の文字で出す。契約テストで「page.tsx が『準備中』を含まない」を全 130 ページに適用する(既存の個別テストを一般化)。
2. 色トークンを 1 系統に。--color-v6-accent 系を --color-accent 系へ寄せ、主ボタンは既存の --color-accent-deep(#087a3e)+ 白文字にし、同値の別名トークンは新設しない(索引 §5-2)。--color-v6-ink-faint(#8b938d)は捨てて #6e7781 へ。角丸の同値別名(10px×3、8px×3、3px×2)を削る。globals.css に同値トークンが 2 つ以上無いことを契約テストで固定。
3. PageHeader を 130 ページへ。本文の H1 とトップバーの画面名の二重表示を無くす。契約テストで「page.tsx が h1 を直接持たない」を禁止。
4. StickyBar を全「作成・編集」画面へ。下部追従バーの並び(削除左・他は中央)を部品で固定。
5. 素の select 222 行を shared/select へ。契約テストで「page.tsx が <select を直接持たない」を禁止。
6. 素の confirm() / alert() 51 箇所を shared/confirm-dialog へ(booking 6、rich-menus/edit 16 ほか)。
7. 失敗状態の部品(ListState の error)に「再読み込み」を足し、権限不足(forbidden)の状態を描く。読込中・空のときは KPI を「—」、ページ送りを消す規則を部品で固定。
8. filter-chip など :focus-visible の無い共通 CSS 10 本に追加し、契約テストの対象を全 shared CSS に広げる。

守ること: 機能の画面ファイル(app/<機能>/page.tsx)は触らない。触る必要が出たら S1〜S3 に渡す。各 PR で web テスト全件と、影響画面の撮影(1440・1920)を添える。
```

### S1〜S3 機能担当(Opus 5。<機能一覧> と <所有パス> を差し替えて貼る)

```
目的: 担当機能 <機能一覧> の全画面を Pencil ★V6 と一致させ、「準備中」0、動かない操作は文言で理由が出る状態にする。
所有: <所有パス>。components/shared と globals.css は S0 の領域。部品の不足を見つけたら直さずに S0 へ Slack で渡す。
正本: Pencil ★V6 → docs/v6-common-rules.md → 要件書(docs/v6-requirements/v6-<番号>-*.md) → 契約テスト。
進捗の正本: docs/design-qa/v6-progress-ledger.md(生成物。手で直さない)。

第 1 段(S0 の PR がマージされるまで): 撮影と判定だけ。
- 担当機能の設計画像(docs/design-reference/<機能>-v6)が最新の Pencil から書き出されているか確認。Pencil の修正 50 件のうち担当機能分が反映されたら書き出し直す。
- 実装画像を撮り(capture-screens.mjs)、compare-text.mjs で文字を照合し、screens.mjs の担当区画に判定を書く。判定は短く構造化する: 一致 / 構造一致・データ未接続 / 要修正(足りない部品名、文言、寸法) / 未実装(理由: api / route / drop)。
- 「準備中」「取得できません」「unavailable」「内部語」の出現箇所を機能ごとに一覧にする。

第 2 段(S0 完了後): 1 機能 1 PR で画面を直す。
- 設計との差を部品の参照差し替えで埋める(自前で描かない)。
- 動かない操作は描かないか、BlockedAction で「まだ接続されていません」「権限がありません」など理由を本文に出す。
- 未取得は「—」+「未取得 / 取得失敗 / 権限不足 / 未接続」。0 と混ぜない。
- 全状態(空・読込・失敗・権限不足・確認・完了)を撮る。1440 と 1920 の両方で横スクロール 0、名前列が省略されないことを確認。
- 「一致」は文言一致 + 寸法一致 + 全状態撮影済みのときだけ。PR の最後に ledger.mjs で台帳を再生成し、一致数の増分を PR 本文に書く。
- バックエンドが無い画面(API 待ち 8、ルート不在 8)は、画面側で「未接続」を出して一致扱いにしない。必要な API は Codex へ Slack で渡す。

守ること: 担当外の機能と shared を触らない。翌日に下書きを残さない。PR 番号を先取りしない。
```

## 5. Pencil の修正(人が Pencil の AI に貼る)

`docs/v6-pencil-fix-prompt.md` に 50 件を 1 件ずつ貼れる形で置いた。優先度順(1〜29 要件由来、30〜50 設計画像由来)。主ボタン色の変更($accent-deep #087A3E + 白文字)は 40 番。反映したら `docs/v6-requirements/v6-32-feature-cross-review.md` §7 の該当行に日付を書き、S1〜S3 に Slack で知らせる。

## 6. 週次の見込み

| 週 | S0 | S1〜S3 | Pencil |
|---|---|---|---|
| 〜9/10 | 8 本の部品 PR | 撮影と判定(第 1 段) | 50 件反映 |
| 〜9/17 | 残りの部品、S1〜S3 からの依頼 | 第 2 段開始。各セッション 1 日 1〜2 機能 | 反映分の書き出し直し |
| 〜9/24 | 1440 折り返し規則 | 第 2 段継続 | — |
| 〜9/30 | — | 残り潰し、全状態撮影 | — |
