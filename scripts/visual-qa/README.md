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

- 固定後の地図は既存のroute・URL指定・撮影データを土台に、`review/PEN-ID-CHANGES-1010.tsv` の正のIDへ付け替えます。`frozenAt` のある地図は、通常の再生成でもこの手順を使います。古い台帳を重ねて戻しません。
- 19件の旧板・隠された統括リッチメニュー4件・外箱3件は `replacements` に対応を残します。Penから消えたIDの `retired` と区別します。測るIDは中の板 l5V9a・jjFNi・WQmepです。
- 説明・部品・幕の幅はnullとして撮影対象から外します。aRvrhは独立HTMLがなく、`exportHtml` と `exportNodeName` が示すQX56l内の小窓を使います。
- routeを補った写しは `review/PEN-ID-CHANGES-1010-routes.tsv` に出ます。場所不明は生成時に報告します。幕のrouteは空です。
- `v8-part-values.json` は共通部品の名前で固定HTMLと照合し、色・余白・枠・文字などを深さ2まで写します。HTMLにない自動寸法の計算値bw/bhは捏造せず、収録しません。HTMLの出典とSHA-256を残します。
- `design-parts.json` の既存の棚卸し契約は保ち、固定後のリンク色・選択中のページの色を更新します。`v8-part-values.json` のchecksでV8の色・選択状態・一覧名・余白・丸を追加照合します。落ちても実装に合わせて写しを古い値へ戻しません。
- `sync-v8-design-refs.mjs --include-html` は固定後には `html/` を写します。PNGは別工程の撮影成果物です。古いPNGは更新が必要と報告します。

最初の固定前だけ、地図の生成器はBOARD-INDEXとHANDOVERの台帳から地図を作ります。
