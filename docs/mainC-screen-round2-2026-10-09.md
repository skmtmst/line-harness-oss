# mainC 画面レーン 2周目（2026-10-09）

測定担当 mainC。統合済み本線は `5545d30ef51f8a43623a7ed4475a1a5dacedf029`。67枚を再測定し、左右の画像を確認した。54枚が文字位置90%以上、13枚が90%未満。正式な見た目合格は司令塔の記録が必要であり、この報告では合格登録していない。

比較の証拠は `~/lh-work/design/v8/overlay/pages-mainC/<板>-delta.md` と `-impl.png` / `-design.png`。ツールがdeltaへ書く撮影SHA `9f55cb66b` は測定道具側のSHAで、実装の土台SHAではない。

## 全板の結果

| 板ID | 名前 | 直す前 | 直した後 | 左右で見比べた結果 |
|---|---|---:|---:|---|
| E7iAYs | ウェビナー ④通知 V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| LPOe7 | ウェビナー ②動画（日時指定・開催回）V8 | 75% | 92% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Omqd4 | ウェビナー コメント演出 V8 | 100% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Q0Jrk | ウェビナー ③CTA・フォーム V8 | 10% | 10% | 残：旧い手順・説明の配置 |
| UyUMw | ウェビナー 一覧 V8 | 99% | 99% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| VWNaA | ウェビナー ②動画 V8 | 11% | 11% | 残：旧い手順・説明の配置 |
| VXZ6T | ウェビナー アーカイブの確認 V8 | 99% | 99% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| XCUNf | ウェビナー ⑤確認 V8 | 9% | 9% | 残：旧い手順・説明の配置 |
| eAQ3t | ウェビナー 状態 V8 | 0% | 0% | 撮れない：複数状態を並べた見本 |
| j7PP04 | ウェビナー ①基本設定（作る）V8 | 100% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| jiNg0 | ウェビナー 一覧（閲覧のみ）V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| pvimJ | ウェビナー ③CTA・フォーム（競合）V8 | 10% | 10% | 残：旧い手順・説明の配置 |
| uBMuB | ウェビナー 一覧 1152 V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| uNsEy | ウェビナー 参加者 V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| z2dgw | ウェビナー 分析 V8 | 97% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| EsYo4 | テンプレート リサーチを作る V8 | 100% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| J60utH | テンプレート カルーセルを作る V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| L7zA7C | テンプレート 一覧（1152）V8 | 81% | 93% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| NCbYn | テンプレート 編集（競合）V8 | 97% | 94% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| S6FEuB | テンプレート クーポンを作る V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| UTbi1 | テンプレート 詳細（未公開の変更あり） V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| V6JFnd | テンプレート 削除（使っていない） V8 | 86% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Z0g3si | テンプレート 削除（使っている所がある） V8 | 97% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| a1k3d | テンプレート メッセージを作る（1152）V8 | 96% | 96% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| cuR8I | テンプレート 公開する（確かめ） V8 | 95% | 95% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| hEDTK | テンプレート 一覧（閲覧のみ）V8 | 89% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| l87p1J | テンプレート 質問を作る V8 | 92% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| susGP | ★V8 テンプレート 状態 | 0% | 0% | 撮れない：複数状態を並べた見本 |
| u5YC6 | テンプレート メッセージを作る V8 | 96% | 96% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| v19Ivv | テンプレート 一覧（メッセージ） V8 | 89% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| F4gELj | リッチメニュー 作る④ 公開 V8 | 41% | 94% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| JeINq | リッチメニュー 作る① 形と画像 V8 | 57% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| OxEMM | リッチメニュー 作る③ 誰に出すか V8 | 45% | 93% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Y9ASp | リッチメニュー 一覧（1152）V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Z0uO6 | リッチメニュー 作る② ボタンの動き V8 | 80% | 91% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| ZoKow | リッチメニュー 一覧（閲覧のみ）V8 | 96% | 96% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| f3SoAm | ★V8 リッチメニュー 状態 | 0% | 0% | 撮れない：複数状態を並べた見本 |
| hKr8f | リッチメニュー 公開した（公開の進み） V8 | 100% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| kmTab | リッチメニュー 作る②（1152）V8 | 80% | 93% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| r8dGXT | リッチメニュー 編集（競合）V8 | 66% | 91% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| rZEGN | リッチメニュー 一覧 V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| wxIQ7 | リッチメニュー 切替のつながり V8 | 73% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| yOyCg | リッチメニュー 削除できない理由 V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| GVizd | 回答フォーム アーカイブ・削除 V8 | 99% | 99% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| GrnO4 | 回答フォーム 一覧（1152）V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| I3L41O | 回答フォーム 一覧 V8 | 99% | 99% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| ITBAB | 回答フォーム 編集（1152）V8 | 6% | 65% | 残：古い4列と新しい5列 |
| J1pdB | 回答フォーム 編集（競合）V8 | 1% | 68% | 残：古い4列と新しい5列 |
| JV2oR | 回答フォーム 一覧（閲覧のみ）V8 | 99% | 99% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| MKQyJ | 回答フォーム 集まった回答（1件ずつ） V8 | 95% | 95% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| XXFT4 | 回答フォーム 編集（答え終わったあと） V8 | 10% | 90% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Z9wXm | 回答フォーム この版を公開（確かめ） V8 | 17% | 84% | 残：古い4列と新しい5列 |
| i2ZAS | ★V8 回答フォーム 状態 | 0% | 0% | 撮れない：複数状態を並べた見本 |
| ijxur | 回答フォーム 編集（予約を入れるブロック） V8 | 5% | 74% | 残：古い4列と新しい5列 |
| tpRRT | 回答フォーム 編集（受付と見た目） V8 | 8% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| v0SbYR | 回答フォーム 集まった回答（まとめて見る） V8 | 100% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| AYc6O | 共通情報 編集（変える前に影響を見る） V8 | 88% | 94% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| C67dE | 共通情報 編集（1152）V8 | 87% | 100% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| FM94M | 共通情報 一覧 V8 | 97% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| Hhl9M | 共通情報 止めるダイアログ V8 | 89% | 97% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| O7hUt7 | 登録メディア一覧 V8 | 94% | 94% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| OxSw8 | 共通情報 一覧（閲覧のみ）V8 | 96% | 96% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| RqO7O | ★V8 共通情報 状態 | 0% | 0% | 撮れない：複数状態を並べた見本 |
| XIzkJ | 共通情報 一覧（1152）V8 | 96% | 96% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| p82v9 | 共通情報 作る V8 | 63% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| piWhz | 共通情報 編集（競合）V8 | 83% | 94% | TSV位置一致／残：比較HTMLの本文位置・行高差 |
| xxKtW | 共通情報 削除ダイアログ V8 | 98% | 98% | TSV位置一致／残：比較HTMLの本文位置・行高差 |

## 90%未満で残った板と理由

- Q0Jrk・VWNaA・XCUNf・pvimJ：古い板は題y80→手順y121→説明y148。最新の指示は説明y116。最新の頭と旧い手順の骨格を同時に満たせない。
- ITBAB・J1pdB・Z9wXm・ijxur：古い4列（メールと電話を一緒）と、10月8日の5列（別々）が混在する。現行の5列と実際の入力を残した。差は約61px。
- eAQ3t・susGP・f3SoAm・i2ZAS・RqO7O：空・読込・失敗などを同じ板に並べた見本。ひとつのURLの画面として全体を撮影できない。実際のエラー状態・再試行を弱めていない。

## 絵どうしの食い違い

座標TSVと比較HTMLの本文が一致しない。例：E7iAYs「通知とリマインド」はTSVと実装がy237、HTMLはy273。j7PP04「基本設定」も同じ36px差がある。一覧は比較HTMLの行高も異なる。90%以上の板も、左右画像全体のOKとは扱わない。司令塔で比較HTMLとTSVを同じ版にそろえてから再確認する。

## 共通部品の代表板

| 板 | 測定前 | 測定後 | 結果 |
|---|---:|---:|---|
| WQmep | 46% | 46% | 既存の位置差から変化なし |
| x6QsVz | 98% | 98% | 既存の位置差から変化なし |
| I1E7Bt | 99% | 99% | 既存の位置差から変化なし |
| LRc93 | 5% | 5% | 既存の位置差から変化なし |

共通の型の頭は最新の題・説明の指示へ合わせ、フォームのタブ後の間隔・ダイアログの見出し間隔は任意のpropを追加した。これらのpropを渡さない画面の既定値を保った。入力中も赤枠が消えないよう共通入力の枠を確認した。追加のラベルは共通LabelPillを使い、別担当のタグ・対応状況の札には手を入れていない。

## 画面と動作

- 5機能の入口をV8だけにした。使われていないV7の画面本体と旧い見た目の契約を撤去した。
- 保存・権限・入力保持・失敗と再試行・公開予約・冪等性の試験はV8の操作へ移した。
- テスト更新で見つかった公開予定の破棄漏れ、フォーム名の空欄検査、未来の工程へ移ったときの入力保持、編集の空の使用先表示も直した。使用先が0件の案内はプレビューの後ろに出し、「届き方」の位置を保った。
- 登録だけのリッチメニューを読み込んだとき、勝手に全員の既定へ変更しないよう元の設定を保つ。
- 動画名は登録メディアの実名を取得し、読めない場合は「設定済みの動画」。保存先のキーを名前として表示しない。旧い動画名の試験は実際のV8部品を確認する。
- 共通情報の送信済みだけの使用先では、保存・削除でこれから文が変わると誤表示しない。
- 入力の誤りは欄の赤枠と理由1行、最初の欄へのfocus・中央スクロール。通信・競合の失敗は帯へ出す。

## 測定用データ

wxIQ7の測定URLだけを担当内のmapで接続確認用に変えた。公開中のリッチメニューと、接続が欠ける領域をAPIの実際の形で用意した。実データのdraft状態は変えていない。登録画像の認証付き取得口に画像を返し、アカウント照合と見つからない場合の404を残した。

## APIが要るもの

フォームの受付開始日時は保存する口がないため「公開したときから」と表示する。意味の違う値で埋めていない。この作業ではAPI・DB・Workerを変更していない。

## 本線取り込み時の競合

列車4までの本線をmergeした。列車4は競合なし。列車2取り込みでは、リッチメニューのLayoutPickerと再開処理、ダイアログの連続配置、型のフォルダ配置を保って解消した。対象はcreate-v8.tsx・create-v8.module.css・create-shapeの試験・dialog.module.css・page-templates.module.css。rebase・stashは使っていない。

## 撤去した試験

V7の表示分岐、旧い検索帯や横幅、古い板IDと文字位置だけを固定した試験を撤去した。rich-menu-dirty-guardの旧い公開確認窓・ラジオ注記・日時注記の3群は、V7にしかない形の固定だったため撤去し、現行の公開の影響・完了・保存・予約・入力保持の試験を残した。publish-step-v8-reactの2件は撤去済みの未使用PublishStepの見た目だけを見ていたため撤去した。予約の冪等性4件は実際のuseScheduleSubmitへ移した。空になったrich-menus/edit/design-words-contract.test.ts（旧い注記の形を固定する群）も撤去した。

## 検証と引き継ぎ

検証土台は `5545d30ef51f8a43623a7ed4475a1a5dacedf029`（最終fetchでも変化なし）。型検査・最終build・差分検査は合格。verify:design は456/456一致。対象404ファイルの全体テストは2477件通過・4件失敗・1件スキップ。失敗した回答の後処理テストに、列車4で追加された役割確認のownerデータを補った。再試験はその5件と動画名・削除判定を含め32/32通過。全体と再試験を合わせて2481件通過・0件失敗・1件既存スキップ。対象を絞った契約・動作187件も通過した。撮影サーバーmainCは停止済み。push・PR・DB更新・配備は実施していない。PR番号がないため、司令塔が採番後にリリース履歴のファイルを作る。更新履歴の文案：「担当画面の文字位置と入力の誤りの知らせをV8にそろえた @kenta #PR番号 YYYY-MM-DD HH:MM（日本時間）」。

## 変更ファイル

- `apps/web/design/design-impact-baseline.txt`
- `apps/web/src/app/contents/contents-v6-contract.test.ts`
- `apps/web/src/app/contents/file-scan-banner.test.tsx`
- `apps/web/src/app/contents/folders-contract.test.ts`
- `apps/web/src/app/contents/media-archive-react.test.tsx`
- `apps/web/src/app/contents/media-delete-contract.test.ts`
- `apps/web/src/app/contents/media-detail-unverified-react.test.tsx`
- `apps/web/src/app/contents/media-detail-url-react.test.tsx`
- `apps/web/src/app/contents/media-empty-filter-contract.test.ts`
- `apps/web/src/app/contents/media-list-v8-contract.test.tsx`
- `apps/web/src/app/contents/media-load-failure-react.test.tsx`
- `apps/web/src/app/contents/media-picker-react.test.tsx`
- `apps/web/src/app/contents/media-replacement-partial-react.test.tsx`
- `apps/web/src/app/contents/media-replacement-search-react.test.tsx`
- `apps/web/src/app/contents/media-search-row-contract.test.ts`
- `apps/web/src/app/contents/media-terms-versions-react.test.tsx`
- `apps/web/src/app/contents/media-version-compat-react.test.tsx`
- `apps/web/src/app/contents/page.tsx`
- `apps/web/src/app/contents/vars/change-impact.test.ts`
- `apps/web/src/app/contents/vars/common-vars-audit-544-contract.test.ts`
- `apps/web/src/app/contents/vars/common-vars-delete-confirm-contract.test.ts`
- `apps/web/src/app/contents/vars/common-vars-v6-contract.test.ts`
- `apps/web/src/app/contents/vars/copy-key-react.test.tsx`
- `apps/web/src/app/contents/vars/delete-impact.test.ts`
- `apps/web/src/app/contents/vars/delete-screen-contract.test.ts`
- `apps/web/src/app/contents/vars/edit/page.load-sections.test.tsx`
- `apps/web/src/app/contents/vars/edit/page.redisplay.test.tsx`
- `apps/web/src/app/contents/vars/edit/page.schedule.test.tsx`
- `apps/web/src/app/contents/vars/edit/page.tsx`
- `apps/web/src/app/contents/vars/export-panel-react.test.tsx`
- `apps/web/src/app/contents/vars/list-v8-board-numbers-contract.test.ts`
- `apps/web/src/app/contents/vars/list-v8-parity.react.test.tsx`
- `apps/web/src/app/contents/vars/list-v8.react.test.tsx`
- `apps/web/src/app/contents/vars/list-v8.tsx`
- `apps/web/src/app/contents/vars/new/page.behavior.test.tsx`
- `apps/web/src/app/contents/vars/new/page.load-failure.test.tsx`
- `apps/web/src/app/contents/vars/new/page.test.ts`
- `apps/web/src/app/contents/vars/new/page.tsx`
- `apps/web/src/app/contents/vars/page.tsx`
- `apps/web/src/app/contents/vars/vars-load-failure-react.test.tsx`
- `apps/web/src/app/contents/vars/vars-overflow-contract.test.ts`
- `apps/web/src/app/form-submissions/edit/form-design-settings.dead-ui.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-design-settings.editing.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-edit-unsaved-guard.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-name-blur.react.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-og-image-url.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-preview-proof.test.tsx`
- `apps/web/src/app/form-submissions/edit/form-publish-flow-contract.test.ts`
- `apps/web/src/app/form-submissions/edit/form-save-failure-m00x.test.tsx`
- `apps/web/src/app/form-submissions/edit/page.tsx`
- `apps/web/src/app/form-submissions/edit/save-conflict-tabs.test.tsx`
- `apps/web/src/app/form-submissions/form-boards-f11.test.ts`
- `apps/web/src/app/form-submissions/form-boards-nodes.test.ts`
- `apps/web/src/app/form-submissions/page-duplicate.test.tsx`
- `apps/web/src/app/form-submissions/page-folder.test.tsx`
- `apps/web/src/app/form-submissions/page-load-errors.test.tsx`
- `apps/web/src/app/form-submissions/page-monthly-counts.test.tsx`
- `apps/web/src/app/form-submissions/page.review.test.tsx`
- `apps/web/src/app/form-submissions/responses/page.tsx`
- `apps/web/src/app/form-submissions/responses/responses-failure-m00x.test.tsx`
- `apps/web/src/app/form-submissions/responses/responses-search-contract.test.tsx`
- `apps/web/src/app/form-submissions/responses/responses-v8.test.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/rich-menus/connections/connections-v8-react.test.tsx`
- `apps/web/src/app/rich-menus/connections/page.tsx`
- `apps/web/src/app/rich-menus/connections/rich-menu-connections-contract.test.ts`
- `apps/web/src/app/rich-menus/delete-impact-contract.test.ts`
- `apps/web/src/app/rich-menus/edit/design-words-contract.test.ts`
- `apps/web/src/app/rich-menus/edit/page.tsx`
- `apps/web/src/app/rich-menus/edit/prepublish-check-section.react.test.tsx`
- `apps/web/src/app/rich-menus/edit/publish-history-react.test.tsx`
- `apps/web/src/app/rich-menus/edit/publish-progress-section.react.test.tsx`
- `apps/web/src/app/rich-menus/edit/publish-step-v8-react.test.tsx`
- `apps/web/src/app/rich-menus/edit/rich-menu-edit-v7-contract.test.ts`
- `apps/web/src/app/rich-menus/edit/schedule-idempotency-react.test.tsx`
- `apps/web/src/app/rich-menus/new/create-account-scope-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-area-list-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-f4gELj-sections.test.ts`
- `apps/web/src/app/rich-menus/new/create-order-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-publish-check-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-shape-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-v8.module.css`
- `apps/web/src/app/rich-menus/new/create-v8.tsx`
- `apps/web/src/app/rich-menus/new/page.tsx`
- `apps/web/src/app/rich-menus/new/rich-menu-load-failure-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-preview-bottom-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-tag-account-scope.test.tsx`
- `apps/web/src/app/rich-menus/new/rich-menu-template-account-scope-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-template-account-scope.test.tsx`
- `apps/web/src/app/rich-menus/page.tsx`
- `apps/web/src/app/rich-menus/rich-menu-delete-confirm-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-dirty-guard.test.tsx`
- `apps/web/src/app/rich-menus/rich-menu-empty-filtered-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-external-import-viewport-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-kpi-react.test.tsx`
- `apps/web/src/app/rich-menus/rich-menu-light-578-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-list-paging-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-ops-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-safe-errors-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-search-row-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menu-v8-flow.test.tsx`
- `apps/web/src/app/rich-menus/rich-menu-v8-tap-fallback.react.test.tsx`
- `apps/web/src/app/rich-menus/rich-menu-write-flows-contract.test.ts`
- `apps/web/src/app/rich-menus/rich-menus-row-actions.react.test.tsx`
- `apps/web/src/app/rich-menus/rich-menus-v6-contract.test.ts`
- `apps/web/src/app/templates/broadcast-template-flow.test.ts`
- `apps/web/src/app/templates/carousel/page.limit-guidance.test.tsx`
- `apps/web/src/app/templates/carousel/page.save-retry.test.tsx`
- `apps/web/src/app/templates/carousel/page.tsx`
- `apps/web/src/app/templates/carousel/page.unsaved-guard.test.tsx`
- `apps/web/src/app/templates/detail/page.tsx`
- `apps/web/src/app/templates/detail/template-detail-delete-confirm-contract.test.ts`
- `apps/web/src/app/templates/detail/template-detail-shape.test.tsx`
- `apps/web/src/app/templates/detail/template-versions-820.test.tsx`
- `apps/web/src/app/templates/edit/page.mount.test.tsx`
- `apps/web/src/app/templates/edit/page.tsx`
- `apps/web/src/app/templates/edit/test-dom.ts`
- `apps/web/src/app/templates/list-readonly-band.react.test.tsx`
- `apps/web/src/app/templates/list-v8-date-col-contract.test.ts`
- `apps/web/src/app/templates/page.tsx`
- `apps/web/src/app/templates/question-template-contract.test.ts`
- `apps/web/src/app/templates/questions/new/page.tsx`
- `apps/web/src/app/templates/questions/new/question-save-500-contract.test.ts`
- `apps/web/src/app/templates/questions/new/question-unsaved-react.test.tsx`
- `apps/web/src/app/templates/staff-gate.test.tsx`
- `apps/web/src/app/templates/template-asset-save.test.tsx`
- `apps/web/src/app/templates/template-boards-nodes.test.ts`
- `apps/web/src/app/templates/template-button-contract.test.ts`
- `apps/web/src/app/templates/template-create-board-1152.react.test.tsx`
- `apps/web/src/app/templates/template-delete-confirm-contract.test.ts`
- `apps/web/src/app/templates/template-drawer-close-contract.test.ts`
- `apps/web/src/app/templates/template-folder-contract.test.ts`
- `apps/web/src/app/templates/template-folder-count-refresh.test.tsx`
- `apps/web/src/app/templates/template-folder-scope-react.test.tsx`
- `apps/web/src/app/templates/template-media-picker-react.test.tsx`
- `apps/web/src/app/templates/template-question-tab-r135.test.tsx`
- `apps/web/src/app/templates/template-search.test.tsx`
- `apps/web/src/app/templates/template-v6-layout-contract.test.ts`
- `apps/web/src/app/templates/template-v8-flow.test.tsx`
- `apps/web/src/app/templates/template-words-contract.test.ts`
- `apps/web/src/app/templates/templates-console-error.test.tsx`
- `apps/web/src/app/templates/templates-list-state-contract.test.ts`
- `apps/web/src/app/templates/templates-mid-contract.test.ts`
- `apps/web/src/app/templates/templates-row-keyboard.test.tsx`
- `apps/web/src/app/templates/usage-destinations.test.tsx`
- `apps/web/src/app/webinars/button-accessible-names.test.tsx`
- `apps/web/src/app/webinars/edit/edit-extras-nav.react.test.tsx`
- `apps/web/src/app/webinars/edit/page.tsx`
- `apps/web/src/app/webinars/edit/webinar-analytics-lazy-contract.test.ts`
- `apps/web/src/app/webinars/edit/webinar-edit-failure-recovery-contract.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-edit-load-failure-react.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-participants-classification-react.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-participants-role-react.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-public-preview-contract.test.ts`
- `apps/web/src/app/webinars/edit/webinar-registration-form-contract.test.ts`
- `apps/web/src/app/webinars/edit/webinar-single-fetch-contract.test.ts`
- `apps/web/src/app/webinars/edit/webinar-unsaved-flow-react.test.tsx`
- `apps/web/src/app/webinars/list-v8-board-numbers-contract.test.ts`
- `apps/web/src/app/webinars/new/page.tsx`
- `apps/web/src/app/webinars/new/page.unsaved-guard.test.tsx`
- `apps/web/src/app/webinars/new/webinar-new-blur.react.test.tsx`
- `apps/web/src/app/webinars/new/webinar-new-pane-react.test.tsx`
- `apps/web/src/app/webinars/new/webinar-new-save-failure-react.test.tsx`
- `apps/web/src/app/webinars/page.tsx`
- `apps/web/src/app/webinars/published/page.tsx`
- `apps/web/src/app/webinars/published/published-permission-react.test.tsx`
- `apps/web/src/app/webinars/webinar-list-behavior.test.tsx`
- `apps/web/src/app/webinars/webinar-list-state-contract.test.ts`
- `apps/web/src/app/webinars/webinar-list-v8.react.test.tsx`
- `apps/web/src/app/webinars/webinars-row-actions.react.test.tsx`
- `apps/web/src/app/webinars/webinars-v6-contract.test.ts`
- `apps/web/src/components/shared/button-migration-contract.test.ts`
- `apps/web/src/components/shared/dialog.module.css`
- `apps/web/src/components/shared/dialog.tsx`
- `apps/web/src/components/shared/folder-panel-heading-contract.test.ts`
- `apps/web/src/components/shared/folder-rail-owner-contract.test.ts`
- `apps/web/src/components/shared/insert-text-field.module.css`
- `apps/web/src/components/shared/label-pill.module.css`
- `apps/web/src/components/shared/label-pill.tsx`
- `apps/web/src/components/shared/sticky-bar-contract.test.ts`
- `apps/web/src/components/templates/create-page.tsx`
- `apps/web/src/components/templates/page-templates-head-contract.test.ts`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/components/templates/steps.test.tsx`
- `apps/web/src/components/templates/steps.tsx`
- `apps/web/src/lib/design-impact.test.ts`
- `apps/web/src/lib/screen-css-budget-baseline.json`
- `apps/web/src/lib/use-field-validation.test.tsx`
- `apps/web/src/lib/use-field-validation.ts`
- `apps/web/src/v8/common-vars-edit/edit.tsx`
- `apps/web/src/v8/common-vars-edit/new.tsx`
- `apps/web/src/v8/common-vars/list.tsx`
- `apps/web/src/v8/form-edit/appearance-tab.tsx`
- `apps/web/src/v8/form-edit/edit.tsx`
- `apps/web/src/v8/rich-menus/connections.tsx`
- `apps/web/src/v8/template-detail/detail.tsx`
- `apps/web/src/v8/template-edit/asset.tsx`
- `apps/web/src/v8/template-edit/message.tsx`
- `apps/web/src/v8/template-edit/rich.tsx`
- `apps/web/src/v8/templates/carousel.tsx`
- `apps/web/src/v8/templates/list.module.css`
- `apps/web/src/v8/templates/list.test.tsx`
- `apps/web/src/v8/templates/list.tsx`
- `apps/web/src/v8/templates/question-new.module.css`
- `apps/web/src/v8/templates/question-new.tsx`
- `apps/web/src/v8/webinar-edit/basic.tsx`
- `apps/web/src/v8/webinar-edit/chrome.tsx`
- `apps/web/src/v8/webinar-edit/cta.tsx`
- `apps/web/src/v8/webinar-edit/edit.test.tsx`
- `apps/web/src/v8/webinar-edit/new.tsx`
- `apps/web/src/v8/webinar-edit/notifications.tsx`
- `apps/web/src/v8/webinar-edit/video-media-label.tsx`
- `apps/web/src/v8/webinar-edit/video.tsx`
- `docs/mainC-screen-round2-2026-10-09.md`
- `scripts/visual-qa/fixtures.mjs`
- `scripts/visual-qa/mock-api.mjs`

## 実装コミット

- `afbf986da13e8dfef15eea45b3cc094976a0b278` 共通: V8の題・手順・入力の誤りの表示をそろえる
- `be2596a3dfda7c6ce7aa43187740164aaf8fd371` ウェビナー: V8へ一本化し入力保持と動画名の確認を残す
- `520a3f32cbd58370b446c088fa1cf7547bdb24b7` テンプレート: V8の文字位置と利用先の案内をそろえる
- `6051f43fcdf559b055d72675797a8ae834bfa6a3` リッチメニュー: V8へ一本化し公開予定と選択候補を保つ
- `40b7a127477ec3ee3dcc66b0df18d7563f2b7bd7` 回答フォーム: V8へ一本化し入力の誤りと後処理の確認を残す
- `09ac8b157a33cfb9a24d72c5c863fd7db2fc2cb4` コンテンツ: V8へ一本化し共通情報の確認と失敗時の操作を残す
