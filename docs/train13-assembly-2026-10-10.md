# 列車13 組立記録（全枝取り込み・検証完了）

- 作業場所：`~/lh-work/lh-train-13`
- 専用ブランチ：`codex/kenta-train-13-1010`
- 土台：`origin/codex/development` = `53f4b6f7e3e58d5e38f8e06fb8d71a60c4dd88e3`
- 開始前 doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` の最終行「合格」。開始時のLINE・親EC作業ツリーはクリーン。
- 依存の固定版インストールと共有パッケージのビルドを実施。
- push・PR作成・D1更新・配備は未実施。

## 取り込み

各枝を順番に merge commit で取り込んだ。各コミット前に `git diff --cached --check` と worker・web の型検査が合格。

| 順番 | 枝（すべて `codex/` 配下） | merge commit |
| --- | --- | --- |
| 1 | kenta-v8-look-10091725 | aa1bea2b1437956d7c290b8e75e1fd1719d435be |
| 2 | kenta-v8-rules2-10092230 | 3e0ff179282bc05bab37c471dae77d7e8cd44b19 |
| 3 | kenta-v8-behavior-10092130 | 090f4fe2f7ca94e600d70a0a85033c2c89d24d30 |
| 4 | kenta-bugfix-parity-10092300 | a53ffcdbd7b5208630d9889374168ac46b74db10 |
| 5 | kenta-parity-b173-10092330 | d0daff1fa09d021f31e6eef93e4adad9285b7339 |
| 6 | kenta-form-docs-1010 | fc2742626a9dd18a45359fd5e3512f035a63cb53 |
| 7 | kenta-qa-tooling-1010 | c09506b5091ed240a23c6ac6255aabbbf8f108f5 |
| 8 | kenta-liffword-10092330 | 9b25371d620f016936e393007a987f042e198024 |
| 9 | kenta-tapextra-10092230 | fa5da1325b5e7a1f90c5a0c996afb4d078de15bb |
| 10 | kenta-hqfeat-10092330 | 47c1aefc182335b90aad656b01803b12e1f1e7bc |
| 11 | kenta-form-fixed-1010 | cd4436a684d52ba927c6c9642e4dd04a5f0dfefa |
| 12 | kenta-coupon-qr-1010 | 7d286a6b0df8f1b685cd558fa99910494931005d |
| 13 | kenta-map-restaurant-1010 | 674fb3a3c3bbf53d7fb0aaede666e96836679935 |

## 停止した枝

なし。前回止めたliffwordは、2026-10-10の司令塔判断（B-173⑦）で解決した。

## 競合解消

- ウェビナーはWorkerの共通本体（申込み・視聴・回答）を残し、LIFFの頭・読み込み・エラー再試行・ボタン・コメント入力と文字数表示を移した。旧URLも同じ本体を使う。従来の別画面は使わない。両枝の試験を共通本体へ向けた。
- リサーチはB-173①のLIFF回答を維持し、選択肢のタグ付け・加点は回答保存後に実行する。複数選択と同じ回答の再送で二重加点しないことをHTTP試験で確認した。
- HQの動画・音声、保存後の移動、V8共通入力・追加処理の検査を併合した。
- 固定の友だち情報を先に使い、メモはB-173⑤の受信箱へ保存する。住所・予約・添付書類の回答処理を残した。
- クーポンQRは受取時の内容を固定し、使用確認・使用後の処理と再送時の二重加点防止を両立した。
- 地図の2コミットを、最後に設計図の付け替えとして取り込んだ。

## 全検証で見つけた修正

- 新しく入れた添付書類とクーポン受取記録を、退会後の削除対象に登録した。書類の保存先の実体も削除対象へ登録した。古いHQマイグレーションの試験用DBに、現在のヘルパーが読む622の列を足した。
- 自動化の編集窓・条件の窓は入力を親の下書きに保つため、閉じる際に破棄と誤判定しないようにした。タグを選ぶブラウザ試験は現在の共通部品へ合わせた。チェックの飾りがクリックを遮らないようにした。保存中のボタンは「処理中…」として連打防止を確かめる。
- 写真詳細の権限エラー後の再試行を、画面の読み直し処理へ再接続した。
- フォームのリンク設定は親のフォームへ即時反映されるため、閉じる際に破棄と誤判定しないようにした。保存・再読み込みで3欄が残る実ブラウザ検査が合格。
- Webhookの未保存入力を閉じるブラウザ試験は、入力の破棄確認を操作してからアカウントを切り替える。
- 旧カード影の別名・数と単位の空白・旧顧客情報欄を固定する試験を、現在のV8共通部品・固定情報へ合わせた。公開版の選択肢・再送・権限・保存・再試行の動きの確認は残した。
- 空の人数と日時は共通の空欄処理を使う。ウェビナー申込画面の頭が幅を縮めないようにした。
- CIのEC権限案内、保管したタグの一覧切替、フォーム一覧の共通Select操作を現在の部品へ合わせた。保存・権限・API送信の検査は維持した。
- 設計値検査はCSS最適化によるrgba/hexの表記差と変数の別名を解く。数の帯はV8の帯用セレクタを照合し、B-149・B-153（corrections.md）の黒7%・影なしを確認する。旧カードの値との誤比較を直し、色・透明度の差と別状態の混入を検出する試験を足した。
- シナリオ詳細の補足行が題と同じ段で幅を奪い、題が4pxまで潰れていた。詳細の型で補足行を下段へ配置した。共通の頭・シナリオ・リマインダ・配信詳細の38件を再検証し、シナリオ詳細を3幅のはみ出し検査へ追加した。
- 見出しの全文検査はB-152⑩の「題・説明文は折り返してよい」に合わせた。全文が切れずに折り返す題は許可し、省略する題の全文の手掛かり・横や縦の切れ・22/700/32の文字の段は引き続き検査する。13画面の旧条件による失敗を解消するため、正常・切れ・全文なし・寸法違いの回帰試験を足した。

## 最終検証

最新コードのコミット：`21e7e4e52470a5c389442629f021a4c7b11352ad`。全枝取り込み後に全試験を行い、見つけた修正は別コミットにした。修正後は対象試験・型検査・ビルドを再実行した。

| 検査 | 最終結果 |
| --- | --- |
| Worker全試験 | 913ファイル、10,772件合格、30件skip |
| Web全試験 | 2,078ファイル、12,099件合格、1件skip、1件todo。通常2,077ファイルと、開発サーバーを使う自動化1ファイル・8件を分けて逐次実行 |
| DB全試験 | 374ファイル、2,239件合格 |
| 共有型の全試験 | 29ファイル、336件合格。Asia/Bangkokでも合格 |
| LIFF全試験 | 61ファイル、393件合格 |
| `pnpm test:scripts --maxWorkers=2` | 94ファイル、847件合格 |
| Worker・Web・共有型・LIFFの型検査 | 合格 |
| `pnpm typecheck:scripts`（`tsc -p scripts/tsconfig.json`） | 合格 |
| Worker・LIFFのビルド | 合格 |
| `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --filter web build` | 合格。フォームのリンク設定・詳細の頭の修正後も再ビルドして合格 |
| マイグレーション安全検査・bootstrap検査 | 合格 |
| `pnpm --filter web verify:design` | 450項目一致、不一致0。書式・比較対象の修正後も再ビルド成果物で合格 |

CIと同じ実ブラウザ命令（すべて逐次実行、終了後にブラウザ・自分が起動したサーバーを停止）：

| 命令 | 最終結果 |
| --- | --- |
| `pnpm exec playwright test --config apps/web/src/app/webhooks/webhook-runtime.config.mjs` | 両幅16件合格 |
| `pnpm exec playwright test --config apps/web/src/app/contents/contents-permission-behavior.config.mjs` | 6件合格 |
| `pnpm exec playwright test --config apps/web/src/app/ec-commerce/ec-commerce-issue-685.config.mjs` | 6件合格 |
| `node apps/web/src/app/line-notifications/line-notifications-browser-behavior.mjs` | 合格。375〜1920幅、保存中の追加入力・店舗切替・遅延応答を確認 |
| `pnpm exec playwright test --config apps/web/src/components/friend-fields/tag-archived-edit.config.mjs` | 4件合格 |
| `node apps/web/src/app/form-submissions/form-submissions-browser-behavior.mjs` | 合格。並び・ページ・店舗切替・権限・3タブの409入力保持・リンク設定・保存失敗後の再試行・公開と再読込を確認 |
| `node apps/web/scripts/v8-guard/layout-overflow.mjs http://127.0.0.1:4310 /tmp/train13-v8-guard/layout.json` | シナリオ詳細を含む12経路×3幅×2設定の72状態、崩れ0。V8固定のため旧設定値でもV8表示 |
| `node scripts/visual-qa/title-audit.mjs http://127.0.0.1:4310 /tmp/train13-v8-guard/title-audit.tsv` | 179画面、22/700/32と全文の検査が合格。不一致・測定失敗0 |

画面の見張り用には、CIと同じ `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true pnpm --filter web build` も合格。モックAPIと静的配信へ接続し、実環境のデータは使っていない。

- 型・試験・ビルドの成功は★V8の絵との90%合格を示すものではない。Pencilとの重ね合わせ計測・PASSED.tsvへの記入は未実施。
- ビルドは成功しているが、既存の未使用変数・Hook依存などのLint警告は残る。
- CIのv7画素比較・速さ予算は参考チェック。この作業では必須の実挙動・はみ出し・題の検査を行う。

## マイグレーションと反映履歴

- 取得した `origin/codex/development` と公開中PRすべての変更パスを確認し、620〜624番の重複はなかった。一時的に取得に失敗したPRの差分も再取得して確認した。
- 620〜624番をすべて取り込んだ。番号変更・DB適用はしていない。
- `docs/release-log/unreleased/0000-kenta-train13.md` に取り込み済みの変更を記録した。`#0000` は司令塔の採番後に置換する。
- 続行時にも最新の開発ブランチと公開中PRを確認した。最終試験前に再取得した開発SHAは `53f4b6f7e3e58d5e38f8e06fb8d71a60c4dd88e3` のまま。

## 完了状態

- 2026-10-10 04:29（日本時間）：全13枝の取り込み、試験で見つけた修正、反映履歴とこの記録の更新を完了。
- 修正は内容別に6コミット（退会後の削除対象、入力保持と単体試験、Webhook実挙動、フォームと設計値、見出し検査、詳細の頭）。最後に反映履歴・組立記録を文書コミットへまとめる。
- `git diff --check origin/codex/development...HEAD` と文書差分の検査が合格。LINE・親ECのクリーン確認を行う。
- 検査用サーバーとブラウザは停止済み。push・PR・D1更新・配備は未実施。
- 次は司令塔がコミットと記録を確認し、PR採番時に反映履歴の `#0000` とファイル名を置換する。
