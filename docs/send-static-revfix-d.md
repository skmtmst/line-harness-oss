# 送信の修正 revfix-d（2026-10-11）

対象: SEND-S01〜SEND-S04。元の静的報告は読み取りのみ。
Doctor: DOCTOR_LOCAL=1、合格。開始時のLINE作業ツリー・親ECツリーはクリーン。
試験前に取り込んだ origin/codex/development: `d0d00a1b274087d3fbae50a15c552b998619d2e4`。
人工SQLiteと偽LINEだけで再現。全試験は外部fetch/ソケットを遮断し、Vitest最大4・workspace直列。
push・PR・D1・配備・本物のLINE/メール/決済は実施しない。

## 指摘ごとの再現と修正

| ID | 落ちる試験での再現 | 修正 | 新しい見張り |
| --- | --- | --- | --- |
| SEND-S01 | タグ/絞り込み160人の初回150人後にタグ除外＋追加。期待160人に対し159人（統括158人）、未送信が飛び追加者が入る。統括の子配信でも再現。重複除外の途中再開・完了後再試行も対象変動 | 既存宛先台帳へ開始時IDを一括保存。位置でなく未送信IDで続ける。重複除外は当選者snapshotを既存進捗JSONに保存し完了後も保持 | broadcast-audience-resume: 12件。タグ・絞り込み・一時失敗retry・統括・重複除外再開・完了後retry・通常タグの再開/中断・台帳喪失/旧進捗保留 |
| SEND-S02 | LINE受理直後にDB batchを失敗させてプロセス消失。5分回復で受理数が期待1回に対して2回。予定変更でも鍵が変わる。24h超過の予約チャット/automationも再送 | 共通送信台帳を送信前に保存。実行・友だち・固定版の通・開始時刻の固定UUID。24h超過はunknown＋自動送信停止。予約チャットとautomationにも拒否関門 | scenario-interrupted-send: 3件、予約チャット24h: 1件、共通台帳24h: 1件、automation24h: 1件、リマインダ試し送りunknown/24h: 2件 |
| SEND-S03 | 遅延返信をclaimedで放置。次tickの送信が期待1回に対して0回、claimedのまま残る。送信開始後・旧行の消失も再現 | 共通送信台帳をlease＋開始印に再利用。期限切れの送信前だけpendingへ戻す。開始済み/旧行はunknownとして要確認で残し再送しない | 遅延返信の送信前/開始後/旧行/設定変更: 4件、実行一覧の要確認表示: 1件 |
| SEND-S04 | 即時と遅延で返信受理＋動作1件失敗、once判定がtrueになる | 部分失敗でhitを作らない。受理済み返信がある次の一致はpartial_failure_requires_retry。既存の失敗動作だけを再試行する操作で完了後に消化 | auto-reply-partial-once: 2件（即時・遅延）。失敗動作だけが3回目に呼ばれ、返信は1回だけ。実行一覧の保留理由: 1件 |

仲間の範囲: 一斉配信・シナリオ・リマインダ・自動応答・友だち追加・統括・予約通知の7系統をすべて点検。下表は呼出し箇所（行）単位の総当たり（同じ実装へ合流する呼出しも含む）。追加指定された手動即時/複合、不一致応答、リッチメニュー、カルーセル、フォーム、運用者、集計、EC、試し送りも列挙。

赤の実行記録: `/tmp/revfixd-s01-red.log`、`/tmp/revfixd-s02-red.log`、`/tmp/revfixd-s03-red.log`、`/tmp/revfixd-s04-red.log`。修正前コードで期待と異なる結果を確認してから修正した。追加境界も同様に赤→修正→緑で確認（inline、重複除外の再試行、予定変更、旧台帳、遅延設定変更、結果表示）。

## 総当たり

3列の「在る／無い／分からない」は**防止策・回復策・不明の保持策の存在**であり、障害が起きたという判定ではない。在るでも全条件の安全を保証しない。今回の再現試験は上の範囲。その他はコードを読んだだけ。
「送り漏れ回復策」は中断後の回収・未完の続行、「不明結果保持策」は届いたか不明な状態を消さず保持する仕組み。期限超過を含めた保証が読めないものは注記し、無条件再送へ変えない。
詳細の全呼出し・コード位置: [send-static-revfix-d-paths.tsv](send-static-revfix-d-paths.tsv)。

| 経路 | 呼出し箇所数 | 二重送信防止策 | 送り漏れ回復策 | 不明結果保持策 | 読んで確かめた範囲・限界 |
| --- | ---: | --- | --- | --- | --- |
| 予約／確定・変更・取消・リマインダ | 1 | 在る | 在る | 分からない | 呼出元が固定retry_key・recipient・messagesを保存。予約リマインダには貸出回収あり。24h超過の不明停止は当該wrapperでは確認できず |
| 予約／ヒアリング結果 | 1 | 無い | 分からない | 無い | 直送push、失敗はログ。専用再試行台帳は確認できず。未再現 |
| EC／試し送り | 3 | 在る | 分からない | 分からない | 操作ごとrandomUUIDをproxyへ。同一依頼再送は別の鍵になる。未再現 |
| フォーム／回答後の効果 | 2 | 在る | 在る | 分からない | 効果別checkpoint＋親から渡す固定suffix鍵。送信はformsのproxy呼出へ。期限超過は未実証 |
| 予約／Meet前日・1時間前 | 1 | 在る | 在る | 分からない | row.id固定キー、日時・本人・版の再確認。例外はfailedで再試行。24h超過のunknown保持は確認できず。未再現 |
| 運用者／共通通知 | 1 | 在る | 在る | 分からない | 宛先別台帳・固定retryKey・lease・応答不明をunknown表示。長期停止後のキー期限超過拒否は未実証 |
| リマインダ／試し送り | 1 | 在る | 分からない | 在る | 共通送信行・固定キー。予約結果unknown/failed/in_progressをLINE送信前に拒否。unknown/24h超過の2試験あり |
| 自動応答／即時 | 1 | 在る | 分からない | 分からない | 受信イベント評価claimと1回限りのreplyToken。部分失敗は未消化、既受理返信を抑止、失敗動作のみ手動再試行。S04実証あり。返信受理直後のプロセス消失は未実証 |
| 一斉配信／試し送り | 1 | 分からない | 分からない | 分からない | テスト宛先限定の直接push。本送信はbroadcastサービスへ。試し送り受理喪失は未実証 |
| 手動チャット／即時・複合 | 2 | 在る | 分からない | 在る | 依頼UUID＋payload hash、送信台帳、既受理再生、不明を409で保持。in_progressの長期中断回収は未実証 |
| 一斉配信 | 5 | 在る | 在る | 在る | 台帳の開始時IDを固定。未送信IDで継続・一時失敗のみ再試行。全員送信はLINE側宛先選定。S01実証あり 通常タグも全宛先固定。旧配信で宛先写しが無い場合は要確認で停止。 |
| 紹介／運用者への知らせ | 2 | 分からない | 分からない | 無い | 成果承認は任意retryKey、従来追加通知は鍵なし。例外は非ブロック。未再現 |
| 一斉配信／重複除外 | 2 | 在る | 在る | 在る | 当選者snapshot＋既送ID＋送達台帳。完了後も保持。S01実証あり。旧配信で宛先写しが無い場合は要確認で停止。 |
| EC／ペット登録・写真審査通知 | 2 | 在る | 分からない | 分からない | 審査はdecisionId、ペット案内はrandomUUID。proxy転送のみ。親判断行の中断回復は未実証 |
| 運用者／異常通知 | 1 | 在る | 在る | 無い | 宛先別outbox・10分lease・row.id固定キー。送達不明をfailedへ戻す。24h超過停止なし。未再現 |
| 予約／ウェビナー待ち行列 | 2 | 在る | 在る | 分からない | 固定line_retry_key・claim lease・retry_wait。試し送りはrandomUUID。LINE受理喪失の24h超過は未実証 |
| イベント予約／通知 | 1 | 在る | 在る | 在る | リマインダ主経路はworkflow lease・固定キー・23h超過delivery_unknown。直接呼出しのretryKeyは任意。個別枝は未実証 |
| 友だち追加／試し送り | 1 | 在る | 分からない | 分からない | 操作者限定、10秒監査claim・依頼キー。長期中断unknown扱いは未実証 |
| 旧絞り込み（呼出し無し） | 1 | 無い | 無い | 無い | multicast鍵・宛先台帳無し。現在はimportだけで呼出しなし。現行入口はbroadcast queue。未再現 |
| EC／顧客通知 | 1 | 在る | 在る | 在る | workflow固定入力・固定キー・lease・23h超過delivery_unknown。共通通知台帳も残す |
| リマインダ／定期 | 1 | 在る | 在る | 在る | 確定版・対象・本文・lease・固定UUID。holdExpiredLineRetryRunsが24h超過をdelivery_unknownへ。今回は既存試験の全体検証 |
| 予約・EC／顧客通知再試行・試し送り | 3 | 在る | 在る | 在る | 宛先別台帳・固定キー・retry claim・応答不明をprovider_response_unknown。長期停止後のキー期限超過は未実証 |
| シナリオ／定期 | 1 | 在る | 在る | 在る | 開始時刻を含む実行・友だち・通の固定UUID。共通送信行を先に保存。24h超過・文面衝突は停止。S02実証あり |
| ポイント／調整通知 | 1 | 在る | 分からない | 在る | 通知行を先に予約し固定キー。数値HTTP無しはdelivery_unknownとして残す。中断回収は未実証 |
| 統括／運用者への知らせ | 1 | 分からない | 分からない | 無い | 親announcementをclaim、運用者ごとは鍵なしpush。宛先のclaim/不明状態は確認できず。未再現 |
| 予約／重複の運用通知 | 1 | 在る | 在る | 無い | account_settingsに固定キーとclaim、5分回収。最初の送信からの24h制限・unknown状態は確認できず。未再現 |
| シナリオ／試し送り | 1 | 無い | 分からない | 無い | 固定キー無しpush。公開版とテスト宛先確認あり。繰返しは新しい操作、依頼再送は未実証 |
| 手動チャット／予約 | 1 | 在る | 在る | 在る | 期限順claim・lease・固定キー。既存行と共通台帳の24h超過を拒否。S02仲間試験あり |
| 友だち／試し送り | 1 | 在る | 分からない | 在る | 依頼UUID＋共通送信行、unknown拒否。途中中断の手動確認は未実証 |
| 運用者／旧outbox通知 | 1 | 分からない | 無い | 無い | outbox行をclaimして複数運用者へ鍵なしpush。途中失敗は行全体failed。対象外SEND-S05、未再現 |
| 集計／定期レポート | 1 | 分からない | 在る | 無い | レポートrunのclaimと2h回収、運用者ごとのpushは鍵なし。未再現 |
| あいさつ／フォームの案内 | 2 | 無い | 分からない | 無い | 認証後・案内APIのpushに固定キー・専用送信台帳なし。未再現 |
| リッチメニュー／タップ | 3 | 分からない | 分からない | 無い | reply例外で無条件pushへ切替。push鍵・専用unknown記録なし。親のイベント台帳はあるが受理喪失は未実証 |
| シナリオ／即時1通目 | 2 | 在る | 在る | 分からない | enrollment claim。replyToken・push keyは呼出元次第。友だち追加ではunknownSendPolicy=stop。通常呼出しの長期回復は未実証 |
| カルーセル／制限返信 | 1 | 在る | 分からない | 分からない | replyToken、押下台帳、後続動作はautomation。制限返信の受理中断は未実証 |
| EC／NENキャンペーン | 1 | 在る | 在る | 分からない | job.idとretry_generationキー、processing claim回収。unknownの長期再送停止は未実証。履歴二重書込候補は対象外SEND-S06 |
| 友だち追加／あいさつ・紹介・クーポン等 | 9 | 在る | 在る | 在る | 追加配信はfriend claim・lease・dispatch印・generation fence・用途別固定UUID、前回不明なら送らない。通常の返事・紹介通知の直送分岐は別途未実証 |
| 予約／ウェビナー後の案内 | 1 | 在る | 在る | 在る | workflowに宛先・本文・キーを固定、lease・23h超過unknown保持 |
| 予約／ウェビナー受付・開始前 | 2 | 在る | 在る | 分からない | 開始前はreg.id固定キー、受付は任意キー既定randomUUID。送信後に通知済み保存。期限超過のunknownは未実証 |
| 統括／試し送り | 1 | 無い | 分からない | 無い | 固定キー無しpush。統括の本送信は各店のbroadcast待ち行列を使う。HQ本送信S01実証あり |
| 旧動作／send_message | 3 | 在る | 分からない | 分からない | 通常pushは渡されたidempotencyKey。replyのtokenエラーfallback pushには鍵なし。現行automation経路と区別。未実証 |
| 予約／自動送信wrapper | 1 | 在る | 分からない | 分からない | 必須retryKeyをproxyへ渡す。台帳・回復・unknownは呼出元の責任 |
| オートメーション／send_message | 1 | 在る | 在る | 在る | 呼出元automation-engineは永続step.idを鍵に渡す。payload hash、lease、未知結果の拒否。24h超過試験あり |
| シナリオ／予約起点 | 1 | 在る | 在る | 分からない | 永続job鍵・lease・ログ照合。予定から24h超過はcancelled。送達不明を別表示できるか未実証 |
| 自動応答／不一致 | 1 | 在る | 分からない | 分からない | 親の評価claim＋replyToken、受理を先に固定。非受理例外はreply_failed。プロセス消失未実証 |
| 自動応答／遅延 | 2 | 在る | 在る | 在る | 60秒lease、送信開始印、所有者CAS。送信前なら回収、開始後はfailed＋要確認。S03/S04実証あり |
| リマインダ／来店スタンプ期限 | 1 | 在る | 在る | 在る | 通知台帳・lease・固定delivery.id・23h超過retry_window_elapsed停止 |
| シナリオ／質問の返事 | 4 | 在る | 在る | 分からない | 主経路はworkflow stepと返信前receipt。再開で返信は繰り返さない。補助sendReplyは鍵なしpush。未実証 |
| フォーム／回答後の通知 | 6 | 在る | 在る | 分からない | 回答claim・工程別checkpoint・安定した工程UUID。proxyはキーを転送するだけ。24h超過後の工程回復は未実証 |
| 共通／LINE互換proxy | 1 | 在る | 分からない | 分からない | 鍵をLINEへ転送、409受理済みを成功。独自の24h期限制限は無し。reply/narrowcastは履歴対象外 |

合計: 88呼出し箇所（行単位）、50区分。旧segment-sendは未使用1箇所として含める。共通proxyは1箇所でpush/reply/multicast/broadcast/narrowcastを転送する。

## 直さなかったものと制約

- 元の4指摘に未修正はない。再現しなかった仲間・別指摘SEND-S05/S06等は変更しない。静的なガード不足候補は総当たりの注記に残す。実際の二重送信・送り漏れとは断定しない。
- S04は最小構成。次の一致で自動的に動作を再実行せず、運用者が既存の「失敗した動作だけ再試行」を使う。成功した動作と受理済み返信は繰り返さない。再試行完了後に1人1回を消化する。
- シナリオの送信内容が中断後に変わってpayload hashが衝突した場合は要確認で止まる。受理済み内容を勝手に新本文で再送しない。
- S02の到達不明は購読APIの `pauseReason=delivery_unconfirmed` と既存 `/api/chats/outbound-failures` の `unknown` に残す。V8シナリオ一覧は現在この理由を「止まっている」、予定詳細は「画面からの停止」と表示するため、「届いたか不明・要確認」への表示対応は画面担当へ引き継ぐ必要がある。API・Workerの自動再送は停止済み。画面所有領域は変更していない。
- 24時間はLINEのretry key有効時間の境界（[LINE公式文書](https://developers.line.biz/ja/docs/messaging-api/retrying-api-request/)）。開始印の時刻を保存し、期限超過は不明扱い。LINEの409を新しい配信成功と取り違えず同じ要求の受理として扱う。
- 旧配信で全宛先の写しが残っていない場合、当時の相手は復元できない。対象を現在の条件で補わず、要確認で止める。新しい配信は最初から固定する。旧遅延返信のclaimed行は送信前後を証明できないため要確認へ倒す。
- 新しいmigrationは不要、案なし。既存のbroadcast_send_claims、dedup進捗JSON、outbound_send_requestsを使った。DB schema/migrationには変更なし。

## 修正のコミット

- S01: a692c2d02d、0ff7cfc61a、521046b369、7d1355d8c8
- S02: ab5f4f043d、37350450a3、a301072ad0、84d4736fbb（試験の型）
- S03: ee3a131316、f9100e91a4
- S04: 33e64d5351、57cd2046cc

## 検証

- 全workspace試験: 初回26,929件合格。追加境界の修正後は変更したWorkerを全件再実行し、11,083件合格（30件skip）。他workspaceはコード変更なし・合格を維持し、合計26,940件合格（31件skip・1件todo）。
- 最新の共同開発者の変更はworkflow・scripts・反映履歴のみ。取り込み後のscripts全試験: 104ファイル・937件合格。
- 全workspace型検査とscripts型検査: 合格。新規試験の型2箇所を修正後、全workspace型検査を再実行。
- 全workspaceビルド: 合格。既存のlint未使用/依存配列警告・大きいchunk警告は残る。ビルド後に追加の追跡済み変更/生成物なし。
- `git diff --check`: 合格。総当たりTSVの88コード位置を現在の実ファイルと照合し、ずれ0。
- API URL: `https://nen-line-stg.skmtmst.workers.dev`。試験は外部fetch/ソケット遮断、fake provider・人工SQLite。Vitest最大4、workspace直列。
- 実行ログ: `/tmp/revfixd-full-tests.log`、`/tmp/revfixd-worker-final.log`、`/tmp/revfixd-scripts-final.log`、`/tmp/revfixd-typecheck-final.log`、`/tmp/revfixd-script-typecheck-final.log`、`/tmp/revfixd-build-final.log`。
