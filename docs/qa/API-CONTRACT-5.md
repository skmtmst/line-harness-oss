# API 組5 — 機能待ちの板の口（B-323 / 2026-10-16）

## 今の進捗を全体像から整理するとこれ

34板を全部確認した。担当の重複は板名だけでなく不足する機能で照合した。

- 組5の拡張は3件：Upx1cの保存版の通数・差し込みと絞り込み、Qgjmcの受信箱の対応状況と記録されたマーク変更、UTbi1の公開版を作った人。
- rSRFKは既存APIがある。新しいAPIや権限の仕組みを二重に作らず、画面の接続先を下に記載した。
- その他30板は組1〜4の指示書の物。B-299の18板を含め、組5で重複実装していない。B-299は撮影するための案だけ。APIがあることを、画面の完成・撮影合格とは数えない。
- Upx1cの複数通の**作成**・保存した検索、Qgjmcのマーク別の表示場所の**保存**は未実装。保存先の案を後述。既存JSONや別機能の台帳へ無断で詰め込まない。
- migrationファイルの追加0、DB適用0。LINE送信・決済・外部ログイン・配備・push・PRは行っていない。画面・Pencil・合格台帳・親ECも変更していない。

作業場所：`~/lh-work/lh-api-5`、枝：`codex/kenta-api5-1016`。
既に作成済みのクリーンな専用worktreeで着手し、指定のdoctorは最終行「合格」。fetch後の本線をmergeで照合した。テスト前の本線SHAは `cd63dd961f5dc2613a8b16c39a21d01e2cf7c8ba`。rebase・force・stashなし。

## 1. 作ったAPIと画面の接続先

### Upx1c：統括テンプレート一覧の通数・差し込み

既存の `GET /api/hq/templates` を拡張した。別の一覧APIは作っていない。

- 入力：`type=template&kind=message`。任意で `message_count=single|multiple`、`has_interpolations=true|false`。空文字・未知の指定は400。
- 返値：各行に `message_count:number|null` と `has_interpolations:boolean|null`。従来のID・版・種類・配布先・集計・kind_countsは保持。本文やメディアURLを追加で返さない。
- 最新の保存版だけを読む。カルーセルやカードは1通。依存する画像ファイル数を吹き出しの数にしない。今のメッセージ定義は1通なので、正しい保存版は1、複数通の絞り込み結果は現在0件。
- 差し込みは共有の `listInterpolations` を使い、本文・カード・カルーセルの処理・質問・素材から判断。`{{name}}`、`{{field.xxx}}`、`{{var.xxx}}`、既存の店舗用差し込み等を検出する。ファイル名やテンプレート名に記号があるだけではtrueにしない。判定は「記号があるか」であり、送信前の参照・値の検証の代わりではない。
- 壊れた版・読めない将来の複数通の形式は両方null。nullをfalseや1にしない。true/false、1通/複数通のいずれの絞り込みにも含めない。
- 権限：従来どおり自組織の有効なowner/admin、全体スコープ。GETは閲覧のみでも可。実DBの所属・役割・アカウント範囲を検証する。
- Web：`apps/web/src/lib/api-feature-wait.ts` の `listHqMessageTemplates({messageCount?,hasInterpolations?})`。既存 `hqTemplatesApi.listByKind('message')` 等でも行の追加値は受け取れる。共有の `HqTemplateListDisplay` に型を追加済み。
- 画面側：種類の札は既存 `message_type`、1通／複数通の札と絞り込みは `message_count`、差し込みありは `has_interpolations` へ接続。行の選択は画面のID集合で保持でき、新しいDBは不要。「よく使う絞り込み」の保存と複数通の新規作成は下記の承認待ち。
- 試験：`hq-feature-wait-api5.test.ts` 前半3件。保存→実SQL一覧→条件、本文非公開、書込み・外部通信0、null、カード、不正条件、閲覧のみ・組織・役割・アカウント範囲を検証。

### Qgjmc：統括の集計（保管・復元は組1の物）

既存の `GET /api/hq/templates?type=mark` または `?kind=support_mark` の `stats` を拡張した。保管・復元の口は組1の実装を使う。

- 入力：上記のtypeまたはkind。期間の入力はなく、取得時刻から直前168時間。
- `stats.supportStatus`：`source:"chats"`、`friendCount`、`unhandledFriendCount`、`inProgressFriendCount`、`unhandledPercent:number|null`。受信箱のunread/in_progressの友だち人数。分母は同じ範囲に受信箱がある友だち人数、分母0の割合はnull。
- `stats.markChanges`：`source:"operation_audit"`、`count`、`coverage:"recorded_events_only"`、`since/until`。現在の対象友だちについて、既存の記録に残るsupport_mark/changedだけを数える。手動・自動は分けず、作成・定義変更・タグ操作を混ぜない。期間は `[since,until)`。
- `stats.scope:"active_accounts_visible_friends"` と `updatedAt`。同じ組織の有効・未保管アカウントの非表示でない友だちが対象。別組織、停止・保管済みの店、非表示の友だち、アカウントが食い違う受信箱は除く。
- 監査の時刻は既存の日本時間・Z・明示offsetを扱う。既存監査は欠落があり得るため、完全な「実際に起きた全変更件数」ではない。友だちの所属が後で変わった場合、当時の所属へ遡及せず現在の可視範囲の記録として集計する。記録0は記録上の0、DB失敗は500。取得失敗を0にしない。
- **正本との違い**：`v6-04` §8は対応状況と自由な対応マークを分ける。マークの名前が「未対応」でも、このKPIの判定には使わない。受信箱の状態を友だち全体の別の対応状態として表示しない。画面の説明も「受信箱の対応状況」「記録された過去7日のマーク変更」とする。絵の説明との食い違いは司令塔の判断が要る。
- マーク別の「付いている人」は既存 `data[].friend_count`。表示場所は現在マークごとに設定・保存する口がないので、保存済みの値であるような固定配列を返していない。後述の案を承認してから作る。
- 権限：Upx1cと同じ。追加の集計を返す前も既存authorityを通す。書込み・外部通信なし。
- Web：`fetchHqMarkListStats()`（`api-feature-wait.ts`）。受信箱の値とマーク変更の値は別々に接続する。対応状況をマークの人数へ足したり、同名のマーク数をKPIへ代入しない。
- 試験：同Worker試験後半2件。実SQL、複数店、別組織・停止店・非表示・壊れた所属の除外、期間端・JST/Z/offset、他種操作の除外、割合のnull、閲覧のみ、DB失敗を確認。

### UTbi1：店のテンプレート版を作った人

既存の `GET /api/templates/:id/versions` を拡張した（統括ひな形の別の履歴APIではない）。

- 入力：既存のテンプレートID。追加のbody/queryなし。
- 返値：各版に `createdByStaffId:string|null`、`creatorName:string|null`、`creatorNameSource:"current_staff_profile"|null`。版番号・本文・状態・日時等は従来どおり。
- 既存の `template_versions.created_by_staff_id` を使う。公開時点の担当者IDは既に原子的な公開処理で記録されていたので、新しい列・書込みを足していない。
- 名前はテンプレートのアカウントと同じ組織の名簿から取得する。停止済みの作成者も同じ組織なら表示可能。旧版・担当者不明・別組織・アカウント未設定はnull。現在の閲覧者や最新の保存者を流用しない。
- 名前は**現在の名簿名**。改名すれば表示も変わり、公開時の名前の写しではない。ソースを返して区別する。履歴のID・本文・日時を書き換えてはいない。
- 権限：既存のテンプレート閲覧権限とアカウント範囲を維持。担当外404。新しい書込み・送信なし。
- Web：既存 `api.templates.versions(id)` の返値型を `apps/web/src/lib/api.ts` で拡張。画面は版の `creatorName + createdAt` を表示し、nullなら「作成者不明」。未公開の下書きは公開版の履歴に含まれないので、公開した人を下書きの保存者として出さない。
- 試験：`templates-versions-820.test.ts` に2件追加。実際の保存・公開2版→名前取得、停止・改名・別組織・不明・旧版・アカウントなし、担当外404を確認。既存の履歴・版の復元12件も成功。

### rSRFK：既存の組織・権限の口（新しいAPIは不要）

画面が無いという判定であり、API・保存先まで無いわけではない。以下を再利用する。

| 役目 | 既存API | 画面側の関数・接続 |
|---|---|---|
| 統括→事業部→店舗、店舗の状態・LINE名、名簿 | `GET /api/restaurant-test/snapshot?account_id=...` | `restaurantTestApi.snapshot(accountId)`。organizationのtenant_name/name、stores、membershipsを使う |
| 店舗の作成・変更・停止 | `POST /api/restaurant-test/stores` / `PATCH /api/restaurant-test/stores/:id` | `restaurantTestApi.createStore/updateStore`。statusはactive/paused/archived |
| 名簿の作成・変更・停止/再開 | `POST /api/restaurant-test/memberships` / `PATCH /api/restaurant-test/memberships/:id` | `restaurantTestApi.createMembership/updateMembership`。既存の版・本人確認・最後の管理者保護を保つ |
| 名簿と実際のログイン権限を結ぶ | `GET /api/restaurant-test/login-members` / `PUT /api/restaurant-test/memberships/:id/login` | `restaurantTestApi.loginMembers/linkMembershipLogin`。名簿のroleだけで権限を付与しない |
| 取り込み用アドレスの一覧・発行 | `GET /api/restaurant-test/intake-addresses?account_id=...&storeId=...` / `POST /api/restaurant-test/intake-addresses` | `restaurantTestApi.listIntakeAddresses/issueIntakeAddress`。実際のドメイン未設定は503。今回は発行なし |

これらの関数は既存の `restaurant-test-api.ts`。組織/店舗/本人の範囲と既存requireRoleをサーバーで確認する。snapshotはowner/admin/staff、店舗・名簿・アドレスの変更はowner/admin。受信箱等の表示権限から権限管理の変更権限を作らない。

絵の権限マトリクスは役割分担の説明で、操作可否はログイン権限が正。既存の名簿数・store_manager数・LINE/Googleの有無は返値から数えられる。新しい仮のKPIは不要。画面の入口・木・表・確認窓はClaude側の作業。既存Worker `restaurant-test.test.ts` 115件（名簿/ログイン保護・所属境界・店舗・取り込み口等）とWeb `restaurant-test-api.test.ts` を確認した。

## 2. B-299でない16板の担当表

| 板 | 扱い・作った口／画面がつなぐ所 |
|---|---|
| J7HNK | **組1の物**（Ft2Eyと同じ配布）。組1のdistribution-targets→保存後のpreflight→resolutionsを渡す。配布方法を未配布という履歴だけで決めない。組5で再実装しない |
| N4T9mO | **組1・組2の物**。試しURL/店別参照は組1、メニューを選んでもらう/未承認の保存は組2のijxur。両方を統合後、保存先の版と配布先の店IDを画面で渡す |
| UgZPJ | **組1の物**。displayAudience/tag名/defaultOpen、保存前の参照・同名確認。組1のpreview/save/preflightへ接続 |
| Upx1c | **組5で拡張**。上記一覧のmessage_count/has_interpolationsへ接続。複数通の作成・保存した検索は承認待ち |
| W5Wxr | **組2の物**（追加11、画像ライブラリのフォルダ）。組2のAPI-CONTRACT-2と画像フォルダの口へ接続。組5はフォルダを増設しない |
| ME78d | **組1の物**（リッチメニュー・保存前確認/参照）。14種と呼ばれる動きの保存・実行、計測・タグのうち未対応が残れば組1/司令塔の一覧で確定する。現在の実装を14種対応済みとは報告しない。組5から同じadapterを並行変更しない |
| cmRZc | **組1の物**（ME78dと同じリッチメニュー）。既存pagesで直すタブを切り替え、店別予約ページ・押した人のタグ・参照充足は組1へ。未対応の動きは有効に見せない |
| n9vvGx | **組2の物**（追加14、複数吹き出し）。カルーセル・2通目・記念日の前の残りを組2の契約で確認して接続する。組5のmessage_countと別機能 |
| iN6np | **組2の物**。複数の後処理とシナリオ開始。組1側にも関連する実装があるが、今回の引継ぎ先は指定どおり組2。組5は作らない |
| v0SbYR | **組1の物**（追加2）。既存submissionsへperiod=this_month/last_month/all。summaryにも同じ期間が効く組1の実装を使う |
| Qgjmc | **保管/復元は組1の物**。組5は上記集計だけを拡張。表示場所の保存は承認待ち。絵の対応状況/マークの混同も判断が要る |
| UTbi1 | **組5で拡張**。既存店内版履歴のcreatorName/createdAtへ接続。現在の名簿名と明示する |
| Fkv3w | **組1の物**（追加10ほか、店別タグ/クーポンの参照）。既存の保存・配布を組1の検索結果の店ID/名前と組み合わせる。回答後/選択肢の処理を重複実装しない |
| Ft2Ey | **組1の物**（追加8）。確認前の版と配布本体。J7HNKと同じく履歴と同名上書き可否を区別する |
| T5ljMA | **組1の物**（追加9と統括ひな形）。priorityは既存settingsで対応済みという組1の検証記録あり。返すものの選択と後処理は既存delivery定義のresponseType/templateId/actions/referencesを組1の契約で確認してつなぐ。組5では別の保存口や実行機構を追加しない |
| rSRFK | **既存API、画面側の作業**。上記snapshot/店舗/名簿/権限/取り込みアドレスを接続。任意の多段組織を新設する話ではない |

組3（割当・支払い）と組4（スタイル・初期セット・ダッシュボード）も指示書と契約書を読み、該当機能を変更していない。

## 3. B-299の18板：案だけ（すべて組2の物）

API組2指示書の項目8に18IDすべてがある。以下は撮影に必要なものの整理であり、API・DB・画面を追加したという記録ではない。組2の `API-CONTRACT-2.md` の18板表とも照合した。

| 板 | 何を用意すれば撮れるかの案 | 組5の扱い |
|---|---|---|
| Cfed0 | 実在するGoogle投稿・状態を一覧へ接続。投稿と関係のないLINE既読率やコラム件数をこの板へ出すのか、司令塔が絵/要件を決める。記録のない値を作らない | 組2の物、要件判断待ち |
| E14GFm | 保存済みの同じ流入リンクを2人で編集→409→下書きを残した比較窓を開く。整数版/保存者の完全な一致は組2の保存記録案を確認 | 組2の物、状態入口/記録 |
| Gqve5 | 保存済み紹介者の編集と競合状態。更新版/保存者の不足は組2が挙げる既存PRと採番を司令塔が調整。新規作成の画面に仮の競合は作らない | 組2の物、DB/既存PR判断 |
| NGh7b | 保存済みWebhookを同時更新しexpectedVersionの409と最新保存者/時刻を比較窓へ。新規作成とは区別する | 組2の物、画面入口 |
| NQtrW | 写真を選んだ状態と店舗/メニュー/スタッフへの参照・使用中削除防止。組2が挙げる写真用の既存PRを先に確認 | 組2の物、DB/既存PR判断 |
| OhguS | 実在する問い合わせIDの詳細・summary・履歴を読む。返信を入力できる状態を開き、試験用データで撮る。実際の問い合わせ送信は不要 | 組2の物、集計/詳細接続 |
| V4LjH | 保存した自動応答を正常に公開した返値から完了状態へ。409を成功へ置き換えない | 組2の物、公開成功の入口 |
| aRvrh | 既存の店頭/スタッフQRのURLを取得し小窓を開く。絵の各状態を切り分け、保存用のQR描画は画面側。期限・世代を守る | 組2の物、小窓/状態 |
| b8xBtZ | 問い合わせのsummaryと一覧を接続して数の帯を出す。全件数を表示ページの行数で代用しない | 組2の物、集計接続 |
| cXqlS | 保存済み成果定義のexpectedVersion競合を開き、既存previewの30日試算を接続。計測前の過去成果を確定扱いにしない | 組2の物、比較/試算 |
| fBSdY | 画像付きカルーセルで題なし・ボタンの不正URLを入力し保存→422を欄へ表示。既存の検証を弱めない | 組2の物、エラー状態 |
| lwWLu | 表示項目の小窓を開き7列選択。既存の列保存と情報欄一覧を使い、8列目を選べない状態を用意 | 組2の物、上限の入口 |
| nGcY1 | F-24のinventory-rules GET/PUTをタブから開く。絵の残り6→3と正本の止める値の違いは司令塔が決める | 組2の物、入口/要件判断 |
| sFwWf | 保存済み追加時ルールから「自分へ試す」窓を開く。本人限定の既存test-sendの宛先・確認を維持。撮影で本物へ送らない | 組2の物、試し窓 |
| uAWb7 | 会社設定のGET/PUTへ接続しロゴ選択/保存状態の入口を用意。既存の所属・版・公開メディア検査を保つ | 組2の物、設定入口 |
| vWJEm | E14GFmと同じ保存済み流入リンクの古いexpectedUpdatedAtで409。自分の下書きを保持して最新値の取込みへ | 組2の物、競合入口 |
| w51h8 | 席モード・店舗・日付を指定して今日の予約と待機一覧を開く。待機人数と順番は実在する試験用データで用意 | 組2の物、状態/見本データ |
| wJYQb | F-25のsync-rules/sync-noticesをタブから開き、Google未接続・上限等の保存済み状態を接続 | 組2の物、タブ/状態 |

これらを組5で作り始める前には司令塔のOKと組2との所有範囲の調整が必要。本依頼で許された「案だけ」の範囲で止めた。

## 4. 新しい保存先の案（未承認・作成なし）

637〜662は割当済みとして扱い、新しい番号を使っていない。以下の663以降は**案であり予約ではない**。司令塔が最新本線・公開PR・他組の枠を再照合し、番号ごとのオーナー承認後に実装する。

| 番号案 | 必要な保存先・列 | 理由・承認後の作業 |
|---|---|---|
| 663 | 複数通テンプレートの親 `template_message_bundles(id,line_account_id,name,current_draft_version_id,current_published_version_id,revision,archived_at)` と不変版 `template_message_bundle_versions(id,bundle_id,version_number,definition_json,created_by_staff_id,created_at)`。版のdefinition_jsonに最大5通の順序・種類・本文・参照を保存。所属FK・版一意・JSON検証 | Upx1c。今の店テンプレートと共有定義は1通。HQ版のJSONだけに複数通を置いても、店への配布と送信が1通のままになる。保存/参照/コピー/配布/公開/送信を一体で対応し、既存1通との互換を保つ。別案として既存templatesの複数通拡張を選ぶ場合も、列/版/利用先を先に設計承認する |
| 664 | `hq_template_saved_views(id,tenant_id,owner_staff_id,name,filters_json,scope,revision,created_at,updated_at,archived_at)`。scope=personal/tenant、スタッフ/組織FK、JSONの許可キーと範囲を検証 | Upx1c「よく使う絞り込み」。個人のお気に入りや一斉配信の保存検索とは別。組1の「よく使う」の承認範囲との統一も司令塔が判断 |
| 665 | `support_mark_display_preferences(mark_id,line_account_id,tenant_id,locations_json,revision,updated_by,updated_at)`。mark/account/tenantの所属、locationsの許可値（inbox/friends/friend_detail）を検証 | Qgjmc「出す場所」をマークごとに保存し、受信箱・友だち一覧・詳細が実際に守るため。HQのmark定義にもdisplayLocationsを足し、保存/配布/上書き確認まで同じ値を扱う。未保存の既存マークの既定と、マークとは別の対応状況の説明も承認する |

UTbi1で公開時の**名前の写し**まで必要なら、別途 `template_versions` のスナップショット列と既存の原子的な公開/復元処理への組込みを設計する。現在の要望は既存IDから名前を返せるため、今回は列追加を提案の必須条件にはしていない。

B-299のNQtrW/Gqve5等は組2の既存PR/採番調整の物なので、ここで新番号を重ねて割り当てない。任意の外部連携・本物の送信を新設する作業もない。

## 5. 検証と証拠

- HTMLと文字表を全34板（68ファイル）読み、判定TSV49行を板IDで照合。外部の証拠：`~/lh-work/design/v8/review/api5-1016/board-evidence.json` に参照パス・SHA256・抽出文字・判定行を保存した。画素一致の証拠ではない。
- 新規API試験：Worker5件、版履歴に追加2件、Web2件。実SQLiteを使い、送信・外部通信せず検証。
- 関連Worker：8ファイル282件成功（新規一覧5、版履歴14、HQ一覧63、種類11、友だち属性34、店内テンプレート26、組織管理115、OpenAPI14）。
- 関連DB：3ファイル33件成功（公開版22、原子的な履歴2、所属境界9）。
- 関連Web：4ファイル155件成功（新API関数2、既存API120、HQ関数31、飲食関数2）。重複を除く合計470件。全Worker/全Web/全CIではない。
- Worker/DB/Webの型検査成功。追加ファイルと版取得DB関数のESLint成功。変更した既存ソースもエラー0（未使用変数の警告14件）。React検出・pages探索の警告もあり。`git diff --check`成功。
- 初回の新規集計試験は、同一友だちに受信箱を複数作ろうとしてDBの一意制約で失敗した。製品/制約は変えず、別の友だちの不正な所属を試験データにして再実行し成功。未解決の試験失敗はない。
- Worker本番形式ビルド：共通のheavy.sh経由で成功（SSR/クライアント両方、終了0）。既存の動的/静的import混在と500kB以上のchunkの警告のみ。配備なし。

## 次のタスクはこれ

1. 司令塔が組5のコミットをAPI列車へ取り込み、組1/2の同じ一覧・adapterとの変更を両方保持して統合する。統合後の実SHAで関係試験・型・ビルドを再確認する。
2. ClaudeがUpx1c/Qgjmc/UTbi1/rSRFKを上記関数へ接続する。未保存の複数通・表示場所や、記録の完全性を「使える」と出さない。34板の撮影・再判定は別工程。
3. 663〜665の保存先案、Qgjmcの文言、他組に残る14種の動き等を司令塔が判断する。承認前にmigrationやB-299の実装を始めない。
4. PR採番時に司令塔が `docs/release-log/unreleased/<PR番号>-kenta-api5-feature-wait.md` を作成し、日本時間の実日時・@kenta・実PR番号で反映履歴を記載する。文案：「統括のテンプレートを通数・差し込みで絞り込めるようにした」「統括で受信箱の対応状況と記録されたマーク変更を確認できるようにした」「テンプレートの公開版を作った人の名前を表示できるようにした」。複数通の作成や表示場所の保存が完成したとは告知しない。
5. 本組はDBファイルを作っていないので、DB適用・dry-runの起動は不要。司令塔が別の承認済み組を統合・配備する際の工程は別扱い。


## コミットと最終状態

| SHA | 内容 |
|---|---|
| `93bd8c577f` | UTbi1：既存の公開版に保存した担当者IDから同じ組織の名簿名を返す。API型と実SQLiteの試験 |
| `9b8188f3b8` | Upx1c/Qgjmc：一覧の通数・差し込み条件、受信箱と記録された変更の集計、Web関数・試験・OpenAPI |

この後に本書の引継ぎコミットを追加する。指定の外部 `~/lh-work/design/v8/review/API-CONTRACT-5.md` にも同じ本文を保存する。コミット後の追跡変更・未追跡ファイル0を確認して終了する。push・PR・統合は司令塔が行う。
