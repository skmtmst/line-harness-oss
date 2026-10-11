# 列車19 総点検 c の修正結果

基点: `aba7e15838abccb4f8d1f8ab417139be66f420ac` (origin/codex/development)。元報告 ec971ed6 は読み取りのみ。人工データ・fetch の差し替えで確認。外部送信・決済・DB書込み・migration・push・PR・配備なし。
| ID | 実部品で再現 | 対応 | 仲間の調査 | 見張り |
| --- | --- | --- | --- | --- |
| UI-02 | 9入口で失敗、クーポン1入口と直接表示2入口は正常 | 入口の振り分けを共用し、追加前URLの全引数を保持。復帰イベントの重複も抑止 | main.ts の全12入口を確認。友だち追加ゲート8呼出し、復帰処理1か所 | main.friend-return.test.ts 18試験（元main.tsをimport、取得と画面mountだけ差し替え。E3の直接/SDK経由も含む） |
| OPSSET-02 | Workerの元moduleで3試験失敗。LIFFの元EventBookingsも連続再試行で1試験失敗 | 世代番号で古い成功・失敗・finallyを無効化。Workerの失敗を空と分けて再試行 | rgで履歴refreshの同じ書き方を全件検索し2か所（Worker event-booking/main.tsx、LIFF pages/EventBookings.tsx）を修正 | history-race.test.ts 3件、EventBookings.latest.test.tsx 1件 |
| UI2-C02 | 元booking.tsでHTTP503・通信拒否・success:falseの3件が空表示 | 失敗状態と再試行。旧日付の遅い応答も除外 | booking.tsの空配列代入は4か所、失敗時代入1か所を修正、日付選択等の3か所は正当なリセット | booking.slots-failure.test.ts 3件 |
| UI2-C03 | 元会員画面mountでHTTP503・通信拒否の2件が空表示、未処理拒否4件 | 共通の骨組み・失敗＋再試行。古い応答と破損応答も除外 | HealthDiaryのtry/finallyだけの取得1か所 | health-failure.test.ts 2件、未処理拒否0 |
| NORMAL3-02 | 現役Worker入口で再試行・骨組みの2件失敗 | 共通の日時選択へ接続 | サロンの2実装を統一、旧14ファイル削除 | salon-entry.flow 2件＋wiring（共通mountと重複部品禁止） |
| NORMAL3-03 | 現役履歴の変更・取消がなく失敗 | 共通履歴へ接続、版つき取消APIで確認 | 旧履歴とカードを共通へ統一 | 実入口の取消＋既存self-change試験 |
| NORMAL3-04 | 現役入口が4つの店設定を無視して4件失敗 | 共通日時選択が週先・月先・週だけ・月だけを反映 | 旧日時選択と週カレンダーを共通へ統一 | 店の全4設定を実入口で確認 |
| REM3-03 | 元Booking＋本物Stepperで支払い応答を渡すと4段、1 failed / 1 passed | 支払いが返ったとき5段・現在は5を選択。店払いは4段 | 固定4段のサロン2実装は共通化済み、現在1か所 | Booking.payment-steps 2件（決済部品は差し替え、実決済なし） |
| B-241 仲間 | 実際のWorker/LIFFの紹介案件HTTP503が2件・紙の申請の通信拒否1件で失敗 | 案件と申請を失敗＋再試行へ。登録後の再試行は登録を増やさない | 紹介案件2実装の7か所（HTTP失敗2・catch4・紙の申請1）。webinarの空配列3件は成功時/巻戻しの正当なリセット | 実部品4＋紙の履歴1、AST7（両ソース全件・catch/HTTP失敗の空置換禁止） |
| UI-N05 | 本線のFunnelV8実importで404/500の拒否、2 failed / 1 passed / unhandled 2 | 先行bのefbc652ae9で同じ3試験pass・unhandled 0を確認。cへの取り込みは旧文書の削除/変更競合で中止、判断待ち | 本線の結果読込1か所（bが修正済み） | 先行bの実FunnelV8＋ApiError3件。cは未取り込み |
| REM3-02 | 仕様と絵の寸法が不一致で判定保留 | 修正しない | 共通枠1か所、絵2種を比較 | 寸法の正本の統一待ち |
| B-247 E3 | 元Workerの通知3種・案内部品4件・席登録1件・SDK経由Worker/LIFF各3件で失敗 | 既存APIだけで人/席の登録・残り時間つき確定・見送りを接続 | 通知2種＋見送り1種、登録シート2種、席の共通実装1か所。店画面2か所は調査のみ | 実入口・案内部品・席画面・共有URL復元の試験、実Worker bundleのCIブラウザ8組 |

## B-247 E3 調査（既存UI・APIの読み取り）

F-6の人・席のキャンセル待ちを対象。イベントの待ちとは別。順番・30分/開始2時間前から10分・上限3・開始1時間前締めは既存APIとservicesが所有する。
| 操作 | 現役Worker入口 | LIFF単体 | 既存の受け口／不足 |
| --- | --- | --- | --- |
| 人の満席枠から待ちに入る | 旧サロンに入口なし。共通化後DateTimePicker→WaitlistSheetに接続 | 満席の時刻→WaitlistSheet | GET mine・POST waitlist・DELETE waitlistあり |
| 空いた知らせから人の予約 | 通知は /booking?waitlist=id、main.tsが/bookingを読まず登録完了へ | Booking→WaitlistOfferSheet→requests | 本人の待ち照会・requestsのwaitlist_idあり |
| 空いた知らせから席の予約 | 通知は /booking?seat_waitlist=id、同じ入口漏れ | Booking→WaitlistOfferSheet→seat-waitlist/:id/accept | 照会・確定APIあり |
| 本人が見送る | 通知action=declineが同じ入口漏れ | OfferSheetの取消→既存DELETE | 人・席両方あり |
| 人・席の残り時間 | 現役は上記で届かない | 絶対の期限だけ、残り秒の表示なし | hold_expires_atあり、画面の接続のみで可能 |
| 席の満席枠から待ちに入る | main→restaurant→共通SeatReserveに入口なし | 同じSeatReserveに入口なし | 既存POST seat-waitlistあり。fullのstartsAt・storeId・人数は取得できる |
| 店の画面 | 待っている | 案内した | 仮押さえ残り時間 | 確定 | 期限切れ |
| --- | --- | --- | --- | --- | --- |
| 人: booking-day-v8の待ち欄 | 先着の順番あり | invitedを「知らせた」 | あとN分あり | 待ち欄で区別なし（予約台帳へ） | 待ち欄で区別なし |
| 席: SeatWaitlistDialog | 空き待ち | 案内中 | 期限時刻だけ | waiting/invitedのfilterで非表示 | 同filterで非表示 |

店の5つの段の完成には司令塔の画面担当が必要。今回は店の画面を変更しない。APIはwaiting/invited/converted/finished/cancelledと期限を返すが、仮押さえ開始でinvitedとなり、送信成功はnotified_atに残る（案内日時・仮押さえ開始日時は既存）。板ggPZt E3の「20:33に案内→20:35に開いた」を分ける閲覧日時・閲覧報告APIもない。不足するのは本人が案内を開いた日時と、その閲覧を記録する受け口。待ち欄の5段表示自体は既存status・案内日時・期限を使って画面担当がつなげられる。finishedの期限切れ/受付締めは期限の有無から推定できるが、終了理由を確定値で表示する契約はない。閲覧日時が必要ならオーナー承認つきのDB/API設計が先で、今回migrationもAPIも作らない。

- UI-02: `/tmp/revfixc-ui02-red.log`。初回の依存未ビルドは再現証拠にせず、ビルド後の9 failed / 3 passedを確認。修正後は既存5試験を含む17 passed。

- OPSSET-02: `/tmp/revfixc-opsset02-red.log` 3 failed、`/tmp/revfixc-event-sibling-red.log` 1 failed。修正後4 passed。

- UI2-C02/C03: `/tmp/revfixc-ui2-red.log` 5 failed / 4 unhandled、修正後5 passed / unhandled 0。URLとSDKのfixtureの初期不備を直した後のログ。

- NORMAL3: `/tmp/revfixc-normal3-red.log` 元Worker入口から7 failed、共通化後同じ7件がpass。元moduleをimportし、APIだけを人工データへ置換。
- 削除対象を読む試験: deployed-liffの3件をapps/liffのsalon-regressionへ移動（質問・期限・入力保持と同じ冪等鍵）。tap-actions.integrationの7件は共通入口のURL関数へ変更。entryのサロン2件は実際の共通画面を操作する形へ変更。12件の検証内容を維持。さらにpendec2-rulesのCSS経路検査1件を共通CSSへ移し、合計13件を移設/更新。
- Workerの入口wrapperとLIFF単体は同じBooking・BookingHistory・共通部品を読む。SDKをmain.tsから渡し、店と本人の文脈はsetLiffContextで保持。

- REM3-03: `/tmp/revfixc-rem303-red.log` 1 failed / 1 passed。修正後2 passed。支払いの有無は予約作成応答のpaymentで判明するため、その後の手順帯を5段にする。事前の公開メニューには支払い方式の欄がないため、事前から5段にするには公開APIの欄が必要（今回追加しない）。
- REM3-02: `v8-liff.md` は外枠330×690。固定htmlの `xRPdo.html:1223` は330×690、padding10・outline2・offset-1。一方 `owaS3.html:2112` は330×714、outline8・offset-4（半分外側）。実装LiffPhoneFrameは330×714、outline8・offset未指定（8すべて外側、外周は346×730）。測る基準をそろえても外枠と中身の寸法が違い、予約の絵自体も714のため、690固定にはしない。司令塔による枠寸法と線の位置の統一が必要。未確認を再現済みとして数えない。

## B-247 E3 接続後の確認

- 人・席の案内URL3種はmain.tsの実moduleで3 failed→15 passed。
- 案内部品の残り時間・期限切れ・再試行・確定・見送りは4 failed→6 passed。人数枠の照会失敗も同じ再試行にした。
- 席の満席枠は1 failed→9 passed。休業・貸切・開始1時間前に入口を出さず、店・人数・APIが返した開始時刻で登録する。既存の席予約試験7件も維持。
- 共通Buttonとdata-liff-themeの色・角を使う。順番・上限・仮押さえ時間は既存APIを変えず、サーバーの期限を残り秒へ換算。
- 仲間: 通知URL2種（人・席）、見送り引数1種、登録シート2種（人・席）、現役restaurantはLIFFと共通部品1か所。元の人の登録も共通化により現役へ接続した。

- B-241仲間: `/tmp/revfixc-b241-sibling-red.log` 3 failed / 15 passed。修正後、登録後の既存API再試行を加え20 passed。ASTは正しい失敗状態と成功時リセットを区別する負例・正例6件＋全ソース1件、root test:scriptsでCI実行。

- 全件検索で旧CSS参照は席入口・スタンプ入口・pendec2-rulesの3か所にもあった。全試験の実入口3件失敗とV8検査のENOENTを再現し、共通CSSへ接続。外側の幅/中央寄せ/素のボタン枠も実ブラウザで1 failed→1 passed、保持に必要なresetだけ共通CSSに移した（旧の色・影は移さない）。

- E3実配備bundleのブラウザ検査: 375/414×LINE/夜の4組。短い予約操作が2行となる失敗を確認後、板ggPZt E3の並び（共通ボタンを縦に）と「この枠で予約する」に合わせ、全部1行・48px・横はみ出し0・例外0・想定外API0。CIのworker-buildに同じ実bundle検査を接続。夜の案内文もdata-liff-themeの文字色で読む。

- UI-N05: `/tmp/revfixc-uin05-red.log` と `/tmp/revfixc-uin05-green.log`。先行修正efbc652ae9はコード・試験で競合しないが、本線で削除済みの `docs/qa/revfix-b-1011.md` と `docs/release-log/unreleased/0000-kenta-revfix-b.md` がmodify/delete競合となり、cherry-pick --abortして戻した。AGENTSの競合停止により、旧文書を復元せずコードと試験だけ引き継ぐ判断を依頼中。

- E3のSDK経由: 直接の道だけでなく、本物の初期化が読む `liff.state=/booking?...` / `/booking/history` でもWorker3件・LIFF3件が失敗。queryだけの復元を道とqueryの共通復元に直し、両入口でpass。OAuth値と明示したpageは優先、外部URL/未知の道は移動しない（共有の12試験）。実配布bundleのCIも直URL/SDK経由を含む8組にした。

## 検証の基点とコミット

- 検証前の最新本線: `d5deaebec39819a933b58179a9b0dd67c745e9ba`。専用枝へ通常merge（f4a8567439）。本線への書込みなし。
- UI-02: 85ff108130 / OPSSET-02: 9c2e97d2cf / UI2-C02・C03: 2322250746 / NORMAL3: 9256b8e7e2 / REM3-03: 7cb2895963。
- E3: 6277e7d820 / B-241仲間: cc08626e62 / 共通CSSの参照と外側: d0abba4c51 / E3の共通操作・CI: d83dfa3878 / SDK経由の道: 095fcde40e。
- 人工データ検証の外部通信遮断: 19f4effaf4。fetch・HTTP/HTTPSを接続前に止める4件と、手元の人工APIを許可する1件をCIで確認。
- 機能の判断とB番号、元報告・固定絵は変更しない。コードの寸法一致をPASSED台帳へ代筆しない。

## 最終確認

- 開始前: `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` の最終行「合格」を確認してから着手。
- 全件の管理画面試験: 2,133ファイル・12,472件合格、既存スキップ1件・TODO1件。UI-N05を取り込んだとの意味ではない（その再現試験は先行bのための判断材料として別に実行）。
- 型検査: `pnpm --workspace-concurrency=1 -r typecheck` 合格（`/tmp/revfixc-all-typecheck-final.log`）。
- 全ビルド: `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --workspace-concurrency=1 -r build` 合格（`/tmp/revfixc-all-build-stable.log`）。
- scripts: `pnpm typecheck:scripts` 合格、`pnpm run test:scripts --maxWorkers=1` 106ファイル・960件合格（`/tmp/revfixc-scripts-test-final.log`）。
- SDK経由の変更後にLIFF全件を再確認: 76ファイル・456件合格。shared全件: 33ファイル・375件合格。
- 全workspace試験: `NODE_OPTIONS="--import $PWD/scripts/codex/local-test-network-guard.mjs" NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --workspace-concurrency=1 -r run test --maxWorkers=1`（実行時は同内容の/tmpコピーを指定）。全packageを実行し、Workerだけ未合格（`/tmp/revfixc-all-test-isolated.log`）。Workerの初回は935ファイルで932 passed / 3 failed、11,059 passed / 25 failed / 30 skipped。
- 初回の25件のうち23件は、下記の本線比較用worktreeが共用distを本線の旧版で上書きし、現行のURL復元関数がなくなった実行環境の不備。現行sharedを再ビルドし、本物のWorker client全15ファイル・75件を単独で再実行して全件合格（`/tmp/revfixc-worker-client-stable.log`）。試験・コードの書換えなし。再確認を含むWorker全体の結果は934ファイル合格 / 1ファイル未合格、11,082件合格 / 2件失敗 / 30件既存スキップ。全体試験の一括終了コードは1のままであり、全件合格とは扱わない。
- V8: `verify:design` 合格、静的/実CSS/持ち主検査26件合格。実画面の1152/1440/1920幅の72組ではみ出し・右端越え0。今回の持ち主差分候補・未許可の仮置き0。
- 現役LIFFの実bundle: 375/414幅×LINE/夜×直接/SDK経由の8組、予約操作1行・横はみ出し0・例外0・想定外API0。APIは全て人工データ、外部通信は遮断。
- 途中の全件試験で、既存の管理画面試験が試験用URLへ読込みを試みることを検知。その実行を停止し、全件を通信遮断つきでやり直した。以後は本物の外部サービスへ接続しない。
- 画素の全462枚照合・配備判定は実施していない。司令塔のPASSED台帳を変更していない。

### 全試験で見つかった本線の失敗（今回の対象外）

- `apps/worker/src/services/restaurant-followup.test.ts:201,211` の「旧SQLiteのUTC時刻」「00:09 JST」の2件が、処理数2の期待に対して1となる。タイムアウトではない。
- 今回の枝で単独再実行: 21 passed / 2 failed（`/tmp/revfixc-restaurant-followup-solo.log`）。さらに修正を含まない本線SHA `d5deaebec39819a933b58179a9b0dd67c745e9ba` を一時worktreeへ展開し、本物の同じ試験を単独実行: 同じ21 passed / 2 failed（`/tmp/revfixc-restaurant-followup-base.log`）。そのpretestも本線のソースから実行したため、共用distが古い版で再ビルドされた。比較後は現行を再ビルドし、一時worktreeは試験用のsymlinkを外してクリーン確認後に削除した。
- 試験・関連service・人工DB helper・DBのコードには今回の差分なし。試験はJSの時計を `2026-10-11T15:09:00Z` に固定する一方、予約イベントの生成時刻はSQLiteの実時計を使うため、予約入りのジョブが固定時計から未来になる。試験の時計をそろえる判断が必要。
- AGENTS.mdの試験失敗時の停止に従い、対象外のservice/試験は修正しない。実装済みの変更の追加反映も行わず、検証結果と判断待ちを報告する。
