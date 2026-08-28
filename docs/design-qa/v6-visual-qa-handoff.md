# V6 画像比較の引き継ぎ書

最終更新：2026-08-28 22:00 JST

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

---

## 2. いまの数

```
総数 262 ／ 比較済み 189 ／ 未実装 69 ／ 未確認 0 ／ 別の仕掛け 4 ／ 未撮影 0
```

未実装69枚の内訳：**既存部品18／通常実装22／新規API24／除外候補5**

```bash
node scripts/visual-qa/ledger.mjs          # 進捗表（Markdown）
node scripts/visual-qa/ledger.mjs --json   # 集計値
node scripts/visual-qa/ledger.mjs --html   # 進捗ページ
node scripts/visual-qa/ledger.mjs --gaps   # 未実装の片づけ方
node scripts/visual-qa/capture-screens.mjs --check   # 行の数え上げ
```

**3つの出口は同じところから出ます。** 別々に書くと必ずどれかが古くなり、
古い数を根拠に「あと何枚」を話すことになります。

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
  why: 'status の理由。空にしない' }
```

`CAPTURED_AT` は機能ごとの配列です。**どの画面をどのheadで撮ったか**を持ち、
`--gaps` と進捗ページの「撮った先」に出ます。**空欄を確認済みと
読まないでください。**

---

## 5. 判定の言葉

| 言葉 | いつ使うか |
|---|---|
| **一致** | 設計どおり。実装が足したものは差として書く |
| **構造一致・データ未接続** | 形は同じ。数字や中身が繋がっていない |
| **要修正** | 直すところがある。P0/P1/P2 を付ける |
| **未実装** | 画面が無い。**撮らない。合格にもしない** |
| **未確認** | こちらが確かめていない。**いまは0枚** |

全画面に効く決めごと：

- **未取得は `—`、実値0は `0件`。** 混ぜない
- **未実装を合格画像にしない**
- **基準画像が以前と同じだけでは合格にしない**（6節の2番）
- 1440px・1920px の両方で見る。横スクロール・内部用語・押せない操作も

---

## 6. 何度も引っかかったこと

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

## 7. PRの状態

| PR | head | 状態 | 中身 |
|---|---|---|---|
| [#490](https://github.com/skmtmst/line-harness-oss/pull/490) | `ff33ee09` | MERGEABLE/CLEAN | 機能4の比較証拠。**維持** |
| [#491](https://github.com/skmtmst/line-harness-oss/pull/491) | `5078911d` | MERGEABLE/CLEAN | 自動応答の2点。**#430 の後に取り込む。単独マージしない** |
| [#492](https://github.com/skmtmst/line-harness-oss/pull/492) | `ea12afc7` | MERGEABLE/CLEAN | 台帳と比較文書の本体 |
| [#497](https://github.com/skmtmst/line-harness-oss/pull/497) | `84e5bab9` | **Draft** | 一斉配信の最終確認。**#495 → #497 の順。マージしない** |

`#492` は `codex/kenta-v6-feature4-remaining`（#490）の上に積んでいます。
**下から順に取り込んでください。**

### Codexへ返した指摘（PRコメント）

#420 / #421 / #433 / #441 / #444 / #445 / #446 / #447 / #448 / #450 /
#493 / #494 / #495

**#445 と #447 は解決済みとして閉じました。**

---

## 8. 文書

| 文書 | 中身 |
|---|---|
| [v6-progress-ledger.md](v6-progress-ledger.md) | 進捗表（生成物） |
| [v6-progress.json](v6-progress.json) / [v6-progress.html](v6-progress.html) | 同上 |
| [v6-unimplemented-gaps.md](v6-unimplemented-gaps.md) | **未実装69枚の片づけ方**（生成物） |
| [v6-parts-19-instructions.md](v6-parts-19-instructions.md) | **既存部品で作れる画面の実装指示書** |
| [v6-unconfirmed-cleared.md](v6-unconfirmed-cleared.md) | 未確認5枚を0にした記録 |
| [v6-visual-qa-pr-status.md](v6-visual-qa-pr-status.md) | PRの重なりと、撮り直しの履歴 |
| `<機能>-v6/design-qa*.md` | 機能ごとの比較結果 |

---

## 9. 次にやること

1. **`z3PB2` の設計突き合わせ。** 撮影は済んでいますが、設計HTML
   （`f17/z3PB2.html`）とまだ並べていません
2. **#497 の残差4件。** うち「除外の人数」はAPI側の話なのでCodexへ
3. **既存部品で作れる18枚。** 指示書のとおりに進める。優先は
   削除確認7枚 → 実行・停止の最終確認6枚 → そのほか5枚
4. **`s6MBc`。** CodexがDB・API基盤を実装中。**こちらは実装せず、
   V6設計との差分整理だけ**続ける
5. **未実装69枚の再確認。** 実装PRが進むたび、最新headで撮り直す
6. **設計側の食い違い**（記録だけにしてある分）を Pencil で直す

### 待っているもの

| 何 | 誰 |
|---|---|
| `s6MBc` のDB・API基盤 | Codex |
| #495 のマージ（#497 の前提） | Codex |

---

## 10. 覚えておくこと

- **`pnpm` は PATH にありません。** `./node_modules/.bin/…` か
  `../../node_modules/.bin/vitest` を直接叩く
- **反映履歴のゲートは箇条書きの行を見ます。** `^+[-*] ` に当たる行へ
  `@kenta #NNN 日付` を入れる。**PRを作ってから**書く
- **コミット前に `git diff --cached --check`。** `--cached` を付けないと
  意味がありません
- **force push しない**
- **worktree は外付け側へ。** `/private/tmp` は使わない
- **Pencil の `png` 書き出しは壊れています**（砂嵐）。`html-css` で
  書き出してChromiumで描く。まとめ書き出しは55秒で切れるので30個ずつ
- このマシンの時計は **UTC+7**。日時を書くときは `TZ=Asia/Tokyo` を明示
- 外付けの git は遅い。rebase / merge は背景で走らせて待つ
