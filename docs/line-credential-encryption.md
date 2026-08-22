# LINE資格情報の暗号化移行

`line_accounts` に保存するMessaging APIのチャネルアクセストークンと
チャネルシークレットを、Worker Secretを鍵とするAES-256-GCMで暗号化する。
暗号文はバージョン、毎回ランダムに生成する96-bit IV、認証タグ付き暗号文を
1つの文字列として保存する。

## Secret名

```text
LINE_CREDENTIAL_ENCRYPTION_KEY
```

値はGit、Cloudflareの通常変数、D1、Issue、PR、チャットへ保存しない。
本番と検証は別々の鍵を生成し、パスワードマネージャーなどの安全な保管先へ保存する。

## 鍵の生成

次のコマンドは32バイトのランダム鍵をBase64で表示する。表示された値を直ちに
安全な保管先へ移し、ターミナルの共有・録画・ログ保存をしない。

```bash
openssl rand -base64 32
```

Secretは値をコマンド引数へ書かず、Wranglerの対話入力またはCloudflare Dashboardから
環境別Workerへ設定する。

```bash
pnpm exec wrangler secret put LINE_CREDENTIAL_ENCRYPTION_KEY --config apps/worker/wrangler.staging.toml
pnpm exec wrangler secret put LINE_CREDENTIAL_ENCRYPTION_KEY --config apps/worker/wrangler.toml
```

`wrangler secret put` はWorkerの新しいバージョンを作成するため、実行前に環境、対象Worker、
配備ロック、承認状況を確認する。本番値を検証へ、検証値を本番へコピーしない。

## 既存データの移行

1. 対象D1のバックアップとTime Travel bookmarkを取得する。
2. マイグレーション172を適用する。
3. 対象WorkerへSecretを設定する。
4. 必要な値を実行環境だけに設定し、まずdry-runする。
5. 件数を確認し、Masatoの承認後だけ`--apply`を付ける。

```bash
pnpm db:migrate-line-credentials
pnpm db:migrate-line-credentials -- --apply
```

スクリプトが参照する環境変数は次の4つ。値はコマンドライン、ログ、リポジトリへ記載しない。

- `CF_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `CF_API_TOKEN`
- `LINE_CREDENTIAL_ENCRYPTION_KEY`

スクリプトは暗号化列が空の行だけを対象にし、既存の平文列は変更しない。Workerは暗号化列を
優先して復号し、移行期間中に限り、鍵未設定・復号失敗時は既存平文列へフォールバックする。
暗号化列の充足と運用確認が終わるまで平文列を削除しない。

## 切り戻し

この変更をrevertすれば、既存平文列を使う従来動作へ戻せる。マイグレーションで追加した列と
暗号文はD1に残るが、既存機能からは参照されない。データ削除や列削除は別承認で行う。
