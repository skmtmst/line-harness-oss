# B-349：721〜725 承認後の後続（2026-10-16）

開始HEAD `44d5598acbaf36442107490cd2bb33d06a412a4a`、開始時の変更残り0。G2模擬応答・MCP下書き・プール比較は前回コミット済みのため引き継いだ。doctorは合格。

最新本線 `ff790621a587d534f530ec109af2f00c01ac8f28` を `66f7436ae4` でmergeした。bootstrap-metaの追記競合1件は、両側のマイグレーションを残して再生成した。要件は `codex/kenta-claude-f-1015` の `22eed60ed62cb2a233d16a56787808c7c3629fd3` にあるG2/G9/G5/G7/G6/B2をgit showで読んだ。親ECと画面は変更していない。

2026-10-16 19:04 JSTのオーナー承認（司令塔から）で721〜725を作成。作成前に本線と公開中PR全件のファイル全ページを確認し、衝突0。push前の再確認は司令塔が行う。追加SQLは作成だけ、DBへ適用していない。

# B-349 承認後の口（721〜725、2026-10-16）

既存の `api-gap3.ts` に関数を追加した。管理側の成功は `{success:true,data}`、店指定は `account_id`。保存は版・再送キーで競合を拒否する。本人確認、CSRF、閲覧のみ、代理の共通境界を保持。画面は変更していない。

## G5：721 会員ランクの知らせ・特典

- `GET/PUT /api/member-ranks/program`：`notifyUpgrade/notifyDowngrade` を追加（既定true）。PUTには従来のmetric/windowMonths/expectedVersionも渡す。条件変更後は停止し、再開の初回判定は知らせ0。
- `PUT /api/member-ranks/tiers`：各段に `couponCode:string|null`、`upgradeMessages/downgradeMessages:Array<{type:'text',text}>`（最大5）を追加。本文はクーポン部分を含めない通常のお知らせ文。クーポン文はサーバーで別要素として追加する。
- `GET /api/member-ranks/notices`：`{items:[{id,kind,purpose,scheduledAt,status,processedAt,testMode}]}`。個人情報を返さない。
- `POST /api/member-ranks/notices/simulate`：`{testMode:true}` → `{processed,sent:false,testMode:true}`。管理者以上、閲覧のみ・代理不可。
- 関数：`memberRanksApi.program/save/tiers/notices/simulateNotices/card`。既存LIFF会員証に`benefits:string[]`と`benefitDetails:{couponCode,mileMultiplier,tagId}`。
- 毎日の判定と同じbatchで通知予定を保存。昇格・14日猶予開始を一度だけ予定。初回・条件変更の判定では0。回復後は予告を取り消す。10:00、3時間超の遅れを除外。宣伝停止ならクーポン要素を除去してnotice、お知らせ停止・ブロック・設定停止なら模擬もしない。`member_rank_history.notified=0`は維持。
- 倍率は店の現在のランクだけを既存マイル付与へ適用し、台帳に基本額・倍率・根拠を残す。既存の再送キーで二重加算しない。既存の倍率とは重ね掛けせず高い方を使い、タグ自体の固定報酬にはこの店のランク倍率だけを掛ける。他店の同一人物からランクを持ち込まない。ランクタグは手動・一括で付け外し不可。限定メニューは既存B9のタグ対象を使う。

## G7：722 統括CSVと比較元の共通化

- `POST /api/hq/store-comparison/export`：`{from?,to?,compare?:previous|average,poolId?,sort?,order?}`＋Idempotency-Key → 202 `{id,replayed}`。統括owner/admin、閲覧のみ可、代理不可。
- `GET /api/hq/store-comparison/exports/:id` → `{id,status:pending|completed|failed,rowCount,expiresAt,errorCode,downloadUrl}`。
- `GET .../:id/download` → UTF-8 BOM付きCSV。24時間、依頼者本人だけ。
- 関数：`storeComparisonApi.export/exportStatus`。downloadUrlは既存の認証付き取得で使用。
- 一覧とCSVは同じ比較元・欠測・ソート・プールの計算を使う。CSVはページ条件なしの全行、個人情報なし。依頼時・裏の処理・状態/CSV取得時に現在の店権限を再確認。平均は取得できた可視店が3未満ならnull。できたら管理画面の通知へ記録。CSVの式になる店名を無害化。

## G6：723 模擬成果

- `POST /api/ec/auto-line/attribution/simulate`：`{testMode:true,sendId,friendId,eventId,kind:click|purchase,occurredAt,orderId?,amount?}` → `{accepted,replayed,testMode:true}`。管理者以上、閲覧のみ・代理不可。購入はorderIdと非負整数amount必須。
- `GET /api/ec/auto-line/sends/:id` → 模擬状態・予定時の本文・`results:{clickedMessages,purchases,purchaseAmount}`。
- `GET .../stats`：従来の`sent:0,clicks:null,purchases:null`を維持し、`simulatedResults`を別に追加。
- 関数：`ecAutoLineApi.simulateAttribution/send/stats`。既存`simulate`は店内だけの模擬実行。
- 同じ店・本人・模擬配信の行だけ、送った模擬時刻から7日内。同じ行のクリックより後の購入だけ。1注文1回、同event別内容409。他店・他人・リンクなし購入・8日目を拒否。実サイトの計測や実配信の成果ではない。
- 最終の条件付きUPDATEでも、購入・同意・在庫・カートの現在状態と上限を確認する。

## B2：724 試験の購入・月謝

- `POST /api/liff/booking/pass-plans/:id/checkout`：LIFF本人、`{testMode:true}`＋Idempotency-Key → `{id,planId,amount,status,checkoutId,checkoutUrl:null,checkoutAvailable:false,simulationAvailable:true,entitlementId,testMode:true,replayed}`。価格・券条件はサーバーの販売中プランの控えから決める。任意価格を拒否。
- `GET /api/liff/booking/pass-purchases/:id`：同じ本人だけの購入状態。
- `GET /api/booking/admin/pass-purchases` → `{items:[{id,planId,amount,status,entitlementId,billingStatus,graceUntil,testMode}]}`。予約閲覧。
- `POST .../pass-purchases/simulate-event`：管理者以上、店指定、閲覧のみ・代理不可。下記の正規化した試験イベントを渡す。
- `POST /api/booking/pass-payments/webhook`：専用のStripe試験署名（STRIPE_TEST_WEBHOOK_SECRET、5分）を確認。livemode:trueを拒否。`checkout.session.completed`（payment_status:paid）、`invoice.paid/payment_failed`、`customer.subscription.deleted`を正規化。実際のStripeへ書き込まない。
- 正規化入力：`{id,kind,checkoutId?,subscriptionId?,invoiceId?,amount?,currency?,periodStart,periodEnd,occurredAt,testMode:true}`。成功の額・JPY・契約と購入を照合。購入・券・請求の記録と履歴は同じbatch、通知再送・別event IDの重複成功でも同じ購入の券は1枚。
- 関数：`bookingPassPlansApi.checkout/purchase/purchases/simulateBillingEvent`。
- 月謝の失敗は最初の失敗から7日猶予。同じ周期の再失敗で延長しない。期限後は停止、支払いで回復。古い周期・古い失敗で回復を戻さない。既存の手動券は対象外。
- **checkoutUrlはnull**。この回は外部への書込禁止のため、Stripe Checkoutの実セッションは作らない。試験Webhook/管理者の模擬イベントで購入後の動きを確かめる。

## MCP・目的別一斉配信：725

- MCP接続の作成に`level:'send_request'`を追加（オーナー・本人確認、閲覧のみ・代理不可）。read/draftは依頼不可。
- `/mcp`の`request_broadcast_send`：`{accountId,broadcastId,expectedVersion,idempotencyKey,approverStaffId,testMode:true}` → `{broadcastId,version,approvalStatus:'pending',sent:false,testMode:true,replayed}`。その接続が作った下書きだけ。人が2人でも承認待ち、本人再確認を経た人の承認が必須。人の既存approval-approve（本人確認）の後に、管理画面が模擬実行を開始する。
- MCP本文・鍵は呼出記録へ入れない。作成元、現在の作成者/接続/権限と停止を確認する。依頼の記録失敗なら承認待ちも残さない。
- `POST /api/broadcasts/simulation-drafts`：`{title,text,purpose:transaction|notice|marketing,targetTagId?,testMode:true}`＋キー → `{id,version,recipients,...}`。
- `PUT /api/broadcasts/:id/simulation-draft`：同入力＋expectedVersion。目的と出自を独立保存。
- `GET /api/broadcasts/:id/simulation`：`{version,purpose,executionMode:'simulation',createdVia,state,matched,recipients,optedOut,simulated,sent:0,testMode:true}`。
- `POST /api/broadcasts/:id/simulate-send`：`{expectedVersion,confirmedRecipientCount,scheduledAt?,testMode:true}`＋キー。人数・版・承認・夜の時間を確認し、既存の予約送信処理へ載せる。通常の`/:id/send`もこの配信では模擬へ分岐。
- 関数：`broadcastSimulationApi.create/save/preview/send`。管理の編集/公開権限、閲覧のみ・代理不可。
- 本文はテキスト、相手は全員/自店タグ。既存の通常配信は従来の宣伝扱いを保持。この専用口で取引・お知らせを選ぶ。保存時と直前の目的別同意を同じ意味で確認する。
- 既存の受信者台帳にsimulation_pending/only/suppressedで保存、dispatched_atはnull、実成功数0。即時・予約・queue・再試行で実送信へ落ちない。DBも実送信の印を拒否。画面は必ずtestMode/実行モードを使い、模擬を実送信済みに見せない。

## 番号と境界

721 G5・722 G7・723 G6・724 B2・725 MCP/目的別配信を、2026-10-16 19:04 JSTの承認で作成した。本線ff790621a587d534f530ec109af2f00c01ac8f28と公開中PR全件のファイル全ページで、作成前の721〜725衝突0。push前の再確認は司令塔。

B8は対象外。実送信・実決済・外部書込・DB適用・配備・push・PRなし。画面接続/見た目照合、外部の本物の配信・Stripeセッション発行・EC側計測は未実施。


## 検証で見つけて直したこと

- 全DBの最初の実行は8失敗。既存タグの報酬へ既存倍率を重ねた計算を修正し、新しいランク倍率だけを適用した。過去382の器が717以降のタグ参照を拾う点は、その後年の表を過去の器から除外した（382の参照14件の番兵や本物のmigrationは変更しない）。期間の単体SQLの器には新しい読取列の表を追加した。関連3ファイル31件で復旧確認。
- ルート網羅で、前段から残った機能分類の登録漏れを検出。ランク/EC/AI記録/MCP接続は対応する機能、統括比較/初期セット/本人の在席/MCP/署名Webhookはそれぞれの専用境界を登録した。新しい統括CSV3口はowner/admin専用の一覧へ追記した。
- 閲覧のみの集計CSVは正式のダウンロードURLだけを許可し、任意のformat=csvによる一般の書き出し拒否を保持した。通常の書き出しの役割を広げていない。
- 生ログと故障対照は `~/lh-work/design/v8/review/gap3-approved-1016/`。故障対照後は元のバイト列へ復旧してから回帰を実行する。最終件数・型・ビルドの終了値は後段に記録する。


# 再開後の追加契約（B-349 / B-354 / B-355、2026-10-16）

この節が後段の古い説明より優先。721〜725は承認済み、作成のみ。画面は変更していない。

- `GET /api/liff/member-card`：本人の `memberNumber:string`（店ごとの表示用、友だちIDから独立した16桁の英数字、再読込でも同じ）、`benefits:string[]`（短い特典）、`next.progress:number`（0〜1）を追加。`next`は最上位でnull。割合は `(今の実績−今の段の条件)/(次の条件−今の条件)` を0〜1へ収める。実行中でランクありの本人だけ、無効なLIFF/本人未確認401。クエリのfriendIdは採用しない。従来の機械向け特典は `benefitDetails:{couponCode,mileMultiplier,tagId}` へ。`memberRanksApi.card` の型も追加。
- `PUT /api/member-ranks/tiers`：段ごとに `benefitDescriptions?:string[]`（最大10個、各200文字以内）。未設定の段では既存のクーポン/倍率から短文を返す。保存する番号は721。本人の番号は721で既存分へ発行、新規友だちにも自動発行。
- `GET /api/friends?lineAccountId=...&conditions=<JSON>`：既存の `all/any` の形で `{kind:'visit_count'|'purchase_amount',op:'between',value:{min?,max?}}`、`{kind:'last_activity_at',op:'between',value:{from?,to?}}`、`{kind:'member_tier',op:'eq',value:tierId}` を追加。来店数・購入額は365日の控え、最終日は期間外も保持、ランクは自店だけ。配信の `segment_v1` には既存の同名 `type/value` を使い、同じSQLで判定する。人数・一覧の権限は既存のまま。関数 `memberActivityFriendsApi.list`。追加の表なし。
- `GET /api/ai-features?account_id=...` → `{items:[{feature:'banner'|'google_review',enabled,version,consentBy,consentAt,disclosureVersion}],disclosure,disclosureVersion}`。owner/admin、閲覧のみは読むだけ、他店404。行なしは両方off/版0。
- `PUT /api/ai-features/:feature?account_id=...`：`{enabled:boolean,expectedVersion,consent?:true,disclosureVersion?:'2026-10-16'}`。オンには明示同意と `ai.settings` の本人再確認が必須。閲覧のみ・スタッフ・代理は403。古い版409。同意した人・時刻・説明の版と本文を同じbatchで設定と監査へ記録。監査保存失敗ではオンにもならない。オフでも直前の同意記録を消さない。`accountAiFeaturesApi.get/save`。保存する番号は725。
- バナーの `POST /api/hq/banners/projects/:id/generations` と `POST /api/hq/banners/generations/:id/run` に `account_id` が必要。自店のbannerがoffなら409 `code:'ai_disabled'`、`data:{enabled:false,feature:'banner'}`。生成の店を725へ保存し、再実行・cron・AIへ送る直前にも再確認。店の指定が無い既存ジョブも生成しない。
- 口コミの `POST /api/restaurant-test/google/reviews/:id/draft/generate?account_id=...` は自店のgoogle_reviewがoffなら409 `{code:'ai_disabled',enabled:false,feature:'google_review'}`。OpenAIにもWorkers AIにも渡さない。Google管理セッションの既存境界を保持。返信を手で書く/保存する口とは別。
- G2の要約/返信案の口は残し、既定409 `error:'g2_ai_unavailable'`。`GET /api/ai-settings` に `providerAvailable/providerUnavailableReason`。全体の旗 `G2_OPENAI_ENABLED=true` と `DEPLOY_ENV=local|test|development|staging` が同時にある時だけ開く。旗を変える画面/APIは設けず、運営の配備設定だけ。本番・環境名なし/不明では旗がtrueでも閉じ、本文の取得/利用回数/AI呼出より前に断る。QAの照合・自動応答は従来の送信なしの模擬だけ。G9の下書きは使えるまま。711の既定offを維持し、新規アカウント・初期セット・統括配布で勝手にオンにならない試験を追加。
- MCPの送る依頼は常に人の承認待ち。正本G9 §6に合わせ、接続を作った本人も管理画面の本人再確認後なら承認可。MCPの鍵による承認は不可。通常の人が依頼する配信の自己承認禁止は保持。

検証の最終結果・HEADは `docs/qa/gap3-api-approved-1016.md` と `gap3-approved-1016/RESULT.md` へ記録する。push/PR/DB適用/配備/実送信/実決済/外部書込は行わない。B8は対象外。

---


## 再開後の検出と補正

- B-354/B-355の追加依頼は、前回の未コミット実装にはまだ無かった。G2の提供元の旗、アカウント別のバナー/口コミの明示同意、会員証と友だち条件を追加。権限/版/同意記録の失敗・本人拒否まで試験した。
- 721の新規友だちへの会員番号の発行は、bootstrap組立器が扱えるトリガーの書式へ補正。失敗した最初のログ（resume-focused.log）は保存している。DB本番/検証への適用は行っていない。
- G9 §6は、接続を作った本人も人として確認後に承認できると定めていた。MCPの鍵の承認は閉じたまま、管理画面のstep-upを経た本人を許可した。通常の人の依頼で自己承認が403になる既存試験も維持。
- 725の旧MCP下書きの移行では、同じ下書きの再送記録が複数ある場合をDISTINCTで1行にした。メモリ内DBで旧記録を再現し、DISTINCTを外す故障をAssertionErrorで検出した。
- 行数検査は前段の積み重ねも含む20ファイルの超過を検出。API/DBの既存関数、一覧の数え方、応答の整形、初期セットの準備を分け、上限とbaselineを変更せず0にした。画面は変更していない。
- 分割後の広いWorker回帰は191ファイル2249件中、190ファイルと残り34件（計2248件）が成功。飲食店の既存試験1件だけが環境名なしで404だった。開始HEADにも同じ環境名なしの試験が残っていた。`DEPLOY_ENV:'test'`を試験入力へ足し、提供する環境の制限は保持。対象1件の再実行は成功（残り34件はこの実行では省略）。続く同ファイル全件と最終のDB/型/ビルドはfinish-*ログを正とする。
- 最終の故障対照は16種類すべてAssertionError。復旧の印とソースのバイト列も確認した。生ログ、各故障のバックアップ、最終ソースの111本の指紋は `~/lh-work/design/v8/review/gap3-approved-1016/` に保存。

- 最後の照合で、共通の目的別人数プレビューが「宣伝」の別名、非表示、LINE送信先なしの人を模擬実行と同じ意味で数えていない点も修正。目的の別名を同じ定数へ接続し、模擬実行との人数一致を試験した。関連5件は復旧後も成功、別名を落とす追加故障もAssertionError（合計17種類）。MCP承認後の試験も、送信0だけでなく模擬完了まで確認して6件成功。最終ソースは112本へ更新。

## 最終検証（再開後）

- 検証前に取り込んだ本線：`9089d1a712e468b920ba93fbe89e96a28e168169`、merge `8de983661a`。所有者確認済みの前回差分を保持。親EC、画面、Pencil、行数のbaselineは変更していない。
- Workerは191ファイルの広い回帰（2249件中2248件成功、環境名不足1件）に対し、試験の環境指定だけを補正して同ファイル35件をすべて再実行し成功。最後に追加した目的別人数一致も関連5件成功、MCPは実際の模擬完了まで6件成功。残った失敗0、対象の固有試験は2250件。
- DB全体391ファイル2290件、shared条件の1ファイル5件、画面用クライアント2ファイル7件が最終版で成功。
- 故障対照17種類：ランク通知、CSV全行、成果のクリック必須、支払い金額、MCP承認待ち、配信直前の同意、再入荷直前の在庫、ランク倍率、AI既定off、AI明示オン、AI同意、G2本番停止、会員番号、次までの割合、友だち絞り込み、旧MCP再送移行、目的の別名。すべてAssertionErrorで検出し、元のバイト列へ復旧。
- shared/DB/Worker/Webの型検査、Worker/Webビルド、bootstrap整合、追加5本のmigration方針、行数上限（違反0）、差分検査は終了0。変更したWebクライアントのlintも終了0。Web全体に元からある警告は残し、画面を変更していない。
- 最終検証の入口は `/tmp/gap3-finish-validation.sh` と、環境指定の補正後に再開した `/tmp/gap3-finish-rest.sh`。いずれもheavy.shで実行。個別の復旧結果はfinish-styles-fixed、finish-purpose-restored、finish-mcp-execution。ログは失敗分も含め `~/lh-work/design/v8/review/gap3-approved-1016/` に保持。
- 検証・ビルド後の112ソースの指紋は一致、故障状態の残り0。最終HEADとコミット後のクリーン確認は同フォルダのRESULT.mdと外部契約へ記録する。
- 721〜725は作成のみ。DB適用、配備、push、PR、実送信、実決済、外部書込みは0。B8は対象外。実Stripe Checkout、EC側の実計測、Meet/Zoom/Teams自動発行・Outlook・デポジット回収等の外部アダプターと、B2の残り/期限通知は未提供のまま。画面接続・見た目の照合・5万人の性能保証はこの作業では行っていない。
- 反映履歴はpendingファイルに追記済み。PR採番後のファイル名・本文の番号確定と、push前の本線/公開PRの721〜725再確認は司令塔。

## コミット

- 共通のAPI処理の分割：`f6c2ab3728`
- 承認済みDB/共有型：`7204604b7b`
- Worker/試験：`3a7ec51f44`
- 画面用クライアント：`6663ecdf26`
- この記録の最終コミットとクリーン確認は外部 `gap3-approved-1016/RESULT.md` に記載（自分自身のSHAを本文へ埋め込むためのamendは行わない）。
