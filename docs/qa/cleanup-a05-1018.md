# A05 OpenAPI分割の検査記録（2026-10-18）

対象はB02・LONG-FILESのA05。実装は `codex/kenta-train-cleanup-a05-1018`、指定土台 `f2c496cdf534e735bfaeb5cf93643629600e6c11`。開始前doctorはLOCALで合格、開始時・製品コミット直前直後はclean。検査前にfetchした本線 `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` は指定土台に包含済み。親ECは変更していない。

## 変更と同一性

`apps/worker/src/routes/openapi.ts` を9,420行から39行の公開入口へ整理し、metadata/spec・schema・順序付き登録・49個の機能別定義へ分離した。新規TypeScriptは52モジュール、最大524行。既存36モジュールの公開exportと内容は不変。path item全体を後勝ちで置き換える既存の登録順も保った。実ハンドラ・middleware・DB・Web APIクライアント・画面は変更0。未参照のauditstepsPaths importを1件除去した（副作用なしの定義モジュール自体は保持）。その未登録を新規登録へ読み替えず、現行のcoverage負債と応答を保持した。

| 測定（OpenAPI製品TS、試験を除く） | 前 | 後 |
|---|---:|---:|
| ファイル数 | 36 | 88 |
| 総行数 | 11,201 | 11,457 |
| 最大ファイル行数 | 9,420 | 611 |
| any型のASTノード数 | 2 | 2 |
| path / operation / named schema | 853 / 1,010 / 29 | 同じ |
| Worker実行時importの既存循環成分 | 9 | 9（新規0、OpenAPI内0） |

分割前後を同じ要求で呼び、JSONの867,677 UTF-8 bytesと説明ページHTMLが全バイト一致した。path/methodの順序、schema名、required、security、応答、$refを含む。JSON SHA256は `9d5ea341148b651dffa22985cbe9110b6f60f0b5d167e4a5dfa8643aa63364fb`、docs HTMLは `3e7c02927ab68ee64847e73e73da1d7f1a924a30882f82a9b5ce0d329d3a9f1f`。旧528個のpath記述と移動先を対応表に記録した。

## 直接検査

製品コミット `1afe99a9106e4dabc737e5fd00484d1b38584d9c`。Node22.23.3 / pnpm9.15.4 / TZ=UTCで実行した。

- 既存 `openapi-coverage.test.ts`・`chats-combined-openapi-contract.test.ts`・`restaurant-customer-openapi.test.ts`：3ファイル17件成功。
- Worker型検査・Workerビルド：成功。
- 操作欠落、method違い、required除去、壊れた参照、認証表示除去、応答欠落の故障を一時注入し、6種とも既存のAssertionで失敗。復元後17件と全バイト一致を再確認した。
- 既存試験の削除・移動・改名・書換えは0。新しい固定文字/行数ゲート・上限変更・許可一覧の追加は0。

初回はNode26で導入したbetter-sqlite3のABI147がNode22のABI127と合わず、pretest依存buildで停止した（試験本体未開始）。Node22で `pnpm --filter worker rebuild better-sqlite3` を行い、メモリDBの読取りでABI127/SQLite3.53.2を確認して同じ検査を再実行した。製品コード・依存定義・lockfile・検査条件の変更はない。失敗ログも保存した。

## 全体ci-local

同じ製品SHAとbaseで、指定の `~/lh-work/tools/hq/ci-local/run.sh /Users/kentakenta/lh-work/lh-cl-a05` を実行した。GitHub repositoryの公開変数を読み取り、必要4変数が未設定と確認できたため同じ空値を明示した。PR情報や速度検査の条件を捏造していない。

| 検査 | 結果 |
|---|---|
| Worker | 全1,108ファイル13,169件・型・build成功 |
| 管理画面 | 全2,305ファイル13,679件・lint・型・通常build成功（既存skip/todo各1） |
| DB / scripts / 共有 / LIFF | 2,327 / 1,048（既存skip1） / 387×2TZ / 531件成功、scripts・LIFF型成功 |
| 更新エンジン / CLI / SDK / MCP / 文書 | 161 / 52 / 53 / 68 / 6件成功、MCP型/build成功 |
| 実ブラウザ | Webhook・LIFF入口/SDK/ヘッダー・メディア権限・EC切替・LINE通知・保管タグ編集・MFA・認証・フォーム成功 |
| V8 | 1152/1440/1920の基本36条件で崩れ0、状態別201条件で新規/許可/既存の崩れ0（比較元の検出2件をA05の修正実績にしない） |
| V8の対照・操作 | 故障対照79件、入力保持、待機/マウス、予約preview、一覧132条件/読み込み93条件、仮想表の選択/キー操作が成功 |
| 速度 | 11場面×5回を測定完了。目標超過0、stress/PERF-01/Train17成功。下記の配信量警告1件は未解決 |

初回の全体実行は、V8のhead/base build・サーバー起動までは成功し、step10中に一時場所が消失した。共有の `tmp-guard.log` に日本時間15:14「消した ci-local-d6h70kho」を確認した。初回は失敗14行（step10の重複を含む）/実行不能2、終了2のまま保存し、合格に書き換えていない。

未完のV8 jobだけを同じSHA・base・workflow・Node・公開変数で再実行した。自分の一時場所のmtimeを30秒ごとに更新して使用中とし、`--keep` で証拠を保持した。掃除ツール/プロセス・試験・上限・許可一覧は変更していない。V8再実行は失敗0・実行不能1、終了2（正式PR題名がない履歴照合のみ）。画面の実測値・JSON・故障対照を保存した。

初回の非V8成功結果とV8再実行を独立に照合すると、成功80工程・省略31工程（usesの手元準備・条件付き成果物等を含む）、実行不能は正式PR情報の1件。実測したjob結果を入力にCIの集約本文を無変更で実行し、changes=unsupportedのため終了1となった。**正式required-pr-gateは未通過**。PRを作らない指示のため、採番後の照合は司令塔へ渡す。これは生ログを置き換える合格報告ではない。

速度の未解決警告：dashboardのjsBytesは3,713,011B、上限3,710,688B、超過2,323B。既存の報告モードではコマンドが成功するが、予算内とは扱わない。A05と指定土台でWeb・共有・更新エンジン・速度検査・workflow・lockfile/依存定義のgit入力が同一と確認した。A04/画面担当/司令塔へ数値を引き継ぎ、所有外の製品コードや上限を変更しない。

初回の生ログは `~/lh-work/tools/hq/ci-local/logs/20261018-093103-1afe99a910-25327/`、V8再実行は `20261018-131635-1afe99a910-78181/`。外部A05証拠の `ci-original/`・`ci-v8-retry/`・`ci-reconciled.json`・`ci-temp-deletion.json`・`v8-results/` に結果と数値も複写した。

## 見送った差分と次の担当

A07 `16fffff59d`（後の引継ぎ最終版 `ab065b6fb5`）とA08 `c5335e1f39`（後の記録版 `98f304ab04`）のhandler変更は指定土台に未包含。待機中にも更新された引継ぎとAPI-CONTRACTを再読し、最終版のコミットも指定土台へ未包含と照合した。実装のない契約を先にJSONへ載せず、司令塔の統合後に同じhandler版で次を同期する。

- A07：予約通知/同期の結果不明409、支払開始の不明/期限切れ409、LIFF支払照合のunknown/action_required、Google接続解除不明503、イベント/Meetのcheckpoint。
- A08：本人用5GETのLINE access token Bearer化、private/no-store/no-referrer、identity新規受付停止、公開Webhook応答のeligible/安全なjoin_urlへの限定。現在未記載の5口は、handler統合後に具体的な定義を足し、既存coverage負債を減らす。許可一覧は増やさない。

具体的なpath・分割後の反映先・関連試験・持ち主は司令塔の `CLEANUP-1017/A05-HANDOFF.md` に記録した。今回の新API/DB追加/マイグレーション/番号案は不要。既存の別領域の循環9件は担当範囲外で保持。B02はUI撮影不要、UIやPenの合格実績を今回の成果として数えない。

push・PR・本番/検証DB更新・配備・実送信・実決済・外部サービスへの書込みは行っていない。#0000の反映履歴を追加した。CIの履歴検査本文を無変更で使い、利用者指定の仮番号0000・空の題名/本文（skip印なし）で行った独立書式確認は成功した。正式なPR採番とゲート照合は司令塔の工程であり、この書式確認で代替しない。

## 証拠の場所

`~/lh-work/design/v8/review/CLEANUP-1017/A05-EVIDENCE/` にbefore/after JSON・docs、parity/counts/public-exports/path-moves/cycles、直接検査・故障対照・復元ログ、Node ABI失敗/修復ログを保存した。`DONE-A05.tsv` は前後の数・ファイルと試験の対応・見張り・見送りの4記録。API契約の入口は `review/API-CONTRACT-A05.md`。

この記録は検査後の文書だけの追加。検査した製品SHAからのコード・依存・workflow・反映履歴の入力を変更していないことを最終コミット後にgit treeで照合し、最後のSHAとclean状態は外部HANDOFFへ記録する。
