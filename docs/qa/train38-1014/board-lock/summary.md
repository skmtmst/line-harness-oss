# 列車38・正式鍵check

対象 `86431f1289fff71d9d7b92960ec72197f33f339e`。175板・332条件中331取得、差53板2659属性、未取得1で終了2。採用/更新/record/acceptは0。

列車37の47板2488属性から、全差一致41板・既存差の追加/変更6板・新しい板6板。消えた板0。属性は一致2302・追加285・値の変更72・消失114、純増171。消失114はDFl3Qの列等の構成変更の差で、違反解消や合格への読み替えをしない。

新しい6板：Guoye・K7HWG・NCbYn・NtCE3・jjFNi・l5V9a。既存で変わった6板：CVz5d・DFl3Q・M8zhjL・PUWyq・piWhz・usDpO。

|板|URL|幅|前回→今回の属性数|分類|確認した接続/前回の理由|
|---|---|---|---:|---|---|
|AOWoJ|/nen/members|1152,1440|81→81|全差一致|Gの会員説明を共通説明欄へ、Lのフォルダ無しの名前/共通ページ送りへ。列車36と全81件が一致（記録順だけ異なる）。|
|BeNtj|/broadcasts/reserved?id=broadcast-0|1440|15→15|全差一致|予約完了の共通要約に完了アイコンを追加。背面の題が52px移動。 参照 `broadcast-detail/reserved.tsx`|
|CVz5d|/affiliates?tab=payment|1440|5→7|追加/変更|支払いの分割先へ安全説明を保持した差。新しい固定説明と本文高40pxが追加され、板/本文の高さ差は56→96px。payment-footer.tsx・payment.tsx。|
|CcA4k|/booking/staff/new|1152,1440|247→247|全差一致|スタッフ登録をCreatePage・CardHeader・共通入力／画像欄へ移行。 参照 `booking-staff/staff-new.tsx`|
|CyW0E|/ops/dashboard|1152,1440|6→6|全差一致|3つのカード列を内容に合う高さ（natural）へ。 参照 `ops/dashboard.tsx`|
|DA0Ag|/webhooks?tab=interactions|1440|17→17|全差一致|背面のやり取り一覧が共通ListPaginationへ接続され、ページ送り帯が現れる。窓だけの差と混同しない。|
|DFl3Q|/booking/menus?tab=channels|1152,1440|318→371|追加/変更|予約経路の背面にCardHeader・recordsカード・共通表を接続。スタッフの題・説明・列幅等に追加差がある。既存の数の帯と窓の背面の差を含めて371件。channels-tables.tsx。|
|G83vi|/analytics/reports/new?id=report-weekly-friends|1440|55→55|全差一致|定期レポート作成の共通CreatePage/見本欄への接続。右欄の見本が約24px左へ移動し、見本カードの内容幅も変化。参照app/analytics/reports/new/page.tsx。|
|GVizd|/form-submissions|1440|11→11|全差一致|Mの削除確認の左実行/右取消とアーカイブへの配置。取消とアーカイブは122px右へ、操作は15px下へ、窓高5px増。|
|GmVR5|/ec-commerce|1152,1440|120→120|全差一致|数の帯に印と件の単位を追加し、共通の広い本文へ接続。 参照 `settings/ec-commerce/screen.tsx`|
|GobMd|/tags/fields/migrate?id=field-dog-name|1152,1440|124→124|全差一致|移行画面を共通Notice・入力行・表・要約へ接続。DB更新は実施していない。 参照 `tags/field-migrate.tsx`|
|Guoye|/auto-replies/edit?id=ar-new&step=priority|1152,1440|0→4|今回新しい板|共通Buttonのラベル包み/幅予約への接続後、次へ・確認の採取xが両幅24px変わる。wizard-v8.tsx・shared/button.tsx。目視なしで差を採用しない。|
|H031gC|/webhooks?tab=incoming|1152,1440|7→7|全差一致|内部値automationを「オートメーションを動かす」へ表示。受け取る設定のカード高8px増の追加差も観測（webhooks/incoming-actions.tsx）。|
|H5UoIu|/analytics/reports/new|1152,1440|61→61|全差一致|G83viと同じ共通CreatePage/見本欄。狭い幅の入口を「レポートの見本を見る」へ。旧3件に右欄/入口/寸法差が加わる。|
|IIesG|/auto-replies|1440|2→2|全差一致|Mの共通削除操作を「削除」から「削除する」へ統一。|
|IY3nx|/hq/templates|1152,1440|203→203|全差一致|質問作成を共通CardHeader・TextField・SegmentedControl・要約へ接続。 参照 `templates/question-new.tsx`|
|JCDRm|/friends/detail?id=friend-1|1440|8→8|全差一致|行操作の「編集」を「編集する」に共通化。4箇所の言葉の差。 参照 `friend-detail/overview-tab.tsx・shared/row-actions`|
|JeINq|/rich-menus/new|1152,1440|135→135|全差一致|共通画像入力の説明/追加操作への接続（F）とCreatePageの右欄。画像の寸法・形式・容量の説明と「画像を追加」が現れる。旧61件と追加74件を含む。|
|Jn95h|/nen-members|1152,1440|2→2|全差一致|写真審査の数の帯の説明を共通説明欄に集約し、各KPIの説明ボタン4個が減る（G、nen-posts/review.tsx）。審査操作の削除ではない。|
|K7HWG|/auto-replies/edit?id=ar-new|1152,1440|0→4|今回新しい板|Guoyeと同じ共通Buttonのラベル包み/幅予約。次へ・どんなときに動くかの採取xが両幅24px変わる。|
|M8zhjL|/mileage/friends/detail?id=friend-1&adjust=1|1440|42→44|追加/変更|残高説明等の既存42属性は保持。調整の窓の共通操作幅に、取消の採取x/箱xが24px左へ動く2属性が追加。|
|MV5Os|/restaurant-test/menu|1152,1440|20→20|全差一致|背面の飲食店メニューの数の帯に印を追加（G）。「全メニュー」が32px右へ、窓の背面を含む差。|
|MuhWR|/nen-campaigns|1152,1440|16→16|全差一致|長い開封の見出しを「開封率」にし、説明はhelpLabelへ。共通ページ送りへ。 参照 `nen-campaigns/list.tsx`|
|NCbYn|/templates/edit?id=template-80|1152,1440|0→12|今回新しい板|共通StickyBar/Buttonの保存幅への接続後、取消・下書き保存などの採取位置が両幅6px変わる。実保存と未保存保持の検査は成功。|
|NtCE3|/broadcasts|1152|0→7|今回新しい板|一斉配信の1152でも今月の送信枠を保持する接続。旧下書き/編集の途中を差し替え、件の位置など7属性が変わる。broadcasts/list.tsx。|
|PUWyq|/restaurant-test/dashboard|1440|20→79|追加/変更|窓の既存20属性は保持。背面をDetailColumnsへ接続し、右欄を畳む入口と電話の印を保持。予約の空状態等の位置/幅に59属性追加。dashboard.tsx。窓だけの差に帰属させない。|
|Q5le3|/inflow-links/detail?id=er-1|1152,1440|51→51|全差一致|数の帯の見出しに印を追加。 参照 `inflow-links/detail.tsx`|
|R6kIG|/mileage/friends/detail?id=friend-1|1152,1440|78→78|全差一致|残高がある場合に明細確認の説明を出す。説明行の増加で後続が18px移動。 参照 `mileage/friend-detail.tsx`|
|REIxB|/friend-add-settings/runs|1152,1440|16→16|全差一致|実行結果の数の帯に印を追加。 参照 `friend-add-runs/runs.tsx`|
|SkY9V|/reminders|1440|2→2|全差一致|IIesGと同じ共通削除操作の文言。停止/削除機能は保持。|
|Td4TN|/affiliate-offers/new|1152,1440|38→38|全差一致|共通CreatePage/入力行に接続。狭い幅の入口を「アフィリエイターの見え方を見る」へ、見本が約30px左へ。旧25件から38件へ。|
|TkA4D|/nen-members|1152,1440|2→2|全差一致|Jn95hと同じ数の帯の説明ボタン4個減。画面の別状態にも反映。|
|UkZLi|/webhooks?tab=api-tokens|1152,1440|91→91|全差一致|Lの共通内容幅の表と名前列grow。名前が8px右/11px下へ。列車36と件数は92→91で全差一致ではない。|
|V7vn3|/accounts|1152,1440|10→10|全差一致|数の帯に印を追加、名前列の不要なフォルダ部品を除去しチャネルを接続状態の下へ。 参照 `settings/accounts/accounts.tsx`|
|VIij4|/hq/rich-menus|1152,1440|86→86|全差一致|統括リッチメニューにも共通画像入力の形式/容量/作り方の説明を接続。面の見出しが22px右・32px上へ。|
|cniyw|/nen-members|1152,1440|2→2|全差一致|Jn95hと同じ数の帯の説明ボタン4個減。画面の別状態にも反映。|
|eLjeQ|/nen/pets|1440|6→6|全差一致|背面の一覧のページ送りを共通Paginationへ。単頁の高さが20px減る。 参照 `nen-pets/list.tsx`|
|g98F9|/automations/runs|1152,1440|42→42|全差一致|動いた記録を共通DataTable・状態札・行操作・ページ送りへ接続。 参照 `automations/runs.tsx・runs.module.css`|
|gBrCz|/restaurant-test/tables|1440|37→37|全差一致|Lの卓一覧を共通DataTable/RowMenuへ。「変更」「停止」の独立操作を行末メニューへ集約、状態列が88px右へ。機能はメニューに保持。|
|hadfk|/affiliates?tab=approvals|1152,1440|78→78|全差一致|Lの承認一覧の共通ページ送り、L2の共通説明欄への接続。親の高さ/絞り込み位置が変わる。|
|iLJmw|/ec-commerce?tab=connector|1152,1440|132→132|全差一致|EC連携の数の帯の印・単位と共通本文への接続。カード高が2px減る。 参照 `settings/ec-commerce/screen.tsx`|
|jjFNi|/broadcasts|1152|0→7|今回新しい板|NtCE3と同じ一斉配信の別状態。1152の数の帯の接続差7属性。|
|jjUEK|/form-submissions/edit?id=form-1&tab=appearance|1440|2→2|全差一致|プレビューが使うLIFF共通選択欄のborder→outlineと行高を修正。後続の評価の題が3px上へ。 参照 `apps/liff/src/components/forms/controls.module.css`|
|l5V9a|/broadcasts|1152|0→7|今回新しい板|NtCE3と同じ一斉配信の通常状態。1152の数の帯の接続差7属性。|
|mIwA4|/nen/health|1152,1440|12→12|全差一致|健康日記の単頁も共通Paginationへ。末尾の高さが20px減る。 参照 `nen-health/health.tsx`|
|nWmLg|/auto-replies/runs?id=ar-2|1152,1440|16→16|全差一致|実行結果の数の帯に印を追加。 参照 `auto-replies/runs.tsx`|
|piWhz|/contents/vars/edit?id=common-var-hours|1152,1440|4→16|追加/変更|削除文言の既存4属性は保持。共通の保存/操作幅の接続により取消・停止等の採取位置が24.5px変わる12属性が追加。common-vars-edit/edit.tsx。|
|tpRRT|/form-submissions/edit?id=form-1&tab=appearance|1440|2→2|全差一致|jjUEKと同じLIFF共通選択欄の寸法変更が編集プレビューに反映。 参照 `apps/liff/src/components/forms/controls.module.css`|
|usDpO|/affiliates?tab=payment|1440|5→7|追加/変更|CVz5dと同じ支払いの安全説明/本文高の差。ページ送りの既存差は保持。|
|wTIej|/nen/pets|1152,1440|12→12|全差一致|ペット一覧の単頁も共通Paginationへ。末尾の高さが20px減る。 参照 `nen-pets/list.tsx`|
|wxIQ7|/rich-menus/connections?id=rmg-1|1152,1440|17→17|全差一致|切替のつながりをCreatePageからDetailPageへ。現在画面への重複ボタンを除去し操作を整理。 参照 `rich-menus/connections.tsx`|
|z2dgw|/webinars/edit?id=webinar-1&pane=analytics|1152,1440|134→134|全差一致|Lのウェビナー詳細を共通Tabsへ。押しボタン4つがタブ4つになり、36pxの高さと6pxの位置差。|
|zQ5vY|/nen/members?tab=lifetime|1152,1440|98→98|全差一致|会員の共通説明欄を追加し、生涯購入額の説明・表示を整理。後続区画が移動。 参照 `nen-members/members.tsx・lifetime.tsx`|

## 未取得と引き継ぎ

- cFo2p/1440は列車37と同じ保存済み操作の不足。旧「止める」の可視相手がなく、現行の操作へ鍵の開き方を更新する判断は道具係/司令塔。製品を旧名へ戻していない。
- 53板の差は生結果と前回比較へ保存。採否・写真との照合・鍵の更新は司令塔。CIの成功を鍵の合格にしない。
- 今回の直接修正板はn9vvGx・p0kA3・wTIej・PMLkX・ARuZ4。撮影用b18c1448c4とはコードが違うため、変更した接続/印は最新HEADで撮影係が確認する。
