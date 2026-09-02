# 然-NEN- LINE管理システム検証環境

## 環境の役割

- `nen-line` は本番用です。
- `nen-line-stg` は検証用です。
- 検証用は、本番とは別の Worker、D1、R2、Pages を使います。
- 検証用D1には、本番の友だち、配信予約、LINEアカウント、認証情報をコピーしません。
- 検証用Workerにはcronを設定しません。管理画面操作だけでなく、予約済み処理からの自動通知も止めるためです。

## 現在の接続状態（2026-08-13）

- LINE Developersプロバイダー: `然-NEN- TEST`
- 検証専用Messaging API: 接続済み
- 検証専用LINE Login: 接続済み
- 検証専用LIFF: 接続済み
- Webhook URL: `https://nen-line-stg.skmtmst.workers.dev/webhook`
- LINE DevelopersのWebhook検証: 成功
- LINE Loginコールバック: `https://nen-line-stg.skmtmst.workers.dev/api/auth/line/callback`
- 検証EC-CUBE LINE Loginコールバック: `https://stg.nen-petfood.com/line/login/callback`
- LIFFエンドポイント: `https://nen-line-stg.skmtmst.workers.dev`
- Workerの定期実行cron: 無効のまま
- 検証EC-CUBE: `https://stg.nen-petfood.com` と署名付きで相互接続
- 問い合わせ受信・送信元: `test-shed@stg.nen-petfood.com`
- メール受信Webhook: `https://nen-line-stg.skmtmst.workers.dev/webhooks/xserver/support-email`
- メール返信中継: `https://stg.nen-petfood.com/_system/support-mail-relay.php`

## Cloudflareリソース

| 用途 | 本番 | 検証 |
| --- | --- | --- |
| Worker | `nen-line` | `nen-line-stg` |
| D1 | `nen-line` | `nen-line-stg` |
| R2（画像） | `nen-line-images` | `nen-line-stg-images` |
| R2（予約メール原文・非公開） | `musubo-raw-mail` | `musubo-raw-mail-stg` |
| 管理画面 Pages | `nen-line-admin-98712679` | `nen-line-stg-admin` |
| Worker設定 | `apps/worker/wrangler.toml` | `apps/worker/wrangler.staging.toml` |

## 通知事故を防ぐルール

1. 本番の `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、LINE Login情報を検証Workerへ設定しない。
2. 検証では、専用のLINE公式アカウント／Messaging APIチャネル／LINE Loginチャネル／LIFFアプリを使う。
3. 専用テストLINEチャネルの接続と疎通確認が終わるまで、検証Workerのcronは有効にしない。
4. 本番D1のエクスポートを検証D1へ丸ごとインポートしない。必要なマスターデータは、LINEユーザーID、配信予約、アカウント認証情報を除外して個別に移す。
5. デプロイ時は必ず `--config apps/worker/wrangler.staging.toml` を指定する。
6. 検証EC-CUBEの `LINE_HARNESS_EVENT_URL` は必ず `nen-line-stg` を指し、本番Workerを指定しない。
7. 検証用メール中継は本番と異なる共有秘密鍵を使う。

## 検証EC-CUBE・メール連携

- ECイベント送信先: `https://nen-line-stg.skmtmst.workers.dev/api/integrations/eccube/events`
- ECサイトURL: `https://stg.nen-petfood.com`
- LINE LoginチャネルID: `2011090925`（`然-NEN- TEST`）
- LINE公式アカウントBasic ID: `@273ytnca`（`然-NEN- TEST`）
- LINE DevelopersのコールバックURLには、管理画面用と検証EC-CUBE用の2件を登録する。
- EC-CUBEの全メールはSMTPエンベロープで `test-shed@stg.nen-petfood.com` のみに制限する。
- EC-CUBEの差出人、Reply-To、Return-Pathも `test-shed@stg.nen-petfood.com` に統一する。
- `test-shed@stg.nen-petfood.com` は検証側の受信箱・返信元であり、問い合わせ元はECに登録された各ユーザーのメールアドレスとして記録する。
- ECフォーム通知では本文と表示上の宛先から登録メールアドレスを抽出し、直接届くメールではFrom／Reply-Toから送信元を抽出する。
- 同じ登録メールアドレスからの問い合わせは1つの履歴へまとめ、異なる登録メールアドレスは別の履歴として管理する。
- XServerの検証メール振り分けは、検証専用PHP転送スクリプトから検証Workerだけへ送る。
- 共有秘密鍵はコードやGitへ保存せず、XServerでは権限600、CloudflareではWorker Secretとして保存する。

## 検証LINEを接続するときに必要な情報

- 検証用Messaging APIチャネルの Channel ID
- 検証用Messaging APIチャネルの Channel secret
- 検証用Messaging APIチャネルの Channel access token（長期）
- 検証用LINE Loginチャネルの Channel ID
- 検証用LINE Loginチャネルの Channel secret
- 検証用LIFF ID
- 検証用LINE公式アカウントの Basic ID

これらはGitへ保存せず、Cloudflare Worker secrets またはビルド時の環境変数として設定します。

## 検証環境のデプロイ

検証環境は1組しかないため、共同開発中は**必ずデプロイロックを取得してから**反映します。
手順とルールは `docs/DEPLOY-GATE.md` を参照してください。

Cloudflareの資格情報をローカル端末へ置かない場合は、GitHub Actionsの
`Deploy Cloudflare Staging` を使います。先にローカルで同じコミットのロックを
取得し、`codex/development` を指定して起動してください。既定はdry-runで、
`apply` のときだけWorkerと管理画面を反映します。D1マイグレーションは
`Migrate D1` を先にdry-runし、別工程で適用します。

```bash
cd line-harness-nen

# 0. PC ごとに違う値を設定（.zshrc などに書いておくと省略できる）
export LINE_HARNESS_PARENT_REPO="$HOME/path/to/nen-petfood-eccube"

# 1. 使用宣言（ロック取得）
pnpm deploy:lock acquire staging --note "変更範囲"

# 2. デプロイ（既定は dry-run。実反映は --apply）
pnpm deploy:staging -- --apply

# 3. 解放して結果を共有（反映コミット / 確認結果 / 未確認事項）
pnpm deploy:lock release staging
```

スクリプトは事前確認として、両リポジトリの作業ツリーがクリーンなこと、
`codex/development` と一致していること、`wrangler.staging.toml` を指していること、
ロックを自分が保持していることを確認し、1つでも違反があれば中止します。
本番は基準ブランチが `main` になり、承認者と承認記録URLが追加で必要です。

スクリプトが実行している内容は次のとおりです。手動で流す場合も
`--config apps/worker/wrangler.staging.toml` の指定を省略しないでください。

```bash
# Worker / LIFF assets
pnpm --filter worker build
./node_modules/.bin/wrangler deploy \
  --config apps/worker/wrangler.staging.toml

# 管理画面
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev \
  pnpm --filter web build
./node_modules/.bin/wrangler pages deploy apps/web/out \
  --project-name nen-line-stg-admin \
  --branch main
```

## LINE接続後のWebhook

検証用Messaging APIチャネルのWebhook URLには、次を設定します。

```text
https://nen-line-stg.skmtmst.workers.dev/webhook
```

本番チャネルのWebhook URLは変更しません。

## cronを有効にする条件

次のすべてを確認したあとでのみ、`wrangler.staging.toml` に `[triggers]` を追加します。

- 検証専用LINE公式アカウントである
- 検証専用アクセストークンである
- 検証D1の `line_accounts` に本番アカウントがない
- テスト受信者だけが登録されている
- 即時配信と予約配信の両方をテスト受信者で確認した
