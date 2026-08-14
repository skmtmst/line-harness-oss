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
