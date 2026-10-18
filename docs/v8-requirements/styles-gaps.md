# 6つのスタイル：今ある物と不足

2026-10-18、T00、照合した土台 `715d55c2cfe0700b8ece7cae3ab6a8481f137a14`。
要件は [styles.md](styles.md)。これは実装の不足と受け渡しの一覧で、既存機能を使えない物に戻す指示ではない。
司令塔の調べ `~/lh-work/design/v8/review/STYLES-1018-AUDIT.md` と、当該土台の実装・前の束の引き継ぎを照合した。他の枝の途中の成果を土台で実装済みとは数えない。

## 1. 不足と担当

「新API」は新しいパスを必ず作るという意味ではなく、既存の入力・応答・検証の追加を含む。既存の関数名・パス・成功応答の互換を保ち、追加の最小契約をT01がT02/T03へ渡す。上限・許可種別は増やさない。

| ID | 要件と現状の差・根拠 | 必要な作業・既存の受け皿 | 新API／新表 | 持ち主・受け入れ |
|---|---|---|---|---|
| GAP-ST-01 | 登録は飲食だけ選べ、選択を保存しない。面談のUIキーがmeeting（`apps/web/src/v8/account-new/logic.ts`・`register.tsx`） | 6正式キーを選択・保存・再読込。アカウント作成とスタイル保存の途中失敗を同じアカウントで回復。飲食の店舗追加を維持 | 既存のアカウント登録とstyle保存の契約を照合。入力追加の要否はT01、表不要（649） | T01/T02、ST-COM-01/05、ST-CON-01 |
| GAP-ST-02 | はじめの質問は6種を持つが、tickets/payment等の案内は古い準備中・先頭URLのまま（`onboarding/model.ts`・`setup-questions.ts`、`style-setup-core.ts`） | B2はpasses、支払いはpayments、会い方はメニューと担当、EC接続はconnectorへ。既存の回答キー・保存先を再利用。未対応キーをUI内だけ保存しない | 基本は既存API。準備判定の実設定照合が必要。新表不要 | T01/T02、ST-SAL-03、ST-CON-03、ST-EC-04 |
| GAP-ST-03 | 左メニューがスタイルを見ず、飲食区分やEC機能の初期値が全業種へ広がる（`components/layout/sidebar.tsx`・`lib/menu.ts`・`feature-settings.ts`） | styles §3の新規表示初期値と既存の明示設定を区別。飲食のflag・並びを維持し、過去データの閲覧を残す。スタイルを認可に使わない | 既存style/feature読取、表不要。新しい権限の許可一覧不要 | T02、ST-STD-02、ST-EC-06、ST-COM-02/04/12 |
| GAP-ST-04 | standard/ecは共通Home、ECカードは定義のみ（`style-dashboard/home.tsx`、`style-setup-core.ts`） | 標準ではECの数・カードを外す。ECは今の概要・EC連携の実データと行き先を組み合わせる。未取得・未設定・模擬の区別 | 既存dashboard/EC APIで足りるかT01が確認。4業種用IndustryStyle APIへecを追加して代用しない。表不要 | T01/T02、ST-STD-02、ST-EC-02 |
| GAP-ST-05 | LIFFの公開契約に正式styleがなく、U06は中立語まで。管理画面・LINE・LIFFが同じ辞書を読めていない（`apps/liff/src/lib/customer-words.ts`、U06-HANDOFF） | 同じアカウントの既存本人向けGETへ最小styleを追加、本人/店の境界・no-storeを保持。共通語とterms §5/6を参照。状態・支払いの語は維持 | **既存応答の任意欄追加が必要**。名前・配置はT01が既存の入口を照合して公開。649のaccount_stylesを読むため新表不要 | T01→T02/T03、ST-COM-01/03/05/09 |
| GAP-ST-06 | 6種の見本と保存定義が不一致。standard/ecのUI見本が飲食の代用、教室リンクはpage=event（`onboarding/model.ts`、`rich-menu-sample/sample.tsx`、`style-starter-definition.ts`、`style-menu-buttons.ts`） | 業種別の保存・見本・準備判定の定義を一致。教室は実在の公開event ID、履歴はevents/me、券はmypage。写真/資料/会社/ECサイトは具体的な既存のtemplate/URI動作を選ぶ | 現行StarterItemのfeature参照だけでは顧客の具体的な公開先を表せないため、既存rich-menu保存口を使う接続が必要。新しいfeature許可値で穴埋めしない。既存JSON/areaで足り、新表不要 | T01/T02/T03、ST-COM-06、各業種のボタン表 |
| GAP-ST-07 | 調べはstandard/ecの文面を予約用4通と記載。ただし土台のtemplateSamplesは共通15＋4業種別、standardStarterもそのカタログを読む。初期投入はcontent.modeだけを見ており、configured/falseの「入れない」を除外しない（`style-template-samples.ts`・`style-starter-definition.ts`・`style-starter-insert.ts`） | 「見本が4通しかない」と断定しない。カタログ・初期投入・見本UIを別々に確認し、標準/ECに適切な文を選ぶ。「入れない」で見本を作らない。新表で別カタログを作らず、初期セットの既存30項目・6ボタン等の予算内で置き換え・選択 | 定義/表示/初期投入条件の接続、必要な型は既存契約の範囲でT01。表不要 | T01/T02、ST-STD-03、ST-EC-03、ST-COM-09 |
| GAP-ST-08 | B2は既に作り済みだが、初期設定の回数券ボタンが予約設定の先頭・準備中へ（`booking-passes`・`booking-menus/settings-view.tsx`、`onboarding/model.ts`） | 管理はpassesタブ・作る画面、顧客はmypage/予約の確認へ。店が手で付与する機能と実課金の準備中を区別。券の対象と確定/取消は既存契約 | 既存bookingPassPlansApi・booking entitlement APIを使う。種類の表は720、試験購入は724等が存在、新設不要 | T01/T02/T03、ST-SAL-03/04、ST-LES-05 |
| GAP-ST-09 | B3は既に存在、初期設定の振替/スケジュールが運用者の/eventsへ。LIFFには一般の/events一覧がない（`onboarding/model.ts`・`apps/liff/src/App.tsx`） | 振替はLIFF/events/me、開催回は/events/:id。複数クラスは公開案内にリンクを並べる。振替先選択前に欠席可能、二重消費なし。未実装の一覧をあることにしない | 既存bookingMakeupApiとevents API、既存booking_makeup_credits（709）。新表不要 | T01/T02/T03、ST-LES-02〜05 |
| GAP-ST-10 | B7の手動固定URL・会い方・担当calendarは存在するが、面談の初期案内から設定へつながらない。自動会議の口は未提供（`booking-menus/meeting-mode.tsx`・`staff-calendar.tsx`） | メニュー/担当の既存設定へ接続。LIFFと送信は同じ予約URLと会い方。Google CalendarとB8を混同しない | bookingCalendarApiのget/saveStaffUrl・get/saveMenuUrlと既存calendar口。703/704を再利用、新表不要。実自動発行のための新provider契約はこの接続と分離 | T01/T02/T03、ST-CON-02〜04 |
| GAP-ST-11 | G6のrules/save/enableMock/test/statsは存在、ECの初期セットから未接続。sent:false/testMode:trueの境界がある（`lib/api-gap3.ts`・`v8/ec-auto-line`） | 管理は/ec-commerce?tab=auto-line、設定はconnector。模擬の送信・成果を実績へ混ぜない。商品/サイトの顧客URLと管理タブを分ける | 既存ecAutoLineApiとEC連携、既存EC台帳。新表不要。実送信providerの追加・有効化は別の承認 | T01/T02、ST-EC-04/05 |
| GAP-ST-12 | A07：Meet通知の子が相談ID×種別で一意。送信済みを保持して日時変更後の同種通知を追加する世代が不足 | 相談の版・追記型通知を承認後に接続。旧通知をpendingへ戻して再送しない。日時変更の通知まで完了としない | **A07の728案**。新規採番せず下表へ、SQLは作らない | A07/司令塔、ST-CON-05、ST-COM-08 |
| GAP-ST-13 | A07：イベント取消・却下・開催回変更の世代と全段の停止回収が不足。作成/確定の回収があることとは別 | 予約版と操作記録を承認後に接続。B3の通常操作があるだけで全段の停止→再開を完了にしない | **A07の730案**。新規採番せず下表へ、SQLは作らない | A07/司令塔、ST-COM-08、ST-LES-04/05 |
| GAP-ST-14 | U06：有料取消の同意額/版を送るLIFF側の公開口が不足。A07側はfeeAccepted/expectedFeeAmountを要する | 期限内でも料金確認が必要な取消は、公開された同意契約で金額を確認後に送る。未接続中は担当へ連絡を案内し、無料取消として進めない | 既存取消呼出しの拡張・T01からT03へ契約。新表不要 | T01/T03/A07、ST-COM-07/08 |
| GAP-ST-15 | **教室のクラス申込で券を選び消費する口と保存先がない**。643のbooking_entitlement_usesはbookingsへのFK・trigger、720の対象判定もmenu_idだけ。EventConfirm/createEventBookingとeventsの受付に券指定がない。709の振替にentitlement_idがあっても消費記録の代わりにはならない | 本人の利用可能券を開催回で照合し、申込時の選択・確定時の消費・取消/欠席時の復元か振替付与を同じ保存単位にする。通常予約とクラスで同じ残高・月枠を競合させる。クラスをダミーのbookingsに二重登録しない | **既存イベント受付/確定/取消API・券読取の拡張と、733案の保存先が必要**。承認まで実装を止めるのはこの部分だけ | T01/A07/DBオーナー→T03、ST-LES-04/05、ST-COM-08 |
| GAP-ST-16 | B2の「月の回数は上限なしも可」に対し、720の月謝プランのCHECKはmonthly_limit>0でnullを許さない。現在の一覧/付与は有限の枠を前提にする | 要件との差を残す。本整理で上限を上げる・CHECKを緩める・巨大な数で上限なしを代用する作業はしない。有限の月謝と教室の定員の「上限なし」は別 | 上限変更の判断を司令塔へ。許可前に列・SQL・番号を追加提案しない | 司令塔/B2の持ち主、ST-COM-07。無制限月謝の完成を宣言しない |

標準/ECの新しい専用集計表、写真/資料用の新しいCMS、教室の新しい会員台帳、会議URL用の別表は今回不要。教室の券の**利用記録**は会員台帳と別で、GAP-ST-15に保存先の不足がある。新しいAPI契約が必要なのは主にGAP-ST-01の保存接続、05の公開style、06の具体的な公開先、14の料金同意、15のクラスの券利用。最終の入力・応答・権限は実装前にT01が既存の口と照合する。

## 2. 表・列の不足（既存の提案を引き継ぐ。未予約）

T00のSQL作成は **0本**。新規の番号案は **733（未予約・未承認）**。読取照合時の本線 `1bd9569e61` と指定土台の最大は726、公開38PRの追加SQLの最大は565。727〜732は前束の未予約案として避けた。次は保存先の案であり、実在する表として使わない。

| 番号案・持ち主 | 表・列の案 | 理由・止める部分 |
|---|---|---|
| 728・A07/DBオーナー | `meet_consultations.schedule_revision`。`meet_consultation_notification_runs`：consultation_id、schedule_revision、booking_id/version、kind、scheduled_at、recipient/sender snapshot、retry_key、status、attempts/next_at、call_state/result、作成/更新時刻。相談×世代×種別とretry keyを一意 | 送信済みの履歴を残し、変更後の前日/1時間前を新しい世代で登録する。通知世代の完全な停止回収は承認まで未完了 |
| 730・A07/DBオーナー | `event_bookings.lock_version`。`event_booking_transition_runs`：所属、event/booking ID、期待/確定booking版・event版、operation_key、action/status、input_snapshot、各段/通知の結果、前後の参照、作成/更新時刻。所属×予約×期待版×操作を一意 | 取消・却下が一度状態を戻す現方式でも世代を判別し、開催回変更と通知の全段を追えるようにする。一般checkpointで予約版を代用しない |
| **733・T01/A07/DBオーナー（新しい案）** | `event_booking_entitlement_uses`：line_account_id、event_booking_id（一意・FK、削除時は参照を外して履歴を保持）、event_booking_id_history（主キー）、event_id/slot_idと開催日時の控え、entitlement_id（FK）、period_start/end、consumed_at、returned_at、復元/振替との対応、操作キー、版、作成/更新時刻。`booking_pass_plans`にイベント対象用の`event_target_scope_json`案（null＝未設定、明示の空配列＝同店の全クラス、配列＝指定event ID。既存のmenu用scopeは保持） | 今の利用表は通常予約にしか結び付かず、教室の券利用と月謝集計が保存できない。既存の残高・月枠・履歴を正にしてクラス利用を追加。通常予約側の減算/月枠の検査も**両方の利用の合算**へ新migrationで更新し、残り1の同時確定を両側から拒否できる必要がある。既存SQLを書き換えず、承認後に730の予約版と同じbatchへ接続 |

A07が残した729（在庫triggerの対象を絞る案）は新しい業種の表ではなく最適化の残り。A06等の727、S01の731、S03の732等も別束の未予約案であり、T00で再利用・予約しない。番号の順序と所有は司令塔がまとめて調整し、**実際に作成する前・push直前に最新本線と公開PRの追加SQLを数値順で照合し、番号ごとにオーナー承認**を得る。T00はSQL作成・適用をしない。

733の受け入れ：申込中の未消費、承認時と即時確定の1回消費、券/開催回の別店・別人・対象外・期限切れ拒否、通常予約とクラスの残り1回の同時確定、店のtimezoneで月をまたぐ開催・変更、取消の復元1回、振替を渡した欠席の券復元0、振替先での二重消費0、定員競合の全体rollback、再送/再起動の二重消費0、本人の残り表示との一致。従来のプランへイベントの利用範囲を勝手に広げず、未設定のイベントscopeは管理者が確認してから有効にする。

## 3. 食い違いと安全側の判断

| 項目 | 本書で採る条件 | 未完了の扱い |
|---|---|---|
| B-381とB-391 | 売り方は飲食から、実装の目標は6業種全部 | 他5業種を準備中だけで終わらせない |
| 調べの「standard/ecは予約4通」 | 土台のカタログは共通15。初期セット・UIと区別して確認 | 調べを無条件に実装の事実として転記しない |
| terms §5の「骨組みは同じ、違うのは言葉」 | 共通のV8の骨格を保ち、B-304の業種ごとのタブ・数字・専用機能の出し入れは行う | standard/ecを4業種の盤へ増設しない |
| 面談の第3タブ | terms TM-V11の「相談者」。古い案の「担当者」を別の正本にしない | 担当の絞り込み・管理機能は残す |
| 教室LIFFの「お店で払う」 | 支払いの札はTM-V25、連絡先の説明はTM-C03の「教室」 | 新しい支払いの状態名を作らない |
| 写真・資料・会社のこと | 具体的な既存テンプレート・公開URLを選ぶ。未設定は公開しない | リッチメニュー設定画面へ遷移するだけを完成としない |
| 教室のクラス一覧 | 公開クラスID付きの既存LIFFへ。複数なら案内に各リンク | 存在しないLIFF/events一覧やpage=eventへの転送を成功としない |
| 実決済・外部サービス | B-381の準備中を保ち、手動の券/固定URLと模擬G6は接続 | 実課金・実送信・自動会議を有効化しない |
| A07の通知/取消の完全回収 | 728/730承認まで不足を維持。通常の既存操作は落とさない | T00/T01の接続完了とA07の全段完成を混同しない |
| 再試行回数 | 予約の既存初回込み3回、共通既定4回の差はD01/A07の判断待ち | 上限を増やさず、結果不明は再送しない |
| B2とイベントの券利用 | 既存の券を正にしても利用の参照先が不足するため733案。有限月謝を先に扱う | 残りを見せるだけでクラスの券利用完了としない。無制限の月謝は上限変更の判断待ち |

## 4. 後続束へ渡す順序

1. T01：GAP-ST-01/02/04/05/06/07/08〜11/14を、既存のAPI・型・保存先で実装。公開styleと具体的な顧客URLの生成・準備判定、料金同意の契約をT02/T03へ先に渡す。GAP-ST-15は733の番号承認後にA07と接続。728/730はA07の承認待ち、GAP-ST-16は上限変更の判断待ちとして分離する。
2. T02：6つの登録・質問・初期セット・ダッシュボード・§3のメニュー・見本と各設定先を接続。飲食は現行の操作と比較。1152/1440の崩れと実操作を確認する。
3. T03：T01の正式styleを読み、本人の予約・イベント申込・券・振替・面談と文言を接続。顧客のリンクを実クリックし、375/1152/1440で確認。公開APIが無い状態を業種の推測で埋めない。
4. 司令塔：3束の同じSHAでstyles §11と各業種の条件、既存B2/B3/B7/G6の受け入れを照合。未承認の保存先・実外部連携・正式PRゲートを残したまま「全て使える」と宣言しない。

T00の割当確認：PLAN-COVERAGE.tsvのprimaryBundle=T00は0件、LONG-FILES-1018.tsvのbundle=T00も0件。既存ファイルの分割・試験の削除/移動/改名はない。検証記録は [cleanup-t00-1018.md](../qa/cleanup-t00-1018.md)、外部のDONE-T00.tsvに4種類で残す。
