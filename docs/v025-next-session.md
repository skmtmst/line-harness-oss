# v0.25.0 の続きをやる人へ

2026-08-17 時点。**次に何をすればよいか**だけを書いてある。

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

### HTML と1語ずつ突き合わせた画面（8枚）

ダッシュボード / 受信箱 / 友だち / 一斉配信 / テンプレート /
シナリオ / リマインダ / 友だち属性4タブ

### 骨格すら見ていない画面

`docs/design-node-ids.md` の Tier 3（予約6・イベント6・成果と分析11）、
Tier 4（設定7・専用機能4・コンテンツ3）、スマホ20・タブレット3。

**約100枚。**

### 根っこ5つ

| | 根っこ | 状態 |
|---|---|---|
| A | 送信の出どころ | **完了**（028 の `source` を使った） |
| B | 初回返信の時間 | **完了**（107） |
| C | 短縮URLとテンプレート | 110 で `tracked_links.template_id` を用意。**書き込みと読み出しが未** |
| D | 友だち情報欄の型 | **もともと不要**（099 にあった） |
| E | 操作の記録 | 110 で `operation_audit` を用意。**書き込みと読み出しが未** |

---

## 次にやること（順番）

### 1. C を仕上げる（小さい）

`tracked_links.template_id` に書き込む処理と、テンプレートの
「平均クリック率」を出す読み出し。

短縮URLはテンプレート本文から自動で作られる。作るところで
`template_id` を入れれば済む。作成箇所は `tracked-links.ts` を見ること。

### 2. E を仕上げる（中くらい）

`operation_audit` に書き込む処理。対応マークを変えたとき、
保存した検索を使ったときに1行入れる。

読み出しは「過去7日で対応済にした人数」「今月の呼び出し回数」。
設計 §9-2 / §10-2 / §10-3。

### 3. Tier 3 の画面（大きい）

`docs/design-node-ids.md` §5 の Tier 3。予約6・イベント6・成果と分析11。

上のやり方をそのまま回す。1画面あたり、抜けが20〜40件出る想定。

---

## 判断が要るもの

`docs/v025-open-questions.md` に全部ある。いま **50件くらい**。

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
| `docs/design-node-ids.md` | 117画面のIDとルート |
| `docs/v025-screen-audit.md` | 画面ごとの突き合わせ状況 |
| `docs/v025-open-questions.md` | 判断待ち |
| `docs/sidebar-v2-spec.md` | サイドバーの仕様 |
| `docs/migration-runbook.md` | マイグレーションの手順 |
| `docs/DEPLOY-GATE.md` | 誰が何をしてよいか（検証はkenta、本番はmasato） |
| `apps/web/src/lib/design-structure.json` | 画面の骨格と必ず出す語 |
