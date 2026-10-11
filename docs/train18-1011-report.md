# 列車18 組み立て・検査の記録（2026-10-11）

作業枝：`codex/kenta-train-18-1011`。開始前 doctor は合格。
本線：`45547aa0f245df7a2e4db5361010dd79b5bd0589`（列車17 #1690）。検査前と最終検査前に取得し直して同じSHAを確認。
証拠：`~/lh-work/design/v8/review/train18-1011/`。この作業はコミットまで。push・PR・D1更新・配備は実施しない。

## 取り込み

順に merge commit で取り込んだ。停止した枝はない。

| 枝 | merge commit |
|---|---|
| codex/kenta-mapregen2-1011 | 1a8b901b05 |
| codex/kenta-pendec2-1011 | c8f7987109 |
| codex/kenta-custlook-1011 | 2e69de95d8 |
| codex/kenta-rest3-1011 | b884adc07e |
| codex/kenta-del36b-1010 | 18562a7b0a |

顧客欄の「表示項目を編集」と差し込みの枠はpendec2を保持。アレルギー・表示項目の保存・統括で差し込める種類はcustlookを保持し、統括の差し込みをpendec2の共通枠へつないだ。年齢の日付計算も日本時間の共通関数へつないだ。飲食の予約書き込み契約と両枝のOpenAPI検査を保持。削除のbootstrapは採番順で再生成した。各枝の0000反映履歴は保持した。

## migration

追加は **630 → 631 → 634**。本線にある625〜629・633を含む順は625→626→627→628→629→630→631→633→634。632・635以降の追加なし。
`~/lh-work/design/v8/APPROVED-MIGRATIONS`で3番号の承認を確認。公開中37 PRの追加・変更ファイルをページ終端まで照合して重複なし。最終検査前にも再取得して確認（`open-pr-migrations.json` / `open-pr-migrations-final.json` / `open-pr-migration-changes-final.json`）。
634のtable-rebuild印、13表、件数・参照・制約・index・rollback・rowid・大量データの試験を含むDB全試験とmigration検査に合格。SQLはローカル試験だけで実行し、D1には適用していない。

## 原因を確認して直した試験

- Worker QRの1件：V8のQR小窓は共通QR小窓へ委譲済みなのに、試験の一覧が旧URL生成箇所として読んでいた。共通の生成箇所を検査し、サイズ上限と通信制約の検査は保持。単独18試験とWorker全試験で合格。
- LIFF来店QRの1件：新しい顧客画面設定の読み込み口が試験のAPIモックに無く、QR描画前に失敗した。モックを実契約に合わせ、LIFF全419試験で合格。
- 顧客詳細の2件：固定情報欄に増えた「編集」を対応状況の「編集」と取り違えていた。対応状況の区画からボタンを選び、保存・権限・同期の検査を保持。単独10試験で合格。
- 回答年齢：合流後の確認で、生年月日が無い人の回答年齢を一律に隠していたと気づいた。生年月日が見えるときは年齢を添え、それ以外は回答年齢を表示・編集できるように接続。8項目の表示設定も保持。追加した保存・非表示の試験を変更前に失敗させ、修正後に合格させた（age-panel-before.log / age-panel-after.log）。
- お客さまの画面のデザイン：題の検査で新画面だけ落ちた。画面確認用APIに新しい設定のGET応答が無く、既定の一覧の器を返していた。実契約の版とデザインの型を返す固定GETを追加し、PUTを許可しない契約試験を追加した（customer-look-mock-before.log / customer-look-mock-after.log）。
- 自動応答の期間1件：UTCでの全Web試験により、端末の現地日時で作った時計が日本では翌日になる期待値の誤りを再現した。時計を日本時間の絶対日時にし、UTC・Honoluluの日本時間00:09で7日・30日・月初の検索範囲を追加検査した。単独5試験で合格（auto-replies-utc-before.log / auto-replies-utc-after.log）。
- 設定メニューの1件：飲食機能を有効にして走らせると旧期待値が食い違った。本線でも単独で再現。無効時と有効時の両方を検査し、単独9試験で合格。

再現・修正後のログを証拠フォルダに保存した。Web全試験の最終結果とブラウザー検査は後述。

## 固定した絵との照合

10-11の固定HTMLと地図・設計値は戻していない。verify:designは503項目のうち478一致、25不一致、未実装0。前の25件から **25件（増減0）**。一時許可の25件すべてに理由・担当pendec・期限2026-10-17があり、未許可0。許可の中身は`scripts/visual-qa/train16-temporary-allowances.json`のdesign欄。
最終の検証環境向けWebビルドの後にも再実行して成功（design-delivery-final.log）。
持ち主の見張りは本線との差分で新しい候補0・今回使った一時許可0・未許可0。共通顧客欄・共通携帯枠・顧客情報railを持ち主として登録し、同じ名前の自作部品を通さない負の試験も合格。
これはPencilの文字位置90%以上の合格記録ではない。PASSED.tsvは変更していない。

## 全体の検査結果

| 検査 | 結果 | 証拠 |
|---|---|---|
| Worker全試験 | 929ファイル・10,988成功・30 skip | worker.log |
| Web全試験（修正後） | 2,130ファイル・12,443成功・1 skip・1 todo（UTC、修正後） | web-utc-final.log |
| DB全試験 | 376ファイル・2,249成功 | db.log |
| LIFF全試験（修正後） | 67ファイル・419成功 | liff-final.log |
| shared全試験（UTC） | 33ファイル・368成功 | shared-utc-final.log |
| scripts全試験 | 102ファイル・921成功 | scripts-final.log |
| SDK・LINE SDK・MCP・更新器・作成CLI・docsの試験 | 成功 | other-ci-tests.log |
| 全体の型検査・scripts tsc・Worker client tsc | 成功 | typecheck.log / scripts-tsc-final.log / client-tsc.log |
| 全体のビルド（指定staging API URL・飲食有効） | 成功（修正後Webも再構築） | build.log / staging-build-delivery-final.log |
| bootstrap再生成確認・migration検査・差分検査 | 成功 | bootstrap.log / migrations.log / diff.log |
| CI Playwright：Webhook | 16成功 | browser-webhook-final.log |
| CI Playwright：メディア権限・EC取込・保管タグ編集 | 6＋6＋4成功 | browser-media-final.log / browser-commerce-final.log / browser-tags-final.log |
| CIのLINE通知・フォーム保存ブラウザー検査 | 成功 | browser-line-final.log / browser-forms-final.log |
| 見張りの故障を入れる検査 | 19成功（画面、修正後）・12成功（速度） | guard-controls-corrected.log / speed-controls.log |
| 主要画面のはみ出し | 72状態、1152・1440・1920で0（修正後） | layout-final.json / overflow-final.log |
| 一覧の型 | 93状態・未許可0・既存許可6、10種類の対照も検出 | list-skeleton-final.json |
| 管理画面の題 | 183画面・不一致と測定失敗0 | title-audit-final.json |

日本時間00:09（2026-10-10T15:09Z）、月初の日本時間00:09を偽時計に設定し、UTC・Honoluluの端末で共通日付関数、Webの検索範囲・時刻、飲食の契約を検査して成功。UTCでshared全試験368、Web日付10、飲食23を再実行。年齢の共通関数への接続後にDBの固定項目4試験も再実行して成功。

詳細の見張りは198状態を完了、測定エラー0。残った失敗121件はpendec2入力枝の198状態の記録と種類・対象・文字・件数・寸法がすべて一致（新しい失敗0・悪化0）。入力枝の記録を証拠フォルダに複写し、`defects-pendec2-final-comparison.json`に修正後の比較を保存。

本線45547との比較では547→121件、442件解消・105件継続・16件持ち込み。16件はconversionsのカード12件・remindersのカード4件で、pendec2の入力時点の既知の検出と同じ。見張りの許可ファイルは変更せず、実際の終了1を`results.tsv`に残した。失敗した36経路・108状態を単独再実行し、121件すべての再現と入力時点との一致、測定エラー0を確認した（isolated-inherited-summary.json）。

一覧行の静的検査と実ブラウザー129状態・705行は合格、故障を入れる5種類の対照も検出。
一覧の型は93状態を測り、友だち・一斉配信・メディア・テンプレートのページ送り12件が失敗。B-217の件数左・送り先右への変更で内側の共通行が横に広がらず、外側のspace-betweenの中で左へ寄っていた。共通の型の単独の内側要素を伸ばし（メディアの説明を含む囲みも対象）、件数を含む共通ページ送りも幅を伸ばした。単独12件を修正後0にし、型の全93状態でも未許可0・既存許可6を確認（list-skeleton-final.json、故障7種類＋共通部品3種類の対照も検出）。列車17の93状態の記録は未許可0・既存許可6で、ページ送りの12件は今回取り込んだ共通の型の変更で発生した問題だった。画面ごとの上書きや見張りの緩和はしない。従来の飲食の予約盤6件の許可は変更しない。

4一覧を1152・1440で撮影した8枚と寸法をfooter-shots/に保存。友だち1440とメディア1152の画像を目で確認し、切れや重なりがないことを確認した。メディアのページ送りの位置はスクロール範囲を含む型の測定で検査している。

## 速さ

手元Macで固定の画面確認APIを使い、CIと同じ各画面5回の中央値・時間倍率1.30で測定。10画面と友だち2,000人の計11条件を完了。速度予算、2,000人の固定目標、PERF-01はすべて合格。基準表は変更せず、JSの基準更新許可は0。

最大：表示755ms・LCP184ms・反応66ms・長い処理0ms・JS 3,458,357 bytes（圧縮前）。友だち2,000人は表示239ms、初期描画13行、長い処理0ms。長い処理0msはブラウザーが通知する50ms以上を検出しなかった意味で、全処理が0msという意味ではない。GitHub Actions上や実APIでの測定ではない。

| 画面 | 表示ms | LCP ms | 反応ms | 長い処理ms | JS bytes |
|---|---:|---:|---:|---:|---:|
| dashboard | 755 | 136 | 66 | 0 | 3458357 |
| inbox | 693 | 124 | 65 | 0 | 1595444 |
| friends | 720 | 128 | 47 | 0 | 1952730 |
| broadcasts | 734 | 132 | 56 | 0 | 2078172 |
| broadcast-new | 715 | 184 | 66 | 0 | 1960720 |
| templates | 712 | 128 | 41 | 0 | 1692469 |
| booking | 683 | 132 | 33 | 0 | 1431530 |
| answers | 698 | 104 | 66 | 0 | 1936340 |
| tags | 713 | 128 | 66 | 0 | 1635986 |
| settings | 703 | 96 | 65 | 0 | 2910805 |
| friends-2000 | 239 | 124 | - | 0 | 1952730 |

証拠：speed-final.json / speed-final.log / stress-speed-final.log / perf3-final.log / speed-report-final.log。友だち2,000人の選択・キーボード・スクロール後の保持・切れの検査も成功（friends-table.log）。

## 引き継ぎ

修正のコミットは日付・試験の接続が`b619cd093d`、共通部品の接続が`25b4617fd0`。本線の最終取得でも`45547aa0f245df7a2e4db5361010dd79b5bd0589`のまま。開発サーバーとブラウザー検査は終了し、最終成果物は指定staging API URLで再構築した。

本線への統合とPR採番は司令塔の担当。各枝の反映履歴と列車18の反映履歴は#0000のまま保持した。D1更新・配備は行っていない。Pencilとの90%照合と本番反映を完了したという報告ではない。
