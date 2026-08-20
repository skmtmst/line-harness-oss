# デプロイ安全ゲートと排他運用

2026-08-14 に masato / kenta で合意した、2人以上で並行開発するときの運用ルールです。
`AGENTS.md` のゲートを、共同開発の状況に合わせて具体化したものです。

## なぜ必要か

検証環境は1組しかありません。

| 種別 | 検証 | 本番 |
| --- | --- | --- |
| Worker | `nen-line-stg` | `nen-line` |
| D1 | `nen-line-stg` | `nen-line` |
| R2 | `nen-line-stg-images` | `nen-line-images` |
| 管理画面 Pages | `nen-line-stg-admin` | `nen-line-admin-98712679` |
| LINEチャネル | `然-NEN- TEST` | 本番アカウント |

コードはブランチで分けられますが、**検証環境は分けられません**。
片方が検証している最中にもう片方がデプロイすると、テスト結果が無効になり、
LINEのテスト通知も混ざります。だから排他制御が要ります。

## ブランチの役割

| ブランチ | 役割 |
| --- | --- |
| `codex/<担当者名>-<作業内容>` | 個人の作業ブランチ。ここで実装する |
| `codex/development` | 開発・検証環境の統合版 |
| `main` | 検証合格後、本番へ反映してよい確定版 |

デプロイの基準ブランチは**環境ごとに違います**。

| デプロイ先 | 基準ブランチ | wrangler 設定 |
| --- | --- | --- |
| 検証 (`staging`) | `codex/development` | `apps/worker/wrangler.staging.toml` |
| 本番 (`production`) | `main` | `apps/worker/wrangler.toml` |

本番を `codex/development` から出すと未検証の変更が本番へ入り、
検証を `main` から出すと検証そのものが成立しません。preflight は両方を拒否します。

- `codex/development` への直接 push は禁止。PR経由のみ。
- `codex/development` は、条件を確認できた開発者が自分でマージしてよい。
- `main` への反映は masato の承認が必要。
- `LINE_HARNESS_CLOUDFLARE_DEPLOY` は当面未設定のまま。安全なリリース手順が
  確立するまで自動本番デプロイは有効化しない。

## 設定（PC・環境ごとに違う値）

既定値をコードに埋め込んでいません。**確認できない値があれば実行を止めます**。

| 値 | 指定方法 | 既定 |
| --- | --- | --- |
| 親のEC-CUBEリポジトリ | `--parent-repo <path>` または `LINE_HARNESS_PARENT_REPO` | **なし（必須）** |
| デプロイ対象remote | `--remote <name>` または `LINE_HARNESS_DEPLOY_REMOTE` | `origin`（実在を確認） |

親リポジトリのパスはPCごとに違うため既定値を持ちません。
remote名もフォーク環境によって `origin` だったり `fork` だったりするため、
指定値が `git remote` に無ければ推測せずに停止します。

`~/.zshrc` などに書いておくと毎回指定せずに済みます。

```bash
export LINE_HARNESS_PARENT_REPO="$HOME/path/to/nen-petfood-eccube"
export LINE_HARNESS_DEPLOY_REMOTE=origin
```

## 検証デプロイの手順

### 1. ロックを取得する（＝使用宣言）

```bash
pnpm deploy:lock acquire staging --note "紹介リンク一覧の列幅修正"
```

ロックは remote 上の git ref (`refs/deploy-locks/staging`) として保存されます。
すでに誰かが持っていれば取得は失敗し、保持者・対象コミット・変更範囲・経過時間が表示されます。

先に宣言した人が優先です。空くまで待ってください。

現在の状況だけ見たいとき:

```bash
pnpm deploy:lock status staging
```

### 2. デプロイする

```bash
# dry-run（既定）: ゲートとビルドまで。Cloudflare には触れない
pnpm deploy:staging

# 実際に反映する
pnpm deploy:staging -- --apply
```

スクリプトは最初に事前確認（preflight）を実行し、1つでも違反があれば中止します。

### 3. ロックを解放して結果を共有する

```bash
pnpm deploy:lock release staging
```

解放時に次を共有してください。

- 反映コミット
- 確認結果
- 未確認事項

## ロックの仕組みと制限

**取得**：空の orphan commit を `refs/deploy-locks/<env>` へ push します。
既に埋まっていればサーバーが非fast-forwardとして拒否するため、
「確認してから書く」方式の競合が起きません。
git plumbing だけを使うので、**ロック取得で作業ツリーが汚れません**。

**解放**：読み取ったロックrefのSHAを `--force-with-lease=<ref>:<SHA>` で渡し、
**refが変わっていない場合だけ削除**します。
これが無いと、ロックを読んでから削除するまでの間に別の担当者が取得し直した場合、
その新しいロックを消してしまいます（相手のデプロイ中に排他が外れる）。
SHAが変わっていた場合は削除せず、現在の保持者を確認するよう促します。

**他人のロック**は既定では解放できません（`--force` が必要）。

**古いロック**は `status` で「放置の可能性あり」と表示されますが（90分）、
**時間経過での自動解放はしません**。デプロイ継続中か中断かは人が判断すべきだからです。

## 事前確認（preflight）が見ているもの

`scripts/deploy/preflight.ts` は次を確認し、違反を全件まとめて表示します。

| コード | 内容 |
| --- | --- |
| `dirty-worktree` | LINEリポジトリに未コミット変更・未追跡ファイルがある |
| `parent-repo-unspecified` | 親のEC-CUBEリポジトリが指定されていない |
| `parent-repo-missing` | 指定されたパスにリポジトリが見つからない |
| `parent-dirty-worktree` | 親のEC-CUBEリポジトリに未コミット変更がある |
| `wrong-branch` | その環境の基準ブランチ以外からデプロイしようとしている |
| `head-behind-remote` | ローカルHEADが `<remote>/<基準ブランチ>` と一致しない |
| `config-env-mismatch` | 環境と wrangler 設定ファイルの組み合わせが違う |
| `production-approval-missing` | 本番デプロイに `--approved-by` がない |
| `production-approval-invalid` | 承認者として認められていないログインが指定された |
| `production-approval-ref-missing` | 本番デプロイに `--approval-ref`（承認記録URL）がない |
| `lock-not-held` | デプロイロックを取得していない |
| `lock-held-by-other` | 別の開発者が使用中 |
| `lock-sha-mismatch` | 宣言した対象コミットと実際のデプロイ対象が違う |

`head-behind-remote` は並行開発で最も重要です。
これが出たら、共同開発者の更新が入っています。取り込んでテストをやり直してください。
古いテスト結果のまま反映してはいけません。

## 本番デプロイ

原則として masato 専任です。

Cloudflare の本番アクセス権限があること自体は、本番変更の承認ではありません。
kenta は調査・差分確認・dry-run・手順準備まで進められますが、
本番への適用は masato の明示的な承認と担当指定がある場合だけ実施します。

### `--approved-by` は承認の証明ではない

スクリプト上、本番は次の2つを要求します。

```bash
pnpm deploy:preflight production \
  --approved-by skmtmst \
  --approval-ref https://github.com/skmtmst/line-harness-oss/pull/123#issuecomment-456
```

- `PRODUCTION_APPROVERS` は GitHub ログインの `skmtmst` のみです。
  表示名（`masato` など）は使いません。承認者の同定はログインに統一します。
- **`--approved-by` は実行者が自分で入力できるため、それ単独では
  masato の承認を技術的に証明しません。** 入力ミスと勘違いを防ぐ安全確認です。
- したがって `--approval-ref` で**承認記録のURL**を必須にしています。
  PRコメントなど、承認が実際に残っている場所を指定してください。
- **本番実行前には、この承認記録が別途必要です。** スクリプトが通ったことは
  承認があったことを意味しません。

## マイグレーションの採番

`packages/db/migrations` は3桁連番です。並行開発では必ず番号を取り合うため、
**着手前に宣言して予約する**方式にします。

1. 最新の upstream と `codex/development` を取得してから次番号を確認する
2. 着手前に「番号・機能名・担当者」を共有する
3. 先に宣言した人がその番号を使う
4. マージ前に同じ番号が追加されていた場合、**まだ適用していない自分側**を採番し直す
5. 検証・本番へ適用済みのマイグレーションは改名・書き換えしない

担当者ごとの番号帯は、将来の upstream 採番と衝突するため使いません。

なお `scripts/check-migrations.ts` が additive-only ポリシー（`DROP TABLE` /
`DROP COLUMN` / `RENAME` / `DEFAULT` なし `NOT NULL` などの禁止）を静的検査します。

### 表の作り直し（CHECK 制約を変えるとき）

SQLite は CHECK を後から変えられません。種別を1つ増やすだけでも、
**新しい表を作る → 中身を写す → 古い表を落とす → 名前を付け替える**しか手がなく、
途中に `DROP TABLE` と `RENAME TO` が必ず入ります。

そのため、ファイルに次の1行を書いた場合だけ、この2つを見逃します。

```sql
-- migration-policy: table-rebuild
```

書けば何でも通るわけではありません。

- `<表名>_new` を作って、同じ `<表名>` を落として、`<表名>_new` を `<表名>` へ改名する、
  という**組になっていないと通りません**
- 作り直しと関係ない禁止事項（`DROP COLUMN` など）は、印があっても止まります
- 意図した作り直しは `grep 'table-rebuild' packages/db/migrations/` で全部数えられます

**落とすのと改名するのは、必ず同じファイルに書いてください。** 当てる仕組みは
ファイルごとに `wrangler d1 execute --file` を呼ぶので、ファイルの境目が
そのまま「その表が存在しない時間」になります。同じファイルなら1回の呼び出しで
済み、その隙間が消えます。

**索引は貼り直しになるので、名前を毎回変えてください。** 適用の要否を
「いま索引があるか」で判定する仕組みは、表を落とす前の状態を見て「もうある」と
判断し、その行を飛ばします。飛ばされると索引が消えたまま戻りません
（136 で実際に踏みました）。

## CI

`.github/workflows/deploy-scripts-ci.yml` が、`scripts/**`・`package.json`・
`.github/workflows/**` に触るPRで次を自動実行します。

- `pnpm test:scripts`（デプロイロックのgit実挙動テストを含む）
- TypeScript 型検査（`scripts/tsconfig.json`）
- `bash -n`（`scripts/**/*.sh` 全件）
- workflow YAML の構文検査と、各 run ステップのシェル構文検査

型検査に必要な `@types/node` は、リポジトリの依存には追加せず CI 内の一時領域へ入れています。
root へ追加すると、`packageManager` の pin より新しい pnpm で生成された
`pnpm-lock.yaml` が広範囲に書き換わるためです。

## upstream 取り込み

`.github/workflows/update-from-upstream.yml` が毎日 JST 4:17 に、
本家 `Shudesu/line-harness-oss` の main を取り込む PR を作ります。

- 起点・宛先ともに `codex/development`
- マージもデプロイも自動では行わない
- 一次確認: kenta / 最終確認・バックアップ: masato

溜めると一気に競合するので、その日のうちに一次確認します。

## 担当領域

同じ画面を2人で同時に触ると必ず競合します。着手前に機能単位で担当を共有してください。

- masato: 管理画面UI（紹介リンク、Search Console、ブロードキャスト作成画面ほか）
- kenta: 運用基盤（デプロイゲート、デプロイロック、workflow、運用文書）

## 関連文書

- `AGENTS.md` — 上位の運用ルール
- `docs/NEN-LINE-STAGING.md` — 検証環境の構成と接続情報
- `docs/admin-ui-design-guidelines.md` — 管理画面のデザイン基準

## 並行で作業するときに踏んだこと（2026-08-20）

一晩に4つのセッションが同じリポジトリで動いた記録です。**規則として読むより、
「自分がいまこの位置にいないか」を確かめるために読んでください。**
どれも「そのときは正しくやった。続かなかっただけ」でした。

### 別々の作業フォルダにする

同じフォルダを複数のセッションで開くと、**同じファイルの別の場所を同時に書きます。**
`apps/web/src/lib/api.ts` に3セッションぶんの変更が混ざりました。ブランチも1つしか
出せないので、片方がコミットすると相手の変更が載ります。

```bash
git worktree add ../line-harness-<機能名> -b codex/kenta-<機能名> codex/development
```

新しい worktree には `node_modules` がありません。`pnpm install --frozen-lockfile` が要ります。

### `packages/shared` は、マージのたびにビルドし直す

```bash
git merge origin/codex/development
cd packages/shared && npx tsc -p tsconfig.build.json
```

`@line-crm/shared` は `dist` を見に行きます。**新しい `export` が足されると、dist を
持っている人でも古ければ落ちます。** 自分が足していなくても踏みます。

**落ちるのはビルドの最後です。** 型検査も試験も全部通ってから落ちるので、ソースを
いくら読んでも原因が見つかりません。

```
"validateAnswers" is not exported by "packages/shared/dist/index.js"
```

`line-sdk` と `update-engine` も同じです（こちらは「dist が無い」で落ちます）。

**「新しい export を足したときだけ」では見落とします。** マージのたびに流してください。

### `git diff --check` は、コミットする前に流す

```bash
git add -A
git diff --cached --check   # ← ここ
git commit
```

**コミットしたあとに流すと、必ず何も出ません。** 作業ツリーと HEAD が同じになるためです。

実際に、突き合わせの目印（`<<<<<<< HEAD`）が入ったまま押されました。押した本人は
コミット後に `git diff --check` を流して「何も出ない」ので通しています。
**そのあと、それを教えた側（このリポジトリの取りまとめ）も同じ順序で同じ失敗をしました。**
間違った手順が2人のあいだを往復しました。

### `git checkout` が失敗していても、気づかないことがある

未コミットの変更があると切り替わりません。**そのとき、同じ突き合わせの目印が両方の
ブランチに入っていたので、画面に出た中身が正しく見えました。**

偶然が重なると、間違いが正しく見えます。切り替えたつもりのときは
`git branch --show-current` を見てください。

### 追いつきは `gh pr update-branch`

```bash
gh pr update-branch <番号>
```

このリポジトリは「取り込み先に追いついていないと入れられない」設定です。手で
`git merge` して push すると、その間に別のPRが入って、また追いつき直しになります。
一晩で何周かしました。**衝突が無ければこのコマンドで足ります。**（衝突があると弾かれます。
そのときは中身を知っている人が解いてください。）

### 反映履歴は、PRごとの1ファイルに書く

```
docs/release-log/unreleased/<PR番号>-<担当>-<何の話か>.md
```

`unreleased.md` に全員が書き足す形だと、**全員が同じ場所（`## 追加` の直後）に行を
差し込むので、PRのたびに必ずぶつかります。** 一晩で9本のPRが全部ここで止まりました。

### マイグレーションの番号は、取る前に取りまとめへ聞く

担当ごとの番号帯（147〜149 はあなた、150〜152 は私、のような割り方）は**使いません。**
将来の upstream 採番とぶつかるためです。穴を空けずに詰めて取ります。

一晩で2回、番号がぶつかりました。**どちらも「使ったあとに宣言した」ためです。**
書き始める前に聞いてください。

### 試験が走っているか、一度は確かめる

`packages/shared` に試験が74件あるのに、**`test` スクリプトも vitest の設定も無く、
CI も呼んでいませんでした。** 書いた人が手元で1回流して終わりでした。

日付・時刻を扱うものは、**`TZ` を変えても通ることを CI で見てください。** 日本時間で
走らせている限り、時計に引きずられる書き方には気づけません。
