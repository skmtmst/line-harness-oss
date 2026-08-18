# 見た目を画像に合わせる作業の引き継ぎ

2026-08-17 開始。**画面の絵を1枚ずつ見て、実装の見た目を寄せていく**作業。

---

## これは前の作業とは別のもの

いままでやってきたのは **「語の突き合わせ」**。設計HTMLからタグの外の文字を
全部拾い、実装のソースに同じ語があるかを見ていた。PC 85枚すべて終わっている。

**それで揃うのは「何が書いてあるか」だけ。** 余白・文字の大きさ・並びの
向き・色の使い分け・表と札のどちらで見せるか — こういうものは1語も
引っかからない。だから語が全部合っていても、見た目は設計と違う。

この作業で見るのはそちら。**語ではなく絵を見る。**

---

## 進め方

### 1. 絵をもらう

貼ってもらった画像がその画面の正。設計ファイルから出したいときはこれ。

```
mcp__pencil__get_screenshot {
  filePath: "/Users/kentakenta/.pencil/documents/c0e607ec-152b-4e80-a8ae-5c32a234de6b/pencil-new.pen",
  nodeIds: ["<docs/design-node-ids.md のID>"]
}
```

**HTMLの書き出し（export_html）ではなく、画像を見ること。** HTMLからは
余白も並びも読み取れない。前の作業で export_html を使っていたのは、
語を拾うためだった。目的が変わったので道具も変える。

### 2. 実物と並べる

```bash
export PATH="$HOME/bin:$PATH"
cd "/Volumes/My Passport/Github/line-harness-nen/apps/web"
pnpm dev          # http://localhost:3001
```

ブラウザで開いて見比べる。ブラウザ操作の道具（mcp__claude-in-chrome__*）が
使えるなら、実物のスクリーンショットを撮って絵と並べるのがいちばん早い。

### 3. 違いを書き出してから直す

**いきなり直さないこと。** 先に「どこが違うか」を箇条書きにする。
書き出さずに直し始めると、目に付いた1か所だけ直して終わる。

見るところは決まっている。**上から順に見る。**

| 見るところ | よくある違い |
|---|---|
| 見出しの帯 | 題と説明の字の大きさ、操作ボタンの位置と並び順 |
| その下の数字（KPI） | 何枚か、1行に何枚並ぶか、単位の付き方 |
| 絞り込みの帯 | 検索欄・タブ・並び順の順番と、まとまり方 |
| 本体 | 表か札か。列の順番。右寄せ左寄せ |
| 余白 | ブロックとブロックの間、カードの内側 |
| 色 | 状態色（成功・注意・危険）をアクセント色で代用していないか |

### 4. 直す → 確かめる → 積む

```bash
cd "/Volumes/My Passport/Github/line-harness-nen/apps/web"
pnpm typecheck && pnpm test
```

**1画面ずつコミットする。** まとめると、どの直しでどこが変わったか
分からなくなる。見た目の直しは戻したくなることがある。

---

## 使う言葉（デザイントークン）

`apps/web/src/app/globals.css` にある。**新しく書くところは必ずこれを使う。**
色を直に書かない。Tailwind の gray / slate / emerald を新たに増やさない。

| 用途 | 使うもの | 値 |
|---|---|---|
| アクセント | `bg-accent` `text-accent` `hover:bg-accent-hover` | `#06c755` |
| アクセントの上の文字 | `text-on-accent` | 白 |
| アクセントの薄い地 | `bg-accent-soft` / `bg-accent-bg` | `#e8f8ee` |
| 本文 | `text-ink` | `#1a1c1a` |
| 補足 | `text-ink-secondary` | `#565f59` |
| ラベル・注記 | `text-ink-faint` | `#8b938d` |
| カードの地 | `bg-canvas` | 白 |
| 一段沈んだ面 | `bg-canvas-sunken` | `#f7f7f5` |
| 罫線 | `border-hairline` | `#e2e4df` |
| 成功 | `text-success` `bg-success-bg` | |
| 注意 | `text-warning` `bg-warning-bg` | |
| 危険 | `text-danger` `bg-danger-bg` | |
| 情報 | `text-info` `bg-info-bg` | |
| カードの角 | `rounded-card` | 0.75rem |
| 押せるものの角 | `rounded-control` | 0.5rem |
| 丸いもの | `rounded-pill` | 9999px |

**アクセント色を状態表示に使わない。** 緑は「押せる」「このアカウント」の色で、
「うまくいった」の色ではない。両方に使うと、どちらの意味か読めなくなる。

---

## いま残っている見た目の借金

トークンを入れる前に書かれた画面が、まだ古いクラスのまま動いている。
**見た目は同じなので急がないが、その画面を触るときは一緒に直す。**

実測（`apps/web/src/**/*.tsx`）:

| | 件数 |
|---|---|
| `text-gray-*` `bg-gray-*` `border-gray-*` | 1773 |
| `text-slate-*` `bg-slate-*` `border-slate-*` | 266 |
| `rounded-lg` `rounded-xl` `rounded-2xl` `rounded-3xl` | 732 |
| `emerald-*` `green-*`（アクセントの別名） | 421 |
| 色の直書き（`#06c755` など） | 0 ← ここは片付いている |

**gray と slate が混ざっているのがいちばん厄介。** 同じ「薄いグレー」の
つもりで別の色が並んでいる。並べて置くと濁って見える。

### 古いクラスが多い画面（上から順に重い）

| 件数 | ファイル |
|---|---|
| 213 | `app/affiliates/tabs.tsx` |
| 197 | `components/events/event-form.tsx` |
| 156 | `app/nen-campaigns/page.tsx` |
| 143 | `app/webinars/edit/page.tsx` |
| 122 | `app/webhooks/page.tsx` |
| 93 | `app/form-submissions/page.tsx` |
| 73 | `components/broadcasts/broadcast-form.tsx` |
| 70 | `app/search-console/page.tsx` |
| 66 | `components/chats/friend-info-sidebar.tsx` |
| 66 | `app/reminders/page.tsx` |

**この10枚で全体の3割。** 画像を見る順番に迷ったら、ここから始めると
見た目の揃い方が大きい。

---

## 先に見つけてある3つ

画像を見る前から分かっているもの。どこかで直すことになる。

### 1. 見出しの部品そのものが古い

`components/layout/header.tsx` が `text-gray-900` / `text-gray-500` のまま。
**全画面の見出しがここを通る。** ここを直すと全部が一度に変わるので、
効きがいちばん大きい。ただし全画面が変わるので、直したら一通り見ること。

操作ボタンを載せる `action` が `shrink-0 ml-4` で固定されていて、
**狭い画面でボタンが潰れる。** 折り返す形にする必要がある。

### 2. 本体の幅に上限が無い

`components/app-shell.tsx` の `<main>` に `max-w` が無い。
設計の絵は 1920px 幅のフレームで描かれている（サイドバー256px ＋ 本体1664px）ので、
それより横に広いモニタで開くと
表が横に伸びきって、設計とまったく違う見え方になる。

### 3. 地の色が2系統ある

`app/layout.tsx` の `<body>` が `bg-gray-50`、トークンは
`--color-canvas-sunken: #f7f7f5`。**近いが違う色。** カードを置いたときの
浮き方が設計とずれる。

---

## 触ってはいけないもの

- **`data-design="..."` の印を消さない。** `design-structure.test.ts` が
  これで骨格を見ている。消すとテストが落ちる。節を分けたり足したりしたら
  `apps/web/src/lib/design-structure.json` も一緒に直す。
- **`parts` に登録した語を消さない。** 同じテストが「必ず出る語」として
  見ている。言い回しを変えるときは JSON も直す。差分に「設計を更新した」
  ことが残るので、あとから区別できる。
- **押せない状態にしてあるボタンを、押せるようにしない。** 受け口が無いから
  そうしてある。理由はすぐ横のコメントに書いてある。

---

## 確かめ方

```bash
export PATH="$HOME/bin:$PATH"
cd "/Volumes/My Passport/Github/line-harness-nen/apps/web"
pnpm typecheck    # 型
pnpm test         # 208件。骨格・行き止まり・部品の検査を含む
```

見た目だけの直しでも **必ずテストを通すこと。** 印や語を巻き込んで
消していることがある。

---

## 配布

見た目の直しは worker に触らないので、web だけの配布で足りる。
手順は `docs/v025-next-session.md` の「配布の順番」と同じ。

```bash
gh pr merge <N> --merge --repo skmtmst/line-harness-oss
git checkout codex/development && git pull
npx tsx scripts/deploy/deploy-lock.ts acquire staging --note "..."
bash scripts/deploy/staging-deploy.sh --apply --parent-repo "/Volumes/My Passport/Github/nen-petfood-eccube"
npx tsx scripts/deploy/deploy-lock.ts release staging
```

`gh` は `--repo` を付ける（フォークなので付けないと止まる）。
`pnpm` は `~/bin` にある。

---

## 関連文書

| | |
|---|---|
| `docs/v025-next-session.md` | 語の突き合わせの引き継ぎ。PC85枚は完了 |
| `docs/design-node-ids.md` | 117画面のIDとルート。画像を出すときのID |
| `docs/v025-open-questions.md` | 判断待ち80件。**中身の話で、見た目の話ではない** |
| `apps/web/src/app/globals.css` | デザイントークン |
| `apps/web/src/lib/design-structure.json` | 画面の骨格と必ず出す語 |
