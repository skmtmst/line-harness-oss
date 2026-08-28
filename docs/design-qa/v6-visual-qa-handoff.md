# V6 画像比較の引き継ぎ書

最終更新：2026-08-28 23:50 JST

**手で数字を書き写さないでください。** 数はすべて
`scripts/visual-qa/screens.mjs` から機械で出します。

---

## 1. 担当の範囲

| やること | やらないこと |
|---|---|
| Pencil V6 設計画像の書き出し | Worker・DB・migration・API実装 |
| 実装画像の撮影（1440px・1920px） | Codex の実装PRのマージ |
| 設計と実装の比較 | 未実装画面を合格画像として登録すること |
| 未一致・未実装の分類 | 固定値で実データがあるように見せること |
| Visual QA文書と進捗台帳の更新 | |

**画面側の直しは、原則としてCodexへ渡します。** Node ID・ルート・優先度・
推奨修正を書いてPRへコメントします。

**例外が2つあります。** どちらも指示を受けて作ったものです。

- [#491](https://github.com/skmtmst/line-harness-oss/pull/491) 自動応答の段番号と `toDraft`（#450 からの切り出し）
- [#497](https://github.com/skmtmst/line-harness-oss/pull/497) 一斉配信の最終確認（**Draft。マージしない**）
- [#499](https://github.com/skmtmst/line-harness-oss/pull/499) スコアのルールの文言と幅（**Draft。マージしない**）

**設計（Pencil）も2回直しました。** どちらも「取れない数が描いてある」
のを外したものです（10節）。

---

## 2. いまの数

```
総数 262 ／ 比較済み 195 ／ 未実装 63 ／ 未確認 0 ／ 別の仕掛け 4 ／ 未撮影 0
```

**「比較済み」は「合っていた」ではありません。** 2026-08-28 に
判定（`verdict`）を台帳へ入れたので、いまは内訳が機械で出ます。

```
一致 6 ／ 構造一致・データ未接続 16 ／ 要修正 96 ／ 未実装 63 ／ 未判定 77
完了まで残り 252
```

**未判定77は、元の文書で「撮影済み・突き合わせ中」だったものです。**
画像の有無から推測して一致にはしていません。`--check` はこの77件を
1つずつ挙げて落ちます。**落ちるのは意図どおりです。**

未実装63枚の内訳：**通常実装22／既存部品16／新規API20／除外候補5**

```bash
node scripts/visual-qa/ledger.mjs          # 進捗表（Markdown）
node scripts/visual-qa/ledger.mjs --json   # 集計値
node scripts/visual-qa/ledger.mjs --html   # 進捗ページ
node scripts/visual-qa/ledger.mjs --gaps   # 未実装の片づけ方
node scripts/visual-qa/capture-screens.mjs --check   # 行と判定の検査
```

**3つの出口は同じところから出ます。** 別々に書くと必ずどれかが古くなります。

### 本番までの距離

**V6は1画面も本番に出ていません。**

| | |
|---|---|
| `main` へ取り込まれたPR | **0件** |
| `codex/development` が `main` より進んでいる数 | **1515コミット** |
| 本番へ運ぶPR [#258](https://github.com/skmtmst/line-harness-oss/pull/258) | **開いたまま** |
| 比較済みのうち、未取り込みDraftのheadでしか撮っていない画面 | **28枚** |

全画面がそろった機能は **8つ**（1・2・19・28・29・30・31・32）です。

---

## 3. 作業の場所

| 何 | 場所 | 枝 |
|---|---|---|
| 台帳・比較文書 | `line-harness-worktrees/v6-visual-qa` | `codex/kenta-v6-feature21-recheck`（#492） |
| PRのheadを立てる | `line-harness-worktrees/v6-f18-443` | detach で切り替える |
| #497 の作業場 | `line-harness-worktrees/broadcast-confirm` | `codex/kenta-v6-broadcast-final-confirm` |
| #491 の作業場 | `line-harness-worktrees/auto-reply-extract` | `codex/kenta-auto-reply-draft-and-order` |

設計HTML：`/Volumes/My Passport/Github/v6-design-ref/f<機能番号>/<NodeID>.html`
**262枚ぶんすべて書き出し済み。** Pencil を叩き直す必要はありません。

### 立てるもの

| ポート | 何 | どこから |
|---|---|---|
| 8788 | 固定データの口 | `node scripts/visual-qa/mock-api.mjs` |
| 3103 | 画面（PRのhead） | `v6-f18-443/apps/web` から `next dev --port 3103` |

```bash
# PRのheadで撮る
cd .../v6-f18-443 && git checkout -q --detach origin/<枝名>
lsof -nP -iTCP:3103 -sTCP:LISTEN -t | xargs -r kill -9
cd apps/web && (NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 nohup ./node_modules/.bin/next dev --port 3103 > /tmp/next3103.log 2>&1 < /dev/null &)
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:3103/ && break; sleep 5; done

cd .../v6-visual-qa
VISUAL_QA_BASE=http://localhost:3103 node scripts/visual-qa/capture-screens.mjs --feature N --impl --only <NodeID>
```

**`--only` を必ず付けてください。** 理由は6節の1番。

---

## 4. 道具

| ファイル | 何をするもの |
|---|---|
| `screens.mjs` | **262行の台帳の正本。** 撮り方も分類もここに書く |
| `capture-screens.mjs` | 撮る。`--feature` `--impl` `--design` `--only` `--check` |
| `ledger.mjs` | 数える。`--json` `--html` `--gaps` |
| `fixtures.mjs` | 固定データ |
| `mock-api.mjs` | 固定データの口（8788番） |
| `design-text.py` | 設計HTMLから文字を出す |
| `diagnose.mjs` | 画面が落ちた原因を探す |
| `capture.spec.mjs` | 基準画像（CSV取り込みなど、ファイル選択が要るもの） |

### `screens.mjs` の書き方

```js
{ node: 'NodeID', feature: 6, name: '6-1-H 最終確認',
  dir: 'broadcasts-v6', route: '/broadcasts/new',
  mode: 'page' | 'viewport', height: 1080,
  steps: [{ click: 'ラベル', scope: 'main' },
          { fill: 'main textarea', selector: true, text: '…', after: 1500 },
          { wait: 900 }],
  states: { apis: ['**/api/…*'], kinds: ['normal','loading','empty','error'] },
  status: 'unimplemented' | 'elsewhere',
  shots: 'tags-csv-select',       // elsewhere のときの基準画像名
  gap: 'parts'|'build'|'api'|'drop'|'pending',
  gapNote: '**何が要るか**を書く。「無い」では足りない',
  why: 'status の理由。空にしない',

  /* 判定。**`status` とは別。5節を読んでから書く** */
  verdict: 'match'|'structure_match_data_pending'|'needs_fix',
  verdictNote: 'P1×5' / '未接続の中身',
  verdictSource: '<機能>-v6/design-qa-….md',
  verdictHead: '75b010fc' }
```

`CAPTURED_AT` は機能ごとの配列です。**どの画面をどのheadで撮ったか**を持ち、
`--gaps` と進捗ページの「撮った先」に出ます。**空欄を確認済みと
読まないでください。**

---

## 5. 判定の言葉

**台帳が持ちます。手で数えません。**

```js
verdict: 'match' | 'structure_match_data_pending' | 'needs_fix',
verdictNote:   'P1×5' / '未接続の中身',   // 何を直すか・何が繋がっていないか
verdictSource: '<機能>-v6/design-qa-….md', // どこで判定したか
verdictHead:   '75b010fc',                  // 判定したときのPR head
```

| 言葉 | `verdict` | いつ使うか |
|---|---|---|
| 一致 | `match` | 設計どおり。実装が足したものは差として書く |
| 構造一致・データ未接続 | `structure_match_data_pending` | 形は同じ。**何が繋がっていないかを書く** |
| 要修正 | `needs_fix` | **P0/P1/P2 か参照先を残す** |
| 未実装 | （`status`側） | 画面が無い。**撮らない。合格にもしない** |
| 未判定 | 空 | まだ判定していない。**自動で一致にしない** |

**実装の状態（`status`）と判定（`verdict`）は別です。**
「撮れた」と「合っていた」は違います。

### `--check` が見るもの（7つ）

1. 比較済みなのに `verdict` が無い → 落ちる
2. `status: 'unimplemented'` を `match` にできない
3. 空欄を自動で一致にしない（1と同じ入口）
4. `structure_match_data_pending` に `verdictNote` が無い → 落ちる
5. `needs_fix` に P0/P1/P2 も参照先も無い → 落ちる
6. 合計が 262 でない → 落ちる
7. `verdictHead` と `CAPTURED_AT` の最新 head がずれていたら**見直しに挙げる**

**5つとも、わざと壊して落ちるところまで確かめてあります。**
数え上げは**落ちるときにも出します**（出さないと「あと何枚か」が消える）。

全画面に効く決めごと：

- **未取得は `—`、実値0は `0件`。** 混ぜない
- **未実装を合格画像にしない**
- **基準画像が以前と同じだけでは合格にしない**（6節の2番）
- 1440px・1920px の両方で見る。横スクロール・内部用語・押せない操作も

---

## 6. 何度も引っかかったこと

**0. 「既にある」と書く前に、定義ではなく書き手を探す。**
これが**いちばん高くついた**間違いです。`messages_log` の `origin_kind` を
「同じ問題を先に解いた前例」として引き、その上に7画面ぶんの設計の勧めを
積んで、pushした文書に書きました。**実際には使われていない列でした。**

```bash
# 定義があることは、使われていることの証拠にならない
grep -rn "origin_kind" --include="*.ts" . | grep -v "SELECT\|ADD COLUMN\|CREATE INDEX"
#   → 読み手が1か所。**書き手はゼロ。**
```

`packages/db/migrations/108_message_origin.sql` の本文にこう書いてあります。

> 使わない列を足してしまった。消せないので、なぜ使わないかを残す。
> （中略）**どこからも読み書きしない。**
> 突き合わせ表を書いたときに実物を確かめず、「記録していない」と決めつけていた。

**同じ間違いの記録が、その列自身に残っていました。** それを読まずに、
その列を前例にしました。

**外すのは決まって「コードベースには既にこれがある」という主張です。**
画面を見て言ったことは外していません。だから効く確かめ方も1つに絞れます。
**定義・型・索引・読み手ではなく、書き手を1つ見つける。** `grep` 1回です。

同じ形の失敗が今回3つありました。**推測したAPIの道を2本用意した**
（実物は3本目）／**259バイトの入れ物をコピーして「控えた」と言いかけた**
（中身は `~/.pencil/backup/` にある）／**PencilのPNG書き出しが古い絵を
返していた**（バイト数まで同じ）。どれも**先に1回確かめれば済みました。**

**1. 1つの機能が複数のPRに分かれる。**
機能4は #420（友だち情報欄）と #421（保存した検索）が別々に進み、
**#421 は #420 を含みません。** #421 の head で機能4を丸ごと撮り直したら、
#420 で直った絵が直る前に戻りました。→ **`--only` で絞る。**
撮ったあと `git status` を見て、頼んでいない画面が M になっていないか
確かめてください。

**2. 同じ絵でも読み直す。**
機能21では7枚中4枚が1バイトも同じでしたが、その同じ絵から
**前回見落としていたP0が2件**出ました。「変わっていない＝前回見たとおり」は、
前回が正しかったことを前提にしています。

**3. 画面が落ちる原因は、たいてい実装ではなく固定データの形。**
いままで**16回**。型に照らして書いてください。

| 直したもの | 出ていたもの |
|---|---|
| `usedIn` を入れていない | 成果地点の画面が落ちて撮れない |
| `insights` `connections` を入れていない | マイル明細が落ちて撮れない |
| 一覧の既定（配列）を返す | 行動スコアの空状態が落ちる |
| `usageCount` `isFavorite` を入れていない | 「undefined件で使用」「よく使うが常に0件」 |

**4. 値の慣習は型に出ない。**
割合は **0〜1**。`68.7` と書くと **6870%** と撮れます
（worker の試験が `0.5`＝2人中1人で揃えている）。
あと一歩で「通過率が100倍になる不具合」と報告するところでした。

**5. キーは実データから取る。**
NEN配信のキーを自作の名前で書いていて、画面の `campaignKey` 分岐に
**一度も当たっていませんでした**。`eventType` `source` `kind` も同じで、
**画面の当てはめ表にある言葉から選びます。**

**6. 前検査（CORS）が足りないと、実装のせいに見える。**
手動マイル調整で `Failed to fetch` が出て、実装が生のエラーを
出していると思いました。**こちらの `Access-Control-Allow-Headers` が
足りず、ブラウザが弾いていた**だけです。いまは
`Access-Control-Request-Headers` をそのまま返します。
**書き込みそのものは405のままです**（保存できたつもりの絵を撮らないため）。

**7. 数えるだけの POST は通す。**
`/api/broadcasts/preflight` を405で弾いていたため、配信前チェックが
**置き文のまま**でした。何も保存しない口だけ `READ_ONLY_POSTS` に
入れてあります。

**8. 押せる ≠ 効く。**
窓が出ることと、口が呼ばれることは別です。フォルダ操作もマイル調整も、
**押して飛んだ口まで**見ました（`POST /api/folders`、
`PATCH /api/folders/:id`、`PUT /api/mileage/rules/:id`、
`POST /api/mileage/adjustments`）。

**9. 窓は `mode: 'viewport'` で撮る。**
`page`（全面）では `position: fixed` が崩れます。

**10. 試験は、わざと壊して落ちるところまで見る。**
`#491` と `#497` で実際にやりました。

---

## 7. 実行の記録：契約が決まりました

**7機能ぶんの「動いた記録」の画面は、1つの契約に乗ります。**
`packages/shared/src/types.ts`（#500 で入り、#501・#502 が写した）。

```ts
ExecutionOwnerKind  broadcast reminder scenario auto_reply manual user
                    automation notification integration     （9つ）
ExecutionRunStatus  succeeded failed partial skipped pending cancelled （6つ）
ExecutionRunListItem
  occurredAt subject accountLabel triggerLabel reference
  status detail durationMs canRetry               （共通9項目）
```

**物理テーブルは1本にしません。** 各機能の書込台帳はそのまま残し、
**読む口の形だけ揃えます。** 機能固有の状態は `domainStatus` に置き、
共通状態へ潰しません。

| Node | 機能 | PR | 判定 | 読む先 |
|---|---|---|---|---|
| `GC4St` | 7 リマインダ | #500 `409f00bb` | **要修正 P1×5** | 新しい台帳 |
| `t7UtYQ` | 8 自動応答 | #501 `93edbe17` | **一致** | 新しい台帳 |
| `DkPY0` | 25 オートメーション | #502 `75b010fc` | **一致** | **既存の `automation_runs`** |
| `M2b2B` | 5 シナリオ | #503 `6db5ad7f` | **一致** | **既存の `ScenarioStats`** |
| `Se65i` `X8JCA5` | 24 LINE通知 | 未着 | — | `ec_events` ＋ `messages_log` の見込み |
| `KNG00` | 26 外部連携 | 未着 | — | **読む先が無い** |

**#502・#503 でやり方が決まりました。まず「既存を読めないか」を見ます。**

### `t7UtYQ`・`DkPY0` が手本です

- **失敗と「何もしていない」を必ず分ける**（`skipped` を成功にも失敗にも寄せない）
- **空でも、並べる元が無いものは `—`**（`DkPY0` は空のとき
  「動いた 0回」と「いちばん動いた —回」を同じ画面に出す）
- **失敗の理由は口の側で日本語にする**（`safeFailureReason`。
  画面が `failure_code` を知らなくて済む）

**#500 で返した5件のうち4件は、#501 では最初から起きていません。**
`GC4St` を直すときの手本にできます。

---

## 8. PRの状態

| PR | head | 状態 | 中身 |
|---|---|---|---|
| [#490](https://github.com/skmtmst/line-harness-oss/pull/490) | `ff33ee09` | MERGEABLE | 機能4の比較証拠。**維持** |
| [#491](https://github.com/skmtmst/line-harness-oss/pull/491) | `5078911d` | MERGEABLE | 自動応答の2点。**#430 の後。単独マージしない** |
| [#492](https://github.com/skmtmst/line-harness-oss/pull/492) | `96e16458` | MERGEABLE | **台帳と比較文書の本体** |
| [#497](https://github.com/skmtmst/line-harness-oss/pull/497) | `84e5bab9` | **Draft** | 一斉配信の最終確認。**#495 → #497。マージしない** |
| [#499](https://github.com/skmtmst/line-harness-oss/pull/499) | `642b8222` | **Draft** | スコアのルールの文言と幅。**#496 → #499。マージしない** |

`#492` は `#490` の上に積んでいます。**下から順に取り込んでください。**

### Codexへ返した指摘

#420 / #421 / #433 / #441 / #444 / #445 / #446 / #447 / #448 / #450 /
#493 / #494 / #495 / #496 / #500

**#445・#447 は解決済みとして閉じました。**

### 止まっている12枚

確認画面12枚は、**12枚すべてが同じファイルを触る未統合PRにふさがれて**
います（[v6-parts-12-confirm-blocked.md](v6-parts-12-confirm-blocked.md)）。
**どのPRも確認の窓は作っていません。順番がぶつかっているだけです。**
取り込みを待って上から実装する、で合意しています。

---

## 9. 文書

| 文書 | 中身 |
|---|---|
| [v6-progress-ledger.md](v6-progress-ledger.md) | 進捗表と**判定の内訳**（生成物） |
| [v6-progress.json](v6-progress.json) / [v6-progress.html](v6-progress.html) | 同上 |
| [v6-unimplemented-gaps.md](v6-unimplemented-gaps.md) | **未実装63枚の片づけ方**（生成物） |
| [v6-api-requirements-rollup.md](v6-api-requirements-rollup.md) | **未実装の口の要りようを7つに束ねたもの** |
| [v6-execution-records-remaining-4.md](v6-execution-records-remaining-4.md) | 残る `Se65i` `X8JCA5` `KNG00` の下ごしらえ |
| [v6-parts-12-confirm-blocked.md](v6-parts-12-confirm-blocked.md) | 確認画面12枚がふさがれている記録 |
| [v6-parts-19-instructions.md](v6-parts-19-instructions.md) | 既存部品で作れる画面の実装指示書 |
| [v6-recheck-496-and-classification.md](v6-recheck-496-and-classification.md) | 分類を直した記録（`GMvBd` `LT8RS` ほか） |
| [v6-unconfirmed-cleared.md](v6-unconfirmed-cleared.md) | 未確認5枚を0にした記録 |
| `<機能>-v6/design-qa*.md` | 機能ごと・PRごとの比較結果 |

---

## 10. 次にやること

1. **未判定77件を減らす。** いちばん効きます。`--check` が1件ずつ
   挙げるので、上から `design-qa.md` を読んで `verdict` を入れる。
   **画像の有無から推測しない**
2. **`GC4St` のP1×5。** `t7UtYQ` が手本。とくに
   「失敗したのに『0件』と書く」と「1440pxで列が切れる」
3. **`Se65i`・`X8JCA5`。** 読む先は `ec_events` ＋
   `messages_log(source='ec_transactional')`。**`ec_events` に
   `line_account_id` は無く、`friend_id` は `null` になりうる。
   所属アカウントを推測で出さない**
4. **`KNG00`。** 4枚のうちここだけ読む先が無い。**`DkPY0` と形が
   ほぼ同じなので、先にそちらを見て写せるか確かめる**
5. **確認画面12枚。** ふさいでいるPRが取り込まれた順に
6. **設計側の食い違い**（記録だけにしてある分）を Pencil で直す

### 設計側で直したもの・残っているもの

**直した（2件）**

| Node | 何を |
|---|---|
| `s6MBc` | 「メッセージを開いた ＋2」の行を消し、理由を1行足した |
| `GC4St` | 開封率の列（見出し1・セル3）を消し、注記を1行足した |

**残っている（取れない数が設計に描いてある）**

| Node | 設計の数 |
|---|---|
| `M2b2B` | ステップ別の反応「開封 82.4%・74.8%・69.2%」 |
| `Se65i` | 「開かれた 3,682通 96.2%」＋行ごとの「読まれた」列 |
| `M2b2B` | 「エラー 3人」／`KNG00` 「返事までの時間 平均0.4秒」 |

**Pencilを直すときは、必ず控えを取ってから**（10節）。

### 待っているもの

| 何 | 誰 |
|---|---|
| `Se65i`・`X8JCA5`・`KNG00` の実装PR | Codex |
| #495 のマージ（#497 の前提）／#496 のマージ（#499 の前提） | Codex |
| 確認画面12枚をふさいでいる11本の取り込み | Codex |

---

## 11. 覚えておくこと

- **`pnpm` は PATH にありません。** `./node_modules/.bin/…` か
  `../../node_modules/.bin/vitest` を直接叩く
- **反映履歴のゲートは箇条書きの行を見ます。** `^+[-*] ` に当たる行へ
  `@kenta #NNN 日付` を入れる。**PRを作ってから**書く
- **コミット前に `git diff --cached --check`。** `--cached` を付けないと
  意味がありません
- **force push しない**
- **worktree は外付け側へ。** `/private/tmp` は使わない
- **Pencil の `png` 書き出しは古い絵を返します**（バイト数まで同じ）。
  `html-css` で書き出して撮影ハーネスに通す。
  **`html-tailwind` では駄目**（`sizeFromHtml` が幅を読めない）
- **Pencil の `filePath` は効きません。** どの道を渡しても、
  いま開いている1つの文書を触ります。**複製の読み比べには使えない**
- **`.pen` ファイルは259バイトの入れ物です。** 中身は
  `~/.pencil/backup/` に指紋の名前で置かれます。**控えはそちらを写す**
- このマシンの時計は **UTC+7**。日時を書くときは `TZ=Asia/Tokyo` を明示
- 外付けの git は遅い。rebase / merge は背景で走らせて待つ
