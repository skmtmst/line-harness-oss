# 機能8-1-H 自動応答の実行結果（`t7UtYQ`）— 撮る支度

最終更新：2026-08-28

**まだ撮っていません。合格でもありません。**
Codex の Draft PR の番号と head SHA が届いたら、この手順で撮ります。

`screens.mjs` の `t7UtYQ` は `status: 'unimplemented'` のままです。
**この1行を外すまで、撮影も合格も起きません**（`capture-screens.mjs` が
「未実装のため撮らない」で止めます。確認済み）。

---

## 用意したもの

| 何 | どこ | 状態 |
|---|---|---|
| 固定データ | `fixtures.mjs` の `AUTO_REPLY_RUNS` | 7行・7状態 |
| 口 | `mock-api.mjs` | **2つの道の両方に答える** |
| 空の返事 | `capture-screens.mjs` の `EMPTY_BODIES` | 入れた |
| 行 | `screens.mjs` の `t7UtYQ` | route・states を先に書いた |

**ルートがまだ決まっていません。** リマインダ #500 に合わせた
`/api/auto-replies/:id/runs` と、共通契約をそのまま口にした
`/api/execution-runs?ownerKind=auto_reply` の**両方に答えます。**
どちらで来ても撮れます。実装が来たら片方に寄せます。

画面のルートは `/auto-replies/detail?id=auto-reply-1` と見込んでいます
（#500 の `/reminders/detail?id=` に合わせた）。**実物を見て直します。**

---

## 固定データの7行

**設計（`f8/t7UtYQ.html`）の数に寄せてあります。**
今期ヒット214回／累計1,842回／引継ぎ36件／エラー3件。

| # | 相手 | 入力 | 共通状態 | 何を見るため |
|---|---|---|---|---|
| 1 | Kenta Kawano | 予約を変更したい | `succeeded` | ふつうに動いた |
| 2 | Masato S. | 予約の確認 | `succeeded` | 同上 |
| 3 | 菅野 亮 | 予約キャンセル | `pending` | **確認待ち。失敗ではない** |
| 4 | 山田 太郎 | 予約 | `failed` | 理由が出るか |
| 5 | 石田 未来 | こんにちは | `skipped` | **何もしていない。成功ではない** |
| 6 | 前田 さくら | 予約したい | `partial` | **下の「要の行」** |
| 7 | （削除済み） | 予約 | `cancelled` | 名前が取れない行 |

### 要の行（6行目）

**先に当たるはずのルールが見送られ、あとのルールだけが動いた行です。**

```
matchedRuleName : 営業時間外の案内
skippedRules    : [{ name: '予約問い合わせ', reason: '1日1回までの上限に達しています' }]
actionResults   : [{ kind: '返信処理', status: 'succeeded' }]
status          : partial
detail          : 「予約問い合わせ」は見送り。「営業時間外の案内」を実行しました。
```

**この行を「成功」と1語で書く実装を捕まえるために入れました。**
運用者が見たいのは「予約問い合わせが動かなかった」ことです。
返信自体は成功しているので、**行だけ見ると成功に見えます。**

`averageResponseMs` は `null` にしてあります。**数えていないものを
0.0秒と書かせないため**です。設計には「平均応答 0.8秒」とありますが、
取れる口があるかは実装を見て判断します。

---

## 届いたらやること

```bash
# 1. head を確かめてから立てる
cd .../v6-f18-443 && git checkout -q --detach <head SHA>
cd apps/web && (NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 nohup ./node_modules/.bin/next dev --port 3103 …)

# 2. screens.mjs の t7UtYQ から status/gap/gapNote/why を外し、route を実物に直す

# 3. 撮る
cd .../v6-visual-qa
VISUAL_QA_BASE=http://localhost:3103 node scripts/visual-qa/capture-screens.mjs --feature 8 --impl --only t7UtYQ

# 4. 台帳を出し直す
node scripts/visual-qa/ledger.mjs > docs/design-qa/v6-progress-ledger.md
node scripts/visual-qa/ledger.mjs --html > docs/design-qa/v6-progress.html
node scripts/visual-qa/ledger.mjs --json > docs/design-qa/v6-progress.json
node scripts/visual-qa/ledger.mjs --gaps > docs/design-qa/v6-unimplemented-gaps.md
```

### 見るところ

| # | 何を見るか | 落ちる条件 |
|---|---|---|
| 1 | 通常・読込・空・失敗 | どれかが撮れない |
| 2 | 成功・一部失敗・何もしなかった | **3つが同じ見た目** |
| 3 | 未取得「—」と実値0 | 失敗のときに「0回」と書く。平均応答を0.0秒と書く |
| 4 | **見送られたルール** | 6行目を「成功」と書く／見送りの理由が出ない |
| 5 | 横スクロール | 1440px・1920px のどちらかで0でない |
| 6 | 内部ID | 友だち名の下などに `friend-1` `arr-6` が出る（#500 で出ていた） |
| 7 | 内部エラー | `API error: 405` などが本文に出る |
| 8 | 見出しの重なり | 共通のヘッダと本文のタイトルが二重に出る |

**#500 で見つけた5件は、写すと同じものが入ります。** 先に直っているか
見てください（[reminders-v6/design-qa-execution-results-500.md](../reminders-v6/design-qa-execution-results-500.md)）。

1. 失敗したのに「ありません 0件」と書く
2. 1440px で列が切れる
3. 友だち名の下に内部ID
4. 画面名に自動応答の名前が入らない
5. きっかけが番号だけで名前が無い

---

## 設計側は直しました

`f7/GC4St.html` から開封率の列を外しました。`t7UtYQ` の設計には
開封の列はありません。**ただし「平均応答 0.8秒」があります。**
取れる口が無ければ、同じように外します。
