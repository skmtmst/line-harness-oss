# 管理画面のページの題の見張り

`title-audit.mjs` は `apps/web/src/app/**/page.tsx` を毎回探し、1440px の Chromium で V8 のページの題を測ります。題は `22px / 700 / 32px` の3つすべてが一致しないと失敗します。題なし・画面エラー・予期しない転送も失敗です。

詳細・予約済みのページでは、題が1行で省略され、`title` 属性で全文を確認できることも検査します。

公開のログイン・登録・招待・パスワード画面と部品見本は対象外です。LIFF は別アプリなので探索対象に入りません。型の題を優先し、型がない画面は main 内の最初の見える h1/h2 を使います。ダイアログ・引き出し・フォルダの見出しは除きます。

見本データの ID と入口だけの転送先は `title-audit-routes.json` にあります。新しいページは自動で検査に加わります。ID が必要なページを追加したときだけ、見本の URL をこの JSON に足してください。

## 実行

見本 API を起動し、同じ API を指定して web を build します。飲食店の見本も含めるため、build 時に `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true` を指定します。書き出した out を `apps/web/scripts/v8-guard/serve-out.mjs` で配信します。テーマは検査中のブラウザ内で V8 に固定されます。

```sh
node scripts/visual-qa/title-audit.mjs http://127.0.0.1:4310 /tmp/title-audit.tsv
```

TSV は URL・題の文字・size・weight・lh を記録します。同名の JSON は測定要素、全文表示用の title 属性、省略表示の CSS、転送先、対象外ルート、画面エラーも記録します。修正前の記録だけを取る場合は `--record-only` を指定します。

## 落ちることの確認

```sh
node scripts/visual-qa/title-audit.mjs http://127.0.0.1:4310 /tmp/title-broken.tsv --route /tags --inject-20
node scripts/visual-qa/title-audit.mjs http://127.0.0.1:4310 /tmp/title-restored.tsv --route /tags
```

1行目は実際に描かれた1画面の題だけを20pxに変え、終了コード1になります。2行目は通常表示を測り、終了コード0になります。ソースファイルは書き換えません。`--screenshots` を指定すると、出力先の `title-audit-shots/` に測ったページの画像も保存します。

同じ検査を Required PR Gate の `v8-screen-guard` で実行し、結果を既存の画面検査の成果物へ保存します。
