# 列車41・所有監査の残件（続き2）

base: af8e504d75ad3d647fd2698690e2a97daa388387。残り25件、一時許可0。許可・上限を変更していない。

| 型/区分 | 対象 | 内容 | 判断理由 |
|---|---|---|---|
| a/page-head | apps/liff/src/pages/MyPage.tsx:233 | LIFF専用部品 | 管理画面のPageHeading/Field/ToggleはLIFFの画面構成・入力と別。LIFF内の共通Buttonは使用済み。管理画面の型へは置換しない。 |
| a/folder-column | apps/web/src/v8/hq-starter-sets/starter-sets.tsx:157 | 固定スタイルの選択 | 5業種の固定行。FolderPanel使用済みで、フォルダ追加・編集・削除のない選択。ManagedFolderPanelの管理操作と役目が違う。 |
| a/table | apps/web/src/v8/style-dashboard/calendar.tsx:86 | 月カレンダー | 共通GridTableのcalendar提示を確認したが、role=tableと行密度52/60を持つ時刻×担当の表。曜日7列/可変週/日ボタンの月盤へそのまま置換すると意味と寸法が変わる。月盤の共通口を追加するか司令塔判断。 |
| a/table | apps/web/src/v8/style-dashboard/calendar.tsx:87 | 月カレンダー | 共通GridTableのcalendar提示を確認したが、role=tableと行密度52/60を持つ時刻×担当の表。曜日7列/可変週/日ボタンの月盤へそのまま置換すると意味と寸法が変わる。月盤の共通口を追加するか司令塔判断。 |
| a/table | apps/web/src/v8/style-dashboard/calendar.tsx:88 | 月カレンダー | 共通GridTableのcalendar提示を確認したが、role=tableと行密度52/60を持つ時刻×担当の表。曜日7列/可変週/日ボタンの月盤へそのまま置換すると意味と寸法が変わる。月盤の共通口を追加するか司令塔判断。 |
| a/select | apps/web/src/components/hq/banners/reference-picker-dialog.tsx:269 | 参照画像の複数選択と取込 | EntityPickerDialogは既存項目の選択、MediaSlotは1枠の媒体。画像のタイルを3枚まで選ぶ一覧＋FileDropzone取込を同じ形で置換する口が無い。FileDropzone自体は共通UI。上限は変更しない。 |
| a/tap-action | apps/web/src/v8/rich-menu-sample/sample.tsx:119 | 読取専用の動作一覧 | TapActionFieldは動作を編集する入力欄。ここは共通GridTableの列名・説明・HelpTipで、編集フォームではない。語だけを根拠に型へ置換しない。候補は残す。 |
| a/tap-action | apps/web/src/v8/rich-menu-sample/sample.tsx:124 | 読取専用の動作一覧 | TapActionFieldは動作を編集する入力欄。ここは共通GridTableの列名・説明・HelpTipで、編集フォームではない。語だけを根拠に型へ置換しない。候補は残す。 |
| a/tap-action | apps/web/src/v8/rich-menu-sample/sample.tsx:149 | 読取専用の動作一覧 | TapActionFieldは動作を編集する入力欄。ここは共通GridTableの列名・説明・HelpTipで、編集フォームではない。語だけを根拠に型へ置換しない。候補は残す。 |
| a/media-slot | apps/web/src/app/rich-menus/new/create-v8.module.css:309 | リッチメニューの領域見本 | 画像の上の座標付き領域線とラベル。媒体を取り込む枠ではなくMediaSlotでは相対座標を保てない。既存のLinePreview内の表示。 |
| a/media-slot | apps/web/src/components/hq/banners/generation-panel.tsx:202 | 参照画像の取込 | FileDropzoneは共通UIの既存取込。MediaSlotへ置換するとドラッグ＆ドロップ/形式/複数画像の操作が変わる。司令塔へ確認を渡す。 |
| a/media-slot | apps/web/src/components/hq/banners/reference-picker-dialog.tsx:317 | 参照画像の複数選択と取込 | EntityPickerDialogは既存項目の選択、MediaSlotは1枠の媒体。画像のタイルを3枚まで選ぶ一覧＋FileDropzone取込を同じ形で置換する口が無い。FileDropzone自体は共通UI。上限は変更しない。 |
| a/media-slot | apps/web/src/components/hq/banners/reference-picker-dialog.tsx:321 | 参照画像の複数選択と取込 | EntityPickerDialogは既存項目の選択、MediaSlotは1枠の媒体。画像のタイルを3枚まで選ぶ一覧＋FileDropzone取込を同じ形で置換する口が無い。FileDropzone自体は共通UI。上限は変更しない。 |
| a/media-slot | apps/web/src/v8/style-dashboard/style-dashboard.module.css:98 | 独自の予約盤とCSS | freeSlotは点線の空き枠ボタンで媒体枠ではない。共通Buttonに同じ全面/点線の提示は無い。legendItemは動的な凡例を含み、dayName aは動的な予約名。共通部品の上書きでないと断定せず残す。 |
| a/field-error | apps/liff/src/pages/MyPage.tsx:288 | LIFF専用部品 | 管理画面のPageHeading/Field/ToggleはLIFFの画面構成・入力と別。LIFF内の共通Buttonは使用済み。管理画面の型へは置換しない。 |
| a/sticky-bar | apps/web/src/v8/hq-banners/project.module.css:9 | 下部操作の配置 | 子の操作本体は共通StickyBar。galleryFooterはその上の警告と本文幅内のsticky配置をまとめる外側。StickyBarを二重にすると配置・余白が変わる。 |
| a/toggle | apps/liff/src/pages/MyPage.tsx:394 | LIFF専用部品 | 管理画面のPageHeading/Field/ToggleはLIFFの画面構成・入力と別。LIFF内の共通Buttonは使用済み。管理画面の型へは置換しない。 |
| b/kpi-band | apps/web/src/v8/style-dashboard/style-dashboard.module.css:109 | 独自の予約盤とCSS | freeSlotは点線の空き枠ボタンで媒体枠ではない。共通Buttonに同じ全面/点線の提示は無い。legendItemは動的な凡例を含み、dayName aは動的な予約名。共通部品の上書きでないと断定せず残す。 |
| b/table | apps/web/src/v8/friends/list/list.tsx:850 | 既存の表のセル指定 | 共通Tdは使用済み。受信なしの枝追加で候補化した既存のtdクラスで、前後のpadding/文字/行高指定は同じ。表全体の既存上書きを共通提示へ移す判断が必要。候補を消していない。 |
| b/table | apps/web/src/v8/hq-templates/store-list.tsx:472 | 既存の表のセル指定 | 共通Td/Checkboxは使用済み。追加した選択セルに既存のcellPlainを使用。共通側へ全テンプレート一覧の文字提示を移す判断が必要。ラッパーへクラスを移すだけの隠蔽はしない。 |
| b/（型なし） | apps/web/src/v8/booking-bookings/next-booking.module.css:10 | 使い先の証明ができないCSS | row > svgはLucideアイコンの色/縮み止め。動的な日付・要望等の子があるためASTは子孫全体を素の要素と断定できない。見張りをゆるめず候補を残す。 |
| b/（型なし） | apps/web/src/v8/booking-payments/payments.module.css:269 | 使い先の証明ができないCSS | amountBox svgは計算アイコンだが動的な金額の子あり。sideCardLink svgは共通TextLink内のアイコンも対象。後者は本当の子孫指定として残し、共通のアイコン配置口を検討する。 |
| b/（型なし） | apps/web/src/v8/booking-payments/payments.module.css:316 | 使い先の証明ができないCSS | amountBox svgは計算アイコンだが動的な金額の子あり。sideCardLink svgは共通TextLink内のアイコンも対象。後者は本当の子孫指定として残し、共通のアイコン配置口を検討する。 |
| b/（型なし） | apps/web/src/v8/settings/sns/sns.module.css:111 | 使い先の証明ができないCSS | checks svgはmapで出すチェックアイコン。動的な子の中身を見張りは証明しないため、候補を残す。 |
| b/（型なし） | apps/web/src/v8/style-dashboard/style-dashboard.module.css:156 | 独自の予約盤とCSS | freeSlotは点線の空き枠ボタンで媒体枠ではない。共通Buttonに同じ全面/点線の提示は無い。legendItemは動的な凡例を含み、dayName aは動的な予約名。共通部品の上書きでないと断定せず残す。 |
