# 飲食店向け予約メールのcatch-all取り込み

## 目的

店舗ごとにCloudflare Email Routingのルールを増やさず、取り込み専用ドメインの
catch-all 1本からWorkerへ渡し、宛先から店舗を特定する。

## 環境設定

- 環境変数名: `RESTAURANT_INTAKE_DOMAIN`
- 本番値: `r.musubo.jp`
- 検証環境: 本番と異なる専用ドメインを設定する。本番値を流用しない。
  2026-08-22時点で値は未確定のため、検証設定にはまだ入れない。

ドメイン値は実行環境へ設定し、Workerの処理コードには直接書かない。
Cloudflare側のcatch-allルールは環境ごとに管理し、このリポジトリから作成・変更しない。

発行するアドレスは `r-` と暗号学的乱数から作る32文字の英数字を連結し、
`r-<32文字のランダム英数字>@<環境別ドメイン>` とする。店舗ID、連番、時刻は使わない。

## 受信フロー

1. ローカル部が `r-` で始まるメールだけを飲食店向けへ分岐する。
2. 有効な取り込みアドレスから店舗を特定する。
3. 原文を非公開のメール専用R2の `restaurant-intake/<店舗>/` へストリーム保存する。
4. D1に本文を入れず、`message_id`、店舗、R2キー、サイズ、処理状態の台帳を残す。
5. 店舗付きの受信イベントも従来どおりD1へ記録し、予約解析処理へ渡せる状態にする。
6. 未知・期限切れ・失効・異なるドメインのメールは、捨てずに
   `restaurant-intake-quarantine/` へ隔離保存する。
7. `r-` で始まらないメールは、既存のサポートメール受信処理へそのまま渡す。

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

## 原文の保持期間

- 既定値は90日。
- `RAW_MAIL_RETENTION_DAYS`の1〜3650の整数で変更できる。不正値は90日に戻す。
- 6時間ごとの既存cronで期限超過のR2オブジェクトを削除する。
- D1の台帳行は削除せず、R2キーを空にして`raw_deleted`を残す。

旧画像バケットからの移行は
[`restaurant-raw-mail-r2-migration.md`](restaurant-raw-mail-r2-migration.md)に分離する。

## 運用上の境界

- 今回追加するのはWorker内の振り分けと保存処理だけである。
- Cloudflare Email Routing、DNS、catch-allルールは変更しない。
- DBマイグレーションは承認後に環境ごとへ適用する。
- 切り戻しは該当PRのrevertで行い、既存サポートメールの受信経路へ戻す。
