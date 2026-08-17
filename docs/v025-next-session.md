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

### HTML と1語ずつ突き合わせた画面（20枚）

ダッシュボード / 受信箱 / 友だち / 一斉配信 / テンプレート /
シナリオ / リマインダ / 友だち属性4タブ

**予約7枚**（2026-08-17）
予約管理 / 予約の詳細 / 予約設定 / メニューを追加する /
予約スタッフを登録する / 受付時間・カレンダー / メニューごとの担当スタッフ

**イベント5枚**（2026-08-17）
イベント予約の一覧 / イベントの予約者 /
イベントを作る ①概要・②予約枠・③公開設定（`/events/new` の3段階）

20枚すべて `design-structure.json` に登録済み。崩れたらテストが止める。

### 骨格すら見ていない画面

`docs/design-node-ids.md` の Tier 3 のうち イベントの編集（8-3-1）と
成果と分析11、Tier 4（設定7・専用機能4・コンテンツ3）、スマホ20・タブレット3。

**約87枚。**

### 根っこ5つ

| | 根っこ | 状態 |
|---|---|---|
| A | 送信の出どころ | **完了**（028 の `source` を使った） |
| B | 初回返信の時間 | **完了**（107） |
| C | 短縮URLとテンプレート | **完了**（PR #83。テンプレート一覧に平均クリック率） |
| D | 友だち情報欄の型 | **もともと不要**（099 にあった） |
| E | 操作の記録 | **完了**（PR #83。友だち属性に「マークの変更 過去7日」） |

**5つとも片付いた。** 当てた日より前のぶんは記録が無いので数に入らない。

---

## 配布済み（2026-08-17）

| | | |
|---|---|---|
| #83 | 根っこ C・E | マージ済み |
| #84 | 予約7画面＋イベント2画面 | マージ済み |
| #85 | #84 の入れ直し | マージ済み。配布コミット `a6e6b39` |

**#84 で1回踏んだ罠。** #84 の base を `codex/development` ではなく
#83 のブランチ（`codex/kenta-root-c-e`）にしていたため、#83 が先に
development へマージされた時点で #84 の中身が取り残された。
積んだPRは、下のPRがマージされた**あとで base を development に付け替える**か、
#85 のように入れ直すこと。`git branch -r --contains <マージコミット>` で確かめられる。

マイグレーションは無し（115件すべて記録済み・未適用ゼロ）。

## 次にやること（順番）

### ~~1. 一覧APIに `visible_tag_id` を足す~~ → 完了（2026-08-17）

イベント一覧の「申込条件」にタグ名が出るようになった。判断待ち 16-1 は閉じた。

**ここでも文書のほうが間違っていた。** 一覧APIは `SELECT e.*` なので
`visible_tag_id` はもとから返っていた。足りなかったのはタグ名だった。
冒頭の注意はこの件にも当てはまる。

### ~~2. イベントの作成を3段階に分ける~~ → 完了（2026-08-17）

`event-wizard.tsx` を新しく作り、`/events/new?step=1..3` の3段階にした。
設計の語 181 件のうち 89 件が実装に無かったので、102 件を
`design-structure.json` に登録して固定してある。

**`event-form.tsx` のタブは残してある。** 編集（8-3-1）がまだそれを使っていて、
new と edit を一度に組み替えると壊したとき戻せないため。枠の追加まわりが
両方に書かれているので、8-3-1 に手をつけるときに片方へ寄せること。

新しく判断待ちに入れたのは3つ（16-7 公開する日時 / 16-8 主催者へのメール /
16-9 画像アップローダの文言）。前の2つは列が無く、押せない状態で置いてある。

### 3. 成果と分析11枚（大きい）

`docs/design-node-ids.md` §5 の Tier 3。上のやり方をそのまま回す。
1画面あたり、抜けが20〜40件出る想定。

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
