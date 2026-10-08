# mainD：予約設定・イベントの2周目（2026-10-09）

開始・検査前の本線：`ec03047312b7240dfb8c6ac6b60acd77a86747b3`。rebase・push・PR・配備・DB更新は行わない。

担当23枚をすべて測定。21枚が90%以上。正式な合格台帳の更新と統合は司令塔が行う。
画像は design/v8/overlay/pages-mainD の design / impl を左右で確認した。HTML書き出しは位置が崩れるため、位置は pencil-texts の座標表を正本とする（HOW-TO-90 §0）。切れ・重なり・短い文字列の途中折り返し、列・札・操作の欠けを確認。データの値・行数・権限による操作の出し入れは差として認める。

## 板ごとの測定

| 板ID | 名前 | 直す前 | 直した後 | 左右で見比べた結果 |
|---|---|---:|---:|---|
| C9fv7A | 予約設定 メニュー（閲覧のみ）V8 | 62% | 96% | OK（データ・権限の差を除く） |
| CcA4k | 予約設定 予約スタッフを登録 V8 | 95% | 95% | OK（データ・権限の差を除く） |
| DFl3Q | 予約管理 予約が重なった知らせ（人）V8 | 2% | 4% | 未合格：ZyDd6 と骨格が食い違う |
| E3YDK | 自分の勤務（スタッフ本人）V8 | 81% | 100% | OK（データ・権限の差を除く） |
| KRgTQ | 予約設定 休業日 V8 | 98% | 99% | OK（データ・権限の差を除く） |
| P6EdLW | 予約設定 メニュー（1152）V8 | 50% | 98% | OK（データ・権限の差を除く） |
| QqER7 | 予約設定 メニューを作る V8 | 93% | 93% | OK（データ・権限の差を除く） |
| VFxWU | 予約設定 受付枠（1152）V8 | 96% | 98% | OK（データ・権限の差を除く） |
| VLEaj | 予約設定 担当スタッフ V8 | 86% | 94% | OK（データ・権限の差を除く） |
| ZyDd6 | 予約設定 予約経路の連携（人）V8 | 91% | 93% | OK（データ・権限の差を除く） |
| d5fmnM | 予約設定 勤務とシフト（管理者）V8 | 81% | 100% | OK（データ・権限の差を除く） |
| ooufy | 予約設定 担当メニューをまとめて決める V8 | 96% | 100% | OK（データ・権限の差を除く） |
| owaS3 | 予約設定 メニュー V8 | 62% | 96% | OK（データ・権限の差を除く） |
| v5L19Z | 予約設定 メニュー編集（競合）V8 | 92% | 92% | OK（データ・権限の差を除く） |
| wvGke | 自分の勤務（ひも付けなし）V8 | 100% | 100% | OK（データ・権限の差を除く） |
| x1OZS6 | 予約設定 予約のルール V8 | 96% | 98% | OK（データ・権限の差を除く） |
| xCoDe | ★V8 予約設定 状態 | 0% | 0% | 対象外：横並びの状態見本帳 |
| yRPxl | 予約設定 受付枠 V8 | 96% | 97% | OK（データ・権限の差を除く） |
| Mu8qW | イベント予約 申込者 V8 | 100% | 100% | OK（データ・権限の差を除く） |
| d4adD4 | イベント予約 イベントを作る V8 | 100% | 100% | OK（データ・権限の差を除く） |
| e2ekFu | イベント予約 一覧 V8 | 90% | 90% | OK（データ・権限の差を除く） |
| hmr2P | イベント予約 変更の確認 V8 | 40% | 100% | OK（データ・権限の差を除く） |
| qUdNh | イベント予約 変更内容を確認 V8 | 50% | 98% | OK（データ・権限の差を除く） |

## 90%未満で残った板と理由

- **DFl3Q：4%**。重なり通知の実状態をAPIと同じ形の見本データで撮影した。背景は5タブ・古い説明の板だが、同じ予約経路画面 ZyDd6 は6タブで構成が異なる。通知も絵は「②を移す」、現在のAPI契約と画面は bookingId に当たる「①を移す」。絵にある外部媒体名・移動先の確実な空き時刻はAPIにないので、断言しない。片方の板に寄せてもう片方を崩す修正はしない。司令塔がPenを揃えた後に測り直す。
- **xCoDe：0%（画面として測定不可）**。幅2000の横並びの状態見本帳で、1枚のURLに対応しない。通常画面へ無理に並べない。読込失敗・読み直し・閲覧のみの表示は動作試験で確認する。合格画面として数えない。

## 共通部品と代表板

TagPill に分類の読み上げ名を指定する任意の口を追加。DateTimeField に高さ36の任意の口を追加。既定値と既存呼び出し先の形は変えない。
代表板の再測定：WQmep 46%、x6QsVz 98%、I1E7Bt 99%、LRc93 5%。変更前後で点数は同じ。WQmep・LRc93 の未合格部分はこの担当の変更で生じた差ではなく、別担当の画面に残るもの。

## 監査と細かい依頼

- B-55：本線の TimeFieldV8（数字入力＋時・分の2列）を使う。共通部品の動作試験で文字入力・選択・消去を確認する。
- WEB052：個別更新と巻き戻しをやめ、版番号付きの一括並べ替えAPIへ接続。失敗時は順序を戻し、再試行する。一括APIは本線にあり、新しいAPIは作らない。WEB091のタグ画面側は別担当。
- WEB186：スタッフを二重作成せず、割当の再試行前に直した属性を登録済みスタッフへ保存する。保存中は入力を止め、対象アカウントと世代を照合する。
- WEB187：日付休憩の保存の成否を呼び出し側へ返す。失敗時は追加欄・日付・時刻を残し、その場で再試行する。
- WEB188：保存した区分だけ読み直し、他の区分の編集中の値を残す。
- WEB295〜297：カレンダーのアカウント・期間と取得状態を結ぶ。失敗後はその期間を再取得。一括空き枠は400/404だけ従来方式へ戻し、通信失敗・500で要求を増やさない。
- WEB298〜300：編集時の離脱確認、対象と世代による古い完了の破棄、保存中の入力保護。別予約へ移った後の競合や再試行失敗で旧予約を再取得しない。
- WEB303〜307：確認と確定の対象キーを統一、復元した電話客の保存時入力を照合、別担当の候補時刻を空き枠再取得後に復元、通知対象外へ自動通知を約束しない、古いアカウントのメニュー応答を捨てる。
- WEB051・053〜059・WEB-062〜064：本線で既に修正されている動作を対応するV8の試験で再確認する。
- WEB189〜191：検査サービス・機能設定の監査項目で、この予約・イベント担当の画面ではない。変更しない。
- 要件判断が必要な32問（triage 第3節）は判断・仕様変更を行わない。
- 入力不足は欄の赤枠と理由に寄せ、最初の誤りへ焦点を移す。欄の理由を上の帯に重ねない。

変更する監査項目は、修正前または元の不具合を戻した状態で再現試験の失敗を確認した。スタッフ、日付休憩、カレンダー、予約詳細・代理作成、並べ替えの試験を追加。保存・送信・権限・失敗・再取得の試験を削除しない。

## API・設計の判断待ち

- 予約メニューの分類に色の値がないため、色を別の値から作らず、共通札の既定の点を表示する。
- DFl3Q にある「移動先の空きが確実」「外部予約サイトの具体名」は、現在の返事で保証できない。板を実契約に揃えるか、別のAPIが要るか司令塔の判断。
- API・DB・Worker・親ECリポジトリを変更しない。

## V7 の削除と残件

予約一覧・予約詳細・スタッフ一覧の V7 の見た目分岐を除いた。イベント新規作成の入口は V8 へ集約した。

次の8入口の V7 削除は保留：予約メニュー一覧・作成／編集・担当割当、スタッフ作成・勤務、イベント一覧・申込者・変更確認。V8へ直接つなぎ直す検証では、従来の動作試験が失敗した。旧画面の編集窓からV8の別ページへの試験移行だけでなく、設備の必要数を変える欄、待ち列の「見送り」など、V8の絵・操作へ引き継がれていない項目を含む。保存・送信・権限・再取得の試験を消して合格扱いにせず、入口は戻した。V8の見た目と今回の監査修正は残している。

この点により「自分の機能のV7をすべて削除」は未完了。司令塔が既存の動きをV8でどこへ置くかを確認し、必要なPenの板を揃えた後、動作試験をV8へ移してから残りの入口を除く。

追加の動作修正：設定取得を待たずメニュー一覧を表示する（DEEP-26）。メニュー作成後の担当割当では一括取得に担当が含まれない場合に担当別で取り直し、新しく作ったメニューの割当を明示的に送る。V8のキャンセルも未保存確認を通す。

## 仕上げ

- DOCTOR_LOCAL=1 の開始検査：合格。
- テスト：116ファイル・661件、すべて成功。TimeFieldV8 と DateTimeField の試験、設計の境界・直書き値・CSS予算・共通部品の影響も含む。
- 型検査：成功（測定サーバー停止・本番ビルド後に独立して再実行）。
- 本番ビルド：成功。既存の img 警告のみ。
- verify:design：456件一致、不一致0、合格。
- impeccable detect：指摘0。git diff --check：成功。
- 共通部品の代表4枚は変更前後で同じ点数。最後に owaS3 96%・QqER7 93%を再測定。
- 自分の測定サーバーだけ停止。
- CSS予算は勤務の行高と変更確認の見出し高の2項目だけ、意図した高さ指定の追加に合わせた。他の画面の予算は変えていない。
- 未失敗のように扱うためのテスト削除はしていない。旧テーマだけを対象とする予約一覧の見た目契約をV8だけの契約へ変更。実描画の状態変更と再取得・並べ替えの試験はV8の入口・一括APIに合わせて移した。

実装コミット：`588307c734`（見た目）、`db7e89a3d8`（動作・入力・試験）。報告書のコミットSHAは最終返信に記載。push・PR・DB更新・配備なし。

661件には、保留した8入口の従来の動作試験も含む。その8入口をV8へ移し終えた証拠としては扱わない。今回の監査修正は対象の現行V8または共通の予約画面を実描画する追加試験で確認した。

変更ファイル：
- `apps/web/src/app/booking/bookings/booking-account-boundary-contract.test.ts`
- `apps/web/src/app/booking/bookings/booking-audit-r89-r90.test.tsx`
- `apps/web/src/app/booking/bookings/booking-issue634-availability-retry.test.tsx`
- `apps/web/src/app/booking/bookings/booking-row-target-contract.test.ts`
- `apps/web/src/app/booking/bookings/detail/page.r318-r322.test.tsx`
- `apps/web/src/app/booking/bookings/detail/page.tsx`
- `apps/web/src/app/booking/bookings/new/page.draft.test.tsx`
- `apps/web/src/app/booking/bookings/new/page.test.ts`
- `apps/web/src/app/booking/bookings/new/page.tsx`
- `apps/web/src/app/booking/bookings/page.tsx`
- `apps/web/src/app/booking/bookings/ux2-booking-detail.test.ts`
- `apps/web/src/app/booking/menus/page.split-load.test.tsx`
- `apps/web/src/app/booking/menus/settings-optimistic.react.test.tsx`
- `apps/web/src/app/booking/staff/page.tsx`
- `apps/web/src/app/events/new/page.tsx`
- `apps/web/src/components/shared/date-time-field.module.css`
- `apps/web/src/components/shared/date-time-field.tsx`
- `apps/web/src/components/shared/tag-pill.tsx`
- `apps/web/src/lib/screen-css-budget-baseline.json`
- `apps/web/src/v8/booking-menus/menu-form-followup.test.tsx`
- `apps/web/src/v8/booking-menus/menu-form.module.css`
- `apps/web/src/v8/booking-menus/menu-form.tsx`
- `apps/web/src/v8/booking-menus/menus-tab-reorder.test.tsx`
- `apps/web/src/v8/booking-menus/settings.module.css`
- `apps/web/src/v8/booking-menus/settings.tsx`
- `apps/web/src/v8/booking-menus/tabs/menus-tab.tsx`
- `apps/web/src/v8/booking-staff/phone.module.css`
- `apps/web/src/v8/booking-staff/shifts.module.css`
- `apps/web/src/v8/booking-staff/shifts.test.tsx`
- `apps/web/src/v8/booking-staff/shifts.tsx`
- `apps/web/src/v8/booking-staff/staff-new.module.css`
- `apps/web/src/v8/booking-staff/staff-new.test.tsx`
- `apps/web/src/v8/booking-staff/staff-new.tsx`
- `apps/web/src/v8/events/change-review.module.css`
- `apps/web/src/v8/events/change-review.tsx`
- `apps/web/src/v8/events/create.tsx`
- `docs/v8-mainD-second-pass-20261009.md`
- `scripts/visual-qa/mainD-second-pass-states.json`

PR時の更新履歴案（司令塔が番号を決めて unreleased/<PR番号>-kenta-予約イベント.md に保存）：
`- 予約設定とイベント画面を見本に合わせ、保存や予約のやり直しで入力が失われる問題を直した @kenta #<PR番号> 2026-10-09 03:04`
