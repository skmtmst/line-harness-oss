> **完了済みの引き継ぎ・経緯メモ(2026-09-03 に archive へ移動)。判断に使わない。** 現在の正本は `docs/v6-requirements/v6-requirements-master-index.md` と `docs/v6-common-rules.md`。

# 画像に合わせる作業 — 3日目に入る人へ

2026-08-18 起こし。**設計の絵を1枚ずつ見て、実装の見た目を寄せる**作業の
3本目の引き継ぎ。

| | |
|---|---|
| 作業の考え方（読む順番・トークン・見るところ） | `docs/v025-design-pass.md` |
| 1日目の記録と、決めてほしいこと6件 | `docs/v025-design-pass-day1.md` |
| 2日目の記録と、踏んだ落とし穴5件 | `docs/v025-design-pass-day2.md` |

**ここには「3日目に入る時点で本当にどうなっているか」だけを書く。**
前の2本と重なることは書かない。数字は今日測り直したもので、
前の引き継ぎから変わっているものには印を付けてある。

---

## 1. 出発点

```
ブランチ   codex/kenta-handover-day2（HEAD d1a03d2、作業ツリーはきれい）
origin/codex/development との差   0コミット ← 追いついている
```

**着手前に必ずもう一度取り直す。** 2日目にサイドバーが丸ごと衝突して、
こちらの変更を捨てている。

```bash
git fetch origin && git log --oneline HEAD..origin/codex/development
```

空でなければ、**触ろうとしている画面が既に直っていないか**を先に見る。

---

## 2. 前の引き継ぎを1か所直す — 色の直書きは0件ではない

`docs/v025-design-pass.md` に「色の直書き 0件 ← ここは片付いている」と
書いてあるが、**実際は64件ある。** 3日目の人がそのまま信じると、
片付いているつもりの場所を見落とす。

内訳は測ってある。**全部が直すべきものではない。**

| | 件数 | どうするか |
|---|---|---|
| LINEのトーク画面の再現（吹き出し・地の青） | 13 | **直さない。** LINE側の色なので、こちらのトークンに寄せると別物になる |
| タグ・マークの色見本（利用者が選ぶ色） | 21 | **直さない。** 画面の色ではなくデータの色 |
| UIの部品に残っているもの | 30 | **直す対象** |

直す対象の30件が居る場所:

| ファイル | 中身 |
|---|---|
| `app/search-console/page.tsx` | グラフの線と KPI の色（青・紫・緑・橙）。状態色トークンを通っていない |
| `app/nen-campaigns/page.tsx` | 見出し帯 `#3f3f3f`、地 `#8facd8`、ボタン `#0f766e` |
| `components/support/support-inbox.tsx` / `email-thread.tsx` | 地 `#f4f6f5`、吹き出し `#c9f4d8` |
| `components/friends/nen-friend-detail-drawer.tsx` | 地 `#f6f8f7`、見出し `#0d4a32` |
| `components/prompt-modal.tsx` | ボタンの地と文字（`#f3f4f6` / `#374151`） |
| `components/broadcasts/test-send-section.tsx` | ボタンが青 `#3B82F6`。押せるものはアクセント色のはず |
| `app/accounts/page.tsx` | 無効時の灰 `#9CA3AF` |
| `app/rich-menus/edit/page.tsx` | 削除の赤 `#dc2626`。`danger` トークンがある |
| `app/nen-members/page.tsx` | 緑のグラデーション `#0d4a32 → #16815b` |
| `components/friends/tag-badge.tsx` | 明度から文字色を出す計算。**これは直さなくてよい** |

数え直すとき:

```bash
cd "/Volumes/My Passport/Github/line-harness-nen/apps/web/src"
grep -rEn '#[0-9a-fA-F]{6}\b' --include='*.tsx' . \
  | grep -vEi 'canvas-editor|flex-preview|app/chats/page|ec-commerce/page|nen-campaigns/page|tags/new/page|tags/edit/page'
```

---

## 3. 見た目の借金は減っていない。増えている

2日目に5つの PR を入れたぶん、**古いクラスのまま増えた。**

| | 前回 | いま | |
|---|---|---|---|
| `gray-*`（text/bg/border ほか） | 1773 | **1800** | +27 |
| `slate-*` | 266 | **287** | +21 |
| `rounded-lg` / `xl` / `2xl` / `3xl` | 732 | **734** | +2 |
| `emerald-*` `green-*`（アクセントの別名） | 421 | **427** | +6 |
| 色の直書き | 0（誤り） | **64** | 上の節のとおり |

**新しく書くところでトークンを使う、という決まりが守られていない。**
2日目に触った画面（シナリオ・一斉配信・メニューバー）で増えている。

3日目からは、**画面を1枚直すたびに、その画面ぶんの古いクラスをゼロにする。**
借金を別途まとめて返す時間は取れない。触るついでにしか返せない。

```bash
# 直す前と後で、その画面の件数を見る
grep -Eo '(text|bg|border|divide|ring|from|to)-(gray|slate)-[0-9]+|rounded-(lg|xl|2xl|3xl)|(emerald|green)-[0-9]+' \
  apps/web/src/app/<画面>/page.tsx | wc -l
```

---

## 4. 「先に見つけてある3つ」は3つとも手つかず

> **【追記 2026-08-18】3つとも直した。** `codex/kenta-design-common`
> （`0d9a120` / `d135d3c` / `0c94f61`）。以下は直す前の記録として残す。
> 実物のCSSで測った結果:
>
> | | 直す前 | 直した後 |
> |---|---|---|
> | 見出しの色 | `oklch(0.21 0.034 264.665)` ← 色相264の**青寄りのグレー** | `#1a1c1a`（ink） |
> | 説明の色 | `oklch(0.551 0.027 264.364)` | `#565f59`（ink-secondary） |
> | 420px幅の操作ボタン | 題と同じ行に居座り、題が260pxに圧縮 | 2行目へ折り返す（題は281px） |
> | 1920px幅の本体 | 上限なし | **1664pxで止まる**（＝設計フレームの本体幅） |
>
> **65画面ぶんの見た目の確認はまだ済んでいない。** 手元では認証が通らず、
> 認証の内側の画面を開けなかった。ステージングへ配布してから一通り見ること。


1日目に書いたまま、**1つも直っていない。** 3日目の最初にここから入るのが
いちばん効く。ただし**3つとも全画面に効く**ので、直したら一通り見ること。

### 4-1. 見出しの部品が古い — 65画面が通る

`apps/web/src/components/layout/header.tsx`

```tsx
<h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
<p className="mt-1 text-sm text-gray-500">{description}</p>
{action && <div className="shrink-0 ml-4">{action}</div>}
```

- `text-gray-900` → `text-ink`、`text-gray-500` → `text-ink-secondary`
- `shrink-0 ml-4` で操作ボタンが**狭い幅で潰れる。** 折り返す形にする

**この1ファイルを直すと65画面の見出しが一度に変わる。** 効きが最大で、
リスクも最大。単独のコミットにして、他の直しと混ぜない。

### 4-2. 本体の幅に上限が無い

`apps/web/src/components/app-shell.tsx`

```tsx
<main className="flex-1 overflow-auto pt-[72px] md:pt-0">
  <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
```

`max-w` が無い。**設計の絵は 1920px 幅のフレームで描かれている**ので、
それより横に広いモニタで開くと表が伸びきって、絵と違う見え方になる。

> **【訂正 2026-08-18】** ここを最初 1440px と書いていたが**誤り**。
> `docs/admin-ui-design-guidelines.md` の「幅1440pxと1920pxの両方で確認」を
> フレーム幅と読み違えた。あれは**確認する幅**の指示で、設計フレームの幅ではない。
> 絵を実測すると サイドバー256px ＋ 本体1664px = 1920px。
> この誤りで一度 `max-w` を 1184px で入れてしまい、設計より480px狭くなった。

### 4-3. 地の色が2系統ある

`apps/web/src/app/layout.tsx:34`

```tsx
<body className="bg-gray-50 text-gray-900 antialiased" ...>
```

トークンは `--color-canvas-sunken: #f7f7f5`。**近いが違う色。**
カードを置いたときの浮き方が絵とずれる。文字色も `text-ink` ではない。

---

## 5. 残りは68枚。どれから見るか

PC 85枚のうち、**絵と突き合わせ済みは17枚。残り68枚。**

（2日目の引き継ぎに「15枚」とあるが、列挙されている画面を数えると17枚）

**重い順に並べた。** 数字は「その画面が読み込んでいる部品まで追った、
古いクラスの件数」。多いほど、絵に寄せる作業も大きい。

| 件数 | 画面 | ルート |
|---|---|---|
| 254 | V2 6-1 成果とアフィリエイト | `/conversions` |
| 235 | V2 8-3-1 イベントの編集 | `/events/edit` |
| 223 | V2 4-8-1 ウェビナーの編集 | `/webinars/edit` |
| 213 | V2 10-1 アカウント | `/accounts` |
| 213 | V2 10-5 データ移行 | `/accounts?tab=migration` |
| 200 | V2 9-1 NEN配信 | `/nen-campaigns` |
| 193 | V2 7-2 外部連携 | `/webhooks` |
| 134 | V2 2-1-1 テンプレートを選ぶ | `/chats?template` |
| 114 | V2 4-3 テンプレート | `/templates` |
| 96 | V2 6-3 回答フォーム | `/form-submissions` |
| 93 | V2 4-4 リマインダ | `/reminders` |
| 82 | V2 4-7-1 リッチメニュー編集 | `/rich-menus/edit` |
| 80 | V2 9-2 写真審査 | `/health` |
| 78 | V2 6-11 検索からの流入 | `/search-console` |
| 69 | V2 6-4 マイル | `/scoring` |

**この上位15行（`/accounts` の2行が同じファイルなので実ファイルでは14枚）で、
残り68枚が読み込む .tsx の借金 2439件のうち 1888件、77%。** 逆に言うと、
残り53枚は全部足しても551件しかない。**上から順に見るのが効く。**

ノードIDは `docs/design-node-ids.md`。

### 数字の読み方に1つ注意

**`page.tsx` だけを見ると0件に見える画面がある。** 借金が共有部品のほうに
寄っているため。

| 共有部品 | 件数 | 使っている画面 |
|---|---|---|
| `app/affiliates/tabs.tsx` | 234 | `/conversions`（6-1）**だけ**。名前と置き場所が合っていない |
| `components/events/event-form.tsx` | 205 | `/events/edit`（8-3-1） |
| `components/broadcasts/broadcast-form.tsx` | 110 | `/broadcasts/new`（4-2-1、突き合わせ済み） |
| `components/chats/friend-info-sidebar.tsx` | 70 | `/chats`（2-1、突き合わせ済み） |
| `components/webinars/webinar-form.tsx` | 65 | `/webinars/edit` と `/webinars/new` |

**突き合わせ済みの画面にも借金が残っている。** 見た目は絵に寄せたが、
中のクラスは古いまま。次に触るときに返す。

### masato さんの担当と重なる画面

2日目に合意した分担では、**10-1〜10-5 の8画面は masato さん**。
上の表の `/accounts`（213）と `/accounts?tab=migration`（213）はそこに入る。

**先に確認してから着手する。** 分担の運用（Pen の4領域分け）は
**まだ着手していない**ので、口頭の合意しかない状態。

---

## 6. 次にやること（この順番）

1. **`git fetch` で origin の差分を見る**（1節）
2. ~~**共通の3つを直す**（4節）~~ → **済み。** 残っているのは
   **65画面の見た目の確認**。ステージングへ配布してから一通り見る
3. **Pen の共同編集の準備**（バックアップ → 4領域 → ARCHIVE 分離 → 権限付与）。
   2日目に合意して未着手。分担が動かないと 10-x で衝突する
4. **5節の重い順に、1枚ずつ絵と突き合わせる。** 1画面1コミット。
   直すついでにその画面の古いクラスをゼロにする
5. スマホ21枚・タブレット3枚は手つかず。**PC が終わってから**

---

## 7. 触るときの決まり

1日目・2日目から変わっていない。**全文は `docs/v025-design-pass-day2.md`
の「触るときの決まり」にある。** ここには3日目に効くものだけ。

- **`data-design="..."` の印と、`design-structure.json` の `parts` の語を消さない。**
  85画面ぶんの骨格をテストが見ている（`design-structure.test.ts` 139件）。
  言い回しを変えるときは JSON も一緒に直す
- **押せない状態にしてあるボタンを、押せるようにしない。** 受け口が無いから
  そうしてある。理由はすぐ横のコメントにある
- **1画面ずつコミットする。** 見た目の直しは戻したくなることがある
- **共通部品（header / app-shell / layout / sidebar）は単独のコミットにする。**
  全画面に効くので、他の直しと混ぜると切り戻せない

---

## 8. 確かめ方

```bash
export PATH="$HOME/bin:$PATH"
cd "/Volumes/My Passport/Github/line-harness-nen"
(cd apps/web && pnpm test)      # 223件
(cd apps/worker && pnpm test)   # 1296件
(cd packages/db && pnpm test)   # 239件
```

**この3つは 2026-08-18 の起こし時点で実際に流して全部通っている。**
数が合わないときは、誰かの変更が入っている。

**見た目だけの直しでも必ずテストを通す。** 印や語を巻き込んで消していることがある。

配布の手順とマイグレーションの状態確認は `docs/v025-design-pass-day2.md`
の「配布の手順」。**着手前に `migrate.ts status staging` を取り直すこと**
（2日目終了時点で113まで適用済み、未適用ゼロ）。

---

## 9. 決めてほしいことは溜まったまま

**1日目6件・2日目5件、どれも未回答。** 全部「受け口が無い」ことが理由で
止まっていて、画面には枠だけ置いて何が足りないかを書いてある。

| | |
|---|---|
| 1日目の6件 | `docs/v025-design-pass-day1.md` の「決めてほしいこと」 |
| 2日目の5件 | `docs/v025-design-pass-day2.md` の「決めてほしいことが残っている」 |

**3日目に重い画面（6-1 成果とアフィリエイト、7-2 外部連携）へ入ると、
同じ形の「受け口が無い」が増える見込み。** 溜める前に一度返してもらいたい。

---

## 関連文書

| | |
|---|---|
| `docs/v025-design-pass.md` | 作業の考え方。トークン一覧、見るところの順番 |
| `docs/v025-design-pass-day1.md` | 1日目の記録と決めてほしいこと6件 |
| `docs/v025-design-pass-day2.md` | 2日目の記録、落とし穴5件、配布の手順、分担の合意 |
| `docs/design-node-ids.md` | 117画面のノードIDとルート |
| `docs/v025-open-questions.md` | 判断待ち。**中身の話で、見た目の話ではない** |
| `apps/web/src/app/globals.css` | デザイントークン |
| `apps/web/src/lib/design-structure.json` | 画面の骨格と必ず出す語 |
