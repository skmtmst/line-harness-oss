# 型の違いの洗い出し（2026-10-09・オーナー「共通部品なのに違うところは共通として」「フォルダの違いなど」）

調べた範囲：ページから実際にたどれる V8 のファイル 414 本（読まれていない古い *-v8.tsx 87 本と v7 の分岐は除く）。文字の検索なので数は目安。直すのは Codex（列車10が本線に入ったあと・型ごとの担当）。

## フォルダの列（29画面）— 正：列の上に作るボタン（閲覧のみは場所だけ空ける）・見出し「フォルダ」・すべて/未分類・色の丸・件数・行の「…」（名前と色・並べ替え・消す＝useFolderRowActions）・下に「フォルダを追加」と注「フォルダを消しても…未分類に残ります」・狭い幅は「作る＋フォルダを選ぶ欄」
- 「…」の作り方が4通り：部品の useFolderRowActions 8画面／手で全部（broadcasts・forms・hq/home・webinars・tags×2・templates）／並べ替え無し（contents/list・common-vars/list・hq-broadcasts/list・hq-templates/store-list）／名前だけで消せない（friend-add/list・inflow-links/list）／「…」無し（affiliates×2・mileage×2）
- 選べない列：v8/conversions/list.tsx:1205
- 見出し：「見る」v8/hq-banners/list.tsx:287,582、「メニュー」app/booking/bookings/page.tsx:1047
- 作るボタン：createAction で渡す（broadcasts・forms・hq-banners・hq-broadcasts・hq/home・rich-menus）と列の外（残り）。1152 で道具の段に出る app/reminders/list-v8.tsx:1395
- 閲覧のみの場所取り：部品の reserveCreateSpace は forms だけ。ほかは画面ごと。場所を取らない：contents・affiliates×2・mileage×2・tags/fields-tab
- 追加の言葉：v8/contents/list.tsx:1158 だけ「フォルダを追加する」
- 注の文：無い（templates・conversions・mileage×2・hq-banners）／言い回し違い（broadcasts・hq-broadcasts「入っていたもの」、hq/home「アカウントは消えません」）
- 色の丸を渡していない：inflow-links/list・conversions・mileage/rewards
- 狭い幅：folderNav 12・collapsedFolders 10・どちらも無い broadcasts
- 窓：FolderAddDialog 16・FolderEditorDialog 6・自前 v8/inflow-links/list.tsx:937
- 消す窓の題・ボタンの言葉が3通り
（※ foldcol の担当（列車10）で12一覧は ManagedFolderPanel に置き換え済み。その後の残りを数え直すこと）

## 一覧の道具の段 — 正：ListToolbar（検索→絞り込みの札→並び→右端に件数の切り替え）
- 手で組んでいる：v8/broadcasts/list.tsx:936・v8/friend-add/list.tsx:603・v8/friends/list/list.tsx:583・v8/hq-broadcasts/list.tsx:214・tags の4タブ・v8/mileage/rewards.tsx:558・v8/affiliates/offers.tsx:448
- 件数の切り替えがページ送りの段にある：v8/nen-health/health.tsx:354・v8/nen-campaigns/list.tsx:395,703

## 行の右端 — 正：「…」（RowMenu / MoreAction）
- 手作りの「…」：app/reminders/list-v8.tsx:1010・v8/nen-posts/review.tsx:492・v8/inflow-links/ads.tsx:491・v8/inflow-links/site-script.tsx:341
- ボタンを並べる：v8/hq/members.tsx:267・v8/ops/announcements.tsx:413-414・v8/hq/home.tsx:382-400

## ページ送り — 正：10・20・50 の切り替えあり
- 切り替え無し：booking-menus menus-tab・staff-tab、friends/duplicates、friends/migrations/uid、inflow-links/ad-history・ref-orders、ops/audit・knowledge、restaurant 4画面、settings の ec-commerce・file-scan・line-notifications/runs-tab・staff、visit-stamps
- 20・50・100：app/reminders/list-v8.tsx・v8/friends/merged/use-merged-users.ts
- 件数の定数を画面ごとに持つ（約20）。PageSizeSelect は components/ui にあり shared に無い
- 「もっと読む」：v8/notifications/list.tsx:277

## 数の帯 — 正：KpiBand＋KpiCard（帯）
- カードの形（presentation="cards"）：settings 9画面・v8/restaurant/google/performance.tsx:132（理由があるか確かめる）
- 手書き：StatCard（hq/home.tsx:674・hq/members.tsx:325・hq-banners/list.tsx:151）・Stat（broadcast-detail/detail.tsx:888・restaurant/common-a/parts.tsx:34・restaurant/booking-kit/shell.tsx:79）・MiniStat（ops/dashboard.tsx:265）・Kpi（settings/accounts/accounts.tsx:324）・CSS 直書き（scenario-detail/detail.tsx:2531・settings/emergency/history.tsx:129・affiliates/drawer.tsx:265・nen-health/summary.tsx:81・tag-edit/edit-form.tsx:383）
- KpiMenu を5か所で作り直し（nen-members/members.tsx:144・nen-health/health.tsx:221・nen-pets/pets.tsx:151・friends/list/list.tsx:112・analytics/common.tsx:16）

## 作る・編集の下の帯 — 正：キャンセル・保存は中央、削除は左端（destructive）。戻るはパンくずとキャンセルだけ
- 削除が左端に無い：v8/friend-add/editor.tsx:1278・v8/templates/question-new.tsx:329・v8/templates/carousel.tsx:590
- 帯に「一覧へ戻る」：events/create.tsx:221・webhooks/create.tsx:302・nen-campaigns/column-new.tsx:118・nen-campaigns/edit.tsx:392・conversions/create.tsx:525・friend-add/editor.tsx:726・friend-add-publish/publish.tsx:385・tags/mark-editor.tsx:440
- 保存の言葉がばらばら（「保存する」「保存」「下書きを保存」「下書きを保存する」「下書きのまま保存」など）
- キャンセルが2つ出ている疑い：template-edit/asset.tsx:422・message.tsx:514・rich.tsx:397

## 詳細の頭 — 正：ページの中に「← 〇〇へ」を置かない
- scenarios/create.tsx:365・scenarios/results.tsx:429・scenario-first-step/first-step.tsx:566・tags/create.tsx:192・tags/field-editor.tsx:254・tags/field-migrate.tsx:463・tags/mark-editor.tsx:399・tag-edit/search-edit.tsx:878・rich-menus/connections.tsx:195・rich-menu-edit/detail.tsx:258・webinar-edit/chrome.tsx:17・form-responses/responses.tsx:452・template-edit/message.tsx:436・settings/sb-frame/settings-screen.tsx:64・hq-templates/detail.tsx:179

## 空の表示・読めない表示 — 正：ListState
- styles.stateCard を手で：15ファイル（broadcasts・forms・rich-menus・friend-add・tags 系・templates・scenarios・auto-replies・common-vars・events・reminders ほか）
- 自前：StateCard（booking-menus/tabs/shared・affiliates/parts・mileage/parts）・PageState（booking-staff/shifts）
- 「アカウントを選んで」の言葉が4通り（1つにそろえる）

## 閲覧のみの帯（約60か所）— 正の形を部品で作る（型に readOnly を渡すと帯）
- Notice info・ViewerBand の別定義4（affiliates/frame.tsx:62・automations/shell.tsx:97・webhooks/shell.tsx:215・mileage/frame.tsx:57）・CSS 直書き（viewerBand/roBand/readonlyBand/readOnly）・Band hint・NoteBar

## 確かめの窓（ConfirmDialog 149）— 題の終わり「？」全角にそろえる（半角 40・記号なし 33）、消すボタンの言葉をそろえる

## 保存の失敗の知らせ — Notice danger 119・手書きの role="alert" 197。CSS も文字の大きさも割れている（欄の誤りは useFormErrors、欄に結び付かない失敗は Notice danger に）

## 状態の札 — StatusBadge を手で作り直し：broadcasts/list.tsx:132・webinars/list.tsx:200・friend-add/list.tsx:150・affiliates/parts.tsx:134・reminders/detail.tsx:189・analytics/common.tsx:52・booking-menus statePill

## 部品に足す変わり形
- FolderPanel：閲覧のみの場所取りを既定・itemLabel で注と消す窓の言葉を自動・useFolderRowActions を部品の中へ
- 閲覧のみの帯の部品（型に readOnly）
- ListState：「アカウント未選択」の決まった形
- Pagination：件数の切り替えを持たせる・PageSizeSelect を shared へ・件数の定数を1つに
- KpiCard：KpiMenu を部品として出す
- StatusBadge：画面ごとの色の呼び名→tone の対応表
- ConfirmDialog：題の「？」・消す窓の決まった言葉
- StickyBar / CreatePage：「一覧へ戻る」を置けない・削除は destructive だけ（試験で縛る）

## 担当の分け方の案
A フォルダの列（部品＋29画面）／B 閲覧のみの帯・失敗の知らせ（部品＋約260・機械的）／C 空・読めない表示（19）／D 数の帯（約15）／E 行の右端・ページ送り（約24）／F 下の帯・戻るリンク（約28）／G 札・確かめの言葉（約80・機械的）

## 値の揺れ（型をそろえたあと）
箱の余白 20／箱の角丸 12／ボタン・欄の高さ 36（小 32）／札の余白 2px 8px／表の行の高さ 56／帯の余白 10px 14px／欄の間 6
