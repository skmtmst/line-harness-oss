# 画像に合わせる作業 — 2日目の引き継ぎ

2026-08-18。**設計の絵を1枚ずつ見て、実装の見た目と動きを寄せる**作業。
1日目の記録は `docs/v025-design-pass-day1.md`、作業の考え方は
`docs/v025-design-pass.md` にある。ここには**2日目に分かったことと、
次に必要なことだけ**を書く。

---

## いまどうなっているか

配布済み。ステージングで触れる。

```
https://nen-line-stg-admin.pages.dev
```

| | |
|---|---|
| 反映コミット | `f277426`（codex/development） |
| マイグレーション | 111・112・113 まで適用済み（未適用ゼロ） |
| テスト | web 223 / worker 1296 / db 239 |

### 2日目にマージしたもの

| PR | 内容 |
|---|---|
| #111 | 受信箱の不具合・友だち一覧の列ズレ・タグの並び替え・シナリオ一覧 |
| #113 | メニューバー（アイコンレール廃止・選択中を薄緑に） |
| #114 | シナリオ編集（離脱地点・差し込み・複製・削除） |
| #115 | シナリオの並び替え・通ごとの「配信後」 |
| #116 | 一斉配信（配信前チェックの自動化・テスト送信） |

### 絵と突き合わせ済みの画面

0-1 ログイン / 1-1 ダッシュボード / 1-1-1 QR / 2-1 受信箱 / 2-2 友だち一覧 /
2-2-1 友だち詳細 / 3-1〜3-4 友だち属性 / 3-1-1 タグを作る / 3-2-1 項目を追加 /
4-1 シナリオ一覧 / 4-1-1 シナリオ編集 / 4-2 一斉配信 / 4-2-1 作成 / 4-2-2 詳細 /
サイドバー

**4-2-2（配信の詳細）は設計どおり揃っていた**ので変更なし。

---

## いちばん大事なこと — もう一人と並行して触っている

**masato さんが同じリポジトリの同じ画面を並行して直している。**
2日目にサイドバーが丸ごと衝突し、こちらの変更を捨てた（#111 のマージコミット）。

### 着手前に必ずやること

```bash
git fetch origin && git log --oneline HEAD..origin/codex/development
```

**空でなければ、触ろうとしている画面が既に直っていないか確認する。**
衝突してから捨てるのは、両方の時間が無駄になる。

### Pen（設計ファイル）の共同編集で合意した運用

2日目の終わりに決めた。まだ**着手していない**。

- 領域を4つに分ける: `APPROVED` / `WORK_KENTA` / `WORK_MASATO` / `ARCHIVE`
- masato さんの担当: **10-1〜10-5 の8画面**（アカウント・ログインユーザー・機能設定・運用状態・データ移行）
- 状態: `[MASATO-DRAFT]` → `[MASATO-REVIEW]` → 合意して `[APPROVED]`
- masato さんは Sidebar / 共通ヘッダー / 共通コンポーネント / デザイン変数 / こちらの担当画面に触らない
- **APPROVED への最終反映はこちら側**（対応表を直す人と同じにする）
- 先にテスト用フレームで、リアルタイム反映・履歴・元に戻すを確認する

**こちらが先にやること**: 正本のバックアップ → 4領域を作る → V1・Lステップ比較・
飲食店案を ARCHIVE へ → 編集権限を渡す。

`.pen` を GitHub（`design/nen-admin-v2.pen`）へ置く案も出ているが、
**Pen 上の運用を固めてから後で足す**ことにした。

---

## 2日目に踏んだ落とし穴

同じところで止まらないように残す。

### 1. 配布が空振りすることがある

シナリオ編集の配布で、**1回目は古いチャンクのまま**だった。もう一度流したら通った。
原因は分かっていない。

**配布したら必ず中身を確認する。**

```bash
D=https://<デプロイ固有のホスト>
C=$(curl -s "$D/scenarios/detail" | grep -o '/_next/static/chunks/app/scenarios/detail/[^"]*\.js' | head -1)
curl -s "$D$C" | grep -c "入っているはずの文字列"
```

本番URL（`nen-line-stg-admin.pages.dev`）は**少し遅れて切り替わる**。
デプロイ固有URLで先に確認し、本番URLが同じチャンクを指すまで待つ。

### 2. D1 は複数の ALTER をまとめると途中で落ちる

マイグレーション113 は `ALTER` が2本あり、**1本目だけ入って2本目で落ちた**。
`_migrations` にも記録されず、`migrate.ts status` が「部分」と判定して止まった。

残りを手で当てて記録も入れた。**次からは1ファイル1文にしたほうが安全。**

止まったときの直し方:

```bash
# 何が入っているか確かめる
./node_modules/.bin/wrangler d1 execute nen-line-stg --config apps/worker/wrangler.staging.toml \
  --remote --json --command "SELECT COUNT(*) AS n FROM pragma_table_info('テーブル') WHERE name='列'"
# 足りないぶんを当てる → 記録を入れる
./node_modules/.bin/wrangler d1 execute ... --command "INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES ('113_....sql', datetime('now'))"
```

### 3. Hono は先に登録した経路が勝つ

`/api/tags/reorder` を `/api/tags/:id` の**後ろ**に置くと、`:id` が `"reorder"` を
IDとして食う。並び替えのつもりが名前の変更として届く。

**`:id` より前に置く。** タグとシナリオの両方でテストに固定してある。

### 4. フォルダ名が「必ず出る語」に登録されている

`design-structure.json` の `parts` に `01_購入ステータス` `01_お知らせ` などの
**その環境のデータ**が入っていた。実装をDBから読む形に変えると落ちる。

画面の文言ではないので、**JSON から外すのが正しい**。tags / scenarios /
broadcasts の3画面で外した。

### 5. 列を足したら通す場所が多い

`tags.is_starred` を足したときの経路:

```
migrations → packages/db の型と関数 → bootstrap 再生成
  → worker の serialize と受け口 → packages/shared の型 → shared をビルド
  → apps/web の api.ts → 画面
```

**`pnpm --filter @line-crm/shared build` を忘れると web の型チェックが古い型を見る。**
**`pnpm --filter @line-crm/db generate:bootstrap` を忘れると db のテストが落ちる。**

---

## 決めてほしいことが残っている

1日目のぶんは `docs/v025-design-pass-day1.md` にある。2日目に増えたのはこれ。

| | 内容 |
|---|---|
| シナリオ一覧の「最終ステップ後」列 | 設計にあるが、持っている列が無い |
| KPI の「前週比 +6%」など | 前週ぶんを数える口が無い。いまは「過去7日」 |
| 一斉配信の「開封率が低い」「今月分」 | 比べる相手・区切りが決まっていない |
| シナリオ一覧の「離脱が大きい」 | 同上 |
| 一斉配信・シナリオのフォルダ | `broadcasts` / `scenarios` に `folder_id` が無い |

**どれも「受け口が無い」ことが理由**で止まっている。画面には枠だけ置いて、
何が足りないかを書いてある。

---

## 触るときの決まり

1日目から変わっていないが、2日目に効いたものを再掲する。

- **`data-design="..."` の印と `parts` の語を消さない。** 言い回しを変えるときは
  `design-structure.json` も一緒に直す。差分に「設計を更新した」ことが残る
- **押せない状態にしてあるボタンを、押せるようにしない。** 受け口が無いから
  そうしてある。理由はすぐ横のコメントにある
- **たどり着けない分岐を残さない。** 2日目に215行のデッドコード（開く手段の
  無い作成フォーム）と、「返信待ちのみ」を消したことで通らなくなった分岐を落とした
- **1画面ずつコミットする。** 見た目の直しは戻したくなることがある

---

## 確かめ方

```bash
export PATH="$HOME/bin:$PATH"
cd "/Volumes/My Passport/Github/line-harness-nen"
(cd apps/web && pnpm typecheck && pnpm test)      # 223件
(cd apps/worker && pnpm typecheck && pnpm test)   # 1296件
(cd packages/db && pnpm test)                     # 239件
(cd apps/web && NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm build)
```

`pnpm` は `~/bin` にある。`gh` は `--repo skmtmst/line-harness-oss` を付ける
（フォークなので付けないと止まる）。

---

## 配布の手順

```bash
export PATH="$HOME/bin:$PATH"
cd "/Volumes/My Passport/Github/line-harness-nen"

gh pr merge <N> --merge --repo skmtmst/line-harness-oss
git checkout codex/development && git pull

npx tsx scripts/deploy/deploy-lock.ts acquire staging --note "..."
npx tsx scripts/deploy/migrate.ts status staging      # 未適用があれば apply --apply
bash scripts/deploy/staging-deploy.sh --apply --parent-repo "/Volumes/My Passport/Github/nen-petfood-eccube"
# ここで配布物の中身を確認する（落とし穴1）
npx tsx scripts/deploy/deploy-lock.ts release staging
```

- **ロックは必ず解放する。** 取ったままだと他の人が配布できない
- `.claude/launch.json` は `.git/info/exclude` で手元だけ除外している
  （`codex/development` が保護ブランチで push できないため）
- GitHub API が 503 を返すことがある。**git 経路は生きていることが多い**ので、
  `gh` が落ちても `git push` は通る

---

## 次にやること

1. **Pen の共同編集の準備**（バックアップ → 4領域 → ARCHIVE 分離 → 権限付与）
2. 残りの画面を絵と突き合わせる。**PC 85枚のうち触ったのは15枚**
3. スマホ21枚・タブレット3枚は手つかず

## 関連文書

| | |
|---|---|
| `docs/v025-design-pass.md` | 作業の考え方。デザイントークン、見るところの順番 |
| `docs/v025-design-pass-day1.md` | 1日目の記録と決めてほしいこと6件 |
| `docs/v025-open-questions.md` | 判断待ち。中身の話で、見た目の話ではない |
| `docs/design-node-ids.md` | 117画面のIDとルート |
| `apps/web/src/lib/design-structure.json` | 画面の骨格と必ず出す語 |
