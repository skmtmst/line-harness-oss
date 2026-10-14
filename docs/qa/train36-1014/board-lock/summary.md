# 列車36：鍵の検査（正式結果と補助測定）

対象製品SHA: `e38e83331d99ad4c549ba25df3a84618df8524fe`。正式guardは終了2、175板・332条件中331取得、動き30板／差1545件、未取得1条件。欠測を成功に数えない。

保存先: `/Users/kentakenta/lh-work/design/v8/locks/checks/2026-10-14T04-26-42-457Z-97947`。鍵・許容幅・除外・承認台帳は変更していない。以下はコードと差分を照合した理由であり、Pencilとの再合格や鍵更新の承認を代行するものではない。

|板ID|画面|幅|差の件数|由来|理由|主な参照先|
|---|---|---|---:|---|---|---|
|AOWoJ|会員 一覧 V8（機能追加 F-19・API待ち）|1152,1440|81|G/L|会員の説明を共通の説明欄に集約、フォルダ無しの名前・共通ページ送りへ。|`nen-members/members.tsx・list.tsx`|
|BeNtj|一斉配信 予約を取り消す（確かめ）V8|1440|15|L|予約完了の共通要約に完了アイコンを追加。背面の題が52px移動。|`broadcast-detail/reserved.tsx`|
|CcA4k|予約設定 予約スタッフを登録 V8|1152,1440|247|F|スタッフ登録をCreatePage・CardHeader・共通入力／画像欄へ移行。|`booking-staff/staff-new.tsx`|
|CyW0E|運営 ダッシュボード V8|1152,1440|6|G|3つのカード列を内容に合う高さ（natural）へ。|`ops/dashboard.tsx`|
|GmVR5|設定 EC連携 V8|1152,1440|120|G|数の帯に印と件の単位を追加し、共通の広い本文へ接続。|`settings/ec-commerce/screen.tsx`|
|GobMd|友だち属性 友だち情報欄の移行 V8|1152,1440|124|F|移行画面を共通Notice・入力行・表・要約へ接続。DB更新は実施していない。|`tags/field-migrate.tsx`|
|H031gC|外部連携 受け取る設定を追加 V8|1152,1440|4|F2x|内部値automationを利用者向け「オートメーションを動かす」へ表示。|`webhooks/incoming-actions.tsx`|
|H5UoIu|分析 レポートを作る V8|1152,1440|3|既存本線|前回の本線検査と差3件が一致。右欄の白・プレビュー名の共通修正。|`components/templates/create-page.tsx`|
|IY3nx|統括 テンプレート 質問を作る V8（店と同じ形＋配る）|1152,1440|203|F|質問作成を共通CardHeader・TextField・SegmentedControl・要約へ接続。|`templates/question-new.tsx`|
|JCDRm|概要|1440|8|L|行操作の「編集」を「編集する」に共通化。4箇所の言葉の差。|`friend-detail/overview-tab.tsx・shared/row-actions`|
|JeINq|リッチメニュー 作る① 形と画像 V8|1152,1440|61|既存本線|前回の本線検査と差61件が一致。共通入力行・保存操作・右欄の修正。|`components/templates/create-page.tsx・shared/settings-form-card`|
|M8zhjL|マイル マイルを手で増やす・減らす V8|1440|42|G|背面の残高説明の矛盾を修正。残高ありに「確定待ちはありません」と出さない。|`mileage/friend-detail.tsx`|
|MuhWR|NEN配信 一覧（自動配信）V8|1152,1440|16|G/L|長い開封の見出しを「開封率」にし、説明はhelpLabelへ。共通ページ送りへ。|`nen-campaigns/list.tsx`|
|Q5le3|流入と計測 詳細（新）V8|1152,1440|51|G|数の帯の見出しに印を追加。|`inflow-links/detail.tsx`|
|R6kIG|マイル 友だちのマイル詳細（新）V8|1152,1440|78|G|残高がある場合に明細確認の説明を出す。説明行の増加で後続が18px移動。|`mileage/friend-detail.tsx`|
|REIxB|友だち追加時の配信 実行結果 V8|1152,1440|16|G|実行結果の数の帯に印を追加。|`friend-add-runs/runs.tsx`|
|Td4TN|成果とアフィリエイト 案件を作る V8（機能追加 F-23・API待ち）|1152,1440|25|既存本線|前回の本線検査と差25件が一致。右欄と共通入力行の修正。|`components/templates/create-page.tsx・shared/settings-form-card`|
|UkZLi|外部連携 鍵を発行しました V8|1152,1440|92|L|背面の鍵一覧を共通の内容幅の表に接続。名前列をgrowへ。|`webhooks/api-tokens.tsx`|
|V7vn3|設定 LINEアカウント V8|1152,1440|10|G/L|数の帯に印を追加、名前列の不要なフォルダ部品を除去しチャネルを接続状態の下へ。|`settings/accounts/accounts.tsx`|
|eLjeQ|マイペット ペットの情報を直す V8|1440|6|G/L|背面の一覧のページ送りを共通Paginationへ。単頁の高さが20px減る。|`nen-pets/list.tsx`|
|g98F9|オートメーション 動いた記録 V8|1152,1440|42|G/L|動いた記録を共通DataTable・状態札・行操作・ページ送りへ接続。|`automations/runs.tsx・runs.module.css`|
|iLJmw|EC連携 つなぎ先 V8|1152,1440|132|G|EC連携の数の帯の印・単位と共通本文への接続。カード高が2px減る。|`settings/ec-commerce/screen.tsx`|
|jjUEK|回答フォーム 編集（受付と見た目：カスタム）V8（B-236 採用 2026-10-11）|1440|2|LIFF|プレビューが使うLIFF共通選択欄のborder→outlineと行高を修正。後続の評価の題が3px上へ。|`apps/liff/src/components/forms/controls.module.css`|
|mIwA4|健康日記 一覧 V8|1152,1440|12|G/L|健康日記の単頁も共通Paginationへ。末尾の高さが20px減る。|`nen-health/health.tsx`|
|nWmLg|自動応答 実行結果 V8|1152,1440|16|G|実行結果の数の帯に印を追加。|`auto-replies/runs.tsx`|
|piWhz|共通情報 編集（競合）V8|1152,1440|4|L/F2x|共通の削除操作の言葉を「削除する」に統一。保存競合の状態は保持。|`common-vars-edit/edit.tsx・shared/row-actions`|
|tpRRT|回答フォーム 編集（受付と見た目） V8|1440|2|LIFF|jjUEKと同じLIFF共通選択欄の寸法変更が編集プレビューに反映。|`apps/liff/src/components/forms/controls.module.css`|
|wTIej|マイペット 一覧 V8|1152,1440|12|G/L|ペット一覧の単頁も共通Paginationへ。末尾の高さが20px減る。|`nen-pets/list.tsx`|
|wxIQ7|リッチメニュー 切替のつながり V8|1152,1440|17|K|切替のつながりをCreatePageからDetailPageへ。現在画面への重複ボタンを除去し操作を整理。|`rich-menus/connections.tsx`|
|zQ5vY|会員 ライフタイム V8|1152,1440|98|G|会員の共通説明欄を追加し、生涯購入額の説明・表示を整理。後続区画が移動。|`nen-members/members.tsx・lifetime.tsx`|

## 未取得と残る判断

- `cFo2p`（1440）：保存済みの開き方は「止める」。L組の明示的な修正で「止められない理由を見る」へ変わったため、その操作が見つからず未取得。`friend-add/list.tsx`と同ファイルの動作試験で確認。正式な鍵の開き方の更新は司令塔へ。
- 30板の差は司令塔が採否を判断する。組でaccept/recordや許容変更をしていない。
- H5UoIu・JeINq・Td4TNは本線の以前の検査と全差が一致。比較記録は外部 `locks/drift-1014/CHECK-CURRENT.json`。
