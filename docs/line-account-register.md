# LINEアカウント登録（V6 33-2）

2026-09-13。統括コンソールの `/accounts/new` から、LINE公式アカウントを5手順で登録する。

## 利用者が用意するもの

入力する値は次の4つだけ。表示名は任意で、空欄ならLINEから取得した公式アカウント名を使う。

| LINEチャネル | 入力する値 |
|---|---|
| Messaging API | チャネルID、チャネルシークレット |
| LINE Login | チャネルID、チャネルシークレット |

アクセストークン、Webhook URL、LIFF IDはmusuboが設定する。秘密値は保存後の画面やAPI応答に返さない。

## 登録の流れ

1. 「基本情報」で任意の表示名を入力する。
2. 「LINE準備」で既存または新規を選ぶ。新規の場合はLINE Official Account Managerで公式アカウントを作り、LINE DevelopersでMessaging APIとLINE Loginを同じプロバイダーに用意する。
3. 「チャネル設定」で4つの値を入力する。
4. LINE Loginへ画面に表示されたCallback URLを登録し、「接続して設定する」を押す。
5. 5段すべてが「通りました」になったら「接続して保存」を押す。

認証済みアカウントでは保存直後に既存友だちのID取り込みを開始する。IDの取り込み中は完了画面から移動できない。IDの取り込みが終わるとボタンを有効にし、名前とアイコンの取得は既存のCronで継続する。未認証アカウントでは既存友だちを一括取得できないため、以後の操作やWebhook受信に合わせて登録する。

## 自動接続の5段

| 順番 | 処理 | 止まったときの確認先 |
|---|---|---|
| 1 | Messaging APIのチャネルIDとシークレットでアクセストークンを発行 | Messaging APIの資格情報 |
| 2 | 公式アカウントの名前・アイコン・LINE ID・応答モードを取得 | Messaging APIチャネルの設定 |
| 3 | Webhook URLを登録し、利用状態と到達をテスト | LINE Developersの「Webhookの利用」 |
| 4 | LINE Loginチャネルを確認し、`musubo` LIFFを作成または再利用 | LINE Loginの資格情報とLIFF権限 |
| 5 | 既存友だち取得の利用可否を判定し、利用可能なら取り込みを開始 | 認証状態またはLINE APIの一時障害 |

応答モードがチャットの場合は登録を止めず、完了画面に「チャットをオフ」の残作業を出す。

## API

| 経路 | 権限 | 内容 |
|---|---|---|
| `POST /api/line-accounts/connect/check` | owner | LINE側の自動設定と5段の確認。musuboのDBへアカウント行は作らない |
| `POST /api/line-accounts/connect` | owner | 同じ確認後にアカウントを暗号化保存し、既存友だちの取り込みを開始 |
| `POST /api/line-accounts/:id/follower-import/step` | owner / admin | ID取り込みを1段進める。完了画面が `importing_ids` の間だけ呼ぶ |

両接続APIの入力は `{ name?, channelId, channelSecret, loginChannelId, loginChannelSecret }`。成功応答は5段の状態、アカウント名、アイコンURL、LINE ID、LIFF ID、友だち取り込み状態を返す。チャネルシークレットとアクセストークンは返さない。

## LINE側で行う処理

- `POST /v2/oauth/accessToken`
- `GET /v2/bot/info`
- `PUT` / `GET /v2/bot/channel/webhook/endpoint`
- `POST /v2/bot/channel/webhook/test`
- `GET` / `POST` / `PUT /liff/v1/apps`
- `GET /v2/bot/followers/ids`

通信先はLINE公式APIだけで、各通信の上限は10秒。LINE APIの応答本文はエラーやログへ出さず、利用者が直せる分類だけを返す。

## 保存と巻き戻し

- 手順1〜4で失敗した場合はDBへアカウント行を作らない。
- アカウント行を作成した後に手順5で失敗した場合は、その未完了行を削除する。
- LIFFを作成した後に保存が止まってもLINE側のLIFFとWebhook URLは残る。次回はdescriptionが`musubo`のLIFFを再利用する。
- 旧 `POST /api/line-accounts` と `POST /api/line-accounts/verify-connection` は互換性のため残す。
- コードを戻す場合は、この変更のコミットをrevertする。LINE側のLIFFが不要ならLINE Developersで削除する。

## 環境

検証環境は `WORKER_PUBLIC_URL=https://nen-line-stg.skmtmst.workers.dev` をWebhook、Callback、LIFFの基点にする。環境変数、DB列、Webhook受信処理、Cronは追加・変更しない。本番環境はこの変更の対象外。
