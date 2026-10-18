# 列車35b：PR #1730 の静的出力と本線比較の修正

- 開始HEAD：943c8e7020404d72157bcc7c6c346e60b713e57c。開始時クリーン、指定の `git pull --no-rebase` は更新なし。ローカル診断は合格。
- テスト前に取得した本線：9613559dcbdf279b69a13db7a840345550a1a59d。HEADへの取り込み済み、遅れ0。
- CIログの狭幅プレビュー失敗を確認。ビルド前の実行ではなく、ビルド後の `mv apps/web/out /tmp/head-out` により試験の参照先がなくなっていた。
- 移動を `cp -a` へ変更し、ビルド・ブラウザ導入・サーバー起動後の既存の並びで、元の出力も読めるようにした。試験・前提検査・速度判定方針は変更なし。

## 追加・並び変更した呼び出しの全点検

本線とのworkflow差分から、故障対照の変更された命令に含まれる10本、新しいVitest命令の2本、狭幅プレビュー1本をすべて確認した。

| 試験 | 前提 | 呼び出し位置 |
| --- | --- | --- |
| `layout-defects.test.mjs` | Chromium・その場の見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `form-columns.test.mjs` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `create-consistency.test.mjs` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `list-toolbar-readable.test.mjs` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `fix-patterns.test.mjs` | Chromium・その場の見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `owner-rules.test.mjs` | Chromium・その場の見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `pendec2-rules.test.mjs` | Chromium・その場の見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `layer-order.test.mjs` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `b244-rules.test.mjs` | Chromium・その場の見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `list-row-height.test.mjs` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `automation-create-draft-safety.test.ts` | Chromium・自前起動のNext/Worker | ビルド・Chromium導入・配信サーバー起動の後 |
| `automation-new-overflow-contract.test.ts` | Chromium・実CSSの見本 | ビルド・Chromium導入・配信サーバー起動の後 |
| `narrow-preview.test.mjs` | Chromium・apps/web/out/version.json・自前静的サーバー | ビルド・Chromium導入・配信サーバー起動の後 |

- ブラウザ見本の12本は元の `out` を参照しない。自動化の安全試験はNextとWorkerを自身で起動する。狭幅プレビューは元の `out` と自前の静的サーバーを使用するため、今回のコピーで前提を満たす。同種の欠落は1本。
- 速度の変更命令4本も確認。`qa:speed` は配信中の4310番へ接続し、後続3本は先に生成した `speed.json` を読む。いずれも前提を用意した後に呼ばれる。

## CI全工程の再実行

- `rm -rf apps/web/out apps/web/.next` 後、workflowの全22 run工程を抽出し上から順に実行開始。13工程目の失敗で停止し、残る9工程は未実行。Node 22.23.3、UTC、API 8788番、飲食店テスト有効、速度判定設定はCIログと同じ空値。重い工程は `heavy.sh` で直列実行。
- `compare=true` とし、本線の新しい作業ツリーも依存導入・本番形式ビルド。APIとHEAD/baseの配信開始・準備完了確認も含めた。衝突を避け、ローカルの一時パスだけ `/tmp/train35b-*` へ置き換えた。
- コピー直後の元出力と配信用出力は1,201ファイルすべて一致し、元の `version.json` の存在も確認。
- ブラウザなしの管理画面Vitestは、指示どおり列車33bの結果を引き継ぎ再実行しない。
- 全命令・終了値・ログ・前提点検・出力指紋は `~/lh-work/design/v8/review/TRAIN35B-CI-1730/`。

## 初回の結果（修正前）

- 13/22工程を実行し12成功・1失敗。検査命令は7/19本を実行し6成功・1失敗（依存導入・ビルド・ブラウザ導入・サーバー起動を含むpnpm/node命令は17本）。
- 全画面3幅の崩れ0、故障対照103/103、自動化11/11、今回の狭幅プレビュー1/1、列車17と予約プレビューは成功。
- 本線比較は198場面中101場面で測定エラー。有効場面の新規指摘は0だが、測定できない場面を0に数えず、不合格を維持。
- 別エラーの最小再現：`assessAgainstBase` に `form-preview-surface` の `{bg: 'rgb(247, 248, 250)', canvas: 'rgb(255, 255, 255)'}` を渡すと、数値のみを認める許可検査が同じエラーを返す。新しい作成画面の検出結果の文字列と、既存の数値専用比較の不一致。今回のworkflow修正はこの処理を変更しない。
- `AGENTS.md` のテスト失敗時の停止規則に従い、コミットを保留。利用者へ別エラーの修正範囲を質問済み。後続の速度・一覧・仮想表の工程は未実行で、全成功とは報告しない。
- workflowのYAMLと全82 run工程のbash構文検査は成功。今回の実装差分はworkflowの移動→コピー1行、反映履歴1行、本文書。試験コード・前提検査・速度方針は未変更。
- 検査用の自分のAPI/HEAD/baseサーバーは停止。再調査用に自分の `/tmp/train35b-base` 作業ツリーと静的出力は保持。DB更新・配備・pushなし。

## 承認後の直し

- 2026-10-14 04:44 JSTの司令塔の指示で、未コミットのコピー・workflow・反映履歴・記録を保持して再開。再開時のpullも更新なし、ローカル診断は合格、本線9613559dcbから遅れ0。
- 作成画面のY1〜Y4で、説明用の文字列・配列を数値の実測へ入れていた。色・題・アイコン等は`detail`へ保持し、`measure`は文字サイズ差・間隔超過・不一致件数・アイコンの個数差へそろえた。元の検出条件は変更していない。
- 再実行で、押せない操作の理由不足も本線の許可へ変換するとエラーになることを確認。この比較を中断し、元から許可で除外しない`form-action-reason`を、既存の厳密判定項目と同様に本線の許可へ変換しないようにした。HEADに理由不足があれば既存でも失敗する。許可種類・許可一覧・上限は増やしていない。
- Y1〜Y4を実ブラウザで検出し、本線比較、新規、件数増加、数値悪化、固定許可の維持を回帰試験で確認。理由不足も本線だけなら変換エラーなし、HEADにもあれば失敗、固定許可は拒否されることを確認。故障対照104/104成功。
- 先に成功した1〜12工程の成果を保持し、サーバーを同じ命令で再起動。影響した8工程目の故障対照と13工程目の本線比較を再実行し、未実行の9工程（14〜22）を順にすべて実行した。ビルド済み製品コードは変更せず、比較は修正済みの同じ検出器で両側を測定。
- 本線比較198場面は新規0・測定エラー0で終了0。狭幅試験の出力存在検査と速度の参考判定方針は維持。

## 最終結果

- 全22工程の最終終了値は0。検査19命令、依存導入・ビルド・ブラウザ導入・サーバー起動を含むpnpm/node命令29本が成功（再実行の重複は別記録）。修正前の失敗と途中の中断を成功数へ混ぜず、当初のログ・結果も保持。
- 狭幅プレビュー1/1・自動化11/11・故障対照104/104・速度判定の対照19/19が成功。全画面198場面の崩れ0、本線比較198場面の新規0・測定エラー0。一覧129場面・744行は失敗0、骨格93場面の未許可0（既存許可6件を維持）。
- 見出し185画面は不一致・測定失敗0。速度11画面×各5回の測定と後続4命令が成功、今回の超過0。仮想表の選択・キーボード・画面外から戻る操作と3幅の表示も成功。
- ソース4本の構文検査と差分検査が成功。最後のfetchでも本線9613559dcbは変わらず遅れ0。検査ソース5ファイルの指紋も実行時から変化なし。
- 自分のAPI・HEAD・base配信サーバーは停止。最終成果物は外部記録の`artifacts/final/`へ保存。DB更新・配備・pushなし。次は司令塔がpushしてPR #1730のCIを再確認する。

| 工程 | CIの命令（ステップ名） | 最終終了値 |
| --- | --- | --- |
| 1 | Decide whether to run the screen guard | 0 |
| 2 | pnpm install --frozen-lockfile | 0 |
| 3 | Build the PR admin against the visual-qa mock API | 0 |
| 4 | Build the base admin against the same mock API | 0 |
| 5 | Install Chromium for the V8 screen guard | 0 |
| 6 | Start the mock API and serve the built admin | 0 |
| 7 | No V8 layout breaks at 1152, 1440 and 1920 | 0 |
| 8 | Broken fixtures must fail the V8 layout guard | 0 |
| 9 | Automation draft safety and U023 layout on a real browser | 0 |
| 10 | Narrow preview opens once and preserves form input | 0 |
| 11 | Train 17 waitlist failure and inflow mouse regressions | 0 |
| 12 | Booking preview date agrees through settings and preview tabs | 0 |
| 13 | No new V8 layout or owner-rule defects (B-191 through B-218) | 0 |
| 14 | List row rules (B-190/193/194/195/198, with negative controls) | 0 |
| 15 | All admin page titles are 22px / 700 / 32px at 1440 | 0 |
| 16 | Speed measurement and reference policy controls | 0 |
| 17 | Common V8 speed checks (11 scenes, five medians) | 0 |
| 18 | Train 17 absolute targets | 0 |
| 19 | 2000 friends meet absolute speed targets | 0 |
| 20 | PERF-01 fixed list speed targets | 0 |
| 21 | Report speed reference results (including incomplete measurements) | 0 |
| 22 | Virtual table selection, keyboard and layout | 0 |

- 確認時刻：2026-10-14 05:10 JST。全命令は外部記録の`plan.json`、最終終了値は`results.json`、命令数は`final-command-counts.json`。
