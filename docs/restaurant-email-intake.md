# 飲食店向け予約メールのcatch-all取り込み

## 目的

店舗ごとにCloudflare Email Routingのルールを増やさず、取り込み専用ドメインの
catch-all 1本からWorkerへ渡し、宛先から店舗を特定する。

## 環境設定

- 環境変数名: `RESTAURANT_INTAKE_DOMAIN`
- 本番値: `r.musubo.jp`
- 検証環境: 本番と異なる専用ドメインを設定する。本番値を流用しない。

ドメイン値は実行環境へ設定し、Workerの処理コードには直接書かない。
Cloudflare側のcatch-allルールは環境ごとに管理し、このリポジトリから作成・変更しない。

発行するアドレスは `r-` と暗号学的乱数から作る32文字の英数字を連結し、
`r-<32文字のランダム英数字>@<環境別ドメイン>` とする。店舗ID、連番、時刻は使わない。

## 受信フロー

1. ローカル部が `r-` で始まるメールだけを飲食店向けへ分岐する。
2. 有効な取り込みアドレスから店舗を特定する。
3. 原文をR2の `restaurant-intake/<店舗>/` へストリーム保存する。
4. 店舗付きの受信イベントをD1へ記録し、予約解析処理へ渡せる状態にする。
5. 未知・期限切れ・失効・異なるドメインのメールは、捨てずに
   `restaurant-intake-quarantine/` へ隔離保存する。
6. `r-` で始まらないメールは、既存のサポートメール受信処理へそのまま渡す。

再発行時は旧アドレスを直ちに止めず、`active` のまま90日後の失効日時を設定する。
その期間中に予約媒体の転送先を新アドレスへ切り替える。

## サイズとメモリの制限

[Cloudflare Email Serviceの制限](https://developers.cloudflare.com/email-service/platform/limits/)により、
Email Routingは25 MiBを超える受信メールをWorkerへ渡す前に拒否する。
また、[Cloudflare Workersの制限](https://developers.cloudflare.com/workers/platform/limits/)では、
メモリ上限は1 isolateあたり128 MBである。

このため受信処理は `message.raw` を `ArrayBuffer` や文字列へ丸ごと展開せず、
一度だけR2へストリーム転送する。件名や本文の解析は、保存済み原文を対象に
後続処理で行う。受信ハンドラ内で巨大なMIME本文や添付ファイルを保持しない。

## 運用上の境界

- 今回追加するのはWorker内の振り分けと保存処理だけである。
- Cloudflare Email Routing、DNS、catch-allルールは変更しない。
- DBマイグレーションは承認後に環境ごとへ適用する。
- 切り戻しは該当PRのrevertで行い、既存サポートメールの受信経路へ戻す。
