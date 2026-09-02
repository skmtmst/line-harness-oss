# 予約メール原文の専用R2への移行

## 対象

画像用バケットに残っている次の2プレフィックだけを移行する。

- `restaurant-intake/`
- `restaurant-intake-quarantine/`

| 環境 | 移行元 | 移行先 |
| --- | --- | --- |
| 本番 | `nen-line-images` | `musubo-raw-mail` |
| 検証 | `nen-line-stg-images` | `musubo-raw-mail-stg` |

移行先は非公開とし、`r2.dev`公開とカスタムドメインは設定しない。
画像用バケットのその他のオブジェクトは変更しない。

## 必要なもの

- AWS CLI
- 最小権限のR2 S3 API認証情報
- `CF_ACCOUNT_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

認証情報はコマンド引数やGit管理ファイルに書かない。

## 手順

1. 必ずdry-runで対象プレフィックを確認する。

   ```bash
   scripts/migrate-restaurant-raw-mail-r2.sh staging --dry-run
   scripts/migrate-restaurant-raw-mail-r2.sh production --dry-run
   ```

2. Masatoの環境別承認後だけコピーする。

   ```bash
   scripts/migrate-restaurant-raw-mail-r2.sh staging --copy
   scripts/migrate-restaurant-raw-mail-r2.sh production --copy
   ```

3. 移行元と移行先の件数・サイズをプレフィック別に比較し、複数オブジェクトの
   `Content-Type`と本文が一致することを確認する。

4. Workerが`RAW_MAIL`へ新規保存し、台帳に専用R2キーを残すことを検証する。

5. Masatoが移行元削除を別途承認した後、コピー済みの2プレフィックだけを削除する。

   ```bash
   CONFIRM_RAW_MAIL_COPY_VERIFIED=1 \
     scripts/migrate-restaurant-raw-mail-r2.sh staging --delete-source
   ```

本番も同じ手順だが、検証の結果と本番用バックアップを確認してから実行する。

## このPRでの実行範囲

移行スクリプトの追加だけで、dry-run、コピー、移行元削除は実行しない。
