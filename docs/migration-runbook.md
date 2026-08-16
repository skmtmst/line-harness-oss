# D1 マイグレーション手順書

0.23.0 と 0.24.0 で、データベースに **17 件**の変更が入る。
この文書は、それを当てる人がそのとおりに進めれば終わる形で書いてある。

**所要時間の目安**: 検証 15 分、本番 20 分、様子見 30 分。

---

## 先に知っておくこと

### 本番は自動で当たる

`main` に入った時点で、[deploy-cloudflare-worker.yml](../.github/workflows/deploy-cloudflare-worker.yml)
が未適用のものを順に当てる。**「当てる」という操作は無く、`main` にマージした瞬間に走る。**

だから手順は「当てる」ではなく「**当たる前に検証で確かめ、当たったあと確認する**」になる。

### 戻す手段は Time Travel だけ

追加のみのポリシー（`CONTRIBUTING.md §Migration Policy`）で、
列を消す・型を変える・名前を変える操作を禁じている。
そのぶん壊れにくいが、**down マイグレーションが書けない**。

戻すには D1 の Time Travel（30日以内の任意の時点に復元）を使う。
巻き戻すので、**当てたあとに入った友だち・メッセージ・予約も一緒に消える**。

復元点はデプロイのたびに自動で取り、実行結果のサマリーに出る。

### 何が変わるか

| | 件数 |
|---|---|
| 新しいテーブル | 16 |
| 既存テーブルに足す列 | 51 |
| 索引 | 17 |
| 既存データを書き換えるもの | 3 か所 |

**列を消すもの・型を変えるものは 1 件も無い。**
足す 51 列はすべて `NULL` 可か `DEFAULT` 付きなので、既存の行はそのまま残る。

書き換える 3 か所はこれだけ。

| ファイル | 何をするか | 二度走らせても平気か |
|---|---|---|
| `099_folders_and_fields.sql` | `tag_groups` を `folders` へ写し、タグの所属を移す | 平気（`INSERT OR IGNORE` と `folder_id IS NULL` 限定の `UPDATE`） |
| `100_friend_attributes.sql` | 対応マーク3件を入れる（未対応／対応中／解決済） | 平気（`INSERT OR IGNORE`） |
| `104_scenario_concurrency_default.sql` | 既存シナリオを全件「並行を許す」に寄せる | 平気（`allow_concurrent = 0` の行だけ） |

**104 が特に大事。** 103 で足した `allow_concurrent` の既定が 0（＝並行を許さない）なので、
104 が当たらないと**全シナリオが排他になり、いま複数のシナリオに入っている人への配信が止まる**。
103 の直後に走るので順序は保たれるが、**103 だけ当たって 104 が当たらない状態は作らないこと**。

---

## 手順

### 1. 検証環境で先に当てる

本番が初見にならないようにする。ここが一番大事。

1. GitHub の **Actions** タブを開く
2. 左の一覧から **Migrate D1** を選ぶ
3. 右上の **Run workflow** を押す
4. 次のように選ぶ
   - **environment**: `staging`
   - **mode**: `dry-run`
5. **Run workflow** を押す

**dry-run では何も変わらない。** 未適用の一覧が出るだけ。

終わったら実行結果を開き、サマリーを見る。

```
## 未適用のマイグレーション: 17 件

対象: nen-line-stg

088_tag_groups.sql
089_auto_reply_conditions.sql
...
104_scenario_concurrency_default.sql
```

**確認すること**: 17 件そろっているか。番号が飛んでいないか。

次に、同じ手順で **mode を `apply`** にしてもう一度走らせる。

終わったらサマリーに復元点が出る。

```
## 復元点（Time Travel）

戻すとき:

npx wrangler d1 time-travel restore nen-line-stg --bookmark=00000085-...
```

**この行をどこかに控えておく。**

### 2. 検証環境で動かして確かめる

管理画面: <https://nen-line-stg-admin.pages.dev>

次の順に触る。ここが通れば、追加した列とテーブルが一通り使われたことになる。

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

**5 が特に大事。** ここにチェックが付いていたら 104 が当たっていない。
**その状態で本番に上げてはいけない。**

### 3. 本番に上げる

検証で問題が無かったら、`codex/development` を `main` にマージする。

マージした時点で [Deploy Cloudflare Worker](../.github/workflows/deploy-cloudflare-worker.yml)
が走り、**自動的に本番 D1 に当たる**。

実行結果を開き、サマリーを確認する。

```
## D1 マイグレーション

未適用: 17 件

088_tag_groups.sql
...

### 復元点

npx wrangler d1 time-travel restore nen-line --bookmark=00000085-...
```

**この復元点を控えておく。** 30 日間有効。

### 4. 本番で確かめる

管理画面: <https://nen-line-admin-98712679.pages.dev>

**手順 2 と同じ 10 項目**を、本番でもう一度見る。

加えて、本番でしか確かめられないものを見る。

| 見るところ | 確かめること |
|---|---|
| 友だち数 | 当てる前と同じ。減っていたら止める |
| チャット | 直近のやりとりが読める |
| 予約一覧 | 入っている予約が全部見える |
| 配信予約 | 予約済みの配信が消えていない |

### 5. 30 分ほど様子を見る

当てた直後は動いても、cron で動くもの（配信・リマインダ）は
次の実行まで結果が出ない。

- 予約していた配信が予定どおり出たか
- リマインダが飛んだか
- 自動応答が返っているか

---

## うまくいかないとき

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
npx wrangler d1 time-travel restore nen-line --bookmark=<控えたID>
```

**当てたあとに入った友だち・メッセージ・予約も一緒に消える。**
戻す前に、その間に何が入ったかを確認すること。

### 何が当たっているか調べる

```bash
npx wrangler d1 execute nen-line --remote --command "SELECT name, applied_at FROM _migrations ORDER BY name DESC LIMIT 20"
```

### シナリオが排他になってしまった

104 が当たっていない。単体で当てる。

```bash
npx wrangler d1 execute nen-line --remote --file=packages/db/migrations/104_scenario_concurrency_default.sql
npx wrangler d1 execute nen-line --remote --command "INSERT INTO _migrations (name, applied_at) VALUES ('104_scenario_concurrency_default.sql', datetime('now'))"
```

---

## 環境の一覧

| 用途 | 本番 | 検証 |
| --- | --- | --- |
| Worker | `nen-line` | `nen-line-stg` |
| D1 | `nen-line` | `nen-line-stg` |
| R2 | `nen-line-images` | `nen-line-stg-images` |
| 管理画面 | `nen-line-admin-98712679` | `nen-line-stg-admin` |
| Worker設定 | `apps/worker/wrangler.toml` | `apps/worker/wrangler.staging.toml` |

検証環境の詳細は [NEN-LINE-STAGING.md](NEN-LINE-STAGING.md) を見ること。

---

## 当てるもの一覧（17 件）

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
