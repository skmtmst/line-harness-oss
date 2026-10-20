> 文書：運用と検査の台本｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 運用と検査の台本

リポジトリ直下から実行します。用途ごとに入口を探し、実DB・配備・通知を伴う命令は、その作業の承認手順に従います。

| 場所 | 役目・入口 |
|---|---|
| `codex/doctor.sh` | 作業開始前の環境確認。手元では `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` |
| `db/` | 移行の安全検査、データを変えない移行調査、認証情報の移行。安全検査は `pnpm exec tsx scripts/check-migrations.ts` |
| `deploy/` | 配備ロック、事前検査、staging、本番公開の順序、CLIの隔離実行 |
| `release/` | 配布物・更新manifestの組み立てと試験 |
| `slack/` | 既存の作業報告・PR同期の入口と試験 |
| `browser/` | 認証・EC取込の独立したPlaywright設定、LIFFの復帰・受信失敗の動作検査 |
| `security/` | Workflow接続・本番公開順序・見出し・外部通信・依存の安全検査 |
| `verification/` | 検証環境の運用経路の確認。実行条件・読取専用の契約は各台本の説明に従う |
| `visual-qa/` | 合成データ、模擬API、撮影、崩れと共通部品の検査 |
| `recovery/` | 日付・対象が限定された復旧。自動呼出しがなくても復旧手順として保持 |
| `observability/` | エラー番号の文書生成 |

`pnpm test:scripts` は移動後も `scripts/**/*.test.ts` と共有の単体試験を収集します。前提となる共有パッケージは `pnpm --filter @line-crm/shared build` で用意します。型検査は `pnpm typecheck:scripts` です。全体の重い検査・ビルド・ブラウザは司令塔の `heavy.sh` を通します。

移行調査の入口は `pnpm db:dry-run-automations`・`pnpm db:dry-run-analytics`・`pnpm db:dry-run-funnels` です。従来の `db:dry-run-v6-*` も同じ入口へ接続し、運用中の呼出しを保っています。これらを整理作業の確認のために実DBへ実行する必要はありません。

`check-migrations.ts` は外部HQのci-all.shが使うため元のCLI入口を保持します。郵便データは `db/fetch-jp-postal-data.*`、画面の待ち合わせは `browser/overlay-ready.mjs` へ、アプリ・パッケージの利用元と同時に移しました。見た目の比較地図・外部の撮影命令・安全な失敗の対照で使うIDや機械コードは、経緯だけのコメントと区別して保持します。

構成の決まりは [コードの構成と名前](../docs/code-structure.md)。`pnpm exec tsx scripts/structure/check.ts` が名前・公開入口・循環を検査し、`pnpm test:scripts` がその故障対照を実行します。
