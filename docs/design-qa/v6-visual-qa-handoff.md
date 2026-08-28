# V6 画像比較の引き継ぎ（2026-08-28）

262枚の設計と実装を突き合わせる作業の、いまの状態と続け方。
**会話を切っても、ここと `screens.mjs` があれば続けられます。**

---

## 1. 担当の範囲

**設計画像・実装画像・比較判定・Visual QA台帳だけ**を担当します。

| やること | やらないこと |
|---|---|
| Pencil から設計画像を書き出す | `apps/worker/**` |
| 実装画像を 1440px・1920px で撮る | `packages/db/**` |
| 設計と実装を並べて比べる | migration |
| 一致／構造一致・データ未接続／要修正／未実装／未確認 に分ける | API実装 |
| 台帳と比較文書を更新する | **アプリの画面（`apps/web/**`）** |

**画面側の修正が要るときは、直接変えずに Node ID・ルート・差・推奨修正を
文書に書いて Codex へ渡します。**

> 2026-08-28 の途中まで、わたしは画面を直していました（#424 #448 #450 #457）。
> そのあと範囲が変わっています。**いまは直しません。**

---

## 2. いまの数（2026-08-28 時点）

| | 枚数 |
|---|---|
| 画面総数 | **262** |
| 比較済み | **177**（67.6%） |
| 未実装 | **74** |
| 未確認 | **7** |
| 別の仕掛けで撮影 | **4** |
| 未撮影 | **0** |

**この数を手で書き写さないでください。** 必ず生成器から出します。

```bash
node scripts/visual-qa/ledger.mjs          # 進捗台帳（Markdown）
node scripts/visual-qa/ledger.mjs --json   # 集計値
node scripts/visual-qa/ledger.mjs --html   # v6-progress.html
```

出力先：`docs/design-qa/v6-progress-ledger.md` / `v6-progress.json` / `v6-progress.html`

---

## 3. 作業の場所と、動かし方

### 作業する worktree

```
/Volumes/My Passport/Github/line-harness-worktrees/v6-visual-qa
```

いまの枝：`codex/kenta-v6-feature4-remaining`（head `64c6c19a`）

### 設計HTMLの置き場（リポジトリの外）

```
/Volumes/My Passport/Github/v6-design-ref/f<機能番号>/<NodeID>.html
```

**262枚ぶんすべて書き出し済み**です。Pencil をもう一度叩く必要はありません。

### 立てるもの

| ポート | 何 | どこから |
|---|---|---|
| 8788 | 固定データの口 | `node scripts/visual-qa/mock-api.mjs` |
| 3101 | 画面（自分の枝） | `apps/web` で `./node_modules/.bin/next dev --port 3101` |
| 3103 | 画面（PRのhead確認用） | `v6-f18-443` worktree の `apps/web` から port 3103 |

**`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788` を必ず付ける。**

**固定データを直したら、口を立て直す。** そうしないと古い返事のまま撮ります。

```bash
pkill -f "visual-qa/mock-api.mjs"; sleep 1
nohup node scripts/visual-qa/mock-api.mjs > /tmp/mock.log 2>&1 &
```

### PRのheadで撮り直すとき

`v6-f18-443` worktree を使い回します（`node_modules` は本体への symlink 済み）。

```bash
cd .../v6-f18-443 && git checkout -q --detach origin/<枝名>
lsof -nP -iTCP:3103 -sTCP:LISTEN -t | xargs -r kill -9
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 ./node_modules/.bin/next dev --port 3103 &
until curl -sf -o /dev/null http://127.0.0.1:3103/; do sleep 2; done
cd .../v6-visual-qa
VISUAL_QA_BASE=http://localhost:3103 node scripts/visual-qa/capture-screens.mjs --feature N --impl
```

---

## 4. 道具

| ファイル | 何をする |
|---|---|
| `scripts/visual-qa/screens.mjs` | **台帳の正本。** 262行。撮り方をデータで持つ |
| `scripts/visual-qa/capture-screens.mjs` | 撮る（`--check` / `--impl` / `--design`） |
| `scripts/visual-qa/ledger.mjs` | 台帳・JSON・HTMLを機械で出す |
| `scripts/visual-qa/diagnose.mjs` | 落ちた画面の原因を、口の返事の形から当てる |
| `scripts/visual-qa/design-text.py` | 設計HTMLから文言を読む（画像より桁違いに安い） |
| `scripts/visual-qa/fixtures.mjs` | 固定データ（88件） |
| `scripts/visual-qa/mock-api.mjs` | 固定データを返す口 |
| `scripts/visual-qa/capture.spec.mjs` | 基準画像（CSV取り込み4枚はこちらが撮る） |

### 1機能ぶんの手順

```bash
# 0. 枝を切る（前の機能の枝から積む）
git checkout -b codex/kenta-v6-featureN-visual

# 1. 設計の文言を読む
python3 scripts/visual-qa/design-text.py /Volumes/My\ Passport/Github/v6-design-ref/fN/<id>.html 64 45

# 2. 画面が落ちるなら、口の返事の形から当てる
node scripts/visual-qa/diagnose.mjs "/そのルート"

# 3. screens.mjs に行を足す → 検査 → 撮る
node scripts/visual-qa/capture-screens.mjs --check
node scripts/visual-qa/capture-screens.mjs --feature N --impl
node scripts/visual-qa/capture-screens.mjs --feature N --design

# 4. 比較文書を書く → 台帳を出し直す
node scripts/visual-qa/ledger.mjs > docs/design-qa/v6-progress-ledger.md
node scripts/visual-qa/ledger.mjs --json > docs/design-qa/v6-progress.json
node scripts/visual-qa/ledger.mjs --html > docs/design-qa/v6-progress.html

# 5. 単体テスト
cd apps/web && npx vitest run --config vitest.config.ts
```

### `screens.mjs` の書き方

```js
{
  node: 'M1EXwB',              // Pencil の実ノードID
  feature: 7,                  // 機能番号
  name: '7-1 リマインダ',
  dir: 'reminders-v6',         // 画像の置き場
  route: '/reminders',         // 実装のルート（クエリも含める）
  mode: 'page',                // 'page'（全体）/ 'viewport'（見えている範囲）
  height: 1080,                // viewport のときの高さ＝設計の高さ
  steps: [{ click: 'ボタン名' }],  // 名前は一部だけ。role: 'text' で文字そのもの
  clock: '2026-08-19T12:00:00.000Z',  // 相対時刻を出す画面では必須
  states: { apis: [...], kinds: ['loading','empty','error'] },  // 一覧の3状態
  status: 'unimplemented' | 'unconfirmed' | 'elsewhere',
  why: '理由。空にしない',
}
```

---

## 5. 判定の言葉

| 判定 | 意味 |
|---|---|
| **一致** | 実データまで繋いで比べ、差が無い |
| **構造一致** | 配置・部品・文言が合う |
| **データ未接続** | 出どころが無く値が `—`。**最終的な「一致」にはしない** |
| **要修正** | 差がある。P0/P1/P2 を付ける |
| **未確認** | 押せる場所はあるが撮れない。**「無い」と言い切らない** |
| **未実装** | 実装が無い。**合格画像にしない** |
| **取得不能** | 権限などで辿り着けない |

### 全画面に効く決めごと

- **サイドバーの選択状態は比べません。** 設計の共通サイドバーはどの画面でも
  「友だち属性」が選ばれたままです（共通部品なので1つしか持てない）。
  ここを差として数えると262枚すべてが未一致になります。
- **未取得は `—`、実値0は `0件`。** 固定データでもこれを守ります。
- **未実装を合格画像にしない。**
- **固定値で実データがあるように見せない。**

---

## 6. 何度も引っかかったこと（10）

1. **画面が落ちる原因は、たいてい実装ではなく固定データの形。**
   一覧の口の既定（`{items,total,page,limit}`）が、通を待っている画面へ返ると落ちます。
   これまでに**12回**。`diagnose.mjs` が★を付けて教えます。

2. **型に照らして固定データを書く。** 別名で書いた項目は握りつぶされ、
   画面は既定値のまま描かれます。エラーは出ません。
   （`isShared`→`visibility`／`tagId`→`tagIds`／`lastActivityAt` を落とす／
   型に無い `rank` を渡す／`eventType: 'download'` のような知らない言葉）

3. **操作の名前は一部だけ書く。** 長く書くと、読み上げ名の空白の入り方が
   違うだけで当たりません。

4. **押せるものが操作の役を持っているとは限らない。** 表の行に `onClick` を
   付けただけのものは `button` でも `link` でもありません。`role: 'text'` を使います。

5. **`?tab=xxx` が描けても、そのタブがあるとは限らない。**
   知らないタブ名は既定の画面に落ちます。**タブの一覧をコードで見る。**

6. **「押せない」と「無い」は別。** `status: 'unconfirmed'` を使います。

7. **重なりを `fullPage` で撮らない。** `position: fixed` が最初のビューポート
   位置に焼き込まれ、途中から始まる嘘の絵になります。

8. **時計は止める。** 「6日前」は今日から数えます。止めないと翌朝に「7日前」へ
   変わり、基準画像が赤くなります。実際に一度なりました。

9. **日本時間で撮る。** 機械の時計帯のままだと設計の「14:16」が「12:16」になります。

10. **試験の固定値を実装の不具合と読み違えない。**
    CSV一部失敗の「入らなかった理由」が全行同じに見えましたが、
    `capture.spec.mjs:372` の固定値でした。**実装はAPIが返す文をそのまま出します。**

---

## 7. PRの状態

### わたしのPR：31本、すべて `MERGEABLE / CLEAN`

1本の縦列に積んでいます。**下から順に取り込んでください。**

| PR | 中身 |
|---|---|
| #434 → #481 | 機能3〜32の比較（1機能1本） |
| #488 | 一覧の状態18枚＋機能4の残り10枚を台帳へ |
| #489 | 機能17・18をPRの最新headで再撮影 |
| **#490** | **機能4の残り10画面＋262画面の台帳統合**（head `64c6c19a`、CI両方 pass） |

`development` はこちらの枝を切ったあと **33コミット**進んでいます。

### Codexの実装PRと重なるファイル

| Codex PR | 重なる | どうするのが良いか |
|---|---|---|
| #429 | `app/reminders/new/page.tsx` | **#448 側を取り下げる。Codexのほうが良い**（未取得と0件を区別し、再読み込みも付く） |
| #430 | `auto-replies` 3ファイル | `folderId` は #430 が直した。**#450 にしか無いものが2つ**（下記） |
| #436 | `app/form-submissions/page.tsx` | **先に #436 を入れて**、#457 の帯の直しが要るか見直す |
| #426 | `components/chats/template-picker.tsx` | **#426 を先に**入れるのが安全 |
| #426/#432/#433/#436/#427 | `design-debt-baseline.json`<br>`button-migration-contract.test.ts` | `node apps/web/scripts/design-debt.mjs --update` で作り直す。**手で直さない** |

**#450 にしか無いもの**（#430 head `e6870247` でも直っていない）：
1. 段の番号が上から **1 → 3 → 2** の順に出ている（`edit-dialog.tsx` の270／402／523行）
2. 窓へ渡す中身を2か所で組み立てたまま（また食い違う）

→ **この2つだけ別PRに切り出して #430 のあとに乗せるのが良い。**

---

## 8. Codexへ渡してある指摘

| 文書 | 中身 |
|---|---|
| [`v6-list-states-for-codex.md`](v6-list-states-for-codex.md) | **一覧の状態18枚。** 共通部品（`shared/list-state.tsx`）は在るのに、使っているのは友だち属性の「タグ」タブだけ。ほとんどの一覧で、読み込みに失敗しているのに「ありません」と出る。ウェビナーは「最初のウェビナーを作成」まで誘い、押すと二重に作る |
| [`friend-attributes-v6/design-qa-remaining10.md`](friend-attributes-v6/design-qa-remaining10.md) | **機能4のP0×2・P1×5・P2×2**、および必要なAPI6件（値・取得元・未取得時の表示） |
| [`v6-recheck-2026-08-28.md`](v6-recheck-2026-08-28.md) | 実装PR28本の最新headでの再比較。5機能で判定を改めた |
| [`v6-visual-qa-pr-status.md`](v6-visual-qa-pr-status.md) | PRの重なり・競合・developmentとの差 |
| 各 `docs/design-qa/<機能>/design-qa.md` | 機能ごとの突き合わせ |

### いちばん重い指摘（P0級）

1. **一覧の状態18枚** — 読み込み失敗が「ありません」に見える（登録済みが消えたように見える）
2. **`yKEdO` 4-2-C** — 同上＋「項目を追加」を誘う（押せば二重に作る）
3. **`QKx8Q` 4-4** — 保存した検索の使用先が見えないまま消せる（配信の宛先が静かに壊れる）
4. **機能17 マイル** — 使い道が無い（ためる仕組みだけあって返す先が無い）／手で直せない／記録が残らない
5. **機能16** — 払う仕組みがまるごと無い（締め日・振込先・未払い残高）

---

## 9. 次にやること

1. **機能19 は保留。** Codexの修正完了まで **#465 の比較結果を維持**します。
1. **機能22 も保留。** #447 の実装完了の連絡まで **#469 の比較結果を維持**します。連絡が来たら4画面を撮り直します。
2. **未実装74枚の再確認。** Codexの実装PRが進むたび、最新headで
   `claims.sh` 相当の grep を回して「いまも無いか」を確かめます。
3. **未確認7枚を潰す。** 押せない理由（無効なのか、順番なのか）を1枚ずつ。
4. **設計側の食い違い**（記録だけにしてある分）を Pencil で直す。
   Pencil を直すときは**必ず先に退避**（`pencil-backups/` にmd5照合つき）。
   上書き保存で履歴が残りません。

### 設計側の食い違い（未対応）

| 場所 | 何が食い違うか |
|---|---|
| `M1EXwB` | フォルダの合計が すべて9 なのに 3+2+2+4=**11** ／ 9件なのに12ページ |
| `cmDfJ` | すべて14 なのに 5+4+3+4=**16** |
| `q76C35` | 「停止中／停止済み」が `BroadcastStatus` に無い（**未決**） |
| 差し込みの書き方 | `{会社名}` / `{お名前}` / `{{name}}` が設計内で揃っていない。実装は `{{var.会社名}}` |
| `sfTEW` | 「飛ばす／エラー」より実装の「重複で見送り／入力確認」のほうが正確。**設計を実装に寄せるほうが良い** |

### 既に直した設計側の食い違い

`vUXKb`/`NjK9q` の有効友だち数、`NjK9q` の2ページ、`NjK9q` の表示件数の見た目、
`k6lHgo` の「保留」行。

---

## 10. 覚えておくこと

- **`pnpm` は PATH にありません。** `npx` か `./node_modules/.bin/` を直に叩きます。
- **反映履歴のゲート**は `- ` で始まる行に `#<PR番号>` を求めます。
  見出しや本文に書いても数えません。**PRを作ってから**ファイルを足します（番号は当てられない）。
- **`git diff --cached --check`** をコミット前に。`--cached` を付けないと意味がありません。
- **force push しない。** 空の rebase 残骸を `rm -fr` もしない。
- **worktree は外付け側**（`/Volumes/My Passport/...`）へ。`/private/tmp` は使いません。
- Pencil の `Export(..., "png")` は砂嵐になります。`html-css` で書き出して Chromium で撮ります。
- Pencil の一括書き出しは **55秒で切れます**。30件ずつに割ります。
