# musubo マニュアルサイト

`apps/docs` は、公開マニュアルを静的HTMLとして生成するNext.jsアプリです。記事にはMDXを使い、画像は `public/manual/` に置きます。

## 記事を追加する

1. `src/app/manual/<slug>/page.mdx` を作成する。
2. `src/lib/manuals.ts` に一覧表示用の項目を追加する。
3. 画像を `public/manual/` に置き、記事から `/manual/<ファイル名>` で参照する。
4. `pnpm --filter docs build` と `pnpm --filter docs test:export` を実行する。

記事テンプレートは `src/app/manual/line-account-setup/page.mdx` です。手順、注意、補足、画像とキャプション、「うまくいかないときは」の部品をコピーして利用できます。

## ローカル確認

```bash
pnpm --filter docs dev
pnpm --filter docs typecheck
pnpm --filter docs test
pnpm --filter docs build
pnpm --filter docs test:export
```

静的ファイルは `apps/docs/out/` に出力されます。このフォルダーは生成物のためGit管理しません。

## 公開に関する安全上の前提

- 認証なしの公開サイトです。秘密情報、個人情報、内部専用URLを記事へ記載しません。
- DNS設定やCloudflare Pagesプロジェクトは、このアプリのビルドでは変更されません。
- `musubo.jp` のカスタムドメイン設定は別工程です。既存のMX・TXTレコードを変更しません。
