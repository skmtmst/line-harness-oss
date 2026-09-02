# v0.25.0 の続きをやる人へ

2026-08-17 時点。**次に何をすればよいか**だけを書いてある。

**PCの85枚は全部終わった。** ただしこれで揃ったのは「何が書いてあるか」だけ。
見た目を絵に合わせる作業は別で、`docs/v025-design-pass.md` に分けてある。

---

## いちばん大事な注意

**「この列は無い」と書いてある文書を信じないこと。必ず実物を見ること。**

私は同じ誤りを2回した。どちらも会話の前半で自分が書いた突き合わせ表を信じ、
実物のスキーマを確かめずに「無い」と決めつけたせいだった。

| 私が「無い」と書いたもの | 実際 | 気づいたきっかけ |
|---|---|---|
| 友だち情報欄の型 | 099 に `type`（10種類）と `is_starred` があった | migrate.ts が「部分適用」で止めた |
| 送信の出どころ | 028 に `source`、038 に `template_id_at_send` があった | 書き込み処理を入れようとして送信箇所を読んだ |

確かめ方はこれ。

```bash
npx wrangler d1 execute nen-line-stg --remote \
  --config apps/worker/wrangler.staging.toml \
  --command "SELECT group_concat(name) FROM pragma_table_info('friend_fields')" --json
```

**列を足すマイグレーションを書く前に、必ずこれを走らせること。**
追加のみのポリシーで列は消せないので、間違えると残り続ける。
実際 `messages_log.origin_kind` が使われない列として残っている。

---

## やり方（確立済み）

1画面につき、これを回す。

```
1. 設計を HTML に書き出す
2. 設計の文字と実装を1語ずつ突き合わせる
3. 足りないものを実装する
4. その語を design-structure.json の parts に足す
5. 判断が要るものは v025-open-questions.md に残す
6. テスト → ビルド → PR → マージ → 配布
```

### 1. 書き出し

```
mcp__pencil__export_html {
  filePath: "/Users/kentakenta/.pencil/documents/c0e607ec-152b-4e80-a8ae-5c32a234de6b/pencil-new.pen",
  nodeIds: ["<docs/design-node-ids.md のID>"],
  outputPath: "<scratchpad>/v2-xxx.html",
  format: "html-tailwind"
}
```

**部分的に読まないこと。** `Get()` で構造だけ見ると必ず見落とす。
受信箱で3回やり直した原因がこれ。

### 2. 突き合わせ

書き出した HTML からタグの外側の文字を全部拾い、実装のソースに
含まれるかを見る。サイドバーとサンプルデータは除く。

```python
texts = re.findall(r'>([^<>]+)<', html)
missing = [t for t in set(texts) if t not in impl_source]
```

### 6. 配布の順番

**マージしてからロックを取ること。** 逆にすると preflight が
`lock-sha-mismatch` で止める（私は2回やった）。

```bash
gh pr merge <N> --merge --repo skmtmst/line-harness-oss
git checkout codex/development && git pull
npx tsx scripts/deploy/deploy-lock.ts acquire staging --note "..."
npx tsx scripts/deploy/migrate.ts apply staging --apply   # マイグレーションがあるとき
bash scripts/deploy/staging-deploy.sh --apply --parent-repo "/Volumes/My Passport/Github/nen-petfood-eccube"
npx tsx scripts/deploy/deploy-lock.ts release staging
```

`gh` は `--repo` を付けること。フォークなので付けないと止まる。
`pnpm` は `~/bin` にある（`export PATH="$HOME/bin:$PATH"`）。

---

## いまどこまで終わっているか

### PC 85枚すべてを設計と1語ずつ突き合わせた（2026-08-17）

**PCの画面は残っていない。** `design-structure.json` に **69ルート**を
登録してある（1ルートに複数の設計ノードが入っているものがある。
`/inflow-links` は 6-2・6-6・6-8 の3枚、`/analytics` は5タブ）。

残っているのは **スマホ21・タブレット3**。R-（飲食店・多店舗案）8 は
対象かどうか未確認のまま。

### 今日つかんだ型（同じ失敗を繰り返さないために）

**1. 「APIは前から受け取れていたのに、画面に無い」が今日も5回出た。**
累計8回。**列やAPIが無いと決めつける前に、`create` / `update` の引数と
`api.ts` の中身を読むこと。**

| 画面 | 前からあったもの |
|---|---|
| 6-4-1 付与ルール | `mileage_rules` に 出どころ・確定待ち・回数制限・紹介者付与 が全部あった |
| 2-2-1 友だち詳細 | `api.friends.mileage` と `api.friends.richMenu` |
| 8-3-1 イベント編集 | worker に キャンセル待ちの一覧API があった |
| 4-6 友だち追加時 | `friends.unfollow_count` が追加・解除のたびに更新されていた |
| 6-8 広告連携 | `ad_conversion_logs` に送信の記録が溜まっていた |

**2. 保存先が2つに割れていることがある。**
付与ルールを作る画面は `scoring_rules` に書き、一覧は `mileage_rules` を
読んでいた。**作ったルールは一覧に出ず、マイルも付かなかった。**
一覧側に寄せて直した。同じことが `/nen-campaigns` にもある（29-5）。

**3. 選ばせているのに、どこからも発火しない選択肢があった。**
付与ルールのきっかけ6種のうち4種（リンクを踏んだ・フォームに答えた・
タグが付いた・予約が入った）は `fireEvent` されていなかった。
**選択肢を足すときは、その値を受け取る側が本当に呼ばれるかを見ること。**

**4. `design-structure.test.ts` は import を1段辿る。**
`create-page.tsx` から `Field` だけ import した画面が、CreatePage の
骨組み（Crumb / Head / Body / Left / Right）も持っていることになって
落ちた。`Field` と `inputClass` を `form-controls.tsx` に分けた。
**入力欄だけ使いたいときは `@/components/shared/form-controls` から取る。**

## 次にやること（順番）

### 1. 判断待ちの整理

`docs/v025-open-questions.md` が **80件くらい**になった。今日足したのは
25-1〜30-4。**実害が出ているものから決めるのがよい。**

| # | 内容 | なぜ急ぐか |
|---|---|---|
| 30-1 | はじめての人と以前からの友だちで配信を分ける | 画面に出した「以前からの友だち」の人数が、そのまま誤って挨拶を送った人数 |
| 25-2 | タグ付与でマイルを配る道筋 | タグ画面で額を入れられるのに、一度も配られていない |
| 25-1 | `scoring_rules` を残すか | 作る口はもう無い。event-bus 経由の古いルールだけが動いている |
| 29-5 | NEN配信の編集が2か所 | 片方だけ直しても気づけない |

### 2. スマホ21・タブレット3

PCが全部終わったので、次はここ。`docs/design-node-ids.md` の
MV2 / TV2 の行を見る。

### 3. 実行記録が無い問題（19-37 / 19-52 / 19-23 / 22-1）

4件とも根が同じ。`messages_log` の `origin_kind` / `origin_id`（未使用列）が
入口になる。

---
## 判断が要るもの

`docs/v025-open-questions.md` に全部ある。いま **80件くらい**。

**急いで決めなくてよい。** 数字を捏造せず「—」か「意味の近い別の数」を
出してあるので、画面は動く。実物を見て「この数字が要る」となったものから
決めればよい。

特に大きいのは3つ。

| # | 内容 | なぜ大きいか |
|---|---|---|
| 13-4 | 友だちの一括操作6種 | 「選ぶ」仕組みそのものが要る |
| 13-5 | 詳細検索 | 条件を組み立てる画面が要る |
| 14-1 | メールと友だちの紐づけ | `support_email_threads` は `customer_email` しか持たない。1人が複数アドレスを使う場合の扱いを決める必要がある |

---

## 触っていないもの

- **本番環境**。マイグレーションも配布も一度もしていない。masato の判断
- **二要素認証**。`admin_users.two_factor_enabled` の列はあるが、認証の仕組みそのものが要る
- `apps/web` の旧いTailwindクラス（`bg-white` `text-gray-*`）。ダークモードが無いのでトークンと同じ見た目になる。置き換えても得るものが無い割に差分が大きい

---

## 関連文書

| | |
|---|---|
| `docs/v025-design-pass.md` | **見た目を画像に合わせる作業（いまここ）** |
| `docs/design-node-ids.md` | 117画面のIDとルート |
| `docs/v025-screen-audit.md` | 画面ごとの突き合わせ状況 |
| `docs/v025-open-questions.md` | 判断待ち |
| `docs/sidebar-v2-spec.md` | サイドバーの仕様 |
| `docs/migration-runbook.md` | マイグレーションの手順 |
| `docs/DEPLOY-GATE.md` | 誰が何をしてよいか（検証はkenta、本番はmasato） |
| `apps/web/src/lib/design-structure.json` | 画面の骨格と必ず出す語 |
