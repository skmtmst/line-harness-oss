# D1 マイグレーション手順書

0.23.0 と 0.24.0 で、データベースに **17 件**の変更が入る。
この文書は、それを当てる人がそのとおりに進めれば終わる形で書いてある。

**所要時間の目安**: 検証 30 分、本番 30 分、様子見 30 分。

---

## 先に知っておくこと

### 自動では当たらない。手で当てる

`.github/workflows/deploy-cloudflare-worker.yml` に自動適用の手順は入っているが、
**このリポジトリでは一度も走っていない**。`vars.LINE_HARNESS_CLOUDFLARE_DEPLOY`
が未設定で、job ごとスキップされるため。

これは意図的な状態で、`docs/DEPLOY-GATE.md` にこう書いてある。

> `LINE_HARNESS_CLOUDFLARE_DEPLOY` は当面未設定のまま。安全なリリース手順が
> 確立するまで自動本番デプロイは有効化しない。

デプロイもマイグレーションも、**手元から wrangler で行う**。

### `_migrations` がまだ無い

適用の仕組みは「`_migrations` に無いファイルを当てる」だが、
**検証・本番のどちらにもこの表が無い**。スキーマは手で作られてきた。

この状態でそのまま走らせると 001 から全件を流そうとして、
`ALTER TABLE ADD COLUMN` が「列がすでにある」で必ず落ちる。

だから最初に一度だけ、**現物を見て記録を作る**工程（`seed`）が要る。

### 到達点が環境ごとに違う

2026-08-16 時点。

| | 検証 `nen-line-stg` | 本番 `nen-line` |
|---|---|---|
| テーブル数 | 99 | 96 |
| 適用済み | 76 件 | 71 件 |
| 未適用 | 26 件 | 30 件 |
| 部分適用 | 0 件 | **1 件（077）** |

**本番は検証より遅れている**（084〜087 が未入り）。
両方に 051・057〜066 の穴もある。マイル機能・ウェビナー追客・面談リマインダ。

**検証で確かめた結果が、本番にそのままは当てはまらない。**
本番は先に 084〜087 が当たるぶん、確認項目が増える。

### 戻す手段は Time Travel だけ

追加のみのポリシー（`CONTRIBUTING.md §Migration Policy`）で、
列を消す・型を変える・名前を変える操作を禁じている。
そのぶん壊れにくいが、**down マイグレーションが書けない**。

戻すには D1 の Time Travel（30日以内の任意の時点に復元）を使う。
巻き戻すので、**当てたあとに入った友だち・メッセージ・予約も一緒に消える**。

復元点は `apply` のたびに自動で取り、画面に出る。**控えること。**

### 何が変わるか

17 件（088〜104）の内訳。

| | 件数 |
|---|---|
| 新しいテーブル | 16 |
| 既存テーブルに足す列 | 51 |
| 索引 | 17 |
| 既存データを書き換えるもの | 3 か所 |

**列を消すもの・型を変えるものは 1 件も無い。**
足す 51 列はすべて `NULL` 可か `DEFAULT` 付きなので、既存の行はそのまま残る。

書き換える 3 か所。

| ファイル | 何をするか | 二度走らせても平気か |
|---|---|---|
| `099_folders_and_fields.sql` | `tag_groups` を `folders` へ写し、タグの所属を移す | 平気（`INSERT OR IGNORE` と `folder_id IS NULL` 限定の `UPDATE`） |
| `100_friend_attributes.sql` | 対応マーク3件を入れる（未対応／対応中／解決済） | 平気（`INSERT OR IGNORE`） |
| `104_scenario_concurrency_default.sql` | 既存シナリオを全件「並行を許す」に寄せる | 平気（`allow_concurrent = 0` の行だけ） |

**104 が特に大事。** 103 で足した `allow_concurrent` の既定が 0（＝並行を許さない）なので、
104 が当たらないと**全シナリオが排他になり、いま複数のシナリオに入っている人への配信が止まる**。

---

## 誰がどこまでやるか

`docs/DEPLOY-GATE.md` の分担にそのまま従う。

| | 検証 | 本番 |
|---|---|---|
| 実行 | **どの開発者でもよい**（ロックを取れば） | **masato 専任** |
| 承認 | 不要（ロックが使用宣言） | **masato の明示的な承認と担当指定** |

> kenta は調査・差分確認・dry-run・手順準備まで進められますが、
> 本番への適用は masato の明示的な承認と担当指定がある場合だけ実施します。

---

## 検証環境の手順

### 1. 必要なものをマージする

マイグレーションが `codex/development` に入っていないと当てられない。

系譜を調べたところ、**0.23.0 の 9 本と v0.24.0 の 14 本は
すべて `codex/kenta-v024-deferred` の祖先**だった。順に入れる必要はない。

```bash
gh pr merge 59 --merge --repo skmtmst/line-harness-oss
gh pr merge 61 --merge --repo skmtmst/line-harness-oss
gh pr merge 60 --merge --repo skmtmst/line-harness-oss
```

```bash
gh pr edit 58 --base codex/development --repo skmtmst/line-harness-oss
gh pr merge 58 --merge --repo skmtmst/line-harness-oss
```

**`--repo` を付けること。** このリポジトリはフォークなので、
付けないと `gh` がフォーク元（`Shudesu/line-harness-oss`）を候補に出して止まる。
`gh repo set-default` で解決してもよいが、選び間違えると
フォーク元にマージしてしまう。明示するほうが安全。

**`#58` の base を変え忘れないこと。** そのままだと
`codex/kenta-v024-all-screens` にマージされ、`codex/development` に届かない。

### 2. 基準ブランチに移る

```bash
git checkout codex/development && git pull
```

検証環境に入れるものは統合版と一致していないと、
確認結果が何を保証したのか分からなくなる。

### 3. ロックを取得する（＝使用宣言）

```bash
pnpm deploy:lock acquire staging --note "0.23.0/0.24.0 マイグレーション適用"
```

`command not found: pnpm` と出るPCがある。`pnpm` は PATH に無いことがあり、
このリポジトリも `packageManager` の pin に頼っている。
その場合は `npx tsx` で中身を直接呼べばよい。

```bash
npx tsx scripts/deploy/deploy-lock.ts acquire staging --note "0.23.0/0.24.0 マイグレーション適用"
```

| `pnpm` を使う書き方 | `pnpm` 無しの書き方 |
|---|---|
| `pnpm deploy:lock ...` | `npx tsx scripts/deploy/deploy-lock.ts ...` |
| `pnpm deploy:staging -- --apply` | `bash scripts/deploy/staging-deploy.sh --apply` |

ただし手順7（Worker と管理画面を配る）は、スクリプトの中で
`pnpm --filter worker build` を呼ぶので `pnpm` が要る。
**マイグレーションの適用（手順3〜6）までは `npx tsx` だけで進められる。**

`pnpm` を使えるようにするなら corepack から有効化する。

```bash
corepack enable
```

検証環境は1組しかない。これが他の開発者への通知になる。
すでに誰かが持っていれば失敗する。空くまで待つこと。

### 4. いまの状態を見る

```bash
npx tsx scripts/deploy/migrate.ts status staging
```

読み取りだけ。何も変えない。次のように出る。

```
対象: nen-line-stg (staging)
  マイグレーション 109 件
  スキーマ上   適用済み 76 / 未適用 26 / 部分 0 / 判定不能 7
  _migrations に記録済み 0 件

これから当たるもの 33 件:
  ...
```

**「部分」が 0 件であることを確かめる。** 1 件でもあれば止まる。
途中で落ちた跡の可能性があり、人が中を見るまで動かしてはいけない。

### 5. `_migrations` を作る

```bash
npx tsx scripts/deploy/migrate.ts seed staging          # dry-run
npx tsx scripts/deploy/migrate.ts seed staging --apply  # 実行
```

**スキーマもデータも変えない。** 実際に入っている 76 件を
「適用済み」として記録するだけ。

データのみのもの（026 034 039 063 080 081）は記録しない。
すべて `SELECT 1` / 条件付き `UPDATE` / `INSERT OR IGNORE` で再実行して安全であり、
063 は 061 のあとに流す必要があるため。

### 6. 当てる

```bash
npx tsx scripts/deploy/migrate.ts apply staging          # dry-run
npx tsx scripts/deploy/migrate.ts apply staging --apply  # 実行
```

最初に Time Travel の復元点を取る。取れなければ中止する。

```
復元点: 000003a0-00000000-000050c9-...
戻すとき:
  wrangler d1 time-travel restore nen-line-stg --config ... --bookmark=...
```

**この行を控える。** 30 日間有効。

### 7. Worker と管理画面を配る

```bash
pnpm deploy:staging -- --apply
```

データベースだけ新しくてコードが古いと、画面が新しい列を使えない。

### 8. 動かして確かめる

管理画面: <https://nen-line-stg-admin.pages.dev>

| # | 見るところ | 確かめること |
|---|---|---|
| 1 | 友だち一覧 | いままでどおり出る。件数が減っていない |
| 2 | 友だち詳細 | 「対応マーク」が出て、未対応／対応中／解決済 が選べる |
| 3 | タグ | 分類（フォルダ）でまとまって出る。前の分類が消えていない |
| 4 | シナリオ一覧 | いままで動いているシナリオが `有効` のまま |
| 5 | シナリオ詳細 | 「他のシナリオが動いている人は登録しない」が **チェック無し** |
| 6 | 一斉配信 → 新規作成 | 「時間をかけて配る」の入力欄が出る |
| 7 | 自動応答 | 一覧の並びが優先順位どおり |
| 8 | 予約メニュー | 受付条件（同時受付数・受付期間・締切）が出る |
| 9 | 設定 → 機能設定 | サイドバーの並び替えができる |
| 10 | どれか1画面で再読み込み | エラーが出ない |

**5 が特に大事。** チェックが付いていたら 104 が当たっていない。
**その状態で本番に上げてはいけない。**

穴（051・057〜066）も埋まるので、次も見る。

| # | 見るところ | 確かめること |
|---|---|---|
| 11 | マイル | 画面が開く。ルール一覧が出る |
| 12 | ウェビナー | 追客の設定が出る |
| 13 | 予約 → スタッフ | 繰り返しの受付設定が出る |

### 9. ロックを解放し、結果を共有する

```bash
pnpm deploy:lock release staging
```

解放時に次を共有する。

- 反映コミット
- 確認結果（上の 13 項目）
- 未確認事項
- **復元点のブックマーク**

ここまでが検証担当の範囲。**本番に出すかどうかは masato の判断。**

---

## 本番の手順（masato）

検証と同じ道具を使うが、**承認が要る**。

```bash
npx tsx scripts/deploy/migrate.ts status production
```

承認なしでも `status` は動く。調査は誰でもできる。

`seed` と `apply` は次を要求する。無いと実行前に止まる。

```bash
npx tsx scripts/deploy/migrate.ts apply production --apply \
  --approved-by skmtmst \
  --approval-ref https://github.com/skmtmst/line-harness-oss/pull/58#issuecomment-...
```

`--approved-by` は実行者が自分で打てるので、**それ単独では承認の証明にならない**。
`--approval-ref` に承認が実際に残っている場所を指定すること。

### 本番だけの注意

**1. 到達点が違う。** 本番は 084〜087 も当たる。

| 番号 | 中身 | 増える確認項目 |
|---|---|---|
| 084 | スタッフの閲覧専用権限 | ユーザー管理で権限が選べる |
| 085・086 | 流入経路のジャンル | 流入経路にジャンルが出る |
| 087 | 配信メッセージの組み立て | 一斉配信で複数吹き出しが作れる |

**2. 077 が部分適用。** `nen_consultation_logs_v2` と索引2件が無い。
`migrate.ts` は部分適用があると止まる。**先に中を見て、人が判断すること。**

**3. データ量。** 2026-08-16 時点で友だち 6 人・メッセージ 35 件。
当てる前に控えて、当てたあと減っていないことを確かめる。

### 本番で見るところ

検証の 13 項目に加えて、本番でしか確かめられないもの。

| 見るところ | 確かめること |
|---|---|
| 友だち数 | 当てる前と同じ。減っていたら止める |
| チャット | 直近のやりとりが読める |
| 予約一覧 | 入っている予約が全部見える |
| 配信予約 | 予約済みの配信が消えていない |

### 30 分ほど様子を見る

cron で動くもの（配信・リマインダ）は次の実行まで結果が出ない。

- 予約していた配信が予定どおり出たか
- リマインダが飛んだか
- 自動応答が返っているか

---

## うまくいかないとき

### 「部分適用があります」と言われた

途中で落ちた跡かもしれない。**自動では進めない作りにしてある。**

```bash
npx tsx scripts/deploy/migrate.ts status <env>
```

欠けている物が出るので、そのマイグレーションを開いて、
何が入っていて何が入っていないかを人が確かめること。

### 途中で止まった

`wrangler d1 execute --file` は**トランザクションで包まれていない**。
1 ファイルの途中で落ちると、そこまでの文は当たったまま残る。

`_migrations` にはそのファイルが記録されないので、次に走らせると
**同じファイルを最初からやり直す**。

- `CREATE TABLE IF NOT EXISTS` → 無害
- `ALTER TABLE ADD COLUMN` → **「列がすでにある」で落ちる**

つまり**自動では復旧しない**。手で直すか、復元点まで戻す。

一番長いのは `099_folders_and_fields.sql`（82 行）。落ちるならここの可能性が高い。

### 復元点まで戻す

```bash
npx wrangler d1 time-travel restore nen-line-stg \
  --config apps/worker/wrangler.staging.toml \
  --bookmark=<控えたID>
```

**当てたあとに入ったデータも一緒に消える。**
戻す前に、その間に何が入ったかを確認すること。

### シナリオが排他になってしまった

104 が当たっていない。単体で当てる。

```bash
npx wrangler d1 execute nen-line-stg --remote \
  --config apps/worker/wrangler.staging.toml \
  --file=packages/db/migrations/104_scenario_concurrency_default.sql
```

```bash
npx wrangler d1 execute nen-line-stg --remote \
  --config apps/worker/wrangler.staging.toml \
  --command "INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES ('104_scenario_concurrency_default.sql', datetime('now'))"
```

### `gh` が「no default remote repository」と言う

このリポジトリはフォークなので、`gh` がフォーク元との区別を求める。

```bash
gh pr merge 59 --merge --repo skmtmst/line-harness-oss
```

`--repo` を付けるのが安全。`gh repo set-default` でも解決するが、
選び間違えるとフォーク元にマージしてしまう。

---

## 環境の一覧

| 用途 | 本番 | 検証 |
| --- | --- | --- |
| Worker | `nen-line` | `nen-line-stg` |
| D1 | `nen-line` | `nen-line-stg` |
| R2 | `nen-line-images` | `nen-line-stg-images` |
| 管理画面 | `nen-line-admin-98712679` | `nen-line-stg-admin` |
| Worker設定 | `apps/worker/wrangler.toml` | `apps/worker/wrangler.staging.toml` |

検証環境の詳細は [NEN-LINE-STAGING.md](NEN-LINE-STAGING.md)、
分担と排他の決まりは [DEPLOY-GATE.md](DEPLOY-GATE.md) を見ること。

---

## 当てるもの一覧（088〜104）

| 番号 | 中身 |
|---|---|
| 088 | タグの親分類（`tag_groups`） |
| 089 | 自動応答の「返さない条件」 |
| 090 | 成果地点の数え方 |
| 091 | 予約メニューの受付条件 |
| 092 | リマインダの自動登録 |
| 093 | 送信Webhookの再試行 |
| 094 | イベントの公開対象 |
| 095 | アフィリエイターの支払い条件 |
| 096 | LINEアカウントの友だち数上限 |
| 097 | 友だちのアカウント索引 |
| 098 | イベントのキャンセル待ち |
| 099 | フォルダと友だち情報欄 |
| 100 | 対応マーク・保存した検索 |
| 101 | メディアライブラリ・共通情報 |
| 102 | アクセス解析（サイト計測・ファネル） |
| 103 | ログイン履歴・運用フラグ |
| 104 | シナリオの並行購読の既定値 |

## 穴として一緒に埋まるもの（検証・本番とも未適用）

| 番号 | 中身 |
|---|---|
| 051 | 予約の繰り返し受付・Googleカレンダー |
| 057 | ウェビナーのファネル計測 |
| 058 | ウェビナーの追客 |
| 059 | 面談リマインダ |
| 060 | ウェビナーの導線追客 |
| 061・062 | マイルの土台と管理 |
| 064 | マイルの非同期処理とタグ方針 |
| 065 | 継続フォローのマイル |
| 066 | 紹介品質のマイル |
