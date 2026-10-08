# lnot 画面レーンの引き継ぎ（2026-10-09）

対象は `/line-notifications`・`/notifications` の指定8枚。座標の90%基準は全枚達成。
正式な合格台帳への記録は、下の残差を司令塔が確認してから行う。
push・PR・DB更新・配備は実施しない。測るサーバーは lnot だけ停止する。

## 測定・画像の比較

初回は同じ lnot の前回の未コミット作業を引き継いだ状態。変更前のまっさらな本線の数値ではない。
測定幅は各板の正本の1440。1152・1440・1920の8枚×3幅も別途撮影し、ページ・表の横のはみ出しと右端越えを検査した。

| 板 | 名前 | 初回 | 最終 | 左右で見比べた結果 |
| --- | --- | ---: | ---: | --- |
| DrwMm | 送れなかったもの | 48% | 93% | 本文の列・操作を確認。最初の日時が7px上。メールの完了数はAPIに無いため「—」。共通KPIの形と外側に差 |
| PZBVb | 記録 | 25% | 97% | 本文の列・札を確認。10/1 21:14が7px上。外側に差 |
| g3iDs | 顧客へのお知らせ | 34% | 99% | 題・案内・表・操作を確認。APIに無い数字、共通KPIの形と外側に差 |
| gjUz3 | 運用者へのお知らせを作る | 100% | 100% | 入力と保存の位置を確認。プレビューの内容は現行APIのもの。外側に差 |
| hiBO8 | 運用者へのお知らせを編集 | 100% | 100% | スタッフ行・入力・下の操作を確認。プレビューとテストの送り先に差。外側に差 |
| sDXNy | 公開前の確認 | 100% | 100% | 題・要約・宛先・ボタンを確認。役割はAPIの「オーナー」で、絵の「店長」とは別。背景のプレビューと外側に差 |
| u8xibp | 運用者へのお知らせ | 57% | 98% | 題・数の帯・列・操作を確認。未対応のきっかけ、データ、共通KPIの形と外側に差 |
| y8QQV | 通知 | 100% | 100% | 本文のタブ・行・操作・下の説明はOK。外側に差 |

全8枚を撮影できた。座標率は見つかった文字を分母とするため、API・データ違いの抜けも画像で確認した。
残った「記録」タブの5〜13px差は、前のタブの実際の件数の文字幅による。
画像・deltaは `~/lh-work/design/v8/overlay/pages-lnot/`。

撮影では対応表の写しに、実際のAPIの返事と同じ形式で「失敗3件だけ」「運用者5件」「宛先とIDが一致するスタッフ一覧」を設定した。
商品画面の絞り込み・保存・権限・公開の条件は弱めていない。きっかけも実際に登録されているものだけを使った。
通常の6件の見本も残している。次のコマンドで同じ撮影を再現できる。

```sh
node scripts/visual-qa/lnot-design-map.mjs ~/lh-work/lh-spacing/scripts/visual-qa-stable/v8-design-map.json .measure/lnot-design-map.json
MEASURE_MAP="$PWD/.measure/lnot-design-map.json" zsh ~/lh-work/tools/hq/measure.sh lnot DrwMm,PZBVb,g3iDs,gjUz3,hiBO8,sDXNy,u8xibp,y8QQV
zsh ~/lh-work/tools/hq/measure.sh --stop lnot
```

## 絵どうしの食い違い・共通部品（司令塔へ）

- HTMLから撮った `-design.png` は、座標表・Pencil原画像と本文の横位置や行の高さが異なる箇所がある。特に記録の表はHTML側の行が高い。座標表を正とし、原画像 `lint/V8-B/shots/` も確認した。HTMLに寄せて座標を崩す変更はしていない。
- 外側の左メニュー・上のアカウント欄・利用者欄・下の更新情報・パンくずは本線の共通部品を保持。絵にあるウェビナー・自分の勤務・利用者の上部表示などとの差がある。列車2で入った「タグ」の名前を保持している。
- 絵のKPIカードは角の形・右の「…」が現行の共通KpiCardと違う。ダミーの操作は足さず、共通部品の既定の形は変えていない。案内の帯も共通Noticeの色・角を使う。
- 主な自前の題・入力・タブ・表・札・案内の帯・左右の列は共通部品へ移した。個別のスタッフの箱、LINE風の文面見本、チーム作成の文字ボタン、記録名から詳細を開く文字ボタンは残る。既存の共通の文字ボタンには、この寸法・表示の受け口が無いため、通常のButtonを画面CSSで上書きしていない。

## API・表示の判断が要るもの

- 運用者の絵の「問い合わせの到着」「低評価の口コミ」「キャンセル待ちの案内期限」「定期便の停止」は、現在の運用者用きっかけ一覧に無い。見た目だけ別のイベントへ結びつけていない。
- 失敗一覧の「メールで送った」完了数、顧客一覧の今月の送信枠・失敗数は、値が無い場合「—」と確認先を表示。LINE未ログインからメール送信成功を推定しない。
- 予約日時・顧客名などを含む通知のプレビュー例は、現在のAPIからは来ない。入力した名前・実際のきっかけ・重複防止条件を表示する。
- 運用者のテスト送信は現在のAPIどおり自分宛て。絵の編集画面にある「テスト受信者に送る」とは送り先が違うので、その文字に替えない。
- 確認窓の役割はスタッフ一覧の実際の権限ラベルを使う。「店長」は現行の権限ラベルに無いため、オーナーと勝手に同義にしない。

## 実装の要点

- 既定を変えない最小の受け口：DataTableの列・余白・狭い幅用の列、Fieldの小さいラベル・伸縮、Selectの赤枠だけ、TabsとKpiCardの通知用寸法、DetailColumnsの通知用左右幅。
- 作成・編集の欄の誤りは、赤枠・理由1行・最初の欄への移動にした。保存と公開の両方で止める。通信など欄に結びつかない失敗は上の表示を維持。
- 1152の顧客一覧の編集ボタンが隠れる問題を修正。運用者一覧では狭い表の送る時間を隠して名前の幅を確保。名前や説明は省略表示し、titleで確認できる。作成・編集の補助欄は板が1100未満で畳み、開いてテスト操作を使える。
- 保存・送信・権限・再読込などの動きの試験は削除していない。既存の題の構造の確認を共通PageHeadingへ更新し、欄の検証と補助欄の開閉の試験を追加した。

## 土台・競合の処理

- 枝：`codex/kenta-v8-s-lnot-10090054`。
- 列車2 `origin/codex/kenta-train-2-10082334` をfetchしてmerge（既に取り込み済み）。rebase・stash・forceは未使用。
- テストの前の本線：`5545d30ef51f8a43623a7ed4475a1a5dacedf029` を取り込み。
- 引き継いだ差分を控えた上で本線を取り込み、3wayで戻した。`shared/tabs.module.css` の1箇所の競合は、本線の警告件数の札と、通知用のタブ寸法を両方保持して解決した。他の本線の変更も保持。

## 検査

- doctor（DOCTOR_LOCAL=1）：合格。
- 型検査：合格。共有パッケージのdistが古かったので共有パッケージとLINE SDKを再ビルドしてから検査した。
- 機能・入口・触った共通部品・型：37ファイル221試験合格。追加の最終レイアウト・CSS直書き予算の5ファイル20試験も合格（上の試験との重複を含む）。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build`：合格（既存の警告あり）。
- `pnpm --filter web verify:design`：456項目一致、不一致0、合格。
- CSS直書きの予算：増加0。基準ファイルを変更していない。
- 最終の8枚×1152・1440・1920：24通り、ページ・表の横のはみ出し・右端越え0。
- `git diff --check`：合格。
- 検査ログ・幅の撮影・再開用の差分の控えは、無視対象の `.measure/` に残す。見かけ上クリーンにするための削除はしない。

## コードのコミット

- `6f04f623ac` 共通部品の受け口。
- `0499fe9e84` 運用者の作成・編集。
- `cdd9486b76` LINE通知の一覧・失敗・記録。
- `3147452ae9` 通知の共通タブ。
- 撮影データとこの報告を次のコミットに含める。最終HEADは完了報告で伝える。

## 変更ファイル

- `apps/web/src/components/shared/data-table.module.css`
- `apps/web/src/components/shared/form-controls.module.css`
- `apps/web/src/components/shared/form-controls.tsx`
- `apps/web/src/components/shared/form-section.module.css`
- `apps/web/src/components/shared/form-section.tsx`
- `apps/web/src/components/shared/kpi-card.module.css`
- `apps/web/src/components/shared/kpi-card.tsx`
- `apps/web/src/components/shared/select.tsx`
- `apps/web/src/components/shared/table.tsx`
- `apps/web/src/components/shared/tabs.module.css`
- `apps/web/src/components/shared/tabs.tsx`
- `apps/web/src/components/templates/detail-columns.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/v8/line-notifications/operator-edit.module.css`
- `apps/web/src/v8/line-notifications/operator-edit.test.tsx`
- `apps/web/src/v8/line-notifications/operator-edit.tsx`
- `apps/web/src/v8/notifications/list.module.css`
- `apps/web/src/v8/notifications/list.tsx`
- `apps/web/src/v8/settings/line-notifications/operator-tab.tsx`
- `apps/web/src/v8/settings/line-notifications/runs-tab.tsx`
- `apps/web/src/v8/settings/line-notifications/screen.module.css`
- `apps/web/src/v8/settings/line-notifications/screen.tsx`
- `apps/web/src/v8/settings/line-notifications/toggle-account-switch.test.tsx`
- `scripts/visual-qa/fixtures.mjs`
- `scripts/visual-qa/lnot-design-map.mjs`
- `scripts/visual-qa/lnot-handoff-2026-10-09.md`（この報告）
