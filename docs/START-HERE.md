> 文書：製品とコードの入口｜区分：今の説明｜最終確認：2026-10-22（日本時間）

# はじめに読む — musubo のコード

この 1 枚は、musubo のコードを初めて受け取ったエンジニアが、最初の 1 日に全体像をつかむための入口です。売却・引き継ぎの最初の案内として使い、仕様の正本にはなりません。動きの正本は要件、見た目の正本は V8 の決まりです。

## 1. これは何か

musubo は、LINE 公式アカウントの運用を助ける CRM です。友だちの管理、配信、シナリオ、回答フォーム、予約、分析などを管理画面から扱います。お客さまは LINE の中で LIFF の画面を開きます。裏側の API・LINE の受信・自動処理は Cloudflare Workers が担当し、データは D1 に保存します。

```text
お客さま（LINE） ──> LIFF（apps/liff）
店・統括・運営   ──> 管理画面（apps/web）
                          │
                          ▼
                 Worker（apps/worker）
                    │            │
                    ▼            ▼
             LINE Messaging API   D1（packages/db）
```

- 管理画面は Next.js です。ビルドすると静的ファイルを書き出します。
- LIFF は React と Vite で作った、LINE 内で開くお客さま向けの画面です。
- Worker は Cloudflare Workers 上で動く API・Webhook の受信・定期処理です。
- D1 は Cloudflare の SQLite データベースです。テーブル定義と移行 SQL は `packages/db` にあります。
- `apps/docs` は公開マニュアルのサイトで、製品の実行時には含まれません。

このリポジトリは pnpm の workspace を使うモノレポです。TypeScript で書かれ、`apps/` に動くアプリ、`packages/` に共有の部品があります。

## 2. フォルダの地図

| フォルダ | 何があるか |
|---|---|
| `apps/web` | 管理画面。URL と権限の入口は `src/app`、画面の本体は `src/v8/<機能>`、型は `src/components/templates`、共通部品は `src/components/shared`・`layout` |
| `apps/worker` | API、LINE の受信、自動処理、定期処理。HTTP の入口は `src/routes`、業務の実装は `src/features`、定期処理は `src/cron` |
| `apps/liff` | LINE の中で開くお客さま向けの画面。React + Vite + LIFF SDK |
| `apps/docs` | 公開マニュアルのサイト。Next.js + MDX。記事は `src/app/manual`、画像は `public/manual` |
| `packages/db` | D1 の読み書き、`migrations/` の移行 SQL、`schema.sql`・`bootstrap.sql` |
| `packages/shared` | 管理画面・Worker・LIFF で共用する型、定数、検査 |
| `packages/line-sdk` | LINE Messaging API の型付きラッパーとリッチメッセージの組み立て |
| `packages/sdk` | 管理 API をプログラムから扱う SDK |
| `packages/mcp-server` | MCP 経由で管理 API を操作する入口 |
| `packages/update-engine` | Worker と CLI で共有する自己更新の仕組み |
| `packages/create-line-harness` | セットアップ用の CLI |
| `packages/plugin-template` | 外部連携プラグインを作るときの雛形 |
| `scripts` | 検査、配備、DB、画面撮影など役割別の道具 |
| `docs` | 要件、設計、運用、引き継ぎの文書 |
| `.github/workflows` | CI と配備のワークフロー |

`packages/` のパッケージ名には `@line-crm/*` と `@line-harness/*` の 2 つの名前空間があります。import を読むときは、各 `package.json` の `name` を確認してください。

## 3. 初日の手順

### 前提

- Node.js 22（CI と同じ版）を使います。
- pnpm はルートの `package.json` の `packageManager` に書かれた版（9.15.4）を使います。
- 読む・手元で試験するだけなら Cloudflare のアカウントは不要です。配備と実運用には Cloudflare アカウントと LINE 公式アカウントが必要です。

### 依存を入れる

リポジトリのルートで実行します。

```sh
DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh
pnpm install
```

`doctor.sh` の最終行が「合格」であることを確かめてから進みます。手元で `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が未設定なのは正しい状態です。

CI と同じ解決にするときは、ロックファイルを固定して入れます。

```sh
pnpm install --frozen-lockfile
```

### 試験・型検査・ビルド

ルートの命令は、workspace 全体に同じ命令を順に実行します。

```sh
pnpm test
pnpm typecheck
pnpm build
```

対象のアプリだけを見るときは `--filter` を使います。次の命令はすべて各 `package.json` に実在します。

```sh
pnpm --filter web test
pnpm --filter worker test
pnpm --filter liff test
pnpm --filter docs test

pnpm --filter web typecheck
pnpm --filter worker typecheck
pnpm --filter liff typecheck
pnpm --filter docs typecheck

pnpm --filter web build
pnpm --filter worker build
pnpm --filter liff build
pnpm --filter docs build
```

管理画面と Worker の `test`・`typecheck`・`build` には、先に共有パッケージをビルドする `pre*` の処理があります。単体で実行しても、共有パッケージが古いまま検査されることはありません。

CI が別に実行する検査も、手元で同じ命令を使えます。

```sh
pnpm test:scripts
pnpm typecheck:scripts
pnpm exec tsx scripts/structure/check.ts
```

### 開発サーバー

```sh
pnpm dev:web              # 管理画面（3001）
pnpm dev:worker           # Worker
pnpm --filter liff dev    # LIFF（3002）
pnpm --filter docs dev    # マニュアルサイト（3003）
```

ルートで `pnpm run`、各パッケージで `pnpm --filter <名前> run` を実行すると、使える命令の一覧が出ます。

## 4. 確かめたいこと｜次に開く場所

変更する場所や決まりを探すときは、次の表から開きます。中身をこの文書へ写していません。リンク先が正本です。

| 確かめたいこと | 次に開く場所 |
|---|---|
| 置き場・名前・公開入口・依存 | [コードの構成と名前](code-structure.md) |
| 旧 code-rules 案の内容が、今どの節へ採用されたか | [コードの決まりを探す](code-rules.md) |
| URL から本体・API・試験へ | [機能案内の一覧](feature-guides.md) → 各機能 README → BEHAVIOR |
| 型・共通部品と見た目の直し先 | [V8 の見た目の決まり](v8-design-rules.md)、[型の対応表](v8-pattern-catalog.md)、[変更箇所の地図](v8-change-map.md) |
| 動き・受け入れ条件 | [V6 全34機能の索引](v6-requirements/v6-requirements-master-index.md)、[V8 で足した要件の索引](v8-requirements/README.md)、[段2の共通契約](v8-requirements/cleanup-stage2-contract.md) |
| HTTP の登録・処理・共有型 | [API の追い方](handoff-api.md)、[エラーの契約](error-codes.md) |
| 設定名・DB 構造 | [設定と秘密値の保管先](config-and-secrets.md)、[DB 構造](db-schema.md)。実値を文書へ書かない |
| 検査と公開前の工程 | [検査の入口](code-structure.md#5-検査の入口)、[配備ゲート](DEPLOY-GATE.md)、[V8 切替](v8-requirements/v8-switch.md) |
| 何を外し、何を保持したか | [整理の引き継ぎ](handoff-cleanup.md)、[文書の保管先](document-archives.md)、[変更履歴](release-log/README.md) |
| 配布物・フォント・規約 | [表示と契約の確認事項](legal/distribution-and-terms.md) |

探し方の順番は、動きなら要件、置き場所なら `code-structure.md`、見た目なら `v8-design-rules.md`、実際のファイルなら `v8-change-map.md` です。型と共通部品の持ち主は [型の対応表](v8-pattern-catalog.md) で確かめます。

専門家の確認が要るものは SELL-06（LIFF SDK の LINE 独自契約）と SELL-10（正式規約と飲食草案の整合）です。著作権者の表記・配布物へ残す表示と本文の確定は司令塔が行います。未確認を完了にせず、確認する担当と根拠を引き継いでください。

## 5. 要件の正本

要件は 2 か所だけです。ここに書かれていない文書を、要件として読まないでください。

- [V6 全34機能 要件定義 正本索引](v6-requirements/v6-requirements-master-index.md) — 既存 34 機能の動きと受け入れ条件の索引です。機能ごとの要件へここから進みます。
- [V8 で足した決まり（要件）の索引](v8-requirements/README.md) — V8 で足した機能、お客さまの画面（LIFF）、本番の切り替えなどの決まりです。

役割は「動きは要件、見た目は V8 の決まり」です。要件と実装が食い違うときは、実装ではなく要件を先に直します。見た目の指定は `v8-design-rules.md` と画面ごとの Pencil の絵が勝ちます。

## 6. CI で何が止められるか

PR ごとに `.github/workflows/required-pr-gate.yml` が走ります。最初の `changes` が変更を分類し、必要なジョブだけを動かし、最後の `required-pr-gate` が全部の結果をまとめます。失敗または中断が 1 つでもあれば止まり、意図して飛ばしたジョブ（skipped）は許されます。

| ジョブ名 | 見張るもの |
|---|---|
| `Classify and validate the change` | 変更の分類、司令塔の所有パスの保護、空白エラー、反映履歴、shell と workflow の安全 |
| `Repository and shared checks` | 共有パッケージのビルド、DB の bootstrap・移行の安全・DB 試験、更新と導入の CLI、scripts の試験、品質の後戻り、名前と公開依存の境界、shared と LIFF の型・試験、V8 の型所有と見た目の契約 |
| `Worker typecheck and tests` | Worker の型検査と試験 |
| `Worker build` | Worker のビルド、本番設定とセキュリティヘッダ、LIFF 入口のブラウザ検査 |
| `Admin lint, typecheck and tests` | 管理画面の lint、選択部品、V8 以外の見た目の復活、型、試験、Webhook 画面の実ブラウザ契約 |
| `Admin build and design verification` | 管理画面のビルド、書き出したファイルのヘッダと外部スクリプト、権限・通知・タグ・二段階認証・セキュリティヘッダの実ブラウザ検査、設計の検証 |
| `MCP contract tests, typecheck and build` | SDK の試験、MCP の型・試験・ビルド |
| `Docs site tests` | マニュアルサイトの試験 |
| `V8 screen guard` | 1152・1440・1920 のはみ出し、基準版との崩れの差、一覧の行、速度の目標、2000 人一覧 |
| `required-pr-gate` | 上の結果を集約し、失敗・中断があれば PR を止める |

文書だけの変更は軽い経路になり、`changes` と最後の `required-pr-gate` だけが動きます。コードを変える PR では、反映履歴の 1 行も見られます。

## 7. 用語

| 言葉 | このリポジトリでの意味 |
|---|---|
| musubo | 管理画面と LIFF に出す製品名。リポジトリ名やパッケージ名には LINE Harness と line-crm が残る |
| LINE Harness | このリポジトリの OSS 名。`@line-harness/*` のパッケージ名に使われる |
| V8 | 管理画面の現行の見た目の版。前の見た目へ戻す切り替えは作らない |
| LIFF | LINE の中で開くお客さま向けの画面。実装は `apps/liff` |
| Worker | Cloudflare Workers 上で動く API・LINE 受信・自動処理。実装は `apps/worker` |
| D1 | Cloudflare の SQLite データベース。読み書きと移行 SQL は `packages/db` |
| 管理画面 | 店・統括・運営が使う `apps/web` の画面 |
| LINE 公式アカウント | 配信や友だち管理の対象になるアカウント。1 つの環境で複数を持てる |
| MCP | AI エージェントから管理 API を操作する入口。実装は `packages/mcp-server` |
| pnpm workspace | 1 つのリポジトリで `apps` と `packages` をまとめ、`--filter` で対象を選ぶ仕組み |

## この 1 枚の次に

- 作業の決まりと役割は [AGENTS.md](../AGENTS.md) を読みます。
- 文書の探し方は [文書の入口](README.md) を使います。
- 手元の準備と検査の詳しい手順は [開発ガイド](development.md) にあります。
- URL から機能の実装を追うときは [機能案内の一覧](feature-guides.md) を使います。
- データベースの構造は [データベース構造一覧](db-schema.md) で確かめます。
- 配備と DB 更新は [配備ゲート](DEPLOY-GATE.md) と [D1 マイグレーション手順書](migration-runbook.md) に従います。秘密値は文書へ書きません。

この文書は入口です。仕様を変えるときは、必ず要件と各分野の正本を開いて確かめてください。
