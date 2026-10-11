# 固定したV8の書き出しから地図と照合値を作る

正解は司令塔の `V8_DESIGN_DIR`（既定 `~/lh-work/design/v8`）の固定済みHTML・座標表です。Penを開く必要はありません。

```sh
node scripts/visual-qa/build-v8-design-map.mjs --frozen-exports
node apps/web/scripts/regenerate-v8-design-values.mjs
pnpm typecheck:scripts
pnpm test:scripts
pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-harness/update-engine build
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build
pnpm --filter web verify:design
```

- 固定後の地図は既存のroute・URL指定・撮影データを土台に、`review/PEN-ID-CHANGES-1011.tsv` の正のIDへ付け替えます。`frozenAt` のある地図は、通常の再生成でもこの手順を使います。古い台帳を重ねて戻しません。
- 旧板・隠された統括リッチメニュー・外箱は `replacements` に対応を残します。Penから消えた24件は `deletedBoards` に記録します。旧IDの対応は残し、画面への対応がなく使用禁止の `retired` と区別します。測るIDは中の板 l5V9a・jjFNi・WQmepです。
- 説明・部品・幕の幅はnullとして撮影対象から外します。aRvrhは独立HTMLがなく、`exportHtml` と `exportNodeName` が示すQX56l内の小窓を使います。
- routeを補った写しは `review/PEN-ID-CHANGES-1011-routes.tsv` に出ます。場所不明は生成時に報告します。幕のrouteは空です。
- `v8-part-values.json` は共通部品の名前で固定HTMLと照合し、色・余白・枠・文字などを深さ2まで写します。HTMLにない自動寸法の計算値bw/bhは捏造せず、収録しません。HTMLの出典とSHA-256を残します。
- `design-parts.json` の既存の棚卸し契約は保ち、固定後のリンク色・選択中のページの色を更新します。`v8-part-values.json` のchecksでV8の色・選択状態・一覧名・余白・丸を追加照合します。落ちても実装に合わせて写しを古い値へ戻しません。
- `sync-v8-design-refs.mjs --include-html` は固定後には `html/` を写します。PNGは別工程の撮影成果物です。古いPNGは更新が必要と報告します。

最初の固定前だけ、地図の生成器はBOARD-INDEXとHANDOVERの台帳から地図を作ります。

10-11 の固定版（03:10 JST）は `review/BOARDS-1011.tsv` と削除表を照合します。削除前の行が一覧に残っていても復活させません。新しい板のURL・状態は `frozen-v8-1011-routes.json` を重ね、未対応の独立画面はURLを推測せず場所不明として返します。採用の説明のまとめ板は追加の画面として測りません。設定のURLの根拠は custlook 枝の入口です。

各板の `exportHtml` / `exportTexts` と SHA-256 を現在の固定写しに更新します。単独写しのない aRvrh は従来どおり親HTML内の名前で特定します。固定後のPNGはまだ無いので `shot` はnull、古いPNGは `sync-v8-design-refs` の日時検査で正解として使いません。窓だけ・欄だけの見本も幅nullとして、実画面内の状態と目で照らします。

`MEASURE-EXCLUDE.tsv` に相当する独立の表はリポジトリ内にありません。幅null・`unmeasurable` が撮影対象外を表します。司令塔の手元の除外表はこの道具で変更しません。
