> 文書：開発ガイド｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 開発ガイド

作業前に [AGENTS.md](../AGENTS.md) と、そこで指定された必読文書を順に読みます。機能の動きは [要件の索引](v6-requirements/v6-requirements-master-index.md) と [追加機能](v8-requirements/README.md) で確認します。

| 場所 | 役目 |
| --- | --- |
| `apps/worker` | API、LINEの受信、自動処理。Cloudflare Workersで動く |
| `apps/web` | 管理画面。V8の画面は `src/v8`、型と共通部品は `src/components` |
| `apps/liff` | LINE内のお客さまの画面 |
| `apps/docs` | 公開マニュアル |
| `packages/db` | D1の読取・保存、移行SQLと初期DBの組み立て |
| `packages/shared` | APIと画面で共用する型・検査 |
| `packages/sdk`・`packages/line-sdk` | 管理API・LINE APIのクライアント |
| `packages/mcp-server` | MCP経由で管理APIを呼ぶ入口 |
| `packages/create-line-harness`・`packages/update-engine` | OSSの導入と更新 |

Node.jsはCIと同じ22、pnpmは `package.json` の指定版を使います。手元の準備はリポジトリのルートで行います。検査が「要確認」なら理由を解消するまで進めません。依存の導入後にNodeの版を変えた時は、SQLiteなどの部品もその版に合わせて組み直します。

```sh
DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh
pnpm install
pnpm run
```

命令の一覧はルートで `pnpm run`、各パッケージで `pnpm --filter <名前> run` を使います。`pnpm -r run` は命令名が必要です。重い試験やビルドは `zsh ~/lh-work/tools/hq/heavy.sh <命令>` で包み、順番に実行します。

```sh
pnpm test:scripts --maxWorkers=4
pnpm typecheck:scripts
pnpm --filter docs test
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test --maxWorkers=4
```

管理画面はCookieのセッションとCSRF検査を使います。外部のSDK・MCPはAPIキーを使います。詳しくは [認証](ADMIN-AUTH.md)、[SDKの使い方](../packages/sdk/README.md)、Workerの `src/routes/openapi.ts` を確認してください。

MCPは `pnpm --filter @line-harness/sdk build` → `pnpm --filter @line-harness/mcp-server build` の順で作ります。`LINE_HARNESS_API_URL` と `LINE_HARNESS_API_KEY` を実行環境へ設定し、`node packages/mcp-server/dist/index.js` で起動します。使える操作は `packages/mcp-server/src/index.ts` で確認します。秘密値は文書やログへ書きません。

配備やDB更新は [配備ゲート](DEPLOY-GATE.md) と [DB更新手順](migration-runbook.md) に従います。検証環境はマージだけでは配備されません。DB更新とコード配備は別の工程です。
