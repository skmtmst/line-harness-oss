# 列車37：合格済みの板の鍵確認

対象製品SHAは `ed696891ccf5953c3f5ca465e1823820416f1280`。終了2（未合格）。175板・332条件中331取得、動いた板47、差2,488属性、未取得1。鍵・許容幅・除外・合格台帳は変更していない。

CIの `v8-screen-guard` の同SHA・クリーンなcheckoutと静的成果物を使用。成果物に焼き込まれたmock APIを60266で起動し、staff/meの200とversion.jsonのSHAを確認して検査した。最初に誤ってstaging API入りの `web-build` 成果物を使用した検査は環境不一致のため無効とし、本表に含めない。実サービスへの書き込みはない。

[正式の機械結果](RESULT.json)。原本は `/Users/kentakenta/lh-work/design/v8/locks/checks/2026-10-14T12-18-09-746Z-87474/RESULT.json`。下表は差の原因の説明であり、Pencilとの再合格・鍵の掛け替え承認ではない。背面と見本データを含む差は、窓だけの変更として数えない。列車36との比較は属性の全内容を順序に依存せず照合したもの。

|板ID|画面入口|幅|差の件数|列車36との比較|理由|
|---|---|---|---:|---|---|
|AOWoJ|/nen/members|1152,1440|81|全差一致|Gの会員説明を共通説明欄へ、Lのフォルダ無しの名前/共通ページ送りへ。列車36と全81件が一致（記録順だけ異なる）。|
|BeNtj|/broadcasts/reserved?id=broadcast-0|1440|15|全差一致|予約完了の共通要約に完了アイコンを追加。背面の題が52px移動。 参照 `broadcast-detail/reserved.tsx`|
|CVz5d|/affiliates?tab=payment|1440|5|今回の結果で出現|Lの共通ListPaginationへの接続。背面の支払い一覧に件数/ページ送り帯が現れ親板が56px伸びる。窓自体は変更なし。|
|CcA4k|/booking/staff/new|1152,1440|247|全差一致|スタッフ登録をCreatePage・CardHeader・共通入力／画像欄へ移行。 参照 `booking-staff/staff-new.tsx`|
|CyW0E|/ops/dashboard|1152,1440|6|全差一致|3つのカード列を内容に合う高さ（natural）へ。 参照 `ops/dashboard.tsx`|
|DA0Ag|/webhooks?tab=interactions|1440|17|今回の結果で出現|背面のやり取り一覧が共通ListPaginationへ接続され、ページ送り帯が現れる。窓だけの差と混同しない。|
|DFl3Q|/booking/menus?tab=channels|1152,1440|318|今回の結果で出現|予約経路の背面に数の帯を接続（settings-view/channels-summary）。タブが118px移動し、経路一覧の文字/行と共通CardHeaderの位置も変化。背面のデータ差を含むため318件を窓修正だけに帰属させない。|
|G83vi|/analytics/reports/new?id=report-weekly-friends|1440|55|今回の結果で出現|定期レポート作成の共通CreatePage/見本欄への接続。右欄の見本が約24px左へ移動し、見本カードの内容幅も変化。参照app/analytics/reports/new/page.tsx。|
|GVizd|/form-submissions|1440|11|今回の結果で出現|Mの削除確認の左実行/右取消とアーカイブへの配置。取消とアーカイブは122px右へ、操作は15px下へ、窓高5px増。|
|GmVR5|/ec-commerce|1152,1440|120|全差一致|数の帯に印と件の単位を追加し、共通の広い本文へ接続。 参照 `settings/ec-commerce/screen.tsx`|
|GobMd|/tags/fields/migrate?id=field-dog-name|1152,1440|124|全差一致|移行画面を共通Notice・入力行・表・要約へ接続。DB更新は実施していない。 参照 `tags/field-migrate.tsx`|
|H031gC|/webhooks?tab=incoming|1152,1440|7|追加/変更|内部値automationを「オートメーションを動かす」へ表示。受け取る設定のカード高8px増の追加差も観測（webhooks/incoming-actions.tsx）。|
|H5UoIu|/analytics/reports/new|1152,1440|61|追加/変更|G83viと同じ共通CreatePage/見本欄。狭い幅の入口を「レポートの見本を見る」へ。旧3件に右欄/入口/寸法差が加わる。|
|IIesG|/auto-replies|1440|2|今回の結果で出現|Mの共通削除操作を「削除」から「削除する」へ統一。|
|IY3nx|/hq/templates|1152,1440|203|全差一致|質問作成を共通CardHeader・TextField・SegmentedControl・要約へ接続。 参照 `templates/question-new.tsx`|
|JCDRm|/friends/detail?id=friend-1|1440|8|全差一致|行操作の「編集」を「編集する」に共通化。4箇所の言葉の差。 参照 `friend-detail/overview-tab.tsx・shared/row-actions`|
|JeINq|/rich-menus/new|1152,1440|135|追加/変更|共通画像入力の説明/追加操作への接続（F）とCreatePageの右欄。画像の寸法・形式・容量の説明と「画像を追加」が現れる。旧61件と追加74件を含む。|
|Jn95h|/nen-members|1152,1440|2|今回の結果で出現|写真審査の数の帯の説明を共通説明欄に集約し、各KPIの説明ボタン4個が減る（G、nen-posts/review.tsx）。審査操作の削除ではない。|
|M8zhjL|/mileage/friends/detail?id=friend-1&adjust=1|1440|42|全差一致|背面の残高説明の矛盾を修正。残高ありに「確定待ちはありません」と出さない。 参照 `mileage/friend-detail.tsx`|
|MV5Os|/restaurant-test/menu|1152,1440|20|今回の結果で出現|背面の飲食店メニューの数の帯に印を追加（G）。「全メニュー」が32px右へ、窓の背面を含む差。|
|MuhWR|/nen-campaigns|1152,1440|16|全差一致|長い開封の見出しを「開封率」にし、説明はhelpLabelへ。共通ページ送りへ。 参照 `nen-campaigns/list.tsx`|
|PUWyq|/restaurant-test/dashboard|1440|20|今回の結果で出現|Mのウォークイン窓を480pxへ。本文が40px右へ、人数の幅が80px減。座れる卓だけを出す現行データでradio数5→4も観測。後者を寸法修正だけに帰属させない。|
|Q5le3|/inflow-links/detail?id=er-1|1152,1440|51|全差一致|数の帯の見出しに印を追加。 参照 `inflow-links/detail.tsx`|
|R6kIG|/mileage/friends/detail?id=friend-1|1152,1440|78|全差一致|残高がある場合に明細確認の説明を出す。説明行の増加で後続が18px移動。 参照 `mileage/friend-detail.tsx`|
|REIxB|/friend-add-settings/runs|1152,1440|16|全差一致|実行結果の数の帯に印を追加。 参照 `friend-add-runs/runs.tsx`|
|SkY9V|/reminders|1440|2|今回の結果で出現|IIesGと同じ共通削除操作の文言。停止/削除機能は保持。|
|Td4TN|/affiliate-offers/new|1152,1440|38|追加/変更|共通CreatePage/入力行に接続。狭い幅の入口を「アフィリエイターの見え方を見る」へ、見本が約30px左へ。旧25件から38件へ。|
|TkA4D|/nen-members|1152,1440|2|今回の結果で出現|Jn95hと同じ数の帯の説明ボタン4個減。画面の別状態にも反映。|
|UkZLi|/webhooks?tab=api-tokens|1152,1440|91|追加/変更|Lの共通内容幅の表と名前列grow。名前が8px右/11px下へ。列車36と件数は92→91で全差一致ではない。|
|V7vn3|/accounts|1152,1440|10|全差一致|数の帯に印を追加、名前列の不要なフォルダ部品を除去しチャネルを接続状態の下へ。 参照 `settings/accounts/accounts.tsx`|
|VIij4|/hq/rich-menus|1152,1440|86|今回の結果で出現|統括リッチメニューにも共通画像入力の形式/容量/作り方の説明を接続。面の見出しが22px右・32px上へ。|
|cniyw|/nen-members|1152,1440|2|今回の結果で出現|Jn95hと同じ数の帯の説明ボタン4個減。画面の別状態にも反映。|
|eLjeQ|/nen/pets|1440|6|全差一致|背面の一覧のページ送りを共通Paginationへ。単頁の高さが20px減る。 参照 `nen-pets/list.tsx`|
|g98F9|/automations/runs|1152,1440|42|全差一致|動いた記録を共通DataTable・状態札・行操作・ページ送りへ接続。 参照 `automations/runs.tsx・runs.module.css`|
|gBrCz|/restaurant-test/tables|1440|37|今回の結果で出現|Lの卓一覧を共通DataTable/RowMenuへ。「変更」「停止」の独立操作を行末メニューへ集約、状態列が88px右へ。機能はメニューに保持。|
|hadfk|/affiliates?tab=approvals|1152,1440|78|今回の結果で出現|Lの承認一覧の共通ページ送り、L2の共通説明欄への接続。親の高さ/絞り込み位置が変わる。|
|iLJmw|/ec-commerce?tab=connector|1152,1440|132|全差一致|EC連携の数の帯の印・単位と共通本文への接続。カード高が2px減る。 参照 `settings/ec-commerce/screen.tsx`|
|jjUEK|/form-submissions/edit?tab=appearance|1440|2|全差一致|プレビューが使うLIFF共通選択欄のborder→outlineと行高を修正。後続の評価の題が3px上へ。 参照 `apps/liff/src/components/forms/controls.module.css`|
|mIwA4|/nen/health|1152,1440|12|全差一致|健康日記の単頁も共通Paginationへ。末尾の高さが20px減る。 参照 `nen-health/health.tsx`|
|nWmLg|/auto-replies/runs?id=ar-2|1152,1440|16|全差一致|実行結果の数の帯に印を追加。 参照 `auto-replies/runs.tsx`|
|piWhz|/contents/vars/edit?id=common-var-hours|1152,1440|4|全差一致|共通の削除操作の言葉を「削除する」に統一。保存競合の状態は保持。 参照 `common-vars-edit/edit.tsx・shared/row-actions`|
|tpRRT|/form-submissions/edit?id=form-1&tab=appearance|1440|2|全差一致|jjUEKと同じLIFF共通選択欄の寸法変更が編集プレビューに反映。 参照 `apps/liff/src/components/forms/controls.module.css`|
|usDpO|/affiliates?tab=payment|1440|5|今回の結果で出現|CVz5dと同じ、支払い一覧の共通ページ送り帯（L17）。|
|wTIej|/nen/pets|1152,1440|12|全差一致|ペット一覧の単頁も共通Paginationへ。末尾の高さが20px減る。 参照 `nen-pets/list.tsx`|
|wxIQ7|/rich-menus/connections?id=rmg-1|1152,1440|17|全差一致|切替のつながりをCreatePageからDetailPageへ。現在画面への重複ボタンを除去し操作を整理。 参照 `rich-menus/connections.tsx`|
|z2dgw|/webinars/edit?id=webinar-1&pane=analytics|1152,1440|134|今回の結果で出現|Lのウェビナー詳細を共通Tabsへ。押しボタン4つがタブ4つになり、36pxの高さと6pxの位置差。|
|zQ5vY|/nen/members?tab=lifetime|1152,1440|98|全差一致|会員の共通説明欄を追加し、生涯購入額の説明・表示を整理。後続区画が移動。 参照 `nen-members/members.tsx・lifetime.tsx`|

## 未取得と次の判断

- `cFo2p/1440`：保存済みの操作「止める」が現行の「止められない理由を見る」と合わず、操作相手がない。列車36と同じ既知の不足。実装を旧名へ戻さず、正式な開き方の更新を司令塔に返す。
- 47板の差の採否・撮影との照合・鍵の更新は司令塔。accept/record、許容変更、合格扱いへの読み替えを実施していない。
- 本線の既存差と新差を混ぜて0へ書き換えていない。合格台帳の件数を増やしていない。
