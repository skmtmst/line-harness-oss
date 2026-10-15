# API 組5 — 10-16 04:30 の担当変更に対応（この節が以前の担当表より優先）

## 今の進捗を全体像から整理するとこれ

34板のうち、B-299以外の16板について、以下のAPI・共有型・Web関数を用意した。W5Wxr/rSRFKは既存APIを試験して接続先を明示、iN6npは組2のため変更しない。B-299の18板は下の初回の案を維持し、製品を追加していない。EpTBBも組1のため変更しない。画面の実装・撮影の合格はこの作業に含めない。

組1・組2の既存コミット（bdc414be84 / 03d4534e82 / ecac723a92 / 08ee227fe0 / 5288ca360d）から該当するAPI部分を再利用し、不足した機能を組5で補完した。他組の作業ツリーは変更していない。初回に「他組の物」として保留した範囲は、04:30の再指定でこの節の担当へ変更した。

## 板ごとの受け口と接続

すべての統括APIは、自組織の有効なowner/admin・全体スコープ。読取りは閲覧のみ可、更新は不可。店のAPIは既存の担当アカウント・機能権限を使用。外部への実送信・公開・DB適用は行っていない。

| 板 | 作った口・既存の接続先 | Web関数・画面側でつなぐ所 |
|---|---|---|
| J7HNK / Ft2Ey | `GET /api/hq/templates/:id/distribution-targets?accountIds=a,b`。省略は自組織の全有効店、最大30/重複不可。`{templateId,latestVersion,requiresPreflight:true,stores:[{accountId,accountName,folderId,targetVersion:{version,latestVersion,status,label}}]}`。未配布はversion:null。実際の上書き可否は既存preflightを取り直す | `fetchHqDistributionTargets(id,accountIds)`と`fetchHqDistributionAccounts()`。既存`GET /api/hq/templates/accounts`にもfolderIdを返す。`api.lineAccountFolders.list()`と結び、返された有効店だけで分類別の件数を数える。選択集合は画面で保持。確認は`POST /:id/preflight {accountIds}`、実行は`POST /:id/distribute {preflightId,resolutions}`。取得時点の未配布を同名項目なしとみなさない |
| Fkv3w / Ft2Ey | `GET /api/hq/templates/resources?kind=tag/coupon/scenario&q=...&accountIds=...&limit=30&cursor=0`。`{kind,items:[{id,name,accountId,accountName}],total,nextCursor}`。タグは有効、クーポンは公開版あり、シナリオは有効。本文・コード・顧客情報を返さない。既存保存の`definition.references[]`へ`{sourceId,kind,name,accountId?}`を保存。指定元の店・素材IDもサーバーで検査。同じ配布先はIDを保持、ほかの店では同名の1件に結び直す | `searchHqTemplateResources`。選んだ店と素材IDをreferencesへ入れ、`hqDeliveriesApi.create/update/preflight/distribute`へ。店をまたぐIDをそのまま使わない。couponは`responseType:'coupon',responseContent:JSON.stringify({assetId:sourceId})`と宣言し、店の公開素材の内容・IDへ固定 |
| T5ljMA | 既存auto_reply保存/配布。`settings.priority`は整数-9999〜9999、小さい順。`responseType/responseContent/templateId/actions`と宣言した参照を保持。カードはflex、画像はimage、返信なしはsilent。後の処理は順序と`onFailure:'stop'/'continue'`を保持。通知ルールは配布先の版へ固定 | `hqDeliveriesApi.create/update`。タグは`{actionType:'tag',config:{op:'add',tagIds:[sourceId]},onFailure:'stop'}`、対応マークはsupport_mark、通知は`notify_staff`の既存処理。通知先IDはnotification_ruleの参照で宣言する |
| UgZPJ | 既存rich_menu保存へ`displayAudience:'all'/'store'/'tag',displayTagName?,defaultOpen?`。タグ指定は各店の有効な同名タグが1件必要。`POST /api/hq/templates/rich-menu-preview {name,accountIds,definition?}`は書込みなしで店別の同名メニュー/上書き可否・参照の充足/画像サイズを返す | `saveHqRichMenu` / `previewHqRichMenu`。全員向け・タグ対象・店に任せる、開く/閉じるを保存。配布は各店の下書きまで。LINE上の公開は既存の店の公開工程 |
| ME78d / cmRZc | 同じrich_menu定義のareasへ電話tel、日時datetime、コピーclipboard、上級postbackを追加。既存のURL/テキスト/テンプレート/フォーム/予約/予約履歴/スタンプ/タブを保持。`bookingMenuName`は各店の受付中の同名メニューへ一意解決。`useTrackedLink:true`はURI動作に限り、各店の計測リンクと`tracked_link_id`を配布と同じ原子処理で保存。URL系の押した人へのタグは`tagIds`1個まで。postback/日時は既存の押下処理でタグ付け | `saveHqRichMenu` / `previewHqRichMenu`。datetime/clipboardはDBのactionTypeをpostbackにしintentで本来の動きを保持。URI計測は既存の店の公開時に生成URLへ。`dataBindings:{uri:'店の電話',initial:'日付の名前',text:'共通情報の名前'}`で各店の有効な同名共通情報を使用。未取得・曖昧・期限切れ・不正な値は配布しない。通常のactionDataは同じ動きの入力見本として検査する |
| N4T9mO | フォームの`booking.allowMenuSelection/requireApproval`を保存。統括から配る際は同名の店メニュー/担当へIDを写す。既存`POST /api/liff/booking/requests?liffId=...`へ`{formAnswer:{formId,blockId,submissionKey}}`を追加。認証本人・同店の完了回答・回答に固定した公開版・非テストを検査し、メニュー/担当/日時を回答から読む。選択ONは同店の受付中メニュー、OFFは固定メニュー。期間/担当/空き枠/支払いの既存検査を維持。承認ONはrequested、OFFは店の設定に従う。同じ回答と欄は画面のキーを変えても1回だけ | `bookFromForm(liffId,idToken,formAnswer)`。メニュー候補と空き枠は既存のLIFF booking API。回答の送信完了後に受付を呼ぶ。画面からmenu_idやrequireApprovalを足しても保存済み設定を上書きしない。公開前の確認は`testHqForm`（実送信/回答保存なし） |
| n9vvGx | `PUT /api/restaurant-test/followups/:storeId/steps/:stepId/messages?account_id=... {expectedVersion,messageBubbles}`。1〜5通、展開後も5通。保存で版が増え本送信は停止、再承認が必要。GET scenariosのstepsにmessageBubbles。`anniversary_before`の行も追加（既定7日前、初期は無効）。既存bindingのPOST/PATCHで`trigger:'anniversary_before',offsetMinutes:-10080,enabled`を保存。記念日は固定の友だち情報欄を使用、店の時刻10:00・平年の2/29は2/28。承認済み固定版/送信停止/同じ起点の再送防止を共通ジョブで使用 | `restaurantFollowupApi.get/saveMessages/binding/addBinding`、`api.scenarios.get`。来店フォローの行と複数吹き出しへ接続。「記念日の前」はGETのbindingsから取得し、押されたら対応するstepIdを編集。保存→公開→本送信開始の承認は既存工程。今回の作業で本送信は開始していない |
| v0SbYR | `GET /api/forms/:id/submissions?period=this_month/last_month/all`。日本時間の暦月、終端は翌月1日未満。一覧・件数・開始/完了・日付回答・評価平均等を同期間で絞る。from/toとの併用・未知値は400 | 既存`api.forms.submissions`の検索オプションにperiod。期間の丸ボタン変更で同じオプションを一覧と集計へ。件数0と取得失敗を区別 |
| Upx1c | 既存`POST/PATCH /api/hq/templates`のメッセージ定義に`messageBubbles:BroadcastBubble[1..5]`。text/image/flex/carousel/imagemap、展開後も最大5通。単一通と同じ固定版・配布前確認・配布を使用。店の公開版/版履歴に全吹き出しを保持。統括一括配信の素材選択を展開するときは、配った固定版から全通を順番どおり読む。kind=messageの件数/差し込み/検索条件にも反映 | `saveHqMessageTemplate`と既存detail/preflight/distribute。選択する素材の`content.hqTemplateId/hqTemplateVersionId`は従来どおり。複数通は統括一括配信の経路で展開する。1通しか扱わない既存の自動応答・リマインダ等には結び付けず、後ろの通を黙って落とさない。店側の旧1通編集は409で拒否し統括の編集へ案内 |
| Qgjmc / UTbi1 | 前回のマーク表示場所/保存した絞り込みと、公開版を作った人を維持 | 下記の前回の接続表を使用 |
| W5Wxr | 既存の`/api/hq/banners/folders`のkind=image、画像一覧のfolderId。分類CRUD/色/順序/版検査/保管時の中身維持を既存経路で使用 | `api.hqBanners.folders.list/create/update/swapOrder/delete`、`api.hqBanners.images.list({folderId})`。画像ライブラリの分類なのでkind=projectではない |
| rSRFK | 組織snapshot・stores・memberships・staffの既存APIを使用 | 下記rSRFK接続表。名簿の追加と実ログイン権限の付与は別。新たな組織/権限台帳を作らない |
| iN6np | 組2の物 | 変更なし |

## 保存先と適用の境界

番号はB-324で承認された666〜680のみ。今回の追加は666（複数通の公開/下書き/版履歴・配布元の版ID）と669（記念日前の行と新店舗の初期化）。前回の667/668も維持。663〜665は組3、670〜680は未使用。作成前の本線最大636、公開中PRのmigration最大565、666〜680の公開PRとの重複0を確認。push直前の再照合は司令塔。

669を適用すると、既存の起点変更トリガーにより、対象店の共通フォローは停止し承認が失効する。配備時は、保存した新しい行を含む版の公開・本送信開始の再承認を司令塔が扱う。記念日の行自体は初期無効。今回その工程は行っていない。

検証・本番D1への適用0。ローカルのbootstrap生成と試験用のメモリ内SQLiteだけを使用。司令塔が統合・クリーン・対象SHA・バックアップを確認してから行う検証用dry-run（今回は実行していない）：

```sh
gh workflow run migrate-d1.yml -R skmtmst/line-harness-oss --ref codex/development -f operation=migrate -f environment=staging -f mode=dry-run -f migration=666_template_message_bundles.sql
gh workflow run migrate-d1.yml -R skmtmst/line-harness-oss --ref codex/development -f operation=migrate -f environment=staging -f mode=dry-run -f migration=669_restaurant_anniversary_followup.sql
```

## 次のタスクはこれ

司令塔が下記の最終コミットと検証を確認して統合し、666〜669のDB工程を別途進める。画面担当A・Bが上の関数/型へ接続してから撮影をやり直す。B-299の18枚の案は下記を判断してから着手する。PR採番後の反映履歴案：「配布するテンプレートに複数通を保存し、店ごとの素材と予約受付の設定を引き継げるようにした」「来店フォローで複数通と記念日の前の案内を設定できるようにした」。実番号・@kenta・日本時間の日時は司令塔が付ける。

## 検証結果・コミット

実装コミット：`6035e8e9e4`（承認済み保存先・DB/共有型・Web関数）、`ff04f970f5`（Workerの保存/配布/受付と試験）。

- doctor合格、開始時の未コミット/未追跡0。元の本線は`cd63dd961f5dc2613a8b16c39a21d01e2cf7c8ba`。作成済みの組5 worktree/枝を再利用した。
- heavy.sh経由の関連Worker **30ファイル819件成功**。公開/配布の固定版、複数通の順序・件数、店別の参照/電話/計測、フォーム受付の本人/完了回答/承認、記念日の重複防止と変更直前の再検査、権限、OpenAPIを含む。全Worker/全CIの成功ではない。
- DB **5ファイル35件成功**（公開版の原子処理・履歴・参照・631とbootstrap再生成一致）。WebのAPI関数 **2ファイル8件成功**。DBはメモリ内SQLiteのみ、LINE認証・送信は人工応答。
- sharedビルド、Worker/DB/Webの型検査、Worker SSR/クライアントのビルド成功。既存のimport混在・500KB超chunk警告は保持。Web画面のビルド・撮影・画面合格の検証ではない。
- migration666〜669の静的検査4件・bootstrap一致・差分検査成功。コード長の違反は0。上限/許可/凍結記録は変更せず、型と表示/入力処理を分割して収めた。
- 試験で見つけた版履歴の単独IDへの不正な外部キーを除き、元の統括版IDは所属を確認した固定版の参照で照合する。新しい記念日行と手書きのstep_order=6が衝突した試験は、次の空き順序を使う形へ修正した。API一覧・権限一覧の登録漏れ、通知先の店別の版、電話差し込みのUTC有効期限も修正して成功を確認。
- 作業中に本線が更新されたため、取り込み後のSHAと再検証は次に追記する。DB適用・配備・本送信・push・PRは0。

---

# 以下は初回/前回の記録（担当の分け方・未実装の記述は上の節が優先）

# API 組5 — 機能待ちの板の口（B-323 / 2026-10-16）

## 10-16 続き：B-324 の承認後（この節が初回記録より新しい）

doctor は最終行「合格」。開始時は指定枝の初回3コミットだけで、変更・未追跡0。fetch/merge照合の本線は `cd63dd961f5dc2613a8b16c39a21d01e2cf7c8ba`。新しいworktreeを二重作成していない。

### 今回作った口

| 板 | メソッド・パス | 入力・返値・画面側のつなぎ |
|---|---|---|
| Upx1c | `GET/POST /api/hq/templates/saved-views`、`PATCH/DELETE /api/hq/templates/saved-views/:viewId` | 作成/変更は `name,filters,scope`、変更/保管は `expectedRevision`。filtersは `kind,messageCount,hasInterpolations,undistributed,search,folderId`。scopeはpersonal（既定）/tenant。一覧は自分の個人分＋同組織の共有分。返値はid・保存条件・owner_staff_id・scope・revision・日時。DELETEは保管。Webの `hqTemplateSavedViewsApi.list/create/update/archive` へ接続 |
| Upx1c | 既存 `GET /api/hq/templates` の絞り込みを追加 | `search`（名前・本文・差し込み、最大200字）、`folder_id`（空は未分類）、`undistributed=true/false`。従来の `message_count/has_interpolations/kind` と組合せ可。保存したfiltersを `listHqMessageTemplates(view.filters)` へ渡す。本文をレスポンスへ追加しない |
| Qgjmc | 既存の統括ひな形保存/一覧/配布 | `definition.mark.displayLocations` に `inbox/friends/friend_detail` の配列。空配列は全て非表示、省略した旧版は従来の3か所。重複・未知値・配列以外は422。統括一覧の `display_locations`、配布した店の `display_locations_json` へ同じ設定を保存。配布確認の後に店の表示設定が変わればversion_conflict |
| Qgjmc | 既存 `PATCH /api/support-marks/:id?lineAccountId=...` | `displayLocations,expectedVersion`。表示場所を変える場合は版が必須。既存の店内編集・所属・役割・共有マーク複製の安全確認を使用。Webの `updateSupportMarkDisplayLocations(id,accountId,version,locations)`。GETの `displayLocations` と既存 `displayTargets` に保存値を返す。displayTargetsだけは既存画面の語 `friend_list` を使う |

保存した絞り込みは自組織の有効なowner/admin・全体スコープ。個人分は所有者だけ、共有分は同組織のowner/adminが編集できる。GETは閲覧のみ可、更新は不可。版照合・更新・監査は1つのDB処理にし、同時保存は1件だけ成功、監査失敗は変更も戻す。分類は同じ組織の有効なものだけ。

マークは表示設定の材料をAPIへ追加した。**受信箱・友だち一覧・友だち詳細が実際に隠す接続は画面側の作業**。表示を隠しても友だちへの付与や自動変更を解除しない。自由なマークと固定の受信箱の状態は分ける。画面・Pencilは変更していない。

### 番号と適用

B-324により **666〜680は承認済み**。初回の663〜665という案は取り消し、663〜665は組3の物。

- **667_hq_template_saved_views.sql**：保存した絞り込み。作成済み。
- **668_support_mark_display_locations.sql**：マークの表示場所。既存表への列追加で従来の3か所を既定にする。別の設定表は不要だった。作成済み。
- **666**：複数通テンプレートの作成・配布・送信を一体で扱う案のために未使用で残している。初回の「通数・差し込みを返す」拡張と、複数通を新規作成する機能は別。**複数通の新規作成そのものはまだ実装していない**。承認待ちとは記載しない。
- 本線の最大636、公開中PRが加えるmigrationの最大565を確認。667/668の重複なし。push前の再照合は司令塔。
- bootstrapの再生成と試験のメモリ内SQLiteだけを使用。検証・本番D1への適用は0。

適用前、司令塔が統合・クリーン・対象SHAを確認してから行うdry-run（今回は未実行）：

```sh
gh workflow run migrate-d1.yml -R skmtmst/line-harness-oss --ref codex/development -f operation=migrate -f environment=staging -f mode=dry-run -f migration=667_hq_template_saved_views.sql
gh workflow run migrate-d1.yml -R skmtmst/line-harness-oss --ref codex/development -f operation=migrate -f environment=staging -f mode=dry-run -f migration=668_support_mark_display_locations.sql
```

### 再指定12板：重複禁止との照合

「組1〜4の指示書にある物は作らない」を維持した。再指定12板をそのまま組5の新規12件とは数えない。範囲を変えて組5で同じファイルを補完するかは確認を出した。以下は他組の枝・契約書の読取りであり、組5へ取り込み・試験済みという意味ではない。

| 板 | 担当・接続先と残る作業 |
|---|---|
| J7HNK | **組1の物**。`GET /api/hq/templates/:id/distribution-targets` → 既存preflight → distribute。`fetchHqDistributionTargets`。配布履歴と上書き可否を分ける |
| N4T9mO | **組1・組2の物**。組1のフォーム試用URL・店ごとの参照、組2のijxur（メニュー選択・未承認）の保存。統合後に両方を接続 |
| UgZPJ | **組1の物**。既存保存に `richMenu.displayAudience/displayAudienceTagName/defaultOpen`、`POST /api/hq/templates/rich-menu-preview` に店別の同名参照確認。`previewHqRichMenu` と既存の保存/配布 |
| W5Wxr | **組2の物**（追加11）。既存の分類APIの `kind=image` と画像一覧のfolderId。組2は実SQLiteで確認済みと記録。プロジェクトの分類とは分ける |
| ME78d | **組1の物**（項目1）。リッチメニューの保存・保存前確認・各店の同名参照。14種全ての動き/計測が揃ったとする根拠は無いので、未対応分は組1/司令塔への残りとして保持。重複禁止のまま組5が同じadapterを並行変更していない |
| cmRZc | **組1の物**（ME78dと同じ）。予約ページ・同名参照の充足・押した人へのタグと計測。URL動作と計測タグを無条件に対応済みとはしない |
| n9vvGx | **組2の物**（追加14）。共通フォローの複数吹き出しを `scenario_steps.message_bubbles_json` へ保存、固定版と予約起点送信へ接続済みという契約。新しいmigration不要。記念日の前の指定は組2の契約と要件に従う |
| v0SbYR | **組1の物**（項目2）。`GET /api/forms/:id/submissions?period=this_month/last_month/all`。一覧・人数・集計を同じ期間へ絞る |
| Fkv3w | **組1の物**（追加10）。`GET /api/hq/templates/resources?kind=tag/coupon/scenario&q=...&accountIds=...`、`searchHqTemplateResources`。返された店のIDを既存の処理へ保存 |
| Ft2Ey | **組1の物**（追加8）。J7HNKと同じ配布先の版取得。未配布を同名データなしとして扱わない |
| T5ljMA | **組1の物**（追加9・既存統括配信定義）。`hqDeliveriesApi.create/update` の `settings.priority`、返すもの・templateId・actions/referencesを既存の保存/配布へ。priorityは-9999〜9999、数が小さいものが先 |
| rSRFK | **既存API、画面側の作業**。下の初回の表のsnapshot・店舗・名簿・ログイン権限・取り込みアドレス。名簿と実ログイン権限を分ける。組織階層の別システムは作らない |

B-299の18板とiN6npは下の表のまま組2。追加の実装はしていない。全34板のHTML/文字表を再読し、初回から変更0。外部の `api5-1016/continuation-evidence.json` に本文と指紋を保存した。画面の完成や撮影合格の証拠ではない。

### 今回の検証とコミット

- コード：`ceb4f6507e`（保存した絞り込み、マークの表示場所、667/668、API関数・OpenAPI・権限経路の収録）。
- 関連Worker9ファイル170件、DB4ファイル16件、Web1ファイル4件、重複を除いて **190件成功**。全CI・全Worker・全Webの成功とは数えない。
- 保存検索の個人/共有/別組織・閲覧のみ・条件不正・同時更新・監査失敗、表示場所の保存→配布→一覧・古い版の拒否・確認後の変更検出・共有マークの店別複製を実SQLiteで確認。
- Worker/DB/Webの型検査成功。sharedビルド成功。最終Workerビルドはheavy.sh経由で終了0、SSR/クライアントとも生成。既存のimport混在・大きいchunk警告は保持。DBや外部サービスへ接続していない。
- 新規ファイルとWeb関数/試験のESLintエラー0。変更先の既存friend-attribute-distribution.tsにあるanyの6エラーは、開始HEADと規則・メッセージの件数が一致し、新規0。それ以外の変更した製品ソースはエラー0。既存の未使用変数とpages探索の警告は保持。
- 667/668のmigration静的検査、生成bootstrap一致、差分検査成功。表示場所列を含まない旧モック、保管前確認の参照、OpenAPIのpath引数、権限一覧の順序、実際のversion_conflictの期待値、共有マーク試験の作成日時の不足を検出・修正して再成功。未解決の試験失敗はない。
- 指定の外部 `~/lh-work/design/v8/review/API-CONTRACT-5.md` にも同じ文書を保存する。反映履歴は実PR番号がまだ無いため文案を渡す。push・PR・DB適用・配備は行わない。

### 次のタスクはこれ

司令塔が今回のコミットを取り込み、667/668のDB工程と画面接続を進める。再指定12板の同じファイルを組5で補完する場合は、重複禁止との担当調整が必要。複数通の新規作成・ME78d/cmRZcの未対応動作は未完として残す。PR採番後は実番号・日本時間・@kentaを付け、反映履歴を作る。文案：「テンプレートのよく使う絞り込みを保存できるようにした」「対応マークを出す場所を保存し、配った先でも引き継げるようにした」。


## 以下は初回3コミットの記録（承認・実装状況は上の続きが優先）

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
