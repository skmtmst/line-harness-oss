# 既存部品で作れる19画面 — 実装指示書

**Codexが読んですぐ手を動かせる形にしました。** アプリ・API・DBは
こちらで一切変えていません。

対象は [未実装画面の片づけ方](v6-unimplemented-gaps.md) の
「既存部品で作れる」19枚です。**19枚のうち14枚が、確認の窓が無いだけ**です。

| 順 | 中身 | 枚数 |
|---|---|---|
| 1 | **`FpgxH` 一斉配信の最終確認** | 1 |
| 2 | 削除確認 | 7 |
| 3 | 実行・停止などの最終確認 | 6 |
| 4 | そのほか | 5 |

---

# 全体に効く決めごと

## 使う部品

```tsx
import ConfirmDialog from '@/components/shared/confirm-dialog'
```

| 渡すもの | 型 | 使い方 |
|---|---|---|
| `open` | `boolean` | 窓を出すか |
| `title` | `string` | **対象の名前を入れる。**「削除しますか？」だけにしない |
| `description` | `string` | **何が起きるかと、何が残るか** |
| `confirmLabel` | `string?` | 既定は「実行する」。**動詞を入れる**（「リマインダを削除」） |
| `cancelLabel` | `string?` | 既定は「キャンセル」 |
| `destructive` | `boolean?` | 消す・止めるは `true` |
| `busy` | `boolean?` | 送っているあいだ `true`。**二度押しを止める** |
| `error` | `string?` | 失敗の文言。**窓は閉じない** |
| `onConfirm` / `onCancel` | `() => void` | |

**すでに #433（テンプレート）・#444（成果地点）・#421（保存した検索）で
使われています。** 同じ形をなぞってください。

## 失敗したときの出し方（**全画面共通・P1**）

いま `API error: 405` `API error: 500` のように**生で出ている画面が
あります**（`yKEdO` #420、`vz0Ji` #494）。同じ形にしないでください。

```tsx
error={saveError}   // ← 例: 「リマインダを削除できませんでした（500）。時間をおいて、もう一度お試しください。」
```

- **数字は残してよい。** どこに問い合わせるかの手がかりになります
- **その前に、何が起きたかと次の手を書く**
- **窓は閉じない。** 閉じると、何を消そうとしたのか分からなくなります
- `busy` を戻して、もう一度押せるようにする

## 1440px・1920px の完了条件（**全画面共通**）

1. **両幅で撮れる。** 窓は `position: fixed` なので、撮影は
   `mode: 'viewport'`（高さ1080）。`page`（全面）では崩れます
2. **ページ全体の横スクロールが0。** 表の中の `overflow-x: auto` は可
3. **ボタンの文字が折れない。** 1440pxで2行になっていないこと
   （#433 の「テンプレートを削除」が 84×40px で3行に折れています）
4. 窓の中に**対象の名前**と**何が起きるか**が出ている
5. 失敗させたとき、**生の `API error:` が出ない**
6. `busy` のあいだ、確認ボタンが押せない

---

# 1. `FpgxH` 一斉配信の最終確認（最優先）

| | |
|---|---|
| 機能 | 6 一斉配信 |
| Node ID | `FpgxH`（6-1-H 最終確認） |
| ルート | `/broadcasts/new`（および `/broadcasts/edit`） |
| いまの状態 | **確認の段が無い。**「配信を予約する」が `save()` を直に呼ぶ（`broadcast-form.tsx:1001-1007`）。`/broadcasts` 配下に `ConfirmDialog` は1つもない |

**1,284人へ送る操作に、確認がありません。** これが19枚のなかで
いちばん効きます。

## 再利用する既存部品

- `ConfirmDialog`
- **`runPreflight()` の結果をそのまま使う**（`broadcast-form.tsx:457-476`）。
  新しく数え直す必要はありません
- 送信予定の文言は `sendMode === 'scheduled' && scheduledDate` の
  ところに既にあります（「2026/08/27 10:00 から 30分かけて配信」）

## 確認画面に表示する実値

| 出すもの | どこから | 未取得のとき |
|---|---|---|
| 届く人数 | `preflight.audienceCount` | **`—`＋「数えられませんでした」。0人と書かない** |
| 未確認の件数 | `preflight.warnings.filter(w => w.level === 'warning').length + (testResult ? 0 : 1)` | `—` |
| 未確認の中身 | `preflight.warnings` の `message` を箇条書き | 出さない |
| いつ送るか | `sendMode`／`scheduledDate`／`scheduledTime`／`spreadMinutes` | 「今すぐ」 |
| 何通送るか | `bubbles.length` | — |
| 開封を数えるか | `preflight.audienceCount >= 20` | `—` |
| 短縮URLを使うか | 画面の設定値 | — |

**設計 `FpgxH` の文言にそろえてください。** 帯の「2件 未確認」は
すでに実装にあります。

## 実行API

```ts
api.broadcasts.create({ title, messageType, messageContent, messageBubbles, … })
// broadcast-form.tsx:550
```

**`save()` の中身は変えないでください。** 窓で「はい」を押したときに
いまの `save()` を呼ぶだけにします。

## 失敗時の表示

`res.success === false` のとき `res.error` を **`ConfirmDialog` の
`error` に渡す**。いまは `setError()` でページ上部に出しており、
**窓が無いので押した直後に何が起きたか分かりません。**

## 実行を止める条件

`validate()`（`broadcast-form.tsx:418-450`）が返す文言は、**窓を開く前**に
止めてください。窓の中で初めて弾くと、確認したのに送れない形になります。

| 止める | 文言 |
|---|---|
| 管理用タイトルが空 | 管理用タイトルを入力してください |
| 宛先が決まっていない | `audienceError()` の返り値 |
| 吹き出しが空・ファイル未指定・Flex JSONが壊れている | `吹き出しN の…` |
| **`preflight` がまだ無い** | 窓を開かない。「配信前チェックが終わるまでお待ちください」 |
| **`preflight.audienceCount === 0`** | 窓は開くが、確認ボタンを押せなくする。「届く人が0人です」 |

## 完了条件

上の共通6点に加えて：

- 「今すぐ配信」と「日時を指定して予約」で、**窓の文言が変わる**
- 20人未満のとき「開封数は集計されません」が窓にも出る
- `preflight.warnings` が0件でも窓は出る（**テスト送信がまだ**は必ず1件残る）

---

# 2. 削除確認（7枚）

**7枚とも同じ形です。** ブラウザの `confirm()` を `ConfirmDialog` に
替えるだけで、実行APIは既に在ります。

| Node | 機能 | ルート | いまの場所 | 実行API |
|---|---|---|---|---|
| `Y0Sn3` | 7 リマインダ | `/reminders` | `page.tsx:202` `confirm()` | `api.reminders.delete(id)` → `DELETE /api/reminders/:id` |
| `Gy9OK` | 8 自動応答 | `/auto-replies` | `page.tsx:243` `confirm()` | `api.autoReplies.delete(id)` → `DELETE /api/auto-replies/:id` |
| `szXsT` | 12 リッチメニュー | `/rich-menus` | `page.tsx:193` `confirm()` | `api.richMenuGroups.delete(groupId, { force })` |
| `yPkWe` | 14 共通情報 | `/contents/vars` | `page.tsx:150` `confirm()` | `api.commonVars.delete(id)` → `DELETE /api/common-vars/:id` |
| `YfTfJ` | 15 登録メディア | `/contents` | `page.tsx:175` `confirm()` | `api.media.delete(id, { force })` |
| `gBp2J` | 13 回答フォーム | `/form-submissions` | **導線ごと無い** | `api.forms.remove(id)` → `DELETE /api/forms/:id` |
| `UIaM7` | 18 流入リンク | `/inflow-links` | **一覧に窓が無い** | `api.entryRoutes.delete(id)` → `DELETE /api/entry-routes/:id` |

## 確認画面に表示する実値

| 出すもの | どこから | 未取得のとき |
|---|---|---|
| **対象の名前** | 一覧の行 | 必ず出す |
| **選んだ件数**（まとめて消すとき） | `selected.size` | — |
| **使用先の件数**（あるものだけ） | 各機能の `usageCount` / `usedIn` | **`—`＋「確認できませんでした」。0件と書かない** |
| 残るもの | 文言で（下の表） | — |

**「何が残るか」を書いてください。** #493 のフォルダ削除がよい例です。

> 「EC」を削除しますか？
> **中のテンプレートは削除されず、「未分類」に残ります。**

| Node | 「残るもの」に書くこと |
|---|---|
| `Y0Sn3` | **登録済みの配信予定も一緒に消えます**（いまの `confirm()` の文言を使う） |
| `Gy9OK` | 当たった回数の記録が消えるかどうか |
| `szXsT` | 表示中のメニューを消すとどうなるか。`force` が要るときの理由 |
| `yPkWe` | **差し込み先の文面がどうなるか**（空欄になるのか、そのまま残るのか） |
| `YfTfJ` | 使っている配信からどう見えるか。`force` が要るときの理由 |
| `gBp2J` | **回答が消えるかどうか。** ここがいちばん大事です |
| `UIaM7` | 計測済みの流入がどうなるか |

## 実行を止める条件

| 止める | 出す文言 |
|---|---|
| 使用先が1件以上 | **確認ボタンを押せなくする。**「使用中のため削除できません（N件）」 |
| 使用先が**未取得** | **押せなくする。**「使用先を確認できないため削除できません」 |
| `force` が要る（`szXsT` `YfTfJ`） | 一段目で止め、**何を壊すかを書いてから**二段目で `force: true` |

**「確認できないから消させない」は正しい向きです。** #421 の
保存した検索が既にその形です。

## 失敗時の表示

`ConfirmDialog` の `error` に日本語で。**409（使用中）と500（それ以外）で
文言を分けてください。**

- 409：「ほかの場所で使われているため削除できませんでした。使用先を外してからお試しください。」
- そのほか：「削除できませんでした（500）。時間をおいて、もう一度お試しください。」

## 完了条件

共通6点に加えて：

- **使用中の行と、使っていない行の両方を撮る。** 押せない側も撮ってください
- まとめて消す画面（`Y0Sn3` `yPkWe` `YfTfJ`）は**選んだ件数が窓に出る**
- 消したあと、一覧が**その場で減る**（読み直しでもよい）

---

# 3. 実行・停止などの最終確認（6枚）

| Node | 機能 | ルート | 何の前に止めるか | 実行API |
|---|---|---|---|---|
| `s6Vvp` | 7 リマインダ | `/reminders/new`・`/reminders/edit` | 有効化 | `api.reminders.create()` ＋ `api.reminders.update(id, { isActive })`（`new/page.tsx:93,107`） |
| `Yj6CQ` | 8 自動応答 | `/auto-replies`（窓）・`/auto-replies/edit` | 保存＝即反映 | `api.autoReplies.update(id, body)` / `create(body)`（`edit-dialog.tsx:229,231`） |
| `ec9vg` | 9 友だち追加時の配信 | `/friend-add-settings` | 保存＝即反映 | `api.friendAddRouting.save(accountId, routing)`（`page.tsx:137`） |
| `D6yO7e` | 10 ウェビナー | `/webinars/edit` | 公開 | `webinarApi.update()` |
| `RUxNf` | 5 シナリオ | `/scenarios` | 開始・再開 | `api.scenarios.update(id, { isActive: !current })`（`page.tsx:177`） |
| `GFDqW` | 27 予約管理 | `/booking/bookings/new` | 代理予約の登録 | 予約を作る口 |

## 確認画面に表示する実値

**「これから誰に何が起きるか」を数で出してください。**

| Node | 出すもの | どこから | 未取得のとき |
|---|---|---|---|
| `s6Vvp` | これから送る通数・いちばん近い送信日時 | リマインダの設定から計算 | **`—`＋理由** |
| `Yj6CQ` | 当たる見込みのキーワード数・**同じ言葉に当たる他のルール** | `priority` と `keywords` | `—` |
| `ec9vg` | いま流れているシナリオ・**この設定が効き始める時点** | `routing` | `—` |
| `D6yO7e` | 公開URL（`slug`）・申込の受付開始 | ウェビナーの設定 | `—` |
| `RUxNf` | **購読中の人数**・次に届く段 | シナリオの統計 | **`—`。0人と書かない** |
| `GFDqW` | 日時・担当・メニュー・お客様 | 入力値 | — |

## 実行を止める条件

| 止める | 出す文言 |
|---|---|
| 必須が空 | 窓を開く前に、いまの `validate()` で止める |
| **対象が0人**（`s6Vvp` `RUxNf`） | 窓は開くが押せない。「いま届く人がいません」 |
| **対象が未取得** | 押せない。「対象を数えられませんでした」 |
| `Yj6CQ` で**同じ言葉に当たるルールがある** | 押せるが**警告を出す**。「『営業時間』には他に2本当たります。評価順が小さいほうだけが動きます」 |

## 失敗時の表示

窓の `error` に日本語で。**窓は閉じず、入力も残す。**
`vz0Ji`（#494）がその形で、文言だけが `API error: 405` と生になっています。

## 完了条件

共通6点に加えて：

- **確認 → 実行 → 完了**の3段が通る（完了の面は「通常実装」22枚のほうで扱います）
- `RUxNf` は**開始と停止の両方**で窓が出る。停止のほうが `destructive`
- `Yj6CQ` `ec9vg` は「保存＝即反映」なので、**窓の文言に「すぐに反映されます」を入れる**

---

# 4. そのほか（5枚）

| Node | 機能 | ルート | やること | 実行API |
|---|---|---|---|---|
| `LKuAQ` | 10 ウェビナー削除 | `/webinars` | **口は在るのに画面が呼んでいない。** 一覧に導線＋`ConfirmDialog` | `webinarApi.remove(id)` → `DELETE /api/webinars/:id`（`api.ts:4293`） |
| `QX70l` | 16 アフィリエイター削除 | `/affiliates` | 同上 | `api.affiliates.delete(id)` → `DELETE /api/affiliates/:id`（`api.ts:2306`） |
| `GB0NR` | 10 公開ページプレビュー | `/webinars/edit` | いま `disabled`＋「準備中です」。**`slug` は画面に出ている**ので、公開ページを別窓で開くだけ | 無し（`window.open`） |
| `LT8RS` | 3 友だち・表示件数 | `/friends` | 素の `<select>` を共通 `Select` に替える。タグ一覧は既にそれを使っている | 無し（`pageSize` の状態だけ。`page.tsx:49`） |
| `GMvBd` | 4 対応マークを追加・編集 | `/tags?tab=marks` | 一覧の下の追加欄を窓にする。編集も同じ窓で | `api.supportMarks.create(accountId, {...})` / `update(id, accountId, {...})`（`mark-list.tsx:57,71`） |

`LKuAQ` と `QX70l` は**削除確認7枚と同じ形**です。上の「2. 削除確認」の
決めごとをそのまま使ってください。

`GB0NR` は**確認の窓が要りません。** `disabled` を外し、
`slug` から作ったURLを `target="_blank"` で開きます。
`slug` が空のときだけ押せないままにし、`title` に理由を入れてください。

## `GB0NR` の完了条件

- 1440・1920 で押せる状態が撮れる
- `slug` が空のときは押せず、**理由が `title` に出る**
- 別窓で開く（同じ窓で開くと、編集中の入力が消えます）

## `LT8RS` の完了条件

- **開いた中身が絵に写る。** いまは素の `<select>` なので、
  Playwright で開いても画像に残りません
- タグ一覧の表示件数と**同じ見た目**になる

---

# 撮り方（全19枚）

`screens.mjs` の行はこちらで足します。窓のものは `mode: 'viewport'`、
高さ1080、`steps` に開くボタンを書きます。

```bash
node scripts/visual-qa/capture-screens.mjs --feature N --impl --only <NodeID>
```

**`--only` を必ず付けてください。** 機能ごと丸ごと撮ると、別のPRで
直った絵が直る前に戻ります。

# 数え方

```bash
node scripts/visual-qa/ledger.mjs --gaps
```

**手で数えないでください。** `screens.mjs` の `status` と `gap` を直せば、
表も集計値も同時に変わります。
