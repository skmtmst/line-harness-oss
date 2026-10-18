# A08 整理段2の検査記録（2026-10-18）

指定土台 `92a53d4836df4650a1ca72bb994f8b4134b6d9c1`。検査前に取得した本線は `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9`（指定土台に包含）。製品の検査対象は `c5335e1f3940144eb2f3684f70d274808d4a9a9e`。実装・記録を内容別にコミットし、push・PR作成・DB変更・配備・実送信・決済・外部への書込みは実施なし。

## 変更と比較

- LONG一覧26本のうち、A08所有23本を意味ごとの110 moduleへ分割。route/middlewareの登録順と既存exportを保持。indexはcron3本へ分け、相対import解決後の構文token・順序・waitUntilは一致。follow本体も元と一致。新しい静的runtime循環0。Worker全体のESNext出力でも既存の循環9→9、新規0（型importを除去、test-utils除外で874→985本）。`full-worker-cycles.json` に保存。
- 比較対象のWorker変更・新設176ファイルは67,265行→69,283行（試験を含む）。Webの変更は契約試験10本だけ（1,210→1,218行）で、Web製品ファイルの変更0。非test source147本の型anyは6→0。Q02のcron any9は前束後の土台で既に0だったため、0を保って分割。Q04のHQ配布any6を明示型へ置換し、SQL/snapshot/D1 batchは維持。
- F07は通知20件/tickの上限を維持し、LIFF設定の毎件SELECTをJOINへ移した。実Proxy＋履歴を含む20件のSQL322→302。0/20/21件、停止の3回の再照合・claim・送信後記録を維持。
- B-374は本人確認書類の新しい定義・アップロード・回答への再利用をAPIで拒否。既存公開設定・mixed欄も拒否。画像/PDFの容量・検査・所有者・別店の検査、過去書類の権限・保存期限・削除再試行は維持。
- セキュリティF01/F04は固定origin・公開HTTPS/DNS全回答の再検査・転送拒否・10秒/64KiB、保存済み認証情報のorigin束縛を追加。新規/過去のWebhook結果は公開に必要な資格判定と、有資格者の安全な参加URLだけに絞る。DBの保存履歴は保持。
- セキュリティF02は本人向け5GETのtokenをBearerへ移し、query tokenは400、private/no-store/no-referrer。F08は現在の店が稼働中・未保管で本人の店と一致することを確認。明示的な既定店の旧友だち互換性だけ維持。
- 再試行はA06の共通待機policy/Retry-After解析に接続。1/5/30分・既存の厳しい回数/期限は増やさない。長いRetry-Afterを短く切って送らず、既存の待機予算を超えた場合は理由を残して停止する。

## 維持した検査

Workerの変更した試験29本は `test-changes.tsv` に理由と旧口を記録。Webの契約試験10本も読込み先だけを変更し、全検査式のAST一致を確認。全体で既存の動作試験は削除・改名0。本人確認書類の旧アップロード成功試験は新規拒否へ変更し、過去書類は保存済みfixtureとして権限・期限削除を検査。画像/PDFについても所属/本人/版/ブロック/再利用の実際の防御を別途確認した。

分割前のファイルを読む契約試験は、実import/re-exportを辿って同じ機能の本体を読むよう修正した。既存の送信分類・許可一覧とQR呼出元4件は増やしていない。独立監査の入口は混ぜず、未importの同名接頭辞の送信元も未分類として失敗させる。新しい行数凍結・例外は追加していない。

A10から引き継いだPIN試験の偶発失敗は、部分文字列の拒否からNode cryptoによる独立したPBKDF2計算との一致へ修正した（14件成功）。実装・5回失敗・429・解除の検査は保持。

故障対照11種は全てAssertionErrorで検出し、復元後の試験を実施：F01 authority・F04 DNS・F02 query・F08停止店・B374新規受付・F07最終停止・未登録送信元・heartbeat欠落・URL編集時の認証origin・過去結果の再表示・前回回答の復元。

## 検査結果

| 検査 | 結果 |
|---|---|
| 開始前doctor | `DOCTOR_LOCAL=1` で合格 |
| Worker全体 | 1,110ファイル・13,202件、型検査、build成功 |
| Web修正後の全体 | 2,304ファイル・13,676件成功、既存skip/todo各1。lint・型・実ブラウザ成功 |
| DB / LIFF | DB396ファイル・2,309件、LIFF92ファイル・531件と型検査成功 |
| MCP / 文書サイト | SDK・MCPの型/試験/build、文書サイトの検査成功 |
| 製品buildとブラウザ | Worker/Webのbuild、LIFF入口/SDK/ヘッダー、メディア権限・EC切替・通知等のブラウザ検査成功 |
| V8の既存ガード | 1152/1440/1920幅で崩れ0、新規ルール違反0、行/読み込み表示/故障対照/入力保持/仮想表の選択・キーボード成功 |
| 速度 | 11場面×5回の中央値で全測定完了、予算超過0・目標超過0。共通予算/stress/PERF-01/Train17成功 |

全ci-localは112工程を最後まで実行し、成功79・省略31・失敗2、終了1。失敗は修正前のWeb契約試験20件と連動する集約1工程。**元の全体CIを合格へ書き換えない。** 修正後のWeb再検査は20工程で成功14・省略6・失敗0、終了2（正式PR情報不足1）。WorkerからWeb再検査まで製品コードは同一であり、差分証拠を保存した。正式PRは作らない指示のため採番できず、通常のPR照合は司令塔へ残す。指定された#0000の反映履歴は既存ゲート本文の独立実行で成功。採番後にファイル名と本文を実番号へ変更し通常ゲートを回す。

全体ログ：`~/lh-work/tools/hq/ci-local/logs/20261018-064757-c5335e1f39-17833/`。Web再検査ログ：同 `20261018-072622-f3d0d0c085-11244/`。Node22.23.3/pnpm9.15.4。GitHub repository variablesのGETでビルド用4変数が未設定と確認し、Actionsと同じ空値を手元に明示した（設定変更なし）。

```sh
~/lh-work/tools/hq/ci-local/run.sh /Users/kentakenta/lh-work/lh-cl-a08 --var VITE_LIFF_ID= --var VITE_BOT_BASIC_ID= --var VITE_CALENDAR_CONNECTION_ID= --var V8_SPEED_ENFORCEMENT=
~/lh-work/tools/hq/ci-local/run.sh /Users/kentakenta/lh-work/lh-cl-a08 --job web-checks --var VITE_LIFF_ID= --var VITE_BOT_BASIC_ID= --var VITE_CALENDAR_CONNECTION_ID= --var V8_SPEED_ENFORCEMENT=
```

修正後Webの検査SHAは `f3d0d0c085d3935ae3443ff6c7e72c663d808eb5`。c5335e1f39からWebの契約試験10本だけを修正し、製品コードは同一。元の全体CIで20件失敗した経緯を残し、Web全再検査2,304ファイル/13,676件成功（既存skip/todo各1）とlint・型検査の成功へ参照をつなぐ。`web-fix-product-equivalence.json` と `web-assert-parity.json` に差分と全検査式の一致を保存。

初回全Worker検査の24失敗は、分割先を読めない静的検査と公開DNSを模擬していないfixtureが原因。実装を読む経路とDNS模擬を修正し、修正した12本131件は成功。初回・中断した全体検査を最終合格へ数え直していない。

## 残した物と引き継ぎ

- U15とU18の送信/安全関数は動的参照・SQL副作用の役目が確定せず保持。未接続の機能をcronへ勝手に追加しない。
- F08画像40件の台帳を再生成。現役v2 JPEGは2500×1686の外部契約を維持。旧JPEG/PNGは公開済みURLの外部利用を否定できず保持。
- 所有除外3本は未変更：line-accountsはA02、restaurant-deliveryはA03、availabilityはA07。画面の製品ファイルは未変更。既存CIの1152/1440/1920崩れ0・全幅の新規ルール違反0を確認したが、Pencil照合や画面ごとの見た目の合格を主張しない。
- セキュリティF06はFromだけの照合が存在するが、メール基盤から渡る偽造できない認証結果・転送/SRS契約が未確定。任意のAuthentication-Resultsを信頼する修正はしない。司令塔/メール基盤担当の確定後に接続。本番拒否と隔離は保持。
- A06共通実行器の全adapter接続・全isolate共有遮断は未完。既存outboxにはstarted/unknown・固定policy・revisionの永続CASが不足。MemoryCircuitStoreで代用しない。shared circuit表と各job/outboxの状態/CAS移行はA06/A09/司令塔へ。新migrationは0、未予約の番号案727（取得時の本線最大726、公開PR最大565）。採番時に再確認が必要。
- U05は本人確認書類の選択肢を外す。U06はLIFFと旧Worker clientの本人向けGETをBearerへ同時変更すること。A05はOpenAPIのBearer・本人確認書類の書込み拒否/過去読取り・公開Webhook結果を更新すること。APIだけで顧客へ配備しない。POST/PUTの既存body認証は今回変更していない。
- A01からの旧スコア所属/元イベント不足はA09/司令塔の移行判断へ継続。推測で所属を付けず、既存の加点を一括停止しない。

証拠の正本は司令塔の作業場 `~/lh-work/design/v8/review/CLEANUP-1017/A08-EVIDENCE/`。移動表・構文/登録照合・行数/型数・画像台帳・故障ログを保存。APIごとの接続先は同階層 `A08-HANDOFF.md`、4種類の完了記録は `DONE-A08.tsv`。
