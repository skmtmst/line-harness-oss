# cards レーンの確認

`/v8-parts` は固定データの確認ページです。左メニューには追加していません。通常の認証・店舗選択を通ります。撮影スクリプトだけが `worker.test` を見本データに置き換えます。

リポジトリの根で実行します。ビルド前に、共有パッケージと update-engine がビルド済みであることを確認してください。

```sh
NEXT_PUBLIC_API_URL=http://worker.test pnpm --filter web build
python3 -m http.server 3123 --bind 127.0.0.1 --directory apps/web/out
```

別の端末で数値比較と撮影を実行します。

```sh
node apps/web/src/app/v8-parts/capture-cards.mjs http://127.0.0.1:3123
NEXT_PUBLIC_API_URL=http://worker.test pnpm --filter web exec vitest run --config src/app/v8-parts/v7.config.ts
node apps/web/src/app/v8-parts/capture-v7.mjs http://127.0.0.1:3123
```

正本の場所は `V8_PARTS_REF` で変更できます（既定：`~/lh-work/design/v8/parts` の絶対パス）。正本ファイルは変更しません。各ページを1440×1080・倍率1・動きを減らす設定で開き、部品領域を切り出します。画像は左＝正本、右＝実装です。正本のHTMLは `data-pencil-id` で要素を識別します。

結果は `design/v8/parts-check/cards.md`、数値の記録、IDごとのPNGに書きます。寸法差1px以下、色・影の完全一致を確認します。古いV7部品は基準コミット `4b1cd841318a66b265a6fb64dbe25baa4106b1b6` からSSRし、現在のSSRと同じ書体・CSS層で画素を比較します。

V7の生成には本番exportと基準コミットが必要なので、通常の単体試験から分離した手動設定で実行します。手書き部品の検索結果は `handmade-cards.md` にあります。画面の書き換えは行いません。
