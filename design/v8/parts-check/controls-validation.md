# controls の検証記録

- 比較の基準コミット：`4b1cd841318a66b265a6fb64dbe25baa4106b1b6`。基準点の取り込み・統合は司令塔が行う。
- 共通部品の変更：15種類ごとにローカルコミット。ソースの区切り：`6840d335f915e1b2b5c5d9bee6a3f702546ef29a`。
- 本番ビルド：`NEXT_PUBLIC_API_URL=http://worker.test pnpm --filter web build` 合格。
- 部品HTMLの比較：25/25 合格。寸法・余白・文字・線・影・位置の最大差0px、色などの不一致0、4pxを超える輪郭の差0画素。
- v7の比較：修正前の部品CSSと修正後の部品CSSを同じDOMで比較し、22/22 差分0画素。新しい文字ボタンと行内ラジオは旧部品が無いため対象外。
- 実物の操作確認：11/11 合格。切り替え、認証コードの自動入力、削除の取消と確定、色の選択と直接入力を確認。
- Vitest：101ファイル・647件すべて合格（`NEXT_PUBLIC_API_URL=http://worker.test`）。共通部品、V8操作系・枠線の契約、設計トークンの試験を実行。
- 型検査：`pnpm --filter web exec tsc --noEmit` 合格。
- 差分検査：`git diff --check` 合格。負債の基準ファイルは変更していない。
- 画面ごとのファイルは変更していない。正本HTML・Pencil・親リポジトリも変更していない。
- 共通札の旧「高さ30・白と緑」の見た目だけの契約を、正本 O2fCAt / XGJDa の「高さ36・選択中は墨地と白文字」に更新。保存・送信・権限などの動きの試験は残した。
- 比較画像25枚と重ね合わせ25枚を目で確認。文字ボタンはlist-filter、未対応の札はcircle-dotを使い、正本の印にも合わせた。最終画像判定は司令塔が行う。

再確認は参照HTMLを3218、本番書き出し `apps/web/out` を3219で公開してから：

```sh
node apps/web/src/app/v8-parts/check-controls.mjs design/v8/parts-check 3219 3218
```

`controls.json`に主な要素の全取得値、`controls.md`に合否表、`handmade-controls.md`に画面レーン用の全候補行を記録。参照HTMLと実装の指紋も同じ場所へ保存した。
