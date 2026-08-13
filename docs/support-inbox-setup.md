# お問い合わせ統合受信のセットアップ

`contact-shed@nen-petfood.com` は外部公開せず、ECサイトのお問い合わせフォームから届く通知を管理システムへ渡す裏側の窓口として利用します。

受信メールはXServerの「メール振り分け」で管理システムへコピーします。管理画面からの返信はXServer上の署名付き中継を通り、差出人 `contact-shed@nen-petfood.com` として送信します。Postmarkなどの有料サービスやMXレコードの変更は不要です。

## 構成

- 受信: XServerメール振り分け → PHP転送スクリプト → 署名付きWorker Webhook → D1
- 返信: 管理画面 → Worker → 署名付きXServer中継 → XServerのメール送信機能
- 原本: 「コピー転送」を使うため、XServerの受信箱にも残る
- 認証: WorkerとXServerの間は5分だけ有効なHMAC署名で保護する
- 顧客単位: 同じメールアドレスからの問い合わせは、件名や解決状態に関係なく1つの会話へ統合する

## 配置済みファイル

- 受信転送: `/home/andu2021/nen-support-bridge/support-inbound-forward.php`
- 返信中継: `/home/andu2021/nen-petfood.com/public_html/_system/support-mail-relay.php`
- 共有秘密鍵: `/home/andu2021/.nen-support-relay-secret`
- Worker Webhook: `https://nen-line.skmtmst.workers.dev/webhooks/xserver/support-email`
- 返信中継URL: `https://nen-petfood.com/_system/support-mail-relay.php`

共有秘密鍵はコードやGitに保存しません。XServerでは権限600、Cloudflareでは `XSERVER_RELAY_SECRET` のSecretとして登録します。

## XServerで最後に行う設定

XServerサーバーパネルで対象ドメイン `nen-petfood.com` を選び、「メールの振り分け」からルールを1件追加します。

| 項目 | 設定値 |
| --- | --- |
| キーワード | `Delivered-To: contact-shed@nen-petfood.com` |
| 場所 | ヘッダー |
| 一致条件 | 内容を含む |
| 処理方法（宛先） | `|/usr/bin/php8.3 /home/andu2021/nen-support-bridge/support-inbound-forward.php` |
| 配信方法 | コピー転送 |

「コピー転送」を選ぶことで、管理システムへの取り込みに失敗しても原本はメールボックスに残ります。転送先には先頭の `|` を含めて入力します。

## Cloudflare設定

以下は本番へ設定済みです。

- `XSERVER_RELAY_SECRET`: Worker Secret
- `XSERVER_RELAY_URL`: `https://nen-petfood.com/_system/support-mail-relay.php`
- D1: `072_support_email_inbox.sql` と `073_support_email_sync_state.sql`

従来のWorkerからXServerへ直接接続するIMAP方式は、XServer側でCloudflareの接続がタイムアウトするため本番では使用しません。中継Secretが設定されている間、定期IMAP取得は実行されません。

## 本番確認

1. ECサイトのお問い合わせフォームから、返信を受信できる外部アドレスでテスト問い合わせを送信する。
2. 数分以内にダッシュボードのアラートと「お問い合わせ」の未対応一覧へ表示されることを確認する。
3. 管理画面から返信し、外部アドレスで `contact-shed@nen-petfood.com` からのメールとして受信できることを確認する。
4. ステータスを「対応中」「解決済み」へ変更できることを確認する。
5. 解決済みの会話へ顧客が再返信し、自動的に「未読」へ戻ることを確認する。

添付ファイルはXServerの原本メールに残ります。現在の管理画面へ取り込むのは差出人、宛先、件名、本文などのメッセージ情報で、添付ファイルの管理画面表示は対象外です。

障害時はWorkerログ、`support_email_sync_state.last_error`、XServerに残った原本メールを確認します。
