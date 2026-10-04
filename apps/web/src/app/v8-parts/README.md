# badges 共通部品の確認ページ

`/v8-parts` は固定の見本だけを表示します。左メニューには追加しません。
正本HTMLはリポジトリへ複製せず、ローカルの確認サーバーから変更せずに配信します。
通常の認証とアカウント選択はそのままです。下記の固定APIを使えば実データを取得・変更せず確認できます。

```sh
PORT=8916 node scripts/visual-qa/mock-api.mjs
```

別の端末で本番ビルドして表示します。起動前にポートが空いていることを確認してください。

```sh
pnpm --filter @line-harness/update-engine build
NEXT_PUBLIC_API_URL=http://127.0.0.1:8916 NEXT_PUBLIC_ADMIN_THEME=v8 pnpm --filter web build
python3 apps/web/src/app/v8-parts/serve-reference.py --port 3116
```

`http://127.0.0.1:3116/v8-parts` を1440px幅で開き、上のアカウント選択から固定の検査用アカウントを選びます。
空いているポートを自動で使う場合は `--port 0` とし、表示されたURLを開いてください。

正本の置き場を変える場合は `--references /絶対パス/parts` を渡します。
正本HTMLに付いている属性は `data-pencil-id`（依頼文の `data-layer-id` に相当）です。
`data-part-case` / `data-implementation` で実装側を、iframeの `data-pencil-id` で正本側を測れます。
見えている本体のほか、文字・点・アイコン・棒の済み部分も比較します。

結果は `design/v8/parts-check/badges.md`、実測値は同じ場所のJSON、左右の画像は `<ID>.png` です。
スクリーンショットの切り出し座標は `getBoundingClientRect()` に `scrollX` / `scrollY` を足したページ座標を使います。
