> 文書：検証環境の自動配備（Cloudflare Git 連携）｜区分：今の正本｜最終確認：2026-11-01（日本時間）

# 検証環境の自動配備（Cloudflare Git 連携）

2026-10-31 にオーナーが決めた、GitHub Actions と手元のターミナルを使わない検証配備の経路です。
`scripts/deploy/cf-staging-deploy.sh` が Cloudflare 側（Workers Builds）の Deploy command として動きます。

## 流れ

1. 専用ブランチから `codex/development` 宛ての PR を作り、統合する（`AGENTS.md` §8 のゲートはそのまま）
2. Cloudflare が `codex/development` の更新を検知して、Worker `nen-line-stg` をビルドする
3. Deploy command（`bash scripts/deploy/cf-staging-deploy.sh`）が順に行う
   - 作業ツリーがビルド成果物で汚れていないか
   - 未適用の D1 マイグレーションの一覧（`migrate.ts status staging`）
   - 今回足されたマイグレーションが「追加のみ」か（表の削除・列の削除・データの書き換え・`table-rebuild` 印は停止）
   - D1 へ適用（`migrate.ts apply staging --apply`。復元点の取得は `migrate.ts` が行う）
   - `wrangler deploy --config apps/worker/wrangler.staging.toml`
   - `/health` の `git_commit` が配備元 SHA と一致するか

## 管理画面（Pages）

管理画面は Cloudflare Pages の Git 連携プロジェクト `nen-line-stg-admin-git` が、同じ `codex/development` の更新で自動ビルドする（2026-11-01 設定）。
ビルドコマンドは `pnpm install --frozen-lockfile && pnpm --filter @line-harness/update-engine build && pnpm --filter web build`、出力は `apps/web/out`。
ビルド時の環境変数は GitHub Actions の `Deploy Cloudflare Staging` と同じ `NEXT_PUBLIC_*` 一式（API URL・Turnstile の公開サイトキー・利用規約などの URL）を Pages 側に持つ。
以前の Direct Upload 方式の `nen-line-stg-admin` は Git 連携へ切り替えられないため残してあり、`stg-admin.musubo.jp` を新プロジェクトへ付け替えた時点で役目を終える。
他のブランチのプレビュー配備は切ってある（本番ブランチだけ）。

## モード

Cloudflare の Build variables `CF_STAGING_DEPLOY_MODE` で切り替えます。

| 値 | 動き |
| --- | --- |
| `plan`（既定） | 一覧と dry-run だけ。D1 も Cloudflare も変えない |
| `apply` | D1 へ適用し、Worker を配備する |

`CF_STAGING_SKIP_MIGRATE=1` で D1 の工程だけ飛ばせます（コードだけ配るとき）。

## 止まったとき

- 「追加のみではない文があります」「table-rebuild」で止まった → 人が [D1 マイグレーション手順書](migration-runbook.md) どおりに当ててから、再配備する
- `/health` の SHA が一致しない → Cloudflare の Deployments で配備が success か、`stg-api.musubo.jp` が最新 Worker を向いているかを見る

## 手元用の台本との関係

- `scripts/deploy/staging-deploy.sh`（手元用）は、親リポジトリのクリーン確認を要求するため、親の無い Cloudflare のビルド環境では使えない。そのまま残す
- 親に依存する事前確認（preflight）は PR の段階で代替する
- 本番（`wrangler.toml`）はこの経路の対象外
