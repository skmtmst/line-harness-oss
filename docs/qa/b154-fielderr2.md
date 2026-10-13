# B-154 保存の失敗を欄ごとに表示する（fielderr2）

通常のブロック入力に加え、行のラジオ・選択ボタン・画像入力・認証コード・入力部品を返すhookも接続する。繰り返す欄には番号付きの欄名を渡す。

対象ブランチ: `codex/kenta-fielderr2-1010`。開始・試験前の本線 SHA: `5c2829221153a90e35a269e92b647ba9378ee8cc`（#1684、列車12を含む。#1685は未統合）。push・PR・DB更新・配備は行わない。

## 調査の数え方

- 最初の調査: 保存APIのtry/catchを持つ179ファイル。既存のuseFormErrorsあり13、未使用166。下表の「未使用」がこの166ファイルの一覧。
- 最終の見張り: `src/v8/**/*.tsx` と `src/app/**/*-v8.tsx`（試験・fixtureを除く）。保存する関数、編集窓を返すhook、set系API、Promiseのcatchも含め、208ファイル・384個の保存失敗の受け口を確認。
- 一覧・詳細の編集窓やフォルダ追加も数える。ファイル数は画面の枚数とは異なる。別ファイルの入力部品にも親の保存失敗を渡す。
- 初めから欄表示を持つ画面も、APIのfieldsを受けるところまで接続。最終のAST見張りの未接続は0。通知設定の共通保存関数も失敗結果へfieldsを残し、呼び出した画面で欄へ返す。

## 共通の動き

SaveErrorScope・SaveErrorFieldで、欄名を入力部品へ結び付ける。表示文、赤い印、aria-describedby、最初の欄へのフォーカスを共通で扱い、打ち直した欄の理由だけを消す。正常時の包みのDOMは増やさない。横並びの欄でも理由は最後の行へ出し、入力DOMと値を保つ。同名の欄が背景と編集窓にあれば、編集中の窓だけへ出す。認証コードの自動消去でも保存失敗の理由は残す。選択群・日時・フォルダ・素材選択にも適用する。

既存の入力検査と、競合・権限・通信障害・保存後の後片付けは残す。店舗・対象・読み込み世代が変わった古い応答を捨てる条件の後で、欄の理由を受ける。未知の欄や一部しか結び付かない理由は、既存の上の知らせも残して握りつぶさない。対象アカウントや版番号など、入力欄がない失敗も全体の案内として残す。

統括ひな形のエラー変換とテンプレート保存結果はfieldsを失わず渡す。タグの畳んだマイル設定は、欄名を先に登録し、開いてからその欄へ移る。段階式の統括配信とリッチメニューも既存の検査・段の切替と接続する。

## CIの見張り

`apps/web/src/app/form-save-errors-contract.test.ts` が全対象ファイルをASTで検査する。保存するcatch自身にcapture/setServerErrorsがなく、上の知らせだけなら失敗する。importだけ残す・読むcatchにだけcaptureを置く形も検出する。標準のweb試験からCIで実行する。

この見張りは保存失敗の受け口を調べるもので、Pencilの462枚の見た目の合格を宣言するものではない。欄名の結び付け・フォーカス・エラー修正・競合等は動作試験で確認する。

## 保存処理の一覧

「未使用」は開始時にuseFormErrorsがなかったもの。「既存あり」はその13ファイル。「追加調査」はPromise/set系等で見つけたもの。すべて共通の保存失敗表示へ接続済み。

| ファイル（apps/web/以下） | 開始時 | 保存の受け口 |
| --- | --- | ---: |
| `src/app/accounts/handover/handover-v8.tsx` | 未使用 | 2 |
| `src/app/accounts/new/register-v8.tsx` | 未使用 | 4 |
| `src/app/affiliate-offers/new-offer-v8.tsx` | 未使用 | 1 |
| `src/app/affiliates/new-affiliate-v8.tsx` | 未使用 | 3 |
| `src/app/auto-replies/edit/wizard-v8.tsx` | 未使用 | 2 |
| `src/app/automations/list-v8.tsx` | 追加調査 | 1 |
| `src/app/automations/new/new-v8.tsx` | 未使用 | 2 |
| `src/app/automations/templates-v8.tsx` | 未使用 | 1 |
| `src/app/booking/menus/channels-tab-v8.tsx` | 追加調査 | 2 |
| `src/app/booking/menus/new/menu-form-v8.tsx` | 未使用 | 4 |
| `src/app/booking/menus/payment-tab-v8.tsx` | 未使用 | 2 |
| `src/app/booking/menus/staff/assign-v8.tsx` | 追加調査 | 2 |
| `src/app/booking/prepay-badge-v8.tsx` | 追加調査 | 1 |
| `src/app/booking/staff/new/staff-new-v8.tsx` | 未使用 | 2 |
| `src/app/booking/staff/shifts/staff-detail-v8.tsx` | 未使用 | 6 |
| `src/app/common-actions/common-action-new-v8.tsx` | 未使用 | 1 |
| `src/app/contents/list-v8.tsx` | 未使用 | 3 |
| `src/app/contents/vars/list-v8.tsx` | 未使用 | 4 |
| `src/app/conversions/conversion-points-v8.tsx` | 未使用 | 1 |
| `src/app/events/bookings/bookings-v8.tsx` | 未使用 | 1 |
| `src/app/events/events-list-v8.tsx` | 未使用 | 1 |
| `src/app/hq/account-browser-v8.tsx` | 未使用 | 1 |
| `src/app/inflow-links/ad-integration-v8.tsx` | 未使用 | 1 |
| `src/app/line-notifications/operator/new/operator-new-v8.tsx` | 未使用 | 3 |
| `src/app/nen-campaigns/columns/new/column-new-v8.tsx` | 未使用 | 1 |
| `src/app/nen-campaigns/edit/campaign-editor-v8.tsx` | 未使用 | 2 |
| `src/app/nen-members/photo-policy-history-v8.tsx` | 未使用 | 1 |
| `src/app/nen-members/photo-review-v8.tsx` | 未使用 | 4 |
| `src/app/nen/members/members-v8.tsx` | 未使用 | 2 |
| `src/app/nen/pets/pets-v8.tsx` | 未使用 | 2 |
| `src/app/reminders/detail/detail-v8.tsx` | 未使用 | 3 |
| `src/app/reminders/edit/edit-v8.tsx` | 未使用 | 2 |
| `src/app/reminders/list-v8.tsx` | 未使用 | 3 |
| `src/app/reminders/new/new-v8.tsx` | 未使用 | 1 |
| `src/app/restaurant-test/v8/inventory.tsx` | 未使用 | 3 |
| `src/app/restaurant-test/v8/organization.tsx` | 未使用 | 1 |
| `src/app/rich-menus/new/create-v8.tsx` | 追加調査 | 3 |
| `src/app/scenarios/detail/detail-v8.tsx` | 未使用 | 8 |
| `src/app/scenarios/first-step-v8.tsx` | 未使用 | 1 |
| `src/app/scenarios/mode-v8.tsx` | 未使用 | 2 |
| `src/app/tags/edit-field-page-v8.tsx` | 未使用 | 1 |
| `src/app/tags/edit-tag-page-v8.tsx` | 未使用 | 1 |
| `src/app/tags/field-migrate-v8.tsx` | 未使用 | 1 |
| `src/app/tags/mark-editor-v8.tsx` | 未使用 | 1 |
| `src/app/tags/new-field-page-v8.tsx` | 未使用 | 1 |
| `src/app/tags/new-tag-page-v8.tsx` | 未使用 | 1 |
| `src/app/tags/search-editor-v8.tsx` | 未使用 | 2 |
| `src/app/tags/tags-tab-v8.tsx` | 未使用 | 4 |
| `src/app/templates/asset-editor-v8.tsx` | 未使用 | 1 |
| `src/app/templates/carousel/carousel-v8.tsx` | 追加調査 | 1 |
| `src/app/templates/detail/detail-v8.tsx` | 追加調査 | 1 |
| `src/app/templates/edit-v8.tsx` | 追加調査 | 1 |
| `src/app/templates/list-v8.tsx` | 未使用 | 2 |
| `src/app/templates/questions/question-v8.tsx` | 未使用 | 1 |
| `src/app/webhooks/apitokens-v8.tsx` | 未使用 | 1 |
| `src/app/webhooks/outgoing-v8.tsx` | 未使用 | 2 |
| `src/app/webinars/edit/basic-v8.tsx` | 未使用 | 1 |
| `src/app/webinars/edit/comments-v8.tsx` | 未使用 | 1 |
| `src/app/webinars/edit/cta-v8.tsx` | 未使用 | 2 |
| `src/app/webinars/edit/notifications-v8.tsx` | 未使用 | 1 |
| `src/app/webinars/edit/review-v8.tsx` | 追加調査 | 1 |
| `src/app/webinars/edit/video-v8.tsx` | 未使用 | 3 |
| `src/app/webinars/list-v8.tsx` | 未使用 | 2 |
| `src/app/webinars/new/new-v8.tsx` | 未使用 | 1 |
| `src/v8/account-new/register.tsx` | 未使用 | 4 |
| `src/v8/accounts-detail/dialogs.tsx` | 既存あり | 2 |
| `src/v8/accounts-detail/handover.tsx` | 未使用 | 2 |
| `src/v8/affiliate-offer-new/create.tsx` | 既存あり | 1 |
| `src/v8/affiliates/create.tsx` | 未使用 | 3 |
| `src/v8/affiliates/dialogs.tsx` | 未使用 | 2 |
| `src/v8/affiliates/drawer.tsx` | 未使用 | 1 |
| `src/v8/affiliates/offer-form.tsx` | 未使用 | 1 |
| `src/v8/affiliates/offers.tsx` | 未使用 | 2 |
| `src/v8/affiliates/payment.tsx` | 未使用 | 2 |
| `src/v8/analytics/cross.tsx` | 未使用 | 1 |
| `src/v8/analytics/funnel-form.tsx` | 未使用 | 1 |
| `src/v8/analytics/funnel.tsx` | 未使用 | 2 |
| `src/v8/analytics/saved.tsx` | 追加調査 | 1 |
| `src/v8/auto-replies/list.tsx` | 未使用 | 3 |
| `src/v8/auto-replies/quick-create.tsx` | 未使用 | 1 |
| `src/v8/automations/common-action-new.tsx` | 未使用 | 1 |
| `src/v8/automations/create/create.tsx` | 未使用 | 2 |
| `src/v8/automations/list.tsx` | 追加調査 | 1 |
| `src/v8/automations/templates.tsx` | 未使用 | 1 |
| `src/v8/booking-menus/assign.tsx` | 追加調査 | 2 |
| `src/v8/booking-menus/channels-tab.tsx` | 追加調査 | 2 |
| `src/v8/booking-menus/menu-form.tsx` | 未使用 | 4 |
| `src/v8/booking-menus/staff-edit-dialog.tsx` | 未使用 | 1 |
| `src/v8/booking-menus/tabs/holidays-tab.tsx` | 未使用 | 1 |
| `src/v8/booking-menus/tabs/hours-tab.tsx` | 未使用 | 3 |
| `src/v8/booking-menus/tabs/menus-tab.tsx` | 追加調査 | 2 |
| `src/v8/booking-menus/tabs/rules-tab.tsx` | 未使用 | 1 |
| `src/v8/booking-menus/tabs/staff-tab.tsx` | 未使用 | 1 |
| `src/v8/booking-staff/shifts.tsx` | 未使用 | 6 |
| `src/v8/booking-staff/staff-new.tsx` | 未使用 | 2 |
| `src/v8/broadcasts/list.tsx` | 未使用 | 1 |
| `src/v8/broadcasts/quick-send.tsx` | 未使用 | 1 |
| `src/v8/common-vars-edit/edit.tsx` | 未使用 | 3 |
| `src/v8/common-vars-edit/new.tsx` | 未使用 | 1 |
| `src/v8/common-vars/export-panel.tsx` | 未使用 | 1 |
| `src/v8/common-vars/list.tsx` | 未使用 | 3 |
| `src/v8/contents/list.tsx` | 未使用 | 2 |
| `src/v8/contents/media-detail-dialog.tsx` | 未使用 | 2 |
| `src/v8/contents/media-replacement-dialog.tsx` | 未使用 | 1 |
| `src/v8/conversions/create.tsx` | 未使用 | 1 |
| `src/v8/conversions/list.tsx` | 未使用 | 6 |
| `src/v8/events/bookings.tsx` | 未使用 | 1 |
| `src/v8/events/create.tsx` | 未使用 | 1 |
| `src/v8/form-edit/edit.tsx` | 未使用 | 3 |
| `src/v8/forms/list.tsx` | 未使用 | 3 |
| `src/v8/friend-add-publish/publish.tsx` | 追加調査 | 1 |
| `src/v8/friend-add/editor.tsx` | 未使用 | 2 |
| `src/v8/friend-add/list.tsx` | 未使用 | 1 |
| `src/v8/friend-detail/dialogs.tsx` | 未使用 | 2 |
| `src/v8/hq-banners/list.tsx` | 未使用 | 3 |
| `src/v8/hq-banners/project.tsx` | 未使用 | 3 |
| `src/v8/hq-broadcasts/create.tsx` | 既存あり | 3 |
| `src/v8/hq-broadcasts/list.tsx` | 未使用 | 1 |
| `src/v8/hq-templates/attributes.tsx` | 未使用 | 2 |
| `src/v8/hq-templates/console.tsx` | 既存あり | 1 |
| `src/v8/hq-templates/store-list.tsx` | 追加調査 | 1 |
| `src/v8/hq/account-dialogs.tsx` | 未使用 | 1 |
| `src/v8/hq/company-contact.tsx` | 未使用 | 1 |
| `src/v8/hq/home.tsx` | 未使用 | 3 |
| `src/v8/hq/members.tsx` | 未使用 | 1 |
| `src/v8/hq/settings.tsx` | 未使用 | 1 |
| `src/v8/hq/support.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/ad-connection-dialog.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/ad-connections.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/ads.tsx` | 未使用 | 2 |
| `src/v8/inflow-links/bulk-dialog.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/detail.tsx` | 未使用 | 2 |
| `src/v8/inflow-links/edit-route-dialog.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/genre-dialog.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/list.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/new/create.tsx` | 未使用 | 1 |
| `src/v8/inflow-links/site-script.tsx` | 未使用 | 1 |
| `src/v8/line-notifications/operator-edit.tsx` | 既存あり | 3 |
| `src/v8/login/two-factor-ops.tsx` | 追加調査 | 1 |
| `src/v8/mileage/adjust-dialog.tsx` | 追加調査 | 2 |
| `src/v8/mileage/earning-rule-new/create.tsx` | 未使用 | 2 |
| `src/v8/mileage/earning-rules.tsx` | 未使用 | 4 |
| `src/v8/mileage/reward-edit.tsx` | 追加調査 | 1 |
| `src/v8/mileage/rewards.tsx` | 未使用 | 2 |
| `src/v8/mileage/score.tsx` | 既存あり | 4 |
| `src/v8/nen-campaigns/column-new.tsx` | 未使用 | 1 |
| `src/v8/nen-campaigns/edit.tsx` | 未使用 | 2 |
| `src/v8/nen-members/lifetime.tsx` | 未使用 | 1 |
| `src/v8/nen-members/ranks.tsx` | 未使用 | 1 |
| `src/v8/nen-pets/editor.tsx` | 未使用 | 1 |
| `src/v8/nen-pets/feeding.tsx` | 未使用 | 1 |
| `src/v8/nen-posts/policy-history.tsx` | 未使用 | 1 |
| `src/v8/nen-posts/review.tsx` | 未使用 | 4 |
| `src/v8/ops/announcements.tsx` | 既存あり | 1 |
| `src/v8/ops/login.tsx` | 追加調査 | 1 |
| `src/v8/reminders/detail.tsx` | 未使用 | 3 |
| `src/v8/reminders/edit.tsx` | 追加調査 | 2 |
| `src/v8/restaurant/closures/closure-dialog.tsx` | 未使用 | 2 |
| `src/v8/restaurant/front-desk/phone-drawer.tsx` | 既存あり | 1 |
| `src/v8/restaurant/front-desk/walk-in-dialog.tsx` | 追加調査 | 1 |
| `src/v8/restaurant/google/posts.tsx` | 未使用 | 2 |
| `src/v8/restaurant/google/reviews.tsx` | 未使用 | 2 |
| `src/v8/restaurant/google/settings.tsx` | 追加調査 | 1 |
| `src/v8/restaurant/inventory/stock.tsx` | 未使用 | 2 |
| `src/v8/restaurant/organization/organization.tsx` | 未使用 | 1 |
| `src/v8/restaurant/store-new/store-new.tsx` | 追加調査 | 1 |
| `src/v8/restaurant/tables/tables.tsx` | 未使用 | 1 |
| `src/v8/rich-menu-edit/detail.tsx` | 追加調査 | 4 |
| `src/v8/scenario-detail/detail.tsx` | 既存あり | 8 |
| `src/v8/scenario-first-step/first-step.tsx` | 未使用 | 1 |
| `src/v8/scenarios/create.tsx` | 未使用 | 2 |
| `src/v8/scenarios/list.tsx` | 追加調査 | 2 |
| `src/v8/settings/booking-media/screen.tsx` | 未使用 | 1 |
| `src/v8/settings/ec-commerce/connector.tsx` | 未使用 | 1 |
| `src/v8/settings/line-notifications/screen.tsx` | 未使用 | 共通関数から欄の理由を返す |
| `src/v8/settings/pools/create.tsx` | 未使用 | 1 |
| `src/v8/settings/staff/staff.tsx` | 未使用 | 6 |
| `src/v8/tag-edit/edit.tsx` | 未使用 | 1 |
| `src/v8/tag-edit/search-edit.tsx` | 未使用 | 2 |
| `src/v8/tags/create.tsx` | 未使用 | 1 |
| `src/v8/tags/field-edit.tsx` | 未使用 | 1 |
| `src/v8/tags/field-migrate.tsx` | 未使用 | 1 |
| `src/v8/tags/field-new.tsx` | 未使用 | 1 |
| `src/v8/tags/folder-page.tsx` | 未使用 | 1 |
| `src/v8/tags/mark-editor.tsx` | 未使用 | 1 |
| `src/v8/tags/searches-tab.tsx` | 未使用 | 1 |
| `src/v8/tags/tags-tab.tsx` | 未使用 | 3 |
| `src/v8/template-detail/detail.tsx` | 未使用 | 2 |
| `src/v8/template-edit/asset.tsx` | 既存あり | 1 |
| `src/v8/template-edit/message.tsx` | 追加調査 | 1 |
| `src/v8/template-edit/rich-video.tsx` | 未使用 | 2 |
| `src/v8/template-edit/rich.tsx` | 既存あり | 1 |
| `src/v8/templates/carousel.tsx` | 追加調査 | 1 |
| `src/v8/templates/list.tsx` | 未使用 | 1 |
| `src/v8/templates/question-new.tsx` | 既存あり | 1 |
| `src/v8/visit-stamps/visit-stamps.tsx` | 未使用 | 2 |
| `src/v8/webhooks/api-tokens.tsx` | 未使用 | 1 |
| `src/v8/webhooks/create.tsx` | 未使用 | 4 |
| `src/v8/webhooks/incoming.tsx` | 未使用 | 3 |
| `src/v8/webhooks/outgoing.tsx` | 未使用 | 2 |
| `src/v8/webhooks/sheets.tsx` | 追加調査 | 2 |
| `src/v8/webinar-edit/basic.tsx` | 未使用 | 1 |
| `src/v8/webinar-edit/comments.tsx` | 未使用 | 1 |
| `src/v8/webinar-edit/cta.tsx` | 既存あり | 2 |
| `src/v8/webinar-edit/new.tsx` | 未使用 | 1 |
| `src/v8/webinar-edit/notifications.tsx` | 未使用 | 3 |
| `src/v8/webinar-edit/review.tsx` | 追加調査 | 1 |
| `src/v8/webinar-edit/video.tsx` | 未使用 | 5 |
| `src/v8/webinars/list.tsx` | 未使用 | 2 |

## 既存試験の更新

繰り返す欄の番号を追加するため、競合一覧のソース文字列試験を、mapの引数数に依存しない確認へ更新した。統括配信は古い移動ボタンの代わりに、先頭の入力欄へ自動で移ることと、入力が不正ならAPIを呼ばないことを確認する。友だち詳細の権限試験は認証済みの担当者APIの応答も模擬する。簡易DOMにもid検索を足し、実際の欄登録を試す。

## 司令塔への引き継ぎ

コミットを本線へ取り込む前に、本線の更新を再取得し、必要な再試験を行う。PR採番後、`docs/release-log/drafts/fielderr2.md` のPR番号を実番号へ置き換え、`unreleased/<PR番号>-kenta-fielderr2.md` に移す。検証環境への反映は司令塔が別工程で行う。

コミットは、共通部品・API変換 `fecdb7de09`、画面への接続 `d6b1672cae`、CIの見張り・この一覧と検証記録、の3つに分けた。push・PR・D1・配備は未実施。

## 検証の記録

- 開始前の `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`: 合格。
- 全体のweb試験（ブラウザ試験を分けて2並列）: 2,031ファイル・11,925件合格、既存のskip 1・todo 1。共通部品の10件とCIの見張り4件も含む。
- ブラウザを使う保存・下書きの試験（1並列）: 9件合格。実際の422応答について1440・1152幅で、欄下の理由・フォーカス・値の維持・打ち直した欄だけの消去・上の同文の知らせがないことを確認。専用の開発サーバーとブラウザは終了済み。他の作業役のサーバーは操作していない。
- `pnpm --filter web typecheck`: 合格。`NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter web build`: 合格。
- `pnpm --filter web verify:design`: 456項目一致、不一致0。`git diff --check`: 合格。

全体のweb試験には `NEXT_PUBLIC_API_URL=http://127.0.0.1:8787` を指定し、実ブラウザの `automation-create-draft-safety.test.ts` を分けて実行した。途中のAPI URL指定漏れは起動条件の失敗として修正し、上記は再実行後の結果。

ブラウザ試験が起動するNextとビルドを同時に動かすと生成物がぶつかるため、最終検証は順番に実行した。欄のDOM・値を維持し、エラー時だけ共通表示を足す。Pencilとの1440・1152幅の画素照合はこの記録に含めず、司令塔の全体の照合と統合判断へ引き継ぐ。
