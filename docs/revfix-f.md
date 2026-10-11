# revfix-f の再現・修正記録

対象の静的報告は ec971ed6（列車19）で未再現だったもの。初回の受け持ち15件は人工SQLiteと偽の外部送信で再現し、14件を修正。IN-C02は2026-10-12の追加調査で既存の表からの安全な回収を実装し、入力不足の残りは要確認とした（[追加報告](inc02-recovery.md)）。実環境の動作確認ではない。本物のLINE・メール・決済・ECには送信せず、検証・本番DBも更新していない。画面・親リポジトリは未変更。

開始本線: d0d00a1b27。依頼されたrevfix-dの1aa2df55f6を先に取り込み、SEND-S01〜04の直しは重ねていない。初回全試験前: a23c6681300665bf22c3a5036a4e9e54c4f9d93c。最終全試験前に最新本線aba7e15838abccb4f8d1f8ab417139be66f420acを取り込み（統合コミット3db25ed677）。Worker最終再実行の前にd5deaebec39819a933b58179a9b0dd67c745e9baも取り込み（統合コミット8da1349480）。両更新は画面確認スクリプトと履歴で、今回の実装との競合なし。

仲間の全パスと数え方は [revfix-f-paths.tsv](revfix-f-paths.tsv)。「試験合格」は各段階の関連試験の件数で、最終全試験とは別。

| ID | 再現 | 修正 | 仲間の点検 | 見張り |
|---|---|---|---|---|
| R-IN01 | webhook-unsend.test.ts の保存後確定中断で2件失敗（マイル工程0回） | 受信保存とSQLの完了記録を同じ取引にし、同イベントでは元の保存結果を再利用 | webhook.ts 受信保存3・受信箱3経路（通常text/non-textを修正、停止契約は既存記録窓） | text/sticker、同ID再配達、完了後同ID、別イベント同message、取消先着 |
| R-FORM03 | 上限なしの既存4回答＋上限5＋2要求で2件確保し失敗 | 保存済み回答と確保枠をUNIONして条件付きINSERT内で数える | 全体/選択肢/その他の3種、取得表示2種、確保呼出1か所を照合 | 既存回答、試し除外、保存＋枠の重複、同ID再開、2要求（関連54試験合格） |
| R-FORM01 | 添付条件不成立で回答0・枠1を再現 | 未保存時の解放を回答/添付の取引へ入れ、再開時は枠を再確保 | 添付保存1か所、確保1か所、非添付は結果不明を保持 | 不成立解放・結果不明保持・添付競合・2接続（26試験合格） |
| R-FORM02 | 情報欄INSERT失敗＋メモ成功→再送で二重メモ | ブロック内のSQLと完了を同じ取引で記録 | 固定欄・任意欄・メモ・本名/表示名の4経路を共通の保存窓へ | 部分失敗再送・メモ確定後中断・完了後再送（関連54試験合格） |
| CS-C02 | 登録前の古いmetadata/欄で判定、一部登録失敗でも判定を再現（2件失敗） | 自動化を全登録後の工程へ移動、部分失敗を202＋未完・登録結果に残す。旧形式も成功済みSQLを再実行しない | submitと管理者retryの2入口、metadata/layout/legacyの3登録経路 | 全項目反映後・一部失敗抑止・再送成功・メモ重複なし（31試験合格） |
| CS-C01 | 同じ旧情報から同時下書きで片項目消失 | JSONの項目をUPDATE内で合流。管理者の版照合・項目削除、IG初回保持、最大サイズも維持 | 元の全文更新12経路（Meet旧受付補完を含む現在13）: forms2 / liff5 / Meet1 / event-bus1 / automation1 / friends2。全て同じ窓に変更、worker/db総検索で直接全文更新残り0 | 同時更新、特殊キー、null/配列/真偽、古い版・別account・サイズ拒否、初回保持（27試験合格） |
| IN-C01 | 新解除→旧追加、追加→旧解除の2方向を再現 | 出来事時刻を既存の最終追加/解除時刻と原子的比較。未登録の解除も記録 | 通常/停止の追加/解除4経路・作成補助5呼出・DB比較3文 | 2方向・未登録解除・古い追加の副作用抑止（webhook関連32試験。追加の発生時刻引数に合わせ旧試験を更新） |
| R-EC01 | A→B→Aで取消Bが確定Aへ戻り、versionも3になる失敗 | 処理済みは表示更新前に終了。注文の時刻比較と明細の最終event照合 | 表示更新の共通関数1か所・受付1入口・明細の削除/挿入2経路 | 注文状態・最終event・版・明細・処理済み通知重複（10試験合格） |
| R-EC02 | 表示保存が失敗した後、内部再試行が処理済みになっても注文0件を再現 | 共通の再処理工程で受信記録から表示を補完 | 受付・内部再試行の2入口、共通処理1か所 | SQL拒否→解除→再試行で注文/明細/処理済み確認（11試験合格） |
| IN-H01 | 停止中の通知1回と未照合の先行終了を2条件で再現 | 停止判定を通知と本人照合より前へ移動 | 受付/内部回収2入口、通知1・掲載閲覧1・注文後の案内停止1を点検 | 友だちあり/なしで通知0、停止状態を保存（関連13試験合格） |
| R-MEET01 | 結果未保存でも再送が完了扱い、通知失敗も200の2件を再現 | 受付と工程開始を同時保存、結果保存後に宛先ごとの送信記録を使う。未完は202、不明は自動再送しない | Meet受付1、結果保存1、通知1、旧受付だけの記録1を点検 | 結果保存拒否→再送補完、送信不明の抑止、署名/再送（4試験合格） |
| SEND-S05 | LINE/メールの2条件で成功済み宛先が2回になる失敗 | 宛先を固定し、宛先ごとの送信履歴で成功を除外。不明は保留。行の終了も取得した版で守る | 通知2チャネル・送信関数1・outbox書込4か所、宛先変更/追加/結果不明を点検 | 途中失敗・成功宛先除外・LINE既知拒否のみ再試行・メール不明保留・宛先/完了保存0件（最後の関連13試験合格） |
| supportメール（B-249） | IDなし重複2件と同時初回の会話2件を再現 | 送り主/件名/送信時刻/本文の指紋を既存の固有欄へ保存、初回会話のIDを顧客ごとに固定。保存と会話更新/履歴を同じ取引で守る | Workerメール・受信中継の2入口、保存1、会話検索2条件を点検 | 同時重複、別時刻は別メール、同時初回2通→1会話/2通、署名（10試験合格） |
| SEND-S06 | 3配信が履歴6件になる失敗 | 呼出元の追加記録を除き、中継だけで記録 | 中継2経路・NEN呼出元1・push呼出22か所を全件点検 | 人工中継＋SQLiteで3配信/3履歴、完了後再実行も3（関連11試験合格） |
| IN-C02 | 200応答→マイル工程失敗→管理者retryで期待200/実際409を再現 | 2026-10-12追加：受信箱と工程の記録から安全な未完分だけ回収。鍵/入力不足は理由つき要確認。新しい表なし | 管理者retryと内部回収の共通処理、LINE全種別とほかの受信入口を点検（追加報告参照） | マイル・スコア・タグ・通常postback・unfollow、重複なし、送信不明/取消/削除/所属/停止を人工DBで確認 |

再現は修正前に期待値と実際の違いを確認してから直した。追加点検で見つかった初回messageの時刻・旧JST比較・受信箱の巻き戻り・長いMeet結果・通知の不明表示も、失敗する試験から修正した。初回全試験の12件と、最終再検査で出た3件の失敗を隠さず、原因と修正を下に記録する。

メールの送信時刻はDateを使い、無ければReceived。両方無いメールは時刻なしで本文指紋を使うため、内容まで同一の別メールは区別できない。初回同時2通は顧客ごとの安定した会話IDと同一取引の保存でまとめ、新migration不要。

既存のEC内部回収の停止判定（ec-retry.ts）はそのままで合格。停止中の受付の通知順だけ修正した。旧Meet受付のみで工程記録が無いものは、結果だけ補い、通知は要確認とする。受付記録から送信済みとは推測しない。

## migration の案（初回報告。追加調査で更新）

2026-10-12追記：以下は初回時点の案。既存の受信箱と工程の記録から安全な未完工程だけ再開する実装を追加した。本文を新しい表に重ねず、返信の鍵・元の入力・送達の証拠が不足するものは要確認に残す。最新の回復工程・残り・保存案・試験結果は [IN-C02追加報告](inc02-recovery.md) を参照。画面への理由の表示は司令塔へ引き継ぐ。migrationは作成していない。

IN-C02を外部再配達なしで回復するには、200を返す**前**に再処理用データを確実に保存する必要がある。現状の工程記録にはevent種別と済んだSQLの結果だけで、処理前に止まった本文は復元できない。本文を汎用の工程JSONへ足す変更はしない。

案: アカウント＋event IDを固有キーとする専用の受信保存表。暗号化した必要最小限の入力、本文の指紋、鍵の版、受信/完了/保留状態、取得期限、失効時刻を持つ。受付と保存を一つの取引で確定してから200。内部retryは既存の工程別記録へ戻す。完了済みは再実行せず、送信不明・失効したreply tokenは自動再送しない。本文の保持期間・消去（取消/顧客削除を含む）・閲覧権限・replyの回復方法を先に正本で決め、採番ごとのオーナー承認を受ける。新migrationはまだ作らない。

ほかの14件は既存の表を使い、新migration不要。IN-C02は既修正扱いにも完了扱いにもしない。

IN-C01の仲間点検追加: 停止中の統括の初回followが処理時刻を保存し、後続unfollowを古いと判定する失敗も再現。初回作成に発生時刻を渡す。未割当friendの所属を決める際もfollow状態を勝手に1へ戻さない。追加試験1件が赤→緑（関連10件合格）。

R-IN01の仲間点検追加: 受信箱更新後の途中失敗→担当者が解決/返信→再配達で解決が未読へ戻り返信時刻が消える失敗を再現。text/non-textの受信箱更新2経路も原子的な工程記録へ入れた。追加1件が赤→緑、関連35件合格。停止契約の1経路は既存の同じ記録窓で保護される。

R-MEET01の追加点検: 受付上限内の長い結果（約130KB）が工程の入力記録上限で保存できないケースを赤→緑で確認。結果本体と工程完了を同じ取引へ入れ、別の入力コピーを作らない形に変更（関連23試験合格）。

IN-C01の全体試験からの追加: 初回message登録の時計が処理時刻になるケースと、時差なしの旧JSTをUTC扱いするケースが赤。作成補助の全5呼出に発生時刻を渡し、追加/解除3文の比較で旧JST・Z・+09:00を同じ瞬間に揃えた。並行送信の2試験は同一発生時刻を明示し、時刻順の試験と送信権競合の試験を混ぜない（実DB・独立2接続を含む68試験合格）。

SEND-S05/R-MEET01の見張り追加: 送信不明が単なる未完に見えるケースを2件の赤で確認。通知の失敗記録にunknownを明示し、Meetも要確認の応答と工程unknownを保存する。届いたか不明な状態を自動retry可能なfailedへ隠さない（8試験合格）。

CS-C02/R-FORM02の全体試験からの追加: 登録先なしの旧形式で不要な工程を作って未完になる赤を確認し、空の登録は工程を作らず完了するようにした。工程一覧の期待値へautomationを追加。本人限定の部分保存3試験は簡易DBから人工SQLiteへ置き換え、別人の情報を変えないこと・古い項目を保持すること・未定義キーを落とすことを実際の保存で確認。未構成の自動化は簡易DBでも0件を返す（87試験合格）。

## 見張りの試験の場所

| ID | 試験ファイル（apps/worker/src/から） |
|---|---|
| R-IN01 / IN-C01 / IN-C02 | routes/webhook-unsend.test.ts（人工DBと外部の偽物） |
| R-FORM03 / R-FORM01 | services/form-capacity-backfill.test.ts |
| R-FORM02 | services/form-destination-recovery.test.ts |
| CS-C02 | routes/forms-automation-order.test.ts |
| CS-C01 | routes/friend-metadata-concurrency.test.ts / services/friend-metadata.test.ts |
| R-EC01 | services/ec-order-replay.test.ts / routes/ec-integrations-ledger-d1.test.ts |
| R-EC02 / IN-H01 | routes/ec-integrations-ledger-d1.test.ts（内部回収停止はroutes/ec-pause-and-retry.test.tsも照合） |
| R-MEET01 | routes/meet-callback-recovery.test.ts / routes/meet-callback.security.test.ts |
| SEND-S05 | services/operation-notifications.test.ts / services/recorded-notification-send.test.ts |
| support（B-249） | services/support-email-concurrency.test.ts / routes/support-inbox.security.test.ts |
| SEND-S06 | services/nen-engagement-order-state.test.ts |

## 機能ごとのコミット

| ID | 主な修正SHA（追加点検分を含む） |
|---|---|
| R-IN01 | 2076062a30 / 4d9b88b350 |
| R-FORM03 | 62e25bd24e |
| R-FORM01 | c0c898b3c0 |
| R-FORM02 | 2cea6c06ba / 464fa77898 |
| CS-C02 | 6f50af90ed / 464fa77898 |
| CS-C01 | bec5017840 |
| IN-C01 | 80e8ed33c3 / f32c83b347 / b19e53bf41 |
| R-EC01 | 1f5cbe6b4b |
| R-EC02 | fdfce73452 |
| IN-H01 | 884553d255 |
| R-MEET01 | ffe6374f8a / 491b079443 / 189aacbe63 |
| SEND-S05 | be9dfc618b / 189aacbe63 / a8a2f28686 / 8e55d1c76e / 232eefb710 |
| support（B-249） | 1a5e462a60 |
| SEND-S06 | e3e28a45fd |
| IN-C02（現状確認のみ） | cb6336953a |

最終全試験の追加3件: webhook.test.tsの初回message登録の期待値に発生時刻がなく1件失敗。署名された出来事時刻を期待値へ追加し、実DBの後続解除試験も維持。restaurant-followup.test.tsの2件は製品コードの差分なしで失敗。JSの時計を2026-10-11T15:09Zに固定している一方、SQLiteの予約イベントトリガーは実時計を使うため、その時刻を過ぎると予約入りジョブがまだ未来となり、送信2件の期待に対して1件になる。人工の予約イベント時刻を試験の時計へそろえ、期待する件数・本文・UTC/JSTの比較は変えない。製品コードとmigrationは未変更。

時刻の追加3失敗は、関係する62試験を再実行して合格（/tmp/revfixf-final-clock-tests.log）。期待値更新は4f523aed79、人工DB時計の修正は53c13f2123。全件の失敗ログは/tmp/revfixf-final-all-tests.logに残す。

## 初回の最終検査（IN-C02追加修正前の記録）

重い検査は順番に実行。試験はすべてNEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev、Vitestは最大4並列。送信・決済・ECは偽物、DBは人工のSQLite。

| 対象 | 最終結果 |
|---|---|
| docs | 2ファイル・6試験合格 |
| line-sdk | 11ファイル・53試験合格 |
| shared | 33ファイル・368試験合格 |
| update-engine | 20ファイル・160試験合格 |
| liff | 68ファイル・425試験合格 |
| web | 2133ファイル・12475試験合格、既存skip1・todo1 |
| create-line-harness | 8ファイル・52試験合格 |
| db | 377ファイル・2250試験合格 |
| mcp | 3ファイル・68試験合格 |
| worker（最後の保存確認修正も含む全件再実行） | 943ファイル・11127試験合格、既存skip30 |
| root scripts（sharedも含む） | 104ファイル・941試験合格 |

パッケージ全試験は/tmp/revfixf-final-all-tests.log。この実行のWorkerは3失敗・11122成功で終了し、その3件を直した後、全Workerを/tmp/revfixf-final-worker-tests.logで再実行して合格。その後の最後の通知保存確認232eefb710を含む全件再実行は/tmp/revfixf-last-worker-tests.logで11127試験合格。root scriptsは/tmp/revfixf-final-scripts-tests.log。IN-C02の現状確認試験が合格していても、IN-C02を修正済みとは扱わない。

型検査の途中失敗も保持する。初回型検査ログは/tmp/revfixf-typecheck.log（6cbe6da940でDB試験の型・直接ソースimport・イベントの型絞り込みを修正）。最終型検査の1回目/tmp/revfixf-final-typecheck.logでは、残りの試験batchのT未定義と通知集計の型絞り込みの2件が失敗。20c5461723でbatchをジェネリック関数へ、8e55d1c76eで通知の失敗一覧を型付き配列へ変更し、unknownを含む場合の優先を保った。修正後の関係する8試験が/tmp/revfixf-final-types-repair-tests.logで合格。この段階での全Workerの合格はその直前の8da1349480、型修正分はこの8試験で再確認（最後の全Workerは後述の232eefb710を含む）。

SEND-S05/B-241の最終追加: outbox完了のUPDATEが0件でもsent=1を返す赤を確認。仲間の4書込（claim・宛先固定・完了・失敗記録）も照合し、宛先固定の0件でも送信を始める赤を追加して再現（/tmp/revfixf-notice-outbox-both-red.log、2失敗）。宛先を保存できない時は送信前のfailed、送信後の完了保存0件はunknownとして成功を返さない。既に受理された宛先の記録は再開時も使い、完了だけ補って送信を重ねない。関連13試験は/tmp/revfixf-notice-outbox-both-green.logで合格、修正232eefb710。最新本線d5deaebec3は再取得でも変化なし。最後の全Workerはこの修正を含めて再実行し、943ファイル・11127試験合格（skip30、/tmp/revfixf-last-worker-tests.log）。

作業場所: /Users/kentakenta/lh-work/lh-pages-revfixf、専用ブランチcodex/kenta-revfix-f-1011。開始前のDOCTOR_LOCAL=1 bash scripts/codex/doctor.shは合格。反映履歴はdocs/release-log/unreleased/0000-kenta-revfix-f.md（運用者の文言・@kenta・#0000・日本時間）。push・PR・D1・配備は実施しない。

最後の全パッケージ型検査は/tmp/revfixf-last-typecheck.logでexit 0。root scriptsの型検査は/tmp/revfixf-final-scripts-typecheck.logでexit 0。いずれも秘密値の設定・環境更新なし。

最後の全パッケージビルドは/tmp/revfixf-last-build.logでexit 0。管理画面・Workerも成功。既存の画面lint、古い反映履歴の形式、Nextの複数lockfile検出、bundleサイズの警告は残る。本件では画面や既存の履歴を変更していない。生成後も追跡済みの変更は今回の文書だけ。

差分検査git diff --checkは合格。今回追加したmigrationは0。機能ごとのコードと試験、反映履歴、ID別報告と62行の点検表をコミットまでで引き渡す。IN-C02は未修正・オーナー判断待ち、ほか14件は人工条件で再現して修正。実送信、検証/本番DBへの書込、push、PR、D1、配備なし。

再実行した主なコマンド:

```sh
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm -r --workspace-concurrency=1 run test --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --filter worker run test --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm run test:scripts --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm -r --workspace-concurrency=1 run typecheck
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm run typecheck:scripts
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm -r --workspace-concurrency=1 run build
```

最終のブランチ全体差分検査では、先に取り込んだrevfix-dのbroadcast-audience-snapshot.ts末尾の余分な空行1件も指摘された。空行だけを除去して再検査。動作は変わらず、試験・型・ビルドの対象コードの意味は同一。専用・元の両作業ツリーは最終クリーン。
