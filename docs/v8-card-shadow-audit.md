# カードの影の点検（2026-10-09）

B-137・B-148・B-153に従い、重複を除いて180か所（CSS規則・部品の利用箇所）を修正した。描画されるカードの実数ではない。

入力・副操作・札・表・数の帯・警告・入れ子は影を追加しない。理由付きの例外は `apps/web/design/card-shadow-exceptions.json` を正とし、新しい影なしの候補は見張りが落とす。V8から呼ばれない旧画面は切り替え前の分岐として残す。

判定保留はなし。画像との1440・1152幅の照合は司令塔が行う。ここでPASSEDの記録は更新していない。

## 検証の範囲

設計値は取り込んだ写しを維持し、未実装だった共通変数9件の状態だけを利用中へ更新した。未利用の部品もCSS変数を解いて、写しの `resolved` の値そのものと照合する。値のずれを許す変更はしていない。

テスト前に取り込んだ開発基準は `2dd0c741dc95e3a038821eae977a972d1c35305d`。その後取得した `2b86c006498b6c8bb1f41dbc08a70b0295a537e4` は同じ箇所の変更があるため、取り込みの判断待ち。push・PR・本番・D1への適用は実施していない。

全体vitestは `NEXT_PUBLIC_API_URL=http://localhost:8787`・`--maxWorkers=2` で2027ファイル、11841件成功（skip・todo各1件）。試験内でNextサーバーが起動するので、次回もビルドと同時に走らせず、全体試験→ビルド→型検査→設計照合の順にする。

webの `tsc --noEmit`・`next build`・設計照合450件一致（不一致0）・`git diff --check` も合格。未実装だった共通変数9件は実装済み。画像との照合の合格を意味しない。

## 修正箇所

- `app/ops/knowledge/article-v8.module.css .fields`
- `app/tags/field-migrate-v8.module.css .fieldCard`
- `apps/web/src/app/accounts/migration.tsx:253`
- `apps/web/src/app/accounts/migration.tsx:325`
- `apps/web/src/app/accounts/migration.tsx:609`
- `apps/web/src/app/affiliates/tabs.tsx:2533`
- `apps/web/src/app/affiliates/tabs.tsx:2634`
- `apps/web/src/app/affiliates/tabs.tsx:3071`
- `apps/web/src/app/affiliates/tabs.tsx:727`
- `apps/web/src/app/affiliates/tabs.tsx:975`
- `apps/web/src/app/broadcasts/detail/broadcast-activity.tsx:53`
- `apps/web/src/app/broadcasts/detail/broadcast-recipients.tsx:216`
- `apps/web/src/app/broadcasts/detail/broadcast-status-rail.tsx:99`
- `apps/web/src/app/contents/media-detail-dialog.tsx:454`
- `apps/web/src/app/contents/media-detail-dialog.tsx:517`
- `apps/web/src/app/contents/media-detail-dialog.tsx:538`
- `apps/web/src/app/contents/media-detail-dialog.tsx:598`
- `apps/web/src/app/contents/media-detail-dialog.tsx:689`
- `apps/web/src/app/emergency/send-path-coverage-panel.tsx:80`
- `apps/web/src/app/events/change-review/change-review-v8.tsx:165`
- `apps/web/src/app/hq/account-browser-v8.tsx:328`
- `apps/web/src/app/nen-campaigns/nen-overview.tsx:919`
- `apps/web/src/app/nen-campaigns/nen-overview.tsx:942`
- `apps/web/src/app/nen/health/items-tab.tsx:37`
- `apps/web/src/app/nen/health/items-tab.tsx:48`
- `apps/web/src/app/nen/pets/feeding-tab.tsx:217`
- `apps/web/src/app/restaurant-test/google/google-business.tsx:323`
- `apps/web/src/app/restaurant-test/google/google-business.tsx:355`
- `apps/web/src/app/restaurant-test/google/google-business.tsx:422`
- `apps/web/src/app/restaurant-test/google/google-performance.tsx:180`
- `apps/web/src/app/restaurant-test/google/google-posts.tsx:639`
- `apps/web/src/app/restaurant-test/google/google-posts.tsx:655`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:257`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:281`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:383`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:641`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:704`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:891`
- `apps/web/src/app/restaurant-test/google/google-profile.tsx:914`
- `apps/web/src/app/scenarios/detail/detail-v8.tsx:1931`
- `apps/web/src/app/scenarios/detail/detail-v8.tsx:319`
- `apps/web/src/app/templates/staff-asset-list.tsx:46`
- `apps/web/src/app/webinars/edit/notifications-v8.tsx:107`
- `apps/web/src/app/webinars/edit/notifications-v8.tsx:111`
- `apps/web/src/app/webinars/edit/review-v8.tsx:121`
- `apps/web/src/app/webinars/edit/review-v8.tsx:133`
- `apps/web/src/app/webinars/edit/video-v8.tsx:551`
- `apps/web/src/components/accounts/account-ordering.tsx:332`
- `apps/web/src/components/broadcasts/broadcast-approval.tsx:259`
- `apps/web/src/components/broadcasts/broadcast-approval.tsx:272`
- `apps/web/src/components/broadcasts/broadcast-approval.tsx:282`
- `apps/web/src/components/broadcasts/broadcast-approval.tsx:329`
- `apps/web/src/components/broadcasts/broadcast-form.tsx:2222`
- `apps/web/src/components/broadcasts/broadcast-form.tsx:2230`
- `apps/web/src/components/broadcasts/broadcast-form.tsx:2509`
- `apps/web/src/components/events/event-wizard.tsx:1032`
- `apps/web/src/components/events/event-wizard.tsx:1391`
- `apps/web/src/components/events/event-wizard.tsx:549`
- `apps/web/src/components/events/event-wizard.tsx:808`
- `apps/web/src/components/forms/hq-form-definition-editor.tsx:211`
- `apps/web/src/components/forms/hq-form-definition-editor.tsx:233`
- `apps/web/src/components/friends/advanced-search-dialog.tsx:517`
- `apps/web/src/components/friends/advanced-search-dialog.tsx:762`
- `apps/web/src/components/friends/advanced-search-dialog.tsx:777`
- `apps/web/src/components/hq/banners/generation-panel.tsx:116`
- `apps/web/src/components/ops/notice-line-account-card.tsx:39`
- `apps/web/src/components/scenarios/trigger-editor.tsx:384`
- `apps/web/src/components/scenarios/trigger-editor.tsx:405`
- `apps/web/src/components/shared/condition-builder.tsx:340`
- `apps/web/src/components/shared/create-page.tsx:262`
- `apps/web/src/components/shared/create-page.tsx:369`
- `apps/web/src/components/shared/mobile-table-cards.tsx:71`
- `apps/web/src/components/shared/skeleton.tsx:192`
- `apps/web/src/components/templates/message-template-editor.tsx:313`
- `apps/web/src/components/webinars/webinar-form.tsx:411`
- `apps/web/src/components/webinars/webinar-notifications.tsx:348`
- `apps/web/src/v8/account-new/register.tsx:454`
- `apps/web/src/v8/account-new/register.tsx:490`
- `apps/web/src/v8/account-new/register.tsx:524`
- `apps/web/src/v8/account-new/register.tsx:608`
- `apps/web/src/v8/accounts-detail/detail.tsx:269`
- `apps/web/src/v8/accounts-detail/detail.tsx:292`
- `apps/web/src/v8/accounts-detail/detail.tsx:341`
- `apps/web/src/v8/accounts-detail/detail.tsx:372`
- `apps/web/src/v8/accounts-detail/detail.tsx:377`
- `apps/web/src/v8/accounts-detail/detail.tsx:381`
- `apps/web/src/v8/accounts-detail/handover.tsx:531`
- `apps/web/src/v8/accounts-detail/handover.tsx:539`
- `apps/web/src/v8/accounts-detail/handover.tsx:572`
- `apps/web/src/v8/contents/media-detail-dialog.tsx:458`
- `apps/web/src/v8/contents/media-detail-dialog.tsx:511`
- `apps/web/src/v8/contents/media-detail-dialog.tsx:532`
- `apps/web/src/v8/contents/media-detail-dialog.tsx:592`
- `apps/web/src/v8/contents/media-detail-dialog.tsx:683`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:163`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:171`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:199`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:227`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:251`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:260`
- `apps/web/src/v8/nen-campaigns/column-new.tsx:308`
- `apps/web/src/v8/nen-campaigns/edit.tsx:344`
- `apps/web/src/v8/nen-campaigns/edit.tsx:352`
- `apps/web/src/v8/nen-campaigns/edit.tsx:357`
- `apps/web/src/v8/nen-campaigns/edit.tsx:403`
- `apps/web/src/v8/nen-campaigns/edit.tsx:417`
- `apps/web/src/v8/nen-campaigns/edit.tsx:479`
- `apps/web/src/v8/nen-campaigns/edit.tsx:517`
- `apps/web/src/v8/nen-members/lifetime.tsx:140`
- `apps/web/src/v8/nen-members/ranks.tsx:292`
- `apps/web/src/v8/nen-members/ranks.tsx:307`
- `apps/web/src/v8/nen-members/ranks.tsx:366`
- `apps/web/src/v8/restaurant/inventory/channels.tsx:177`
- `apps/web/src/v8/restaurant/inventory/channels.tsx:193`
- `apps/web/src/v8/restaurant/inventory/channels.tsx:247`
- `apps/web/src/v8/restaurant/inventory/stock.tsx:346`
- `apps/web/src/v8/restaurant/inventory/stock.tsx:381`
- `apps/web/src/v8/restaurant/inventory/stock.tsx:407`
- `apps/web/src/v8/restaurant/inventory/stock.tsx:476`
- `apps/web/src/v8/rich-menus/external-import.tsx:76`
- `apps/web/src/v8/scenario-detail/detail.tsx:2091`
- `apps/web/src/v8/scenario-detail/detail.tsx:393`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:600`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:609`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:622`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:645`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:652`
- `apps/web/src/v8/settings/line-notifications/screen.tsx:662`
- `apps/web/src/v8/settings/staff/staff.tsx:212`
- `apps/web/src/v8/settings/staff/staff.tsx:539`
- `apps/web/src/v8/settings/staff/staff.tsx:540`
- `apps/web/src/v8/settings/staff/staff.tsx:556`
- `apps/web/src/v8/settings/staff/staff.tsx:558`
- `apps/web/src/v8/templates/staff-asset-list.tsx:65`
- `components/shared/card.module.css .card`
- `components/shared/card.module.css [data-theme='v8'] .bordered`
- `components/shared/card.module.css [data-theme='v8'] .card[data-appearance="outlined"]`
- `components/shared/card.module.css [data-theme='v8'] .card[data-spacing='settings']`
- `components/shared/card.module.css [data-theme='v8'] .spacedInset`
- `v8/analytics/analytics.module.css .card`
- `v8/analytics/analytics.module.css .flowCard`
- `v8/analytics/analytics.module.css .funnelFlow`
- `v8/analytics/analytics.module.css .funnelSide`
- `v8/analytics/analytics.module.css .historyCard`
- `v8/analytics/analytics.module.css .hours`
- `v8/analytics/analytics.module.css .reportCard`
- `v8/automations/templates.module.css .card`
- `v8/broadcast-detail/reserved.module.css .done`
- `v8/form-edit/edit.module.css .card`
- `v8/form-edit/edit.module.css .urlBox`
- `v8/hq-templates/console.module.css .editPanel`
- `v8/hq-templates/console.module.css .progressPanel`
- `v8/ops/ops-knowledge-v8.module.css .fields`
- `v8/restaurant/closures/closures.module.css .card`
- `v8/restaurant/reservations/phone.tsx frame 0`
- `v8/restaurant/reservations/phone.tsx frame 1`
- `v8/restaurant/reservations/phone.tsx frame 2`
- `v8/restaurant/reservations/phone.tsx frame 3`
- `v8/restaurant/reservations/phone.tsx frame 4`
- `v8/restaurant/reservations/phone.tsx frame 5`
- `v8/restaurant/reservations/phone.tsx frame 6`
- `v8/restaurant/reservations/phone.tsx frame 7`
- `v8/restaurant/reservations/today.tsx frame 0`
- `v8/restaurant/reservations/today.tsx frame 1`
- `v8/restaurant/reservations/today.tsx frame 2`
- `v8/restaurant/reservations/today.tsx frame 3`
- `v8/settings/pools/pools.module.css .card`
- `v8/settings/sns/sns.module.css .card`
- `v8/settings/staff/staff.module.css .asideCard`
- `v8/settings/staff/staff.module.css .card`
- `v8/settings/staff/staff.module.css .roleCard`
- `v8/visit-stamps/visit-stamps.module.css .card`
- `v8/visit-stamps/visit-stamps.module.css .side`
- `v8/webinar-edit/analytics.module.css .card`
- `v8/webinar-edit/comments.module.css .card`
- `v8/webinar-edit/comments.module.css .side`
- `v8/webinar-edit/cta.module.css .previewCard`
- `v8/webinar-edit/form.module.css .card`
- `v8/webinar-edit/review.module.css .pageCard`
- `v8/webinar-edit/video.module.css .pageCard`
