# 列車17の指摘への修正・追試（2026-10-11）

対象は P2-1・P2-2・P3-1。司令塔指定の列車18 `fc073798f0638d54f82d7977ecde3747800847c1` から `codex/kenta-stgfix17-1011` で作業した。本線の取り込み、push、PR、D1適用、配備は行わない。
根拠は司令塔の `design/v8/staging-verify/train17/review.md` と同所の `evidence/`。開始前のローカル doctor は合格。

## 操作失敗と再取得の失敗

全画面の `catch`・`setError`・一覧再取得を `rg` で検索し、同じ状態を消す候補14操作を確認した。7か所で操作理由が再取得によって消えていた。V8の現行2か所・互換側5か所。消す・止める操作だけでなく、同じ障害がある鍵交換・版戻し・タグ表示・編集開始も含む。
共通 `useActionError` で操作理由を一覧取得から分離する。対象変更・再操作・明示的な閉じる時だけ消す。キャンセル待ちは既存の共通 Dialog の error 欄に理由を置き、通信の失敗と409の状態競合を分けた。一覧の再取得も失敗した場合は、一覧側に別の理由と再取得操作を出す。

|画面／ファイル（apps/web/src 以下）|操作|修正前|今回|
|---|---|---|---|
|v8/restaurant/reservations/waitlist.tsx|キャンセル待ち取消|再取得成功で消える|共通フック・確認窓の理由|
|v8/webhooks/api-tokens.tsx|鍵の入れ替え409|再取得開始で消える|共通フックで保持|
|app/webhooks/apitokens-v8.tsx|同上（互換）|同上|共通フックで保持|
|app/webhooks/api-tokens-panel.tsx|同上（互換）|同上|共通フックで保持|
|app/booking/menus/menu-version-history.tsx|版戻し409（互換）|再取得開始で消える|共通フックで保持|
|components/friend-fields/tags-page-v4.tsx|タグ表示の切替（互換）|再取得開始で消える|操作理由を分離|
|app/automations/page.tsx|編集開始404/409（互換）|再取得開始で消える|操作理由を分離|
|v8/friend-add-runs/detail.tsx|失敗した処理の再試行409|取得後に理由を置く|変更不要|
|app/friend-add-settings/runs/detail/detail-v8.tsx|同上（互換）|取得後に理由を置く|変更不要|
|app/affiliates/tabs.tsx|まとめて処理|取得後に理由を置く|変更不要|
|app/booking/bookings/detail/page.tsx|変更の保存409|取得後に理由を置く|変更不要|
|app/booking/bookings/detail/page.tsx|処理の再試行|取得後に理由を置く|変更不要|
|app/booking/bookings/detail/page.tsx|通知の再送|取得後に理由を置く|変更不要|
|v8/booking-menus/menu-version-history.tsx|版戻し409|keepError付きで取得|変更不要|

## 流入一覧・共通の重なり検査

P2-2 は列車18で既に修正されていた。コピーは行メニュー内にあり、「…」は32px。固定した流入一覧の絵 `xbHxg`（1440）・`y1ztx`（1152）の構成を確認した。列幅をさらに狭めたり、名前を折り返す変更は加えていない。

追加の実ビルド追試で、列車18の共通表に `container-type: inline-size` が加わった結果、確認窓の `align-items: flex-start` 内で表の幅が0になり、キャンセル待ちの行が隠れる問題を確認した。共通表へ幅100%と最小幅0を指定し、窓の内側へ収めた。実物CSSからこの幅指定を外す対照でボタン中央を押せなくなり、修復後は幅560pxで押せる試験を追加した。

外の独立ブラウザ追試を `apps/web/scripts/v8-guard/stgfix17-browser.mjs` として取り込んだ。1152・1440・1920でボタン中央の当たり先、実際のマウスクリック、キーボード操作を確かめる。取消も通信失敗・409の2状態を実ビルドで確認する。
この独立追試もV8の必須CIに組み込んだ。未完了や例外は明示的な終了1と証拠を残す。
既存の `layout-defects.mjs` に押せる物同士の実寸の重なりと、中央クリックが別の列に遮られる検出を追加した。スクロール領域の外の行は表示してから操作するため、中央が領域外の行を遮断の不具合には数えない。わざと重ねたボタンと札で検査終了1、直した実物で終了0を確認する。

## 速度の条件

元レビューのCI結果はダッシュボード表示1012ms、配信一覧の長い処理53ms、配信作成57ms、友だち2000件59ms。これらは別の実行環境なので、手元の修正前後の差とは区別する。
列車18の元コードと修正後を、同じPC・Chromium・本番ビルド・同じ見本API・1440pxで各5回の中央値として測る。ビルド時のAPI URLは `https://nen-line-stg.skmtmst.workers.dev`、飲食の確認用フラグは true。実際の変更操作は通信差し替えによる偽APIだけに送る。
速度の基準表・上限・時間倍率を変更していない。4項目の絶対目標（表示1000ms、長い処理50ms）を別に厳密判定する `stgfix17-targets.mjs` を追加し、各目標を1ms超える壊し方・欠測・未完了・2000件未描画で落ちる対照を用意した。既存CIの速度参考チェックという扱いを維持する。

列車18の元SHAの [CI run 38108724669](https://github.com/skmtmst/line-harness-oss/actions/runs/38108724669) も確認した。画面の必須検査が先に失敗し、速度測定が実行されず、後続の絶対目標検査では `speed.json` がないため未完了になっていた。速度測定とその対照試験の条件を `!cancelled()` にし、画面の不合格とは独立して速度を記録する。必須画面検査の失敗を許す変更ではない。元の条件へ戻すと対照試験1件が落ち、修正後の速度道具の試験10件は合格した。

表示時間は文書・見本API・描画の待ちを含む指標、長い処理はブラウザのメインスレッドの観測として分ける。列車18の手元の修正前は既に4目標以内だった。元CIの12ms・3ms・7ms・9msの超過のコード上の原因は、手元では再現せず特定できていない。4画面の処理を推測で書き換えず、上限を固定して測定を残す。LinuxのCIでの再確認は司令塔のpush後に必要であり、手元の合格をCIの解消証明にはしない。

|項目（ms・5回の中央値）|列車18の元ビルド|修正後|元の上限|
|---|---:|---:|---:|
|ダッシュボード表示|774|758|1000|
|配信一覧の長い処理|0|0|50|
|配信作成の長い処理|0|0|50|
|友だち2000件の長い処理|0|0|50|

0は50ms以上の処理が観測されなかったという意味。各サンプルの中央値だけでなく生値も 整理前のGit履歴に残した（`git show ec971ed64783737a515f00ae6f8e7838c14024d2:docs/stgfix17-evidence.json`）。補助スクリプト再検査が測定中に走った試行は比較に使わず、その終了後に修正後を測り直した。元・修正後とも既存の速度予算11画面と追加した4目標の厳密判定は合格。APIの見本の指紋、取消・流入のブラウザ結果、共通崩れの比較、行・骨格の件数も同JSONに保存した。

## 再実行の入口

```sh
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm test
pnpm test:scripts
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm typecheck
pnpm typecheck:scripts
pnpm --filter @line-harness/update-engine build
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true pnpm --filter web build
node apps/web/scripts/v8-guard/serve-out.mjs apps/web/out 4397
# 別の端末で、実ビルドへ見本APIだけ差し替える。
node apps/web/scripts/v8-guard/stgfix17-browser.mjs http://127.0.0.1:4397 /tmp/stgfix17-browser
V8_GUARD_STUB_API=1 node apps/web/scripts/v8-guard/layout-defects.mjs http://127.0.0.1:4397 /tmp/stgfix17-defects.json
V8_GUARD_STUB_API=1 node apps/web/scripts/v8-guard/speed-budget.mjs http://127.0.0.1:4397 /tmp/stgfix17-speed.json
node apps/web/scripts/v8-guard/stgfix17-targets.mjs /tmp/stgfix17-speed.json
node --test apps/web/scripts/v8-guard/layout-defects.test.mjs apps/web/scripts/v8-guard/stgfix17-targets.test.mjs
```

P2-3 の板との全体一致は今回の依頼外。キャンセル待ち確認窓は元レビューでも比較HTML未整備のため、機能追試・ブラウザ撮影を絵との90%一致の証拠にはしない。

## 完了した機能・道具の確認

- 元コードへ戻す対照：取消4件・鍵交換1件・版戻し1件の計6件が失敗。API URLを指定して実行し、環境未設定による失敗と区別した。修正後は全画面の試験で合格。
- 実ビルドの独立追試：流入の1152・1440・1920、取消の通信失敗・409の計5件が合格。取消は各DELETE 1回、GET 2回。確認窓内に理由が残る。
- 重なり／遮断の壊し方はそれぞれ終了1、修復後0。表の実物CSSを壊す対照も検出。道具の試験34件は合格。
- 生成先が共通のNext開発サーバーを起動する試験と本番ビルドを同時に走らせると、ページの生成物が競合する。最終ビルドは画面の全試験終了後に実行し、合格した。
- 設計値検査は実ビルド完成後に合格。列車18と同じ既知25件の設計値の一時許可を使い、新しい許可・閾値変更は追加していない。
- 全試験は26,814件合格（既存の31件skip・1件todo）。補助スクリプト921件、全パッケージの型検査、補助スクリプトの型検査、Web本番ビルドも合格。
- 横はみ出し検査72条件は0。共通崩れ検査66画面×3幅＝198条件は測定失敗0、操作同士の重なり・中央の遮断0。既存の崩れ121件で終了1だが、列車18の元ビルドと種類・場所・文字・寸法まで同一（追加0・悪化0）。この検査全体を合格とは報告しない。残件の内訳は操作帯の間隔7、板下6、カード内はみ出し10、カード下6、旧差し込み操作3、行の余白19、短い文字7、詰まり12、プレビューの暗い面51。今回のP2-3除外範囲として司令塔へ返す。
- 一覧の行の検査は129条件・705行、骨格と共通3部品は93条件で合格。それぞれ5種類・7種類＋3種類の壊した対照を検出した。
- 独立ブラウザ追試も接続できない入口で終了1・complete=falseとなることを確認した。外部見本APIの例外処理で検査の例外を握りつぶして合格にする形を避ける。

コードは `a9ab6deba5`（操作理由の保持）、`5c35781ab6`（表の幅・重なり・速度測定）に分けてコミットした。反映履歴は依頼指定の `docs/release-log/unreleased/0000-kenta-stgfix17.md`。0000は司令塔がPR採番後に置き換えるための指定名で、PRは作成していない。実ビルド・試験はコミット前の同じコードに対して行ったため、公開版の反映を示すものではない。
