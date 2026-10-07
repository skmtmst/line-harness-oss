# 流入と計測の一覧（V8）の動き

入口：`app/inflow-links/page.tsx`（V8 で「流入経路」のとき＝`?tab` なし／`?tab=links` だけ `src/v8/inflow-links/list.tsx`。それ以外は今のまま）。
絵：一覧 `xbHxg`・1152 `y1ztx`・閲覧のみ `EMUl9`・QR コードの小窓 `GtI4Y`。

## 受け付ける URL と指定
- `/inflow-links`・`/inflow-links?tab=links`：この一覧。
- `?tab=script`・`?tab=ads`・`?tab=connections`（`&view=history`）：この一覧は出ない。★V8 ではタブを出さない（絵 XjOte・qSTVR にタブが無い。戻るは見出しの「流入と計測へ」）。`script` は `site-script.tsx`、`ads` は `ads.tsx`、`connections` は今の `app/inflow-links/ad-integration-v8.tsx`。
- 一覧そのものは URL の指定を読まない（今の一覧と同じ）。

## 呼ぶ口（今の一覧と同じ）
- 行：`GET /api/entry-routes?account_id=`・`api.entryRouteGenres.list()`・`GET /api/analytics/ref-summary?lineAccountId=`・`api.trackedLinks.list()`
- 補助（行を待たせない）：`api.pools.list`（multi_store_hierarchy が有効のときだけ）・`api.pools.listAccounts`・`api.scenarios.list`・`api.messageTemplates.list`・`api.tags.list`（切られている機能は呼ばない）
- 数の帯の4枚目：`api.adPlatforms.list(accountId)`（有効なものの数と名前）
- 役割：`api.staff.me()`（`useStaffRole`）。owner／admin 以外は閲覧のみ
- 受付の停止・再開（行の「…」）・まとめて操作：`api.entryRoutes.update(id, { isActive })`／`{ genre }`
- 作る・直す・未登録 ref の登録：`edit-route-dialog.tsx`（今の `_components/edit-route-modal.tsx` の写し。口・送る形は同じ）
- フォルダの追加・名前の変更：`api.entryRouteGenres.create(name)`／`update(id, name)`
- QR：`/api/qr?size=320x320&data=<URL>`（PNG）・`api.entryRoutes.qrPdf(id)`（印刷用 PDF）
- 保存先（localStorage）は使わない

## 行の作り方（今の一覧と同じ判断。`rows.ts`）
- entry_routes → tracked_links（有効・集計に出るものだけ）→ 集計だけにある ref（未登録）の順に1行へ
- 停止中の entry_route と有効な tracked_link が同じ ref にあれば tracked_link を出す
- アカウントを選んでいるときは、友だち追加がある／Pool 未設定の登録済み／そのアカウントに配るプールの行だけ
- 数の帯・フォルダの件数は、フォルダ・検索・絞り込みの前で数える

## 今の一覧と違うところ（見せ方だけ）
- タブを出さない。ほかのページへは見出しの「広告とのつなぎ」「サイトスクリプト」と、数の帯「広告とつないだ」の「…」（広告連携を開く・広告とのつなぎを開く）から行く
- 数の帯「動きが未設定」の「…」から、その経路だけに絞れる（今の一覧はマスそのものを押す）
- 「まとめて操作」は表の下の一括バー（止める・再開する・フォルダへ移す）から開く。窓は押した操作を選んだ状態で開く
- 行の右は「コピー」「…」「編集」（未登録 ref は「登録する」、クリック計測だけの行は「—」）。QR は「…」の「QRコードを見る」から
- 最新追加は「9/30 14:12」の形（今の一覧は日付だけ）
- 閲覧のみの人には、作る・フォルダを追加・チェック・編集・登録する・「…」の変える操作を置かずに隠す（2026-10-06 オーナー決定）。「…」は QRコードを見る・URLをコピーだけ残す。作るボタンの場所だけ空けてフォルダの列の並びを保つ
- フォルダの名前の変更は、選んだフォルダの行の「…」から
- QR の小窓は、題「〇〇 の QR コード」→ QR → URL とコピー → 注 → 「印刷用 PDF」「PNG を保存」（停止中は QR を出さず案内だけ。今と同じ）

# 流入と計測の詳細（V8・detail.tsx・板 Q5le3）

入口：`app/inflow-links/detail/page.tsx`（V8 のときだけ `src/v8/inflow-links/detail.tsx`。v7 は同じファイルのまま）。写し元：同じ page.tsx（import はしない）。

## 受け付ける URL
- `/inflow-links/detail?id=<経路ID>`。`id` が無ければ `?ref=<refCode>` を一覧から引いて決める。どちらも無ければ「見る流入経路が指定されていません」。404 は「見つかりません」、それ以外の失敗は「読み込めませんでした」＋もう一度。

## 呼ぶ口（今と同じ）
- `api.entryRoutes.list()`・`api.pools.list`（multi_store_hierarchy が有効のときだけ）・`api.staff.me()`（完全削除は owner／admin だけ）
- 経路のアカウントで `api.tags.list`・`api.scenarios.list`・`api.templates.list`（別アカウントの同名タグを混ぜない）
- `api.entryRoutes.get(id)`・`api.entryRoutes.funnel(id)`・`GET /api/analytics/ref/:refCode`（来た友だち）
- 注文の明細：`ref-orders.tsx`（`app/inflow-links/_components/ref-orders.tsx` の写し）→ `GET /api/analytics/ref/:refCode/orders`
- 止める：`api.entryRoutes.update(id, { isActive: false })`／別リンクへ送る：`{ redirectUrl }`（転送先は必ず選ばせる）／削除：`DELETE /api/entry-routes/:id`（名前の入力が一致したときだけ）／再開：`{ isActive: true }`
- 編集：`edit-route-dialog.tsx`、QR：`qr-dialog.tsx`（一覧と同じ窓）

## 今と違うところ（見せ方だけ）
- 受付を止める・別リンクへ送る・削除するは「その後」の段の右上の「…」（今は段の題の右）。帯の「止める」も同じ窓を開く
- 月別内訳は「その後」の段の中に畳んで置く（絵に無い）
- 友だちが1ページに収まるときも「〇人中 1〜〇人」の行を出す（送りの部品は2ページ以上のときだけ）
- 閲覧のみ（owner・admin 以外）には、リンクを編集・止める・することを変える・「…」を出さず、閲覧のみの帯を出す
- QR コードを保存は今と同じく PNG（320×320）を直に落とす。QR コードを表示の小窓からは印刷用 PDF も選べる

# サイトスクリプト（V8・site-script.tsx・板 XjOte）

入口：`app/inflow-links/page.tsx` の `?tab=script`（V8 のときだけ）。写し元：`components/inflow-links/site-script-v8.tsx`（import はしない）。

## 呼ぶ口（今と同じ）
- `api.siteTracking.pages`・`api.siteTracking.summary`・`api.measurementSites.list`（アカウントで絞る）、鍵は `api.siteTracking.trackingKey`（取れないときはコードを出さない）
- サイトの追加・直し：`api.measurementSites.create`／`update`、止める（理由必須）：`stop`、再開：`resume`
- 役割：`api.staff.me()`（owner／admin だけ変えられる）

## 今と違うところ（見せ方だけ）
- 成果を数えるサイトの表は板いっぱい。列は サイト・ドメイン・状態・最後に届いた（10/1 21:14）・「…」
- 行の「…」を押すと、表の下の操作の行がそのサイトの「編集・止める・再開する」になる（選んでいないとき・当てはまらない操作は押せない形）
- 「貼りかたが分からないときは」は窓で開く（今は右の列のいちばん下の段）
- 閲覧のみには、サイトを追加する・「…」・操作の行を出さない

# 広告連携（V8・ads.tsx・板 qSTVR・広告費を手で入れる ZxKL5）

入口：`app/inflow-links/page.tsx` の `?tab=ads`（V8 のときだけ）。写し元：`app/inflow-links/ad-integration-v8.tsx` の `AdMetricsV8`（import はしない）。

## 呼ぶ口
- `api.adPlatforms.list(accountId)`・`api.adCosts.list({ accountId })`・`api.entryRoutes.list(accountId)`・`api.staff.me()`
- 費用を手で入れる：`api.adCosts.create`（同じ流入元・同じ日は上書き）／取り消す（理由必須）：`api.adCosts.cancel`
- 広告の状態を再読み込み：`api.adPlatforms.importCost(id)`
- つなぐ：`ad-connection-dialog.tsx`（`app/inflow-links/ad-connection-dialog.tsx` の写し。`api.adPlatforms.create`／`update`）

## 今と違うところ
- 送信履歴の口（`/api/ad-platforms/logs`）はこの画面に出す所が無いので呼ばない（失敗の判定は媒体の口だけ）
- 成果1件あたりは `/api/ad-costs` の `conversionCost` を出す（今は「—」固定）
- 未接続の媒体に「つなぐ」を出す（今の V8 は出していなかった。v7 と同じ接続の窓）
- 手で入れた費用は行の「…」で選び、下の操作の行の「取り消す」から窓を開く（今は行の「…」のメニュー）
- 手で入れた費用の4列目は「記録 9/15」（記録した日）。絵は入れた人の名前だが、口が返さない
- 閲覧のみには、費用を手で入れる・つなぐ・再読み込み・「…」・操作の行を出さない
