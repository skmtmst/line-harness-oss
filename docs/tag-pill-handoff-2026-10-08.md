# タグ札の統一：tagp 引き継ぎ（2026-10-08）

共通 TagPill と、重ならない V8 の表示箇所を実装した。統括のタグ一覧と、新しいタグ編集の見本は hq の作業中の変更と重なるため未適用。全体の完了・画面の合格とはしない。

## できたこと

- TagPill：白地、hairline 1px、丸い角、フォルダ色の点、名前 600。ふつう＝14px・点10px・6/12、小さい札＝13px・点8px・4/10。
- 名前の読み上げ、全文の title、編集リンク、×の名前・キーボード操作。リンクと×は兄弟で、表のクリックへ伝えない。
- TagToggle：条件づくりの選択／未選択を共通の札で表示。aria-pressed と、既存の条件の付け外しを保つ。
- 店のタグ一覧、友だち一覧、友だち詳細、受信箱のタグ節、予約詳細、詳細条件、タグ作成の見本、既存の V8 タグ編集部品の見本に適用。
- 受信箱は×→共通 ConfirmDialog→外す。キャンセルは変更しない。友だちを切り替えたら確認を閉じる。元に戻す・失敗時の持ち直しは既存処理を使う。
- V7 の見た目と操作は残す。Pencil・対応状況・右欄の幅・メニューの名前は変更しない。

## 板ごとの測定と見比べ

担当名 tagp。変更前の Git SHA は d49079e4028393ee88b134ebf14ba05ecfb85063。数値は文字位置の一致率で、画像全体の合格ではない。

| 板ID | 名前 | 変更前 | 変更後 | 見比べで残った違い |
| --- | --- | ---: | ---: | --- |
| I1E7Bt | 店のタグ一覧・1440 | 67% | 99% | 札はOK。既存の外側・フォルダ幅・色・集計帯の印などに差。名前替えは保留。 |
| aPeD8 | 店のタグ一覧・1152 | 98% | 54% | 書き出しの絵は名前だけの旧形。採用済みの札を入れたため名前位置・行高さが変わる。Pencilは変更しない。 |
| fkGUR | タグ一覧・閲覧のみ | 65% | 97% | 札はOK。絵の押せない作成／CSV／フォルダ追加は、決まりに従って実装では隠す。外側の既存差あり。 |
| IjVpM | フォルダ追加 | 70% | 99% | 背景の札はOK。窓の既存の色選び・保存前の押せない状態・外側に差。 |
| DzdC3 | 統括のタグ一覧 | 11% | 11% | hq と重なるため未適用。集計帯・タブ・列の骨格も絵と異なる。 |
| x6QsVz | 友だち一覧 | 97% | 93% | 札はOK。書き出しの絵は旧形。対応状況の札等の保留分は触らない。 |
| eovoG | 受信箱 | 撮影失敗 | 63% | 札はOK。書き出しの絵のタグ節は文字の列挙。右欄・会話の頭・顧客情報の段など既存差あり。保留分は触らない。 |

全7枚の実装・設計画像を目で確認。タグ札に切れ・重なりなし。友だち一覧の狭い札は1行省略で title と読み上げで全文を確認できる。

画像・位置の記録：`~/lh-work/design/v8/overlay/pages-tagp/`。

### 受信箱の撮影

共有の対応表でのクリック指定 `Kyohei Yamamoto` は、複数の対象が見つかるため撮影できなかった。道具と共有の対応表は変更していない。
作業場所の無視対象 `.measure/tagp-map.json` を作り、同じ会話を `/chats?status=unread&friend=chat-0` から開いた。見本は会話IDと友だちIDが別々なので、`GET /api/friends/chat-0` の応答だけを既存の friend-0 見本（所属アカウント付き）へ合わせた。画面のアカウント照合は保つ。

## hq の作業と重なる未適用分

- `apps/web/src/v8/hq-templates/store-list.tsx`：`type === 'tag'` の名前に小さい TagPill。既存の編集ボタン／onEditを残す。APIがフォルダ色を返さない箇所は灰色。
- `apps/web/src/v8/tag-edit/edit.tsx`：現状の新しい編集画面には「できあがるタグ」の見本が無い。右の欄へ名前と選択中フォルダの色を渡す TagPill を追加する案を用意した。
- 適用案は `.measure/hq-tag-pill.patch`（未適用・未検証）。hq の最新変更に合わせて調整が必要。作業順の確認を利用者へ出している。

## API と配備

API・DBの変更、DB更新、配備はなし。予約詳細の応答はタグの名前・IDだけなので、点は仕様どおり薄い灰色。色を別の値で代用しない。

## 試験

- tsc：合格。
- 関連の vitest：57ファイル・235件合格。札・条件づくり・受信箱の追加試験も合格。
- build：最後のCSS調整後の再実行も合格。
- verify:design：最後のビルド後の再実行も456件一致・不一致0、合格。
- screen-css-budget：合格、基準の更新なし。
- 旧形を固定していた V8 一覧の試験を TagPill の確認へ更新。試験の削除はなし。V7 と保存・権限・再試行の試験は保つ。

## 変更ファイル

- 共通：`components/shared/tag-pill.tsx`・`tag-pill.module.css`・`tag-pill.test.tsx`・`condition-builder.tsx`・`condition-builder-tag-pill.test.tsx`。
- 受信箱：`components/chats/friend-info-sidebar.tsx`・`inbox-panel-inline-edit-react.test.tsx`。
- 詳細条件：`components/friends/advanced-search-dialog.tsx`。
- 予約：`app/booking/bookings/detail/page.tsx`。
- 見本：`app/tags/tag-editor-v8.tsx`・`v8/tags/create.tsx`。
- 一覧・詳細：`v8/tags/tags-tab.tsx`・`list.module.css`・`list.test.tsx`・`v8/friends/list/list.tsx`・`v8/friend-detail/overview-tab.tsx`。
- 文書：`v8/tags/BEHAVIOR.md`・`docs/brain/rules/corrections.md`・この引き継ぎ。

司令塔がPRを採番したら反映履歴を追加する。文案：「タグの表示を丸い札にそろえ、受信箱で外す前に確認できるようにした」。日時は日本時間、担当と実際のPR番号を付ける。

## 実装コミット

- `278b7611a2`：共通の札・2サイズ・編集／外す／条件の切り替えと試験。
- `37fd643947`：各画面への適用・受信箱の確認・V7の維持と試験。

push・PR・統合は実施していない。測るサーバーは `measure.sh --stop tagp` で停止済み。
