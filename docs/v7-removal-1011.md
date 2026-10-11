# V6・V7 の見た目の削除（2026-10-11）

## 方針と開始点

- 司令塔の直接依頼：列車17を土台に、機能ごとにV8固定→動きの試験を移行→合格してから小さくコミット。V8本体の中身・配置は変えない。
- 開始SHA：`342e0dda60754e5a81b3f12c5cf43e54c20701bc`。枝：`codex/kenta-v7rm2-1011`。本線を取り込まない。
- Doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` 合格。開始時クリーン。
- 前回の停止文書・失敗JSON・変更一覧を確認済み。`lh-pages-v7rm` は参照だけ。
- push・PR・D1・配備を行わない。

## 開始時の台帳

画面の入口からimport/export/動的import/requireの到達経路を調べた。未使用の写しは到達しない候補であり、削除前に契約と動作を個別に確認する。
試験数は直接importまたはソースのパス文字列で読む**試験ファイル数**。括弧内はその試験ファイル内のit/test宣言数（eachの展開前、ファイル全体なので対象以外を含む）。分割したpath.join等の動的な読み先は削除時に再検索する。0件でも削除の許可とは扱わない。

|機能|対象ファイル|hook参照|data-theme|v7:|旧マーカー|*-v7|未使用*-v8候補|
|---|---:|---:|---:|---:|---:|---:|---:|
|account-new|1|0|1|0|0|0|0|
|accounts|7|10|3|0|0|0|2|
|affiliate-offers|1|0|0|0|0|0|1|
|affiliates|5|0|13|0|0|0|4|
|analytics|5|4|149|0|0|0|0|
|auto-replies|2|0|12|0|0|0|0|
|automations|16|8|46|0|0|0|5|
|booking|23|12|3|2|4|0|9|
|booking-menus|1|0|1|0|0|0|0|
|broadcast-detail|1|0|5|0|0|0|0|
|broadcasts|6|0|6|0|0|0|3|
|chats|1|0|40|0|0|0|0|
|common-actions|6|6|0|0|0|0|3|
|common-vars|1|0|4|0|0|0|0|
|contents|6|10|4|0|0|0|2|
|conversions|3|4|14|0|0|0|0|
|dashboard|1|0|3|0|0|0|0|
|duplicates|1|2|0|0|0|0|0|
|ec-commerce|4|6|15|0|0|0|0|
|emergency|1|3|1|3|0|0|0|
|events|9|6|0|0|2|0|4|
|form-edit|1|0|11|0|0|0|0|
|form-submissions|2|6|0|0|0|0|0|
|forms|1|0|1|0|0|0|0|
|friend-add|2|0|8|0|0|0|0|
|friend-add-publish|1|0|1|0|0|0|0|
|friend-add-runs|1|0|8|0|0|0|0|
|friend-add-settings|3|0|0|0|0|0|3|
|friend-detail|1|0|1|0|0|0|0|
|friends|8|0|56|0|0|0|2|
|getting-started|1|2|1|0|0|0|0|
|globals.css|1|0|72|2|4|0|0|
|health|1|0|0|0|1|0|0|
|hq|18|0|137|0|0|0|10|
|hq-banners|1|0|1|0|0|0|0|
|hq-broadcasts|2|0|12|0|0|0|0|
|hq-templates|1|0|1|0|0|0|0|
|inbox-chat|1|0|1|0|0|0|0|
|inflow-links|7|9|19|0|0|0|1|
|layout.tsx|1|0|3|0|0|0|0|
|line-notifications|3|2|1|0|0|0|1|
|login|1|2|0|0|0|0|0|
|mileage|8|10|12|0|1|0|1|
|nen|6|6|6|0|0|0|3|
|nen-campaigns|8|6|23|0|0|0|1|
|nen-health|1|0|16|0|0|0|0|
|nen-members|3|0|3|0|0|0|2|
|nen-pets|1|0|14|0|0|0|0|
|nen-posts|1|0|15|0|0|0|0|
|no-permission|1|0|0|0|0|0|1|
|not-found.tsx|1|2|0|0|0|0|0|
|notifications|4|5|31|0|0|0|0|
|ops|13|30|54|0|0|0|0|
|pools|2|4|1|0|0|0|0|
|recipes|1|0|0|0|1|0|0|
|reminders|7|0|5|0|0|0|3|
|restaurant|5|0|7|0|0|0|0|
|restaurant-test|5|8|4|3|0|0|0|
|rich-menus|4|10|1|0|0|0|0|
|scenario-detail|1|0|1|0|0|0|0|
|scenario-first-step|1|0|1|0|0|0|0|
|scenarios|6|0|2|0|0|0|4|
|search-console|1|2|0|0|0|0|0|
|settings|15|0|13|0|0|0|3|
|staff|2|2|1|0|1|0|0|
|support|1|0|0|0|1|0|0|
|tags|15|0|1|0|0|0|14|
|templates|14|10|79|0|0|0|7|
|users|1|2|0|0|0|0|0|
|visit-stamps|1|0|12|0|0|0|0|
|webhooks|6|5|8|0|0|0|2|
|webinar-edit|2|0|7|0|0|0|0|
|webinars|6|8|10|0|0|0|1|
|共通/admin-theme-default.ts|1|0|3|0|0|0|0|
|共通/app-shell.module.css|1|0|14|0|0|0|0|
|共通/app-shell.tsx|1|3|0|0|1|0|0|
|共通/auth-pending-shell.module.css|1|0|3|0|0|0|0|
|共通/auto-replies|1|1|0|0|0|0|0|
|共通/broadcasts|2|4|0|0|0|0|0|
|共通/chats|2|4|0|3|0|0|0|
|共通/dashboard|2|2|0|1|0|0|0|
|共通/events|2|4|0|0|0|0|0|
|共通/friend-fields|1|2|0|0|0|0|0|
|共通/friends|5|8|4|0|0|0|0|
|共通/hq|5|6|0|0|0|0|2|
|共通/identity|1|0|1|0|0|0|0|
|共通/inflow-links|2|2|0|0|0|0|1|
|共通/layout|6|2|62|0|7|0|0|
|共通/ops|3|4|1|0|0|0|0|
|共通/rich-menus|1|2|0|0|0|0|0|
|共通/scenarios|4|2|0|13|0|0|0|
|共通/session-lost-notice.tsx|1|0|0|2|0|0|0|
|共通/shared|92|35|1302|39|30|0|0|
|共通/shell|1|2|0|0|0|0|0|
|共通/support|2|4|0|0|0|0|0|
|共通/templates|3|0|223|0|0|0|0|
|共通/ui|1|2|0|0|0|0|0|
|共通/use-admin-theme.ts|1|1|1|0|0|0|0|

|機能|ファイル（apps/web/srcから）|hook / data-theme / v7: / マーカー|*-v7 / 未使用写し|読む試験ファイル数（宣言数）|試験ファイル|
|---|---|---|---|---:|---|
|account-new|`v8/account-new/register.module.css`|0 / 1 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|accounts|`app/accounts/detail/page.tsx`|2 / 1 / 0 / 0|— / —|3（23）|`apps/web/src/app/accounts/detail/account-detail-aux-failure-react.test.tsx`<br>`apps/web/src/app/accounts/detail/account-detail-contract.test.ts`<br>`apps/web/src/app/accounts/detail/account-detail-edit-react.test.tsx`|
|accounts|`app/accounts/handover/handover-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（3）|`apps/web/src/app/accounts/handover/handover-v8.test.tsx`|
|accounts|`app/accounts/handover/page.tsx`|2 / 0 / 0 / 0|— / —|3（19）|`apps/web/src/app/accounts/handover/handover-contract.test.ts`<br>`apps/web/src/app/accounts/handover/handover-partial-load.react.test.tsx`<br>`apps/web/src/app/accounts/handover/handover-viewer-gating.react.test.tsx`|
|accounts|`app/accounts/migration.tsx`|2 / 0 / 0 / 0|— / —|6（75）|`apps/web/src/app/accounts/migration-contract.test.ts`<br>`apps/web/src/app/accounts/migration-uid-flow-react.test.tsx`<br>`apps/web/src/app/friends/migrations/friend-migrations-v6-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/table-header-migration-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|accounts|`app/accounts/new/page.tsx`|2 / 1 / 0 / 0|— / —|8（53）|`apps/web/src/app/accounts/new/account-save-recovery-react.test.tsx`<br>`apps/web/src/app/accounts/new/registration-v8.test.tsx`<br>`apps/web/src/app/accounts/new/u050-mobile-steps-contract.test.ts`<br>`apps/web/src/app/accounts/new/wizard.test.tsx`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/restaurant-test/restaurant-hq-store-flow.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/sticky-bar-contract.test.ts`|
|accounts|`app/accounts/new/register-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|accounts|`app/accounts/page.tsx`|2 / 1 / 0 / 0|— / —|7（34）|`apps/web/src/app/accounts/account-list-contract.test.ts`<br>`apps/web/src/app/accounts/account-search-row-contract.test.ts`<br>`apps/web/src/app/accounts/accounts-failure-display-react.test.tsx`<br>`apps/web/src/app/accounts/accounts-row-actions.react.test.tsx`<br>`apps/web/src/app/accounts/accounts-setup-visual-parity.test.ts`<br>`apps/web/src/app/hq/u042-mobile-row-actions-contract.test.ts`<br>`apps/web/src/app/restaurant-test/restaurant-hq-store-flow.test.ts`|
|affiliate-offers|`app/affiliate-offers/new-offer-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|4（22）|`apps/web/src/app/affiliate-offers/new/affiliate-offer-account-contract.test.ts`<br>`apps/web/src/app/affiliate-offers/new/offer-v8-design.test.tsx`<br>`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|affiliates|`app/affiliates/affiliates-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（5）|`apps/web/src/app/a11y-issue-637-contract.test.tsx`|
|affiliates|`app/affiliates/create-v8.css`|0 / 0 / 0 / 0|— / 写し候補|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|affiliates|`app/affiliates/list-v8.css`|0 / 0 / 0 / 0|— / 写し候補|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|affiliates|`app/affiliates/new-affiliate-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|4（49）|`apps/web/src/app/affiliates/affiliate-offer-v6-contract.test.ts`<br>`apps/web/src/app/affiliates/feature16-v6-contract.test.ts`<br>`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|affiliates|`v8/affiliates/affiliates.module.css`|0 / 13 / 0 / 0|— / —|0（0）|—|
|analytics|`app/analytics/page.tsx`|2 / 0 / 0 / 0|— / —|21（174）|`apps/web/src/app/analytics/analytics-controls-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-cross-queue-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-cross-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-freshness-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-funnel-state-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-measure-retry-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-notices-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-pending-value-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-saved-reports-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-saved-tab-audit-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-unavailable-words-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-v6-contract.test.ts`<br>`apps/web/src/app/analytics/analytics-visual-parity-contract.test.ts`<br>`apps/web/src/app/analytics/funnel-step-kinds-contract.test.ts`<br>`apps/web/src/app/analytics/readonly-v8.react.test.tsx`<br>`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/conversions/conversion-936-contract.test.ts`<br>`apps/web/src/app/error-copy-recovery-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/bar-chart.test.tsx`<br>`apps/web/src/lib/issue-640-notation-contract.test.ts`|
|analytics|`app/analytics/readonly-v8.css`|0 / 140 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|analytics|`app/analytics/reports/new/report-head-v8.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|analytics|`v8/analytics/analytics.module.css`|0 / 6 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|analytics|`v8/analytics/funnel-form.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|auto-replies|`v8/auto-replies/quick-create.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|auto-replies|`v8/auto-replies/runs.module.css`|0 / 8 / 0 / 0|— / —|0（0）|—|
|automations|`app/automations/automations-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|automations|`app/automations/drafts/page.tsx`|2 / 0 / 0 / 0|— / —|1（2）|`apps/web/src/app/automations/drafts/draft-id-switch-r531.test.tsx`|
|automations|`app/automations/list-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（20）|`apps/web/src/app/automations/automation-v8-boards-contract.test.ts`<br>`apps/web/src/app/automations/list-board-numbers-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`|
|automations|`app/automations/new/new-automation.module.css`|0 / 3 / 0 / 0|— / —|2（9）|`apps/web/src/app/automations/new/automation-new-overflow-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|automations|`app/automations/new/new-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|automations|`app/automations/new/page.tsx`|2 / 0 / 0 / 0|— / —|10（60）|`apps/web/src/app/automations/new/audit-detail-regression.test.tsx`<br>`apps/web/src/app/automations/new/automation-condition-audit.test.tsx`<br>`apps/web/src/app/automations/new/automation-create-v6-contract.test.ts`<br>`apps/web/src/app/automations/new/automation-new-audit.test.tsx`<br>`apps/web/src/app/automations/new/automation-new-options.test.tsx`<br>`apps/web/src/app/automations/new/automation-new-overflow-contract.test.ts`<br>`apps/web/src/app/automations/new/automation-u061-u073-contract.test.ts`<br>`apps/web/src/app/automations/new/automation-weekday-friend-contract.test.ts`<br>`apps/web/src/app/automations/new/resume-read-failure-r532.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|automations|`app/automations/page.tsx`|2 / 0 / 0 / 0|— / —|9（55）|`apps/web/src/app/automations/automation-confirm-dialog-contract.test.ts`<br>`apps/web/src/app/automations/automation-load-state-contract.test.ts`<br>`apps/web/src/app/automations/automation-template-draft-contract.test.ts`<br>`apps/web/src/app/automations/automations-entry-fetch.test.tsx`<br>`apps/web/src/app/automations/list-board-numbers-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`<br>`apps/web/src/lib/audit-cross-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|automations|`app/automations/runs-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（18）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`|
|automations|`app/automations/runs/page.tsx`|2 / 0 / 0 / 0|— / —|10（68）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/automations/runs/automation-runs-audit.test.tsx`<br>`apps/web/src/app/automations/runs/automation-runs-pagination-contract.test.ts`<br>`apps/web/src/app/automations/runs/automation-runs-retry.test.tsx`<br>`apps/web/src/app/automations/runs/automation-runs-v6-contract.test.ts`<br>`apps/web/src/app/error-copy-recovery-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|automations|`app/automations/templates-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（16）|`apps/web/src/app/automations/automation-v8-boards-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`|
|automations|`v8/automations/common-actions.module.css`|0 / 9 / 0 / 0|— / —|0（0）|—|
|automations|`v8/automations/create/create.module.css`|0 / 2 / 0 / 0|— / —|0（0）|—|
|automations|`v8/automations/list.module.css`|0 / 11 / 0 / 0|— / —|0（0）|—|
|automations|`v8/automations/runs.module.css`|0 / 9 / 0 / 0|— / —|0（0）|—|
|automations|`v8/automations/shell.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|automations|`v8/automations/versions.module.css`|0 / 11 / 0 / 0|— / —|0（0）|—|
|booking|`app/booking/bookings/booking-calendar.tsx`|0 / 0 / 2 / 0|— / —|3（29）|`apps/web/src/app/booking/bookings/booking-audit-r315-r317.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-audit-r86-r88.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-calendar-contract.test.ts`|
|booking|`app/booking/bookings/booking-day-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（4）|`apps/web/src/app/booking/bookings/booking-day-v8.react.test.tsx`|
|booking|`app/booking/bookings/booking-detail-v8.tsx`|0 / 1 / 0 / 0|— / —|1（3）|`apps/web/src/app/booking/bookings/booking-detail-v8.react.test.tsx`|
|booking|`app/booking/bookings/detail/page.tsx`|0 / 0 / 0 / 1|— / —|11（69）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/booking/booking-v8-flow.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-approved-text-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-list-limit-contract.test.ts`<br>`apps/web/src/app/booking/bookings/detail/page.idea27-summary.test.tsx`<br>`apps/web/src/app/booking/bookings/detail/page.menu-snapshot.test.tsx`<br>`apps/web/src/app/booking/bookings/detail/page.r318-r322.test.tsx`<br>`apps/web/src/app/booking/bookings/detail/page.r533-contract.test.ts`<br>`apps/web/src/app/booking/bookings/detail/page.target-pinning.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`|
|booking|`app/booking/bookings/new/page.tsx`|0 / 0 / 0 / 1|— / —|10（68）|`apps/web/src/app/booking/bookings/booking-calendar-contract.test.ts`<br>`apps/web/src/app/booking/bookings/new/page.draft.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.instant.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.r534-contract.test.ts`<br>`apps/web/src/app/booking/bookings/new/page.r534-faithful-rerender.react.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.r534-menus-429-react.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.test.ts`<br>`apps/web/src/app/error-copy-recovery-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`|
|booking|`app/booking/bookings/page.tsx`|0 / 1 / 0 / 0|— / —|17（110）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/booking/booking-batch-fetch-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-account-boundary-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-audit-r315-r317.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-audit-r89-r90.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-calendar-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-folder-panel-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-issue634-availability-retry.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-issue635-filtered-empty.test.tsx`<br>`apps/web/src/app/booking/bookings/booking-list-limit-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-row-target-contract.test.ts`<br>`apps/web/src/app/booking/bookings/booking-share-url-contract.test.ts`<br>`apps/web/src/app/booking/bookings/new/page.test.ts`<br>`apps/web/src/app/booking/bookings/ux2-booking-detail.test.ts`<br>`apps/web/src/app/booking/bookings/v8b-ledger-boards.contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|booking|`app/booking/menus/channels-tab-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（26）|`apps/web/src/app/booking/menus/channels-tab-v8.test.tsx`<br>`apps/web/src/app/booking/menus/v6-contract.test.ts`|
|booking|`app/booking/menus/liff-phone-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|booking|`app/booking/menus/new/menu-form-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（19）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/booking/menus/new/menu-form-tag-search.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/menus/new/page.tsx`|2 / 0 / 0 / 0|— / —|8（50）|`apps/web/src/app/booking/booking-batch-fetch-contract.test.ts`<br>`apps/web/src/app/booking/menus/new/menu-form-blur.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/menu-form-v8-skeleton.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/page.retry-staff.test.tsx`<br>`apps/web/src/app/booking/menus/new/page.test.tsx`<br>`apps/web/src/app/booking/menus/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/menus/page.tsx`|2 / 0 / 0 / 0|— / —|10（111）|`apps/web/src/app/booking/menus/booking-menu-safe-state-contract.test.ts`<br>`apps/web/src/app/booking/menus/page.reorder.test.tsx`<br>`apps/web/src/app/booking/menus/page.test.tsx`<br>`apps/web/src/app/booking/menus/settings-optimistic.react.test.tsx`<br>`apps/web/src/app/booking/menus/v6-contract.test.ts`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|booking|`app/booking/menus/payment-tab-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/menus/settings-v8.module.css`|0 / 1 / 0 / 0|— / —|1（22）|`apps/web/src/app/booking/menus/v6-contract.test.ts`|
|booking|`app/booking/menus/settings-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|4（37）|`apps/web/src/app/booking/booking-v8-flow.test.tsx`<br>`apps/web/src/app/booking/menus/booking-settings-boards-nodes.test.ts`<br>`apps/web/src/app/booking/menus/v6-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/menus/staff/assign-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（20）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/booking/menus/staff/assign-v8-ux.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/menus/staff/page.tsx`|2 / 0 / 0 / 0|— / —|6（36）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/booking/booking-batch-fetch-contract.test.ts`<br>`apps/web/src/app/booking/menus/staff/page.matrix-react.test.tsx`<br>`apps/web/src/app/booking/menus/staff/page.r537-r538.test.tsx`<br>`apps/web/src/app/booking/menus/staff/u075-save-state-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/sales/page.tsx`|0 / 0 / 0 / 1|— / —|0（0）|—|
|booking|`app/booking/staff/new/page.tsx`|2 / 0 / 0 / 0|— / —|8（35）|`apps/web/src/app/booking/staff/booking-staff-validation-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.member-load-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.r310-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.r578-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/booking/staff/new/staff-new-blur.react.test.tsx`<br>`apps/web/src/app/booking/staff/new/staff-new-v8-skeleton.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/staff/new/staff-new-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/staff/page.tsx`|0 / 0 / 0 / 1|— / —|9（74）|`apps/web/src/app/booking/menus/page.reorder.test.tsx`<br>`apps/web/src/app/booking/menus/page.split-load.test.tsx`<br>`apps/web/src/app/booking/menus/page.test.tsx`<br>`apps/web/src/app/booking/staff/booking-staff-delete-contract.test.ts`<br>`apps/web/src/app/booking/staff/booking-staff-load-state-contract.test.ts`<br>`apps/web/src/app/booking/staff/booking-staff-r539.test.tsx`<br>`apps/web/src/app/booking/staff/booking-staff-readonly.test.tsx`<br>`apps/web/src/app/booking/staff/booking-staff-validation-react.test.tsx`<br>`apps/web/src/app/booking/staff/staff-page-v8-ux.react.test.tsx`|
|booking|`app/booking/staff/shifts/page.tsx`|2 / 0 / 0 / 0|— / —|7（75）|`apps/web/src/app/booking/staff/shifts/button-accessible-names.test.tsx`<br>`apps/web/src/app/booking/staff/shifts/liff-preview-structure-react.test.tsx`<br>`apps/web/src/app/booking/staff/shifts/own-shift-entry-r579-react.test.tsx`<br>`apps/web/src/app/booking/staff/shifts/page.react.test.tsx`<br>`apps/web/src/app/booking/staff/shifts/page.test.ts`<br>`apps/web/src/app/booking/staff/shifts/staff-detail.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/staff/shifts/staff-detail-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|booking|`app/booking/staff/staff-edit-dialog.tsx`|2 / 0 / 0 / 0|— / —|1（8）|`apps/web/src/app/api-error-wording-guard.test.ts`|
|booking-menus|`v8/booking-menus/settings.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|broadcast-detail|`v8/broadcast-detail/detail.module.css`|0 / 5 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|broadcasts|`app/broadcasts/detail-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|5（18）|`apps/web/src/app/broadcasts/broadcast-misc-boards-contract.test.ts`<br>`apps/web/src/app/broadcasts/broadcast-v8-boards-contract.test.ts`<br>`apps/web/src/app/broadcasts/broadcast-v8-rest-contract.test.ts`<br>`apps/web/src/app/broadcasts/detail-v8-conflict.test.tsx`<br>`apps/web/src/app/broadcasts/detail-v8-test-send.test.tsx`|
|broadcasts|`app/broadcasts/phone-mock-v8.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|broadcasts|`app/broadcasts/phone-mock-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|broadcasts|`app/broadcasts/reserved-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（9）|`apps/web/src/app/broadcasts/broadcast-misc-boards-contract.test.ts`<br>`apps/web/src/app/broadcasts/broadcast-v8-boards-contract.test.ts`|
|broadcasts|`v8/broadcasts/list.module.css`|0 / 1 / 0 / 0|— / —|2（10）|`apps/web/src/app/broadcasts/broadcast-numfix-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|broadcasts|`v8/broadcasts/quick-send.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|chats|`app/chats/inbox-v8.module.css`|0 / 40 / 0 / 0|— / —|0（0）|—|
|common-actions|`app/common-actions/common-action-new-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（18）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|common-actions|`app/common-actions/common-action-versions-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（8）|`apps/web/src/app/api-error-wording-guard.test.ts`|
|common-actions|`app/common-actions/common-actions-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（8）|`apps/web/src/app/api-error-wording-guard.test.ts`|
|common-actions|`app/common-actions/new/page.tsx`|2 / 0 / 0 / 0|— / —|3（24）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/common-actions/m26l-load-failure-react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|common-actions|`app/common-actions/page.tsx`|2 / 0 / 0 / 0|— / —|8（52）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/common-actions/common-actions-v6-contract.test.ts`<br>`apps/web/src/app/common-actions/m26l-load-failure-contract.test.ts`<br>`apps/web/src/app/common-actions/r465-stale-response-contract.test.ts`<br>`apps/web/src/app/common-actions/r479-publish-conflict-contract.test.ts`<br>`apps/web/src/app/common-actions/u096-missing-target-contract.test.ts`<br>`apps/web/src/app/common-actions/u972-header-wrap.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|common-actions|`app/common-actions/versions/page.tsx`|2 / 0 / 0 / 0|— / —|4（25）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/common-actions/versions/list-503-r586.test.tsx`<br>`apps/web/src/app/common-actions/versions/publish-conflict-r479.test.tsx`<br>`apps/web/src/app/glossary-contract.test.ts`|
|common-vars|`v8/common-vars/list.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|contents|`app/contents/list-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（26）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/contents/media-list-v8-contract.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|contents|`app/contents/page.tsx`|2 / 1 / 0 / 0|— / —|17（130）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/contents/button-accessible-names.test.tsx`<br>`apps/web/src/app/contents/contents-v6-contract.test.ts`<br>`apps/web/src/app/contents/folders-contract.test.ts`<br>`apps/web/src/app/contents/media-archive-react.test.tsx`<br>`apps/web/src/app/contents/media-capacity-page.test.tsx`<br>`apps/web/src/app/contents/media-delete-contract.test.ts`<br>`apps/web/src/app/contents/media-detail-url-react.test.tsx`<br>`apps/web/src/app/contents/media-download.test.ts`<br>`apps/web/src/app/contents/media-empty-filter-contract.test.ts`<br>`apps/web/src/app/contents/media-list-v8-contract.test.tsx`<br>`apps/web/src/app/contents/media-load-failure-react.test.tsx`<br>`apps/web/src/app/contents/media-search-row-contract.test.ts`<br>`apps/web/src/app/contents/vars/common-vars-v6-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|contents|`app/contents/vars/edit/page.tsx`|2 / 1 / 0 / 0|— / —|5（76）|`apps/web/src/app/contents/vars/change-impact.test.ts`<br>`apps/web/src/app/contents/vars/edit/page.load-sections.test.tsx`<br>`apps/web/src/app/contents/vars/edit/page.redisplay.test.tsx`<br>`apps/web/src/app/contents/vars/edit/page.schedule.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|contents|`app/contents/vars/list-v8.tsx`|2 / 0 / 0 / 0|— / 写し候補|5（25）|`apps/web/src/app/contents/vars/list-v8-board-numbers-contract.test.ts`<br>`apps/web/src/app/contents/vars/list-v8-parity.react.test.tsx`<br>`apps/web/src/app/contents/vars/xxktw-wording-contract.test.ts`<br>`apps/web/src/app/no-permission/no-permission-v8-contract.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|contents|`app/contents/vars/new/page.tsx`|2 / 1 / 0 / 0|— / —|5（40）|`apps/web/src/app/contents/vars/edit/page.redisplay.test.tsx`<br>`apps/web/src/app/contents/vars/new/page.behavior.test.tsx`<br>`apps/web/src/app/contents/vars/new/page.load-failure.test.tsx`<br>`apps/web/src/app/contents/vars/new/page.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|contents|`app/contents/vars/page.tsx`|2 / 1 / 0 / 0|— / —|15（150）|`apps/web/src/app/contents/folders-contract.test.ts`<br>`apps/web/src/app/contents/media-empty-filter-contract.test.ts`<br>`apps/web/src/app/contents/vars/change-impact.test.ts`<br>`apps/web/src/app/contents/vars/common-vars-audit-544-contract.test.ts`<br>`apps/web/src/app/contents/vars/common-vars-delete-confirm-contract.test.ts`<br>`apps/web/src/app/contents/vars/common-vars-v6-contract.test.ts`<br>`apps/web/src/app/contents/vars/copy-key-react.test.tsx`<br>`apps/web/src/app/contents/vars/delete-screen-contract.test.ts`<br>`apps/web/src/app/contents/vars/list-v8.react.test.tsx`<br>`apps/web/src/app/contents/vars/vars-load-failure-react.test.tsx`<br>`apps/web/src/app/contents/vars/vars-overflow-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`<br>`apps/web/src/lib/issue-640-notation-contract.test.ts`|
|conversions|`app/conversions/new/page.tsx`|2 / 0 / 0 / 0|— / —|12（86）|`apps/web/src/app/conversions/conversion-936-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-points-v6-contract.test.ts`<br>`apps/web/src/app/conversions/dedup.test.ts`<br>`apps/web/src/app/conversions/new/audit-detail.test.tsx`<br>`apps/web/src/app/conversions/new/conversion-create-v8.react.test.tsx`<br>`apps/web/src/app/conversions/new/conversion-points-failure-react.test.tsx`<br>`apps/web/src/app/conversions/new/exclusion-empty-or.test.tsx`<br>`apps/web/src/app/conversions/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/conversions/origin-shared-contract.test.ts`<br>`apps/web/src/app/duplicate-counts-guard.react.test.tsx`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|conversions|`app/conversions/page.tsx`|2 / 0 / 0 / 0|— / —|22（132）|`apps/web/src/app/a11y-issue-637-contract.test.tsx`<br>`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/conversions/affiliate-v6-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-936-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-idea19-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-load-failure-react.test.tsx`<br>`apps/web/src/app/conversions/conversion-mid-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-point-delete-confirm-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-points-rowmenu-react.test.tsx`<br>`apps/web/src/app/conversions/conversion-points-url-attribution-react.test.tsx`<br>`apps/web/src/app/conversions/conversion-points-v6-contract.test.ts`<br>`apps/web/src/app/conversions/conversion-points-v8.react.test.tsx`<br>`apps/web/src/app/conversions/conversion-report-retry-race-react.test.tsx`<br>`apps/web/src/app/conversions/conversion-revise-react.test.tsx`<br>`apps/web/src/app/conversions/conversions-light-batch7-contract.test.ts`<br>`apps/web/src/app/conversions/dedup.test.ts`<br>`apps/web/src/app/conversions/list-1152-overflow-contract.test.ts`<br>`apps/web/src/app/conversions/origin-shared-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|conversions|`v8/conversions/list.module.css`|0 / 14 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|dashboard|`v8/dashboard/dashboard.module.css`|0 / 3 / 0 / 0|— / —|1（20）|`apps/web/src/v8/dashboard/dashboard-align.test.tsx`|
|duplicates|`app/duplicates/page.tsx`|2 / 0 / 0 / 0|— / —|8（51）|`apps/web/src/app/duplicates/duplicates-contract.test.ts`<br>`apps/web/src/app/duplicates/duplicates-permission-states.react.test.tsx`<br>`apps/web/src/app/duplicates/duplicates-stats-failure.react.test.tsx`<br>`apps/web/src/app/friends/friends-owner-feedback-contract.test.ts`<br>`apps/web/src/app/friends/friends-shared-parts-contract.test.ts`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/components/shared/table-header-migration-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|ec-commerce|`app/ec-commerce/identity-candidates/page.tsx`|2 / 0 / 0 / 0|— / —|7（50）|`apps/web/src/app/duplicate-counts-guard.react.test.tsx`<br>`apps/web/src/app/ec-commerce/identity-candidates/page-operations-account-race.test.tsx`<br>`apps/web/src/app/ec-commerce/identity-candidates/page-operations-failure.test.tsx`<br>`apps/web/src/app/ec-commerce/identity-candidates/page-w1W8h-fidelity.test.tsx`<br>`apps/web/src/components/identity/identity-retry-m013.test.tsx`<br>`apps/web/src/components/identity/identity-screens.test.tsx`<br>`apps/web/src/components/ui/list-range-contract.test.ts`|
|ec-commerce|`app/ec-commerce/order-detail-drawer.tsx`|2 / 0 / 0 / 0|— / —|2（19）|`apps/web/src/app/ec-commerce/ec-order-detail-contract.test.ts`<br>`apps/web/src/app/ec-commerce/order-detail-drawer.test.tsx`|
|ec-commerce|`app/ec-commerce/order-drawer-v8.css`|0 / 15 / 0 / 0|— / —|0（0）|—|
|ec-commerce|`app/ec-commerce/page.tsx`|2 / 0 / 0 / 0|— / —|9（72）|`apps/web/src/app/a11y-issue-637-contract.test.tsx`<br>`apps/web/src/app/ec-commerce/ec-commerce-events-panel-mount.test.tsx`<br>`apps/web/src/app/ec-commerce/ec-commerce-load-contract.test.ts`<br>`apps/web/src/app/ec-commerce/ec-commerce-v6-contract.test.ts`<br>`apps/web/src/app/ec-commerce/ec-order-detail-contract.test.ts`<br>`apps/web/src/app/ec-commerce/identity-candidates-impact-keys.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|emergency|`app/emergency/page.tsx`|3 / 1 / 3 / 0|— / —|18（107）|`apps/web/src/app/emergency/alert-impact-wording.test.tsx`<br>`apps/web/src/app/emergency/emergency-confirm-visual-contract.test.ts`<br>`apps/web/src/app/emergency/emergency-control-mount.test.ts`<br>`apps/web/src/app/emergency/emergency-light-batch7-contract.test.ts`<br>`apps/web/src/app/emergency/emergency-stop-reload-contract.test.ts`<br>`apps/web/src/app/emergency/emergency-visual-parity.test.ts`<br>`apps/web/src/app/emergency/line-check-detail-contract.test.ts`<br>`apps/web/src/app/emergency/manual-health-run-guard.test.tsx`<br>`apps/web/src/app/emergency/operation-alert-lifecycle.test.tsx`<br>`apps/web/src/app/emergency/operation-history-summary.test.tsx`<br>`apps/web/src/app/emergency/operations-api-contract.test.ts`<br>`apps/web/src/app/emergency/restore-drift.test.tsx`<br>`apps/web/src/app/emergency/send-paths-shape.test.tsx`<br>`apps/web/src/app/emergency/update-history.test.tsx`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`|
|events|`app/events/bookings/bookings-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（14）|`apps/web/src/app/events/bookings/bookings-v8.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|events|`app/events/bookings/page.tsx`|2 / 0 / 0 / 0|— / —|10（75）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/events/bookings/event-booking-actions-contract.test.ts`<br>`apps/web/src/app/events/bookings/event-booking-cancel-confirm-contract.test.ts`<br>`apps/web/src/app/events/bookings/event-booking-interactions.test.tsx`<br>`apps/web/src/app/events/bookings/event-booking-reminders-contract.test.ts`<br>`apps/web/src/app/events/bookings/u070-reselect-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/events/event-draft-shared.test.ts`<br>`apps/web/src/components/events/event-waitlist-instruction.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|events|`app/events/change-review/change-review-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（11）|`apps/web/src/app/events/change-review/change-review-v8.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/native-choice-rest-contract.test.ts`|
|events|`app/events/change-review/page.tsx`|2 / 0 / 0 / 0|— / —|1（4）|`apps/web/src/app/events/change-review/change-review.test.tsx`|
|events|`app/events/edit/page.tsx`|0 / 0 / 0 / 1|— / —|3（19）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/events/edit/lifecycle-status.test.tsx`<br>`apps/web/src/components/events/event-draft-shared.test.ts`|
|events|`app/events/events-list-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/events/events-list-v8.test.tsx`|
|events|`app/events/new/events-new-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（10）|`apps/web/src/app/events/new/events-new-v8.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|events|`app/events/page.tsx`|2 / 0 / 0 / 0|— / —|12（95）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/events/bookings/event-booking-interactions.test.tsx`<br>`apps/web/src/app/events/event-count-state-contract.test.ts`<br>`apps/web/src/app/events/event-delete.test.tsx`<br>`apps/web/src/app/events/event-list-auth-error.test.tsx`<br>`apps/web/src/app/events/event-list-columns.test.tsx`<br>`apps/web/src/app/events/event-load-state-contract.test.ts`<br>`apps/web/src/app/events/event-long-search-react.test.tsx`<br>`apps/web/src/app/no-preparing-contract.test.ts`<br>`apps/web/src/components/events/event-draft-shared.test.ts`<br>`apps/web/src/components/events/event-waitlist-instruction.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|events|`app/events/preview/page.tsx`|0 / 0 / 0 / 1|— / —|2（4）|`apps/web/src/app/events/preview/preview-account-race.test.tsx`<br>`apps/web/src/app/events/preview/preview.test.tsx`|
|form-edit|`v8/form-edit/edit.module.css`|0 / 11 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|form-submissions|`app/form-submissions/edit/page.tsx`|3 / 0 / 0 / 0|— / —|11（64）|`apps/web/src/app/form-submissions/edit/form-edit-unsaved-guard.test.tsx`<br>`apps/web/src/app/form-submissions/edit/form-name-blur.react.test.tsx`<br>`apps/web/src/app/form-submissions/edit/form-og-image-url.test.tsx`<br>`apps/web/src/app/form-submissions/edit/form-preview-proof.test.tsx`<br>`apps/web/src/app/form-submissions/edit/form-publish-flow-contract.test.ts`<br>`apps/web/src/app/form-submissions/edit/form-save-failure-m00x.test.tsx`<br>`apps/web/src/app/form-submissions/edit/save-conflict-tabs.test.tsx`<br>`apps/web/src/app/form-submissions/form-v8-flow.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/lib/no-browser-confirm.test.ts`<br>`apps/web/src/v8/form-edit/edit.test.tsx`|
|form-submissions|`app/form-submissions/responses/page.tsx`|3 / 0 / 0 / 0|— / —|7（32）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/form-submissions/responses/responses-failure-m00x.test.tsx`<br>`apps/web/src/app/form-submissions/responses/responses-search-contract.test.tsx`<br>`apps/web/src/app/form-submissions/responses/responses-v8.test.tsx`<br>`apps/web/src/app/reminders/u097-return-links-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|forms|`v8/forms/list.module.css`|0 / 1 / 0 / 0|— / —|1（13）|`apps/web/src/app/issue-709-list-structure-contract.test.ts`|
|friend-add|`v8/friend-add/editor.module.css`|0 / 2 / 0 / 0|— / —|0（0）|—|
|friend-add|`v8/friend-add/list.module.css`|0 / 6 / 0 / 0|— / —|1（3）|`apps/web/src/app/friend-add-settings/list-v8-board-numbers-contract.test.ts`|
|friend-add-publish|`v8/friend-add-publish/publish.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|friend-add-runs|`v8/friend-add-runs/runs.module.css`|0 / 8 / 0 / 0|— / —|0（0）|—|
|friend-add-settings|`app/friend-add-settings/publish/done-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（1）|`apps/web/src/app/friend-add-settings/publish/done-v8.react.test.tsx`|
|friend-add-settings|`app/friend-add-settings/runs/detail/detail-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|friend-add-settings|`app/friend-add-settings/runs/runs-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|friend-detail|`v8/friend-detail/detail.module.css`|0 / 1 / 0 / 0|— / —|1（8）|`apps/web/src/app/friends/detail/friend-detail-audit-1011-contract.test.ts`|
|friends|`app/friends/identity-candidates/identity-candidates-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（6）|`apps/web/src/app/broadcasts/broadcast-v8-boards-contract.test.ts`|
|friends|`app/friends/migrations/migrations-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（16）|`apps/web/src/app/friends/migrations/friend-migrations-failure-m015m016.test.ts`<br>`apps/web/src/app/friends/migrations/friend-migrations-v6-contract.test.ts`|
|friends|`v8/friends/compare/compare.module.css`|0 / 8 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|friends|`v8/friends/duplicates/list.module.css`|0 / 10 / 0 / 0|— / —|0（0）|—|
|friends|`v8/friends/list/list.module.css`|0 / 14 / 0 / 0|— / —|2（11）|`apps/web/src/app/issue-636-responsive-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|friends|`v8/friends/merged/merged.module.css`|0 / 8 / 0 / 0|— / —|0（0）|—|
|friends|`v8/friends/merged/person.module.css`|0 / 6 / 0 / 0|— / —|0（0）|—|
|friends|`v8/friends/migrations/migrations.module.css`|0 / 10 / 0 / 0|— / —|0（0）|—|
|getting-started|`app/getting-started/page.tsx`|2 / 1 / 0 / 0|— / —|3（11）|`apps/web/src/app/getting-started/getting-started-retry-m017.test.ts`<br>`apps/web/src/app/settings/settings-misc-boards-contract.test.ts`<br>`apps/web/src/app/settings/settings-v8-rest-contract.test.ts`|
|globals.css|`app/globals.css`|0 / 72 / 2 / 4|— / —|51（345）|`apps/web/src/app/broadcasts/broadcast-numfix-contract.test.ts`<br>`apps/web/src/app/friend-add-settings/list-v8-board-numbers-contract.test.ts`<br>`apps/web/src/app/friends/friends-shared-parts-contract.test.ts`<br>`apps/web/src/app/globals-token-collision-contract.test.ts`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/app/issue-702-badge-contrast-contract.test.tsx`<br>`apps/web/src/app/issue-709-list-structure-contract.test.ts`<br>`apps/web/src/app/japanese-line-break-contract.test.ts`<br>`apps/web/src/app/theme-switch-contract.test.ts`<br>`apps/web/src/app/v8-control-border-contract.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/app/webhooks/webhooks-board-numbers-contract.test.ts`<br>`apps/web/src/components/layout/mobile-header-contract.test.ts`<br>`apps/web/src/components/shared/avatar.test.tsx`<br>`apps/web/src/components/shared/button-press-feel-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/combobox-v8-height.test.ts`<br>`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/destination-guard.test.ts`<br>`apps/web/src/components/shared/dialog-v8-leave.react.test.tsx`<br>`apps/web/src/components/shared/folder-dot.test.tsx`<br>`apps/web/src/components/shared/green-semantics-contract.test.tsx`<br>`apps/web/src/components/shared/help-tip-mark-font.test.ts`<br>`apps/web/src/components/shared/motion-tokens-contract.test.ts`<br>`apps/web/src/components/shared/notice-info-contract.test.ts`<br>`apps/web/src/components/shared/primary-green-contract.test.ts`<br>`apps/web/src/components/shared/proposal-e-props.react.test.tsx`<br>`apps/web/src/components/shared/row-menu.react.test.tsx`<br>`apps/web/src/components/shared/skeleton-contract.test.tsx`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/text-contrast-contract.test.ts`<br>`apps/web/src/components/shared/text-field-unified.react.test.tsx`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`<br>`apps/web/src/components/shared/v8-menu-motion.test.tsx`<br>`apps/web/src/components/shared/v8-row-motion.test.tsx`<br>`apps/web/src/components/shared/v8-rule-values.test.ts`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`<br>`apps/web/src/components/shared/v8-table-row-line-contract.test.ts`<br>`apps/web/src/components/templates/create-page-notice.test.tsx`<br>`apps/web/src/components/templates/create-page-spacing.test.tsx`<br>`apps/web/src/components/templates/list-template-spec-contract.test.ts`<br>`apps/web/src/components/templates/page-templates-head-contract.test.ts`<br>`apps/web/src/components/templates/steps.test.tsx`<br>`apps/web/src/lib/card-radius-contract.test.ts`<br>`apps/web/src/lib/design-token-contract.test.ts`<br>`apps/web/src/lib/design-tokens.test.ts`<br>`apps/web/src/lib/size-scale-contract.test.tsx`<br>`apps/web/src/lib/v8-card-shadow-contract.test.ts`<br>`apps/web/src/v8/hq/members.test.tsx`<br>`scripts/visual-qa/v8-pr-boards.test.ts`|
|health|`app/health/page.tsx`|0 / 0 / 0 / 1|— / —|4（15）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/health/health-failure-m018m019.test.ts`<br>`apps/web/src/app/health/health-state-contract.test.ts`<br>`apps/web/src/app/health/migration-history-state-contract.test.ts`|
|hq|`app/hq/account-browser-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|3（23）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/hq/account-browser-v8.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|hq|`app/hq/banners/hq-banners-v8.css`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`app/hq/billing/hq-billing-v8.css`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`app/hq/hq-settings-nav-v8.css`|0 / 0 / 0 / 0|— / 写し候補|1（7）|`apps/web/src/components/layout/scrollable-tabs-contract.test.ts`|
|hq|`app/hq/hq-settings-nav-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（7）|`apps/web/src/components/layout/scrollable-tabs-contract.test.ts`|
|hq|`app/hq/members/hq-members-v8.css`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`app/hq/readonly-header-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`app/hq/readonly-v8.css`|0 / 103 / 0 / 0|— / 写し候補|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|hq|`app/hq/settings/hq-settings-v8.css`|0 / 17 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`app/hq/templates/template-message-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|hq|`v8/hq/billing.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/dialog-head.module.css`|0 / 9 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/home.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/members.module.css`|0 / 1 / 0 / 0|— / —|1（5）|`apps/web/src/v8/hq/members.test.tsx`|
|hq|`v8/hq/notice-line-dialog.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/settings.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/support-detail.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq|`v8/hq/support.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq-banners|`v8/hq-banners/list.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|hq-broadcasts|`v8/hq-broadcasts/create.module.css`|0 / 6 / 0 / 0|— / —|2（12）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/templates/create-page-spacing.test.tsx`|
|hq-broadcasts|`v8/hq-broadcasts/detail.module.css`|0 / 6 / 0 / 0|— / —|0（0）|—|
|hq-templates|`v8/hq-templates/console.module.css`|0 / 1 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|inbox-chat|`v8/inbox-chat/inbox-chat.module.css`|0 / 1 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|inflow-links|`app/inflow-links/ad-integration-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（20）|`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|inflow-links|`app/inflow-links/ad-integration.tsx`|2 / 0 / 0 / 0|— / —|8（63）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/inflow-links/ad-integration-currency.test.tsx`<br>`apps/web/src/app/inflow-links/feature18-v6-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-mid-contract.test.ts`<br>`apps/web/src/app/inflow-links/list-1152-overflow-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|inflow-links|`app/inflow-links/detail/page.tsx`|3 / 0 / 0 / 0|— / —|11（50）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/inflow-links/detail/inflow-copy-fallback-react.test.tsx`<br>`apps/web/src/app/inflow-links/detail/inflow-delete-confirm-contract.test.ts`<br>`apps/web/src/app/inflow-links/detail/inflow-delete-safety-react.test.tsx`<br>`apps/web/src/app/inflow-links/detail/inflow-detail-audit-contract.test.ts`<br>`apps/web/src/app/inflow-links/detail/inflow-detail-numbers-contract.test.ts`<br>`apps/web/src/app/inflow-links/detail/inflow-detail-v8.react.test.tsx`<br>`apps/web/src/app/inflow-links/pools-no-request.test.tsx`<br>`apps/web/src/app/reminders/u097-return-links-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|inflow-links|`app/inflow-links/new/page.tsx`|2 / 0 / 0 / 0|— / —|9（42）|`apps/web/src/app/inflow-links/new/inflow-create-v8.react.test.tsx`<br>`apps/web/src/app/inflow-links/new/inflow-new-account-scope.test.tsx`<br>`apps/web/src/app/inflow-links/new/inflow-new-conflict.test.tsx`<br>`apps/web/src/app/inflow-links/new/inflow-new-publish-failure.test.tsx`<br>`apps/web/src/app/inflow-links/new/page.behavior.test.tsx`<br>`apps/web/src/app/inflow-links/new/u065-unsaved-url-contract.test.ts`<br>`apps/web/src/app/inflow-links/pools-no-request.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/lib/qr-image.test.ts`|
|inflow-links|`app/inflow-links/page.tsx`|2 / 0 / 0 / 0|— / —|23（110）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/inflow-links/ad-integration-v8.react.test.tsx`<br>`apps/web/src/app/inflow-links/feature18-v6-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-account-scope.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-idea18-orders-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-kpi-scope-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-kpi-scope-render.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-kpi-state-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-links-v6-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-list-failure.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-list-readonly.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-list-v8.react.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-mid-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-row-padding-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-tab-counts.test.tsx`<br>`apps/web/src/app/inflow-links/list-1152-overflow-contract.test.ts`<br>`apps/web/src/app/inflow-links/pools-no-request.test.tsx`<br>`apps/web/src/app/inflow-links/site-tracking-feature-gate.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/inflow-links/site-script-v8.react.test.tsx`<br>`apps/web/src/components/shared/load-shift-reserve.react.test.tsx`<br>`apps/web/src/lib/design-impact.test.ts`<br>`scripts/inflow-link-tag-ui.test.ts`|
|inflow-links|`v8/inflow-links/detail.module.css`|0 / 8 / 0 / 0|— / —|0（0）|—|
|inflow-links|`v8/inflow-links/list.module.css`|0 / 11 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|layout.tsx|`app/layout.tsx`|0 / 3 / 0 / 0|— / —|5（31）|`apps/web/src/app/issue-707-responsive-390-contract.test.tsx`<br>`apps/web/src/app/theme-switch-contract.test.ts`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`<br>`apps/web/src/lib/admin-theme-fixed.test.tsx`<br>`apps/web/src/lib/design-impact.test.ts`|
|line-notifications|`app/line-notifications/operator/new/operator-new-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（18）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|line-notifications|`app/line-notifications/page.tsx`|2 / 0 / 0 / 0|— / —|16（145）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/line-notifications/customer-notifications-v6-contract.test.ts`<br>`apps/web/src/app/line-notifications/failed-link.test.ts`<br>`apps/web/src/app/line-notifications/line-notifications-issue634-retry.test.tsx`<br>`apps/web/src/app/line-notifications/line-notifications-m031-operator403.test.tsx`<br>`apps/web/src/app/line-notifications/line-notifications-mid-contract.test.ts`<br>`apps/web/src/app/line-notifications/line-notifications-n678-contract.test.tsx`<br>`apps/web/src/app/line-notifications/line-notifications-r611-loading-failure.test.tsx`<br>`apps/web/src/app/line-notifications/line-notifications-ux-react.test.tsx`<br>`apps/web/src/app/line-notifications/notification-event-words-contract.test.ts`<br>`apps/web/src/app/line-notifications/toggle-confirm-placement-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/line-notifications/notification-history-contract.test.ts`<br>`apps/web/src/components/line-notifications/operator-notification-v6-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`|
|line-notifications|`v8/line-notifications/operator-edit.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|login|`app/login/two-factor/page.tsx`|2 / 0 / 0 / 0|— / —|5（16）|`apps/web/src/app/login/two-factor/two-factor-challenge-missing-react.test.tsx`<br>`apps/web/src/app/login/two-factor/two-factor-steps.test.ts`<br>`apps/web/src/app/login/two-factor/two-factor-verify-react.test.tsx`<br>`apps/web/src/app/no-duplicate-page-title-contract.test.ts`<br>`apps/web/src/v8/login/two-factor-ops.test.tsx`|
|mileage|`app/mileage/earning-rules/edit/page.tsx`|2 / 0 / 0 / 0|— / —|2（22）|`apps/web/src/app/mileage/earning-rules-v6-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|mileage|`app/mileage/earning-rules/new/page.tsx`|2 / 0 / 0 / 0|— / —|2（13）|`apps/web/src/app/mileage/earning-rules/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|mileage|`app/mileage/friends/detail/page.tsx`|2 / 0 / 0 / 0|— / —|2（12）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/auto-replies/publish/u098-recovery-contract.test.ts`|
|mileage|`app/mileage/mileage-v8.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|mileage|`app/mileage/mileage-v8.tsx`|2 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|mileage|`app/mileage/page.tsx`|2 / 0 / 0 / 0|— / —|20（146）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/mileage/earning-rule-publish-react.test.tsx`<br>`apps/web/src/app/mileage/earning-rules-order-react.test.tsx`<br>`apps/web/src/app/mileage/earning-rules-v6-contract.test.ts`<br>`apps/web/src/app/mileage/issue-947-contract.test.ts`<br>`apps/web/src/app/mileage/mileage-approval-failure-react.test.tsx`<br>`apps/web/src/app/mileage/mileage-audit-541-contract.test.ts`<br>`apps/web/src/app/mileage/mileage-balance-search-react.test.tsx`<br>`apps/web/src/app/mileage/mileage-earning-table-fit-react.test.tsx`<br>`apps/web/src/app/mileage/mileage-rewards-tab-contract.test.ts`<br>`apps/web/src/app/mileage/mileage-rules-export.test.tsx`<br>`apps/web/src/app/mileage/mileage-v6-contract.test.ts`<br>`apps/web/src/app/mileage/mileage-v8-contract.test.tsx`<br>`apps/web/src/app/mileage/score-band-handoff-r300-contract.test.ts`<br>`apps/web/src/app/mileage/u972-tab-overlap.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/menu-portal-rollout-contract.test.ts`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|mileage|`app/mileage/score-rules/page.tsx`|0 / 0 / 0 / 1|— / —|7（39）|`apps/web/src/app/mileage/score-rules/score-rules-audit-r301-r303-contract.test.ts`<br>`apps/web/src/app/mileage/score-rules/score-rules-delete-contract.test.ts`<br>`apps/web/src/app/mileage/score-rules/score-rules-overflow-contract.test.ts`<br>`apps/web/src/app/mileage/score-rules/score-rules-r129-r131-contract.test.ts`<br>`apps/web/src/app/mileage/score-rules/score-rules-u047-contract.test.ts`<br>`apps/web/src/app/mileage/score-rules/score-rules-ui-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|mileage|`v8/mileage/mileage.module.css`|0 / 11 / 0 / 0|— / —|0（0）|—|
|nen|`app/nen/health/health-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|1（4）|`apps/web/src/app/nen/health/health-v8.test.tsx`|
|nen|`app/nen/health/page.tsx`|2 / 1 / 0 / 0|— / —|3（12）|`apps/web/src/app/nen/health/summary-failure-m034.test.tsx`<br>`apps/web/src/app/nen/health/summary-target.test.tsx`<br>`apps/web/src/components/layout/scrollable-tabs-contract.test.ts`|
|nen|`app/nen/members/members-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|4（16）|`apps/web/src/app/nen/members/members-sort-v8.react.test.tsx`<br>`apps/web/src/app/nen/members/members-v8-band.test.tsx`<br>`apps/web/src/app/nen/members/rank-settings-fidelity.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen|`app/nen/members/page.tsx`|2 / 1 / 0 / 0|— / —|4（11）|`apps/web/src/app/nen/members/page-account.test.tsx`<br>`apps/web/src/app/nen/members/page-no-account.test.tsx`<br>`apps/web/src/app/nen/members/page-shape.test.tsx`<br>`apps/web/src/components/layout/scrollable-tabs-contract.test.ts`|
|nen|`app/nen/pets/page.tsx`|2 / 1 / 0 / 0|— / —|1（2）|`apps/web/src/app/nen/pets/pets-csv-contract.test.ts`|
|nen|`app/nen/pets/pets-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|2（13）|`apps/web/src/app/nen/pets/pets-v8.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`app/nen-campaigns/columns/new/column-new-v8.tsx`|0 / 1 / 0 / 0|— / —|3（12）|`apps/web/src/app/nen-campaigns/columns/new/column-new-v8.test.tsx`<br>`apps/web/src/app/nen-campaigns/columns/new/u059-preview-order-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`app/nen-campaigns/columns/new/page.tsx`|2 / 1 / 0 / 0|— / —|2（14）|`apps/web/src/app/nen-campaigns/nen-create-entry-618.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`app/nen-campaigns/edit/campaign-editor-v8.tsx`|0 / 1 / 0 / 0|— / —|7（31）|`apps/web/src/app/nen-campaigns/edit/campaign-editor-form-gate.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/campaign-editor-save-error.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/campaign-editor-v8.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/campaign-editor.mount.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/campaign-insert-toolbar-audit.test.ts`<br>`apps/web/src/app/nen-campaigns/edit/nen-editor-words-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`app/nen-campaigns/edit/page.tsx`|2 / 2 / 0 / 0|— / —|6（27）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/nen-campaigns/edit/column-edit-race.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/column-intro-conflict-m507.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/nen-columns-shape-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/edit/u102-card-save-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`app/nen-campaigns/nen-campaigns-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|2（14）|`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/nen-campaigns-v8.test.tsx`|
|nen-campaigns|`app/nen-campaigns/page.tsx`|2 / 1 / 0 / 0|— / —|7（49）|`apps/web/src/app/nen-campaigns/nen-campaigns-page-935.test.tsx`<br>`apps/web/src/app/nen-campaigns/nen-create-entry-618.test.tsx`<br>`apps/web/src/app/nen-campaigns/nen-operator-words-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/nen-toggle-429.test.tsx`<br>`apps/web/src/app/nen-campaigns/nen-v6-parity-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/test-recipient-login-users.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-campaigns|`v8/nen-campaigns/form.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|nen-campaigns|`v8/nen-campaigns/list.module.css`|0 / 15 / 0 / 0|— / —|0（0）|—|
|nen-health|`v8/nen-health/health.module.css`|0 / 16 / 0 / 0|— / —|0（0）|—|
|nen-members|`app/nen-members/photo-policy-history-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|nen-members|`app/nen-members/photo-review-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|6（51）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/nen-members/photo-review-contract.test.ts`<br>`apps/web/src/app/nen-members/photo-review-v8.test.tsx`<br>`apps/web/src/app/nen-members/photo-workspace-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`|
|nen-members|`v8/nen-members/members.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|nen-pets|`v8/nen-pets/pets.module.css`|0 / 14 / 0 / 0|— / —|0（0）|—|
|nen-posts|`v8/nen-posts/review.module.css`|0 / 15 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|no-permission|`app/no-permission/no-permission-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（4）|`apps/web/src/app/no-permission/no-permission-v8-contract.test.tsx`|
|not-found.tsx|`app/not-found.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|notifications|`app/notifications/page.tsx`|3 / 0 / 0 / 0|— / —|2（6）|`apps/web/src/app/notifications/notifications-m037-failure.test.tsx`<br>`apps/web/src/app/notifications/notifications-order-react.test.tsx`|
|notifications|`app/notifications/readonly-header-v8.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|notifications|`app/notifications/readonly-v8.css`|0 / 30 / 0 / 0|— / —|0（0）|—|
|notifications|`v8/notifications/list.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|ops|`app/ops/announcements/page.tsx`|2 / 0 / 0 / 0|— / —|3（34）|`apps/web/src/app/ops/announcements/ops-announcements-react.test.tsx`<br>`apps/web/src/app/ops/ops-failure-m038-m042-m504.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|ops|`app/ops/audit/page.tsx`|3 / 0 / 0 / 0|— / —|5（25）|`apps/web/src/app/duplicate-counts-guard.react.test.tsx`<br>`apps/web/src/app/ops/audit/ops-audit-react.test.tsx`<br>`apps/web/src/app/ops/audit/ops-audit-v8-design.test.tsx`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|ops|`app/ops/dashboard/page.tsx`|3 / 0 / 0 / 0|— / —|4（24）|`apps/web/src/app/duplicate-counts-guard.react.test.tsx`<br>`apps/web/src/app/ops/dashboard/ops-dashboard-links.test.ts`<br>`apps/web/src/app/ops/dashboard/ops-dashboard-react.test.tsx`<br>`apps/web/src/app/ops/dashboard/ops-dashboard-v8-design.test.tsx`|
|ops|`app/ops/invite/page.tsx`|3 / 0 / 0 / 0|— / —|2（16）|`apps/web/src/app/ops/invite/ops-invite-v8-react.test.tsx`<br>`apps/web/src/app/ops/ops-failure-m038-m042-m504.test.tsx`|
|ops|`app/ops/knowledge/page.tsx`|2 / 0 / 0 / 0|— / —|1（17）|`apps/web/src/app/ops/knowledge/knowledge-react.test.tsx`|
|ops|`app/ops/login/page.tsx`|2 / 0 / 0 / 0|— / —|4（19）|`apps/web/src/app/ops/login/ops-login-failure-reason-contract.test.tsx`<br>`apps/web/src/app/ops/login/ops-login-two-factor-react.test.tsx`<br>`apps/web/src/app/ops/login/ops-login-v8-react.test.tsx`<br>`apps/web/src/app/ops/ops-failure-m038-m042-m504.test.tsx`|
|ops|`app/ops/members/page.tsx`|3 / 0 / 0 / 0|— / —|2（3）|`apps/web/src/app/ops/members/ops-members-error-react.test.tsx`<br>`apps/web/src/app/ops/members/ops-members-v8-design.test.tsx`|
|ops|`app/ops/readonly-header-v8.tsx`|3 / 0 / 0 / 0|— / —|0（0）|—|
|ops|`app/ops/readonly-v8.css`|0 / 54 / 0 / 0|— / —|0（0）|—|
|ops|`app/ops/support/page.tsx`|3 / 0 / 0 / 0|— / —|6（41）|`apps/web/src/app/duplicate-counts-guard.react.test.tsx`<br>`apps/web/src/app/ops/support/ops-support-create-dialog-react.test.tsx`<br>`apps/web/src/app/ops/support/ops-support-react.test.tsx`<br>`apps/web/src/app/ops/support/ops-support-v8-design.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`|
|ops|`app/ops/tenants/detail/page.tsx`|2 / 0 / 0 / 0|— / —|2（7）|`apps/web/src/app/ops/tenants/detail/impersonate-confirm-v8-react.test.tsx`<br>`apps/web/src/app/ops/tenants/detail/ops-tenant-detail-overview-react.test.tsx`|
|ops|`app/ops/tenants/page.tsx`|2 / 0 / 0 / 0|— / —|2（15）|`apps/web/src/app/ops/ops-failure-m038-m042-m504.test.tsx`<br>`apps/web/src/app/ops/tenants/ops-tenants-create-dialog-react.test.tsx`|
|ops|`app/ops/two-factor/page.tsx`|2 / 0 / 0 / 0|— / —|4（24）|`apps/web/src/app/ops/ops-failure-m038-m042-m504.test.tsx`<br>`apps/web/src/app/ops/two-factor/ops-two-factor-error-react.test.tsx`<br>`apps/web/src/app/ops/two-factor/ops-two-factor-v8-react.test.tsx`<br>`apps/web/src/lib/qr-image.test.ts`|
|pools|`app/pools/new/page.tsx`|2 / 0 / 0 / 0|— / —|3（17）|`apps/web/src/app/pools/new/pool-account-load-contract.test.ts`<br>`apps/web/src/app/pools/new/pool-preview-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|pools|`app/pools/page.tsx`|2 / 1 / 0 / 0|— / —|8（42）|`apps/web/src/app/pools/feature-gate.test.tsx`<br>`apps/web/src/app/pools/pool-create-labels-contract.test.ts`<br>`apps/web/src/app/pools/pool-create-labels-rendered.test.tsx`<br>`apps/web/src/app/pools/pool-delete-confirm-contract.test.ts`<br>`apps/web/src/app/pools/pool-empty-state.test.tsx`<br>`apps/web/src/app/pools/pool-submit-error-contract.test.ts`<br>`apps/web/src/app/pools/pools-no-request.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|recipes|`app/recipes/clone/page.tsx`|0 / 0 / 0 / 1|— / —|4（8）|`apps/web/src/app/recipes/clone/clone-retry-key.test.tsx`<br>`apps/web/src/app/recipes/clone/clone-target-race.test.tsx`<br>`apps/web/src/app/recipes/clone/page-no-id.test.tsx`<br>`apps/web/src/app/recipes/clone/recipe-clone-load-error-contract.test.ts`|
|reminders|`app/reminders/basics-form-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|4（20）|`apps/web/src/app/reminders/new/reminder-new-v6-contract.test.ts`<br>`apps/web/src/app/reminders/reminder-folder-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/folder-select-rollout-contract.test.ts`|
|reminders|`app/reminders/detail/detail-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|reminders|`app/reminders/edit/edit-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|5（21）|`apps/web/src/app/reminders/edit/reminder-messages-board-1152.react.test.tsx`<br>`apps/web/src/app/reminders/reminder-save-conflict.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`|
|reminders|`app/reminders/list-v8.module.css`|0 / 1 / 0 / 0|— / —|1（1）|`apps/web/src/components/shared/bulk-bar-sticky-contract.test.ts`|
|reminders|`app/reminders/wizard-v8-ui.tsx`|0 / 1 / 0 / 0|— / —|1（2）|`apps/web/src/native-choice-rest-contract.test.ts`|
|reminders|`v8/reminders/detail.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|reminders|`v8/reminders/edit.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant|`v8/restaurant/booking-kit/shell.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant|`v8/restaurant/common-a/frame.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant|`v8/restaurant/dashboard/dashboard.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|restaurant|`v8/restaurant/google/google.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant|`v8/restaurant/menu/menu.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant-test|`app/restaurant-test/approvals/page.tsx`|2 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant-test|`app/restaurant-test/google/google-business.tsx`|0 / 0 / 3 / 0|— / —|5（28）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/restaurant-test/v8/google-boards-v8.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|restaurant-test|`app/restaurant-test/organization/page.tsx`|2 / 1 / 0 / 0|— / —|0（0）|—|
|restaurant-test|`app/restaurant-test/stores/new/page.tsx`|2 / 1 / 0 / 0|— / —|8（48）|`apps/web/src/app/accounts/accounts-setup-visual-parity.test.ts`<br>`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/restaurant-test/restaurant-hq-store-flow.test.ts`<br>`apps/web/src/app/restaurant-test/stores/new/store-new-field-labels.test.tsx`<br>`apps/web/src/app/restaurant-test/stores/new/store-new-overflow-contract.test.ts`<br>`apps/web/src/app/restaurant-test/stores/new/store-new-unsaved.react.test.tsx`<br>`apps/web/src/app/restaurant-test/stores/new/terms-consent.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|restaurant-test|`app/restaurant-test/terms/page.tsx`|2 / 1 / 0 / 0|— / —|1（8）|`apps/web/src/app/restaurant-test/restaurant-hq-store-flow.test.ts`|
|rich-menus|`app/rich-menus/connections/page.tsx`|3 / 0 / 0 / 0|— / —|3（13）|`apps/web/src/app/rich-menus/connections/connections-v8-react.test.tsx`<br>`apps/web/src/app/rich-menus/connections/rich-menu-connections-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-light-578-contract.test.ts`|
|rich-menus|`app/rich-menus/edit/page.tsx`|3 / 0 / 0 / 0|— / —|11（88）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/common-actions/u096-missing-target-contract.test.ts`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/rich-menus/edit/design-words-contract.test.ts`<br>`apps/web/src/app/rich-menus/edit/publish-step-v8-react.test.tsx`<br>`apps/web/src/app/rich-menus/edit/rich-menu-edit-v7-contract.test.ts`<br>`apps/web/src/app/rich-menus/edit/schedule-idempotency-react.test.tsx`<br>`apps/web/src/app/rich-menus/new/rich-menu-template-account-scope-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-dirty-guard.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-light-578-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|rich-menus|`app/rich-menus/new/page.tsx`|2 / 0 / 0 / 0|— / —|6（64）|`apps/web/src/app/rich-menus/new/rich-menu-tag-account-scope.test.tsx`<br>`apps/web/src/app/rich-menus/new/rich-menu-template-account-scope-contract.test.ts`<br>`apps/web/src/app/rich-menus/new/rich-menu-template-account-scope.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-dirty-guard.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-v8-flow.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|rich-menus|`app/rich-menus/page.tsx`|2 / 1 / 0 / 0|— / —|19（96）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/rich-menus/connections/rich-menu-connections-contract.test.ts`<br>`apps/web/src/app/rich-menus/delete-impact-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-delete-confirm-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-empty-filtered-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-external-import-viewport-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-kpi-react.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-list-paging-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-ops-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-safe-errors-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-search-row-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menu-v8-flow.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-v8-tap-fallback.react.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-write-flows-contract.test.ts`<br>`apps/web/src/app/rich-menus/rich-menus-row-actions.react.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menus-v6-contract.test.ts`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`|
|scenario-detail|`v8/scenario-detail/detail.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|scenario-first-step|`v8/scenario-first-step/first-step.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|scenarios|`app/scenarios/detail/detail-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|5（43）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-detail-v8-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`|
|scenarios|`app/scenarios/first-step-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（18）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|scenarios|`app/scenarios/mode-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（12）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/native-choice-rest-contract.test.ts`|
|scenarios|`app/scenarios/results/results-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（17）|`apps/web/src/app/scenarios/detail/scenario-detail-v8-contract.test.ts`|
|scenarios|`v8/scenarios/create.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|scenarios|`v8/scenarios/list.module.css`|0 / 1 / 0 / 0|— / —|1（1）|`apps/web/src/components/shared/bulk-bar-sticky-contract.test.ts`|
|search-console|`app/search-console/page.tsx`|2 / 0 / 0 / 0|— / —|2（6）|`apps/web/src/app/search-console/search-console-contract.test.ts`<br>`apps/web/src/app/search-console/search-console-failure-react.test.tsx`|
|settings|`app/settings/feature-settings-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|6（32）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/settings/feature-settings-impact.test.ts`<br>`apps/web/src/app/settings/settings-misc-boards-contract.test.ts`<br>`apps/web/src/app/settings/settings-v8-rest-contract.test.ts`<br>`apps/web/src/app/settings/settings-visual-parity.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|settings|`app/settings/file-scan/file-scan-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（11）|`apps/web/src/app/settings/file-scan/file-scan-v8.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|settings|`app/settings/manual-links/manual-links-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（21）|`apps/web/src/app/settings/manual-links/manual-link-contract.test.ts`<br>`apps/web/src/app/settings/manual-links/u071-retry-contract.test.ts`|
|settings|`app/settings/settings-v8.module.css`|0 / 1 / 0 / 0|— / —|2（9）|`apps/web/src/app/settings/settings-misc-boards-contract.test.ts`<br>`apps/web/src/app/settings/settings-v8-rest-contract.test.ts`|
|settings|`v8/settings/ec-commerce/connector.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/ec-commerce/identity.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/ec-commerce/order-drawer.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/ec-commerce/screen.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/emergency/history.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/emergency/screen.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/features/screen.module.css`|0 / 1 / 0 / 0|— / —|1（8）|`apps/web/src/app/issue-707-responsive-390-contract.test.tsx`|
|settings|`v8/settings/file-scan/screen.module.css`|0 / 2 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/line-notifications/screen.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/manual-links/screen.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|settings|`v8/settings/pools/create.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|staff|`app/staff/new/page.tsx`|0 / 0 / 0 / 1|— / —|5（22）|`apps/web/src/app/blur-validation-wiring-contract.test.ts`<br>`apps/web/src/app/staff/new/page.test.ts`<br>`apps/web/src/app/staff/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/staff/new/staff-permission-pairing.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|staff|`app/staff/page.tsx`|2 / 1 / 0 / 0|— / —|28（130）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/staff/staff-action-alignment.test.tsx`<br>`apps/web/src/app/staff/staff-admin-readonly-react.test.tsx`<br>`apps/web/src/app/staff/staff-confirm-dialog-contract.test.ts`<br>`apps/web/src/app/staff/staff-custom-scope-r497-react.test.tsx`<br>`apps/web/src/app/staff/staff-light-batch6-contract.test.ts`<br>`apps/web/src/app/staff/staff-list-loading-contract.test.ts`<br>`apps/web/src/app/staff/staff-partial-scope-r497b-react.test.tsx`<br>`apps/web/src/app/staff/staff-permission-aside-react.test.tsx`<br>`apps/web/src/app/staff/staff-permission-clipping-contract.test.ts`<br>`apps/web/src/app/staff/staff-permission-edit.test.tsx`<br>`apps/web/src/app/staff/staff-permission-save-guard-react.test.tsx`<br>`apps/web/src/app/staff/staff-pii-hint-contract.test.tsx`<br>`apps/web/src/app/staff/staff-preset-reset-contract.test.ts`<br>`apps/web/src/app/staff/staff-resend-contract.test.tsx`<br>`apps/web/src/app/staff/staff-save-503-wording-react.test.tsx`<br>`apps/web/src/app/staff/staff-scope-contract.test.ts`<br>`apps/web/src/app/staff/staff-scope-option-labels-react.test.tsx`<br>`apps/web/src/app/staff/staff-search-620.test.tsx`<br>`apps/web/src/app/staff/staff-sessions-stepup-react.test.tsx`<br>`apps/web/src/app/staff/staff-suspended-filter-react.test.tsx`<br>`apps/web/src/app/staff/staff-v8-react.test.tsx`<br>`apps/web/src/app/staff/staff-visual-parity.test.ts`<br>`apps/web/src/app/staff/u972-tab-overlap.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`<br>`apps/web/src/lib/qr-image.test.ts`|
|support|`app/support/page.tsx`|0 / 0 / 0 / 1|— / —|0（0）|—|
|tags|`app/tags/edit-field-page-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（15）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|tags|`app/tags/edit-tag-page-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（13）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/tags/tag-boards-nodes.test.ts`<br>`apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`|
|tags|`app/tags/field-editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|tags|`app/tags/field-migrate-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（18）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|tags|`app/tags/fields-tab-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|5（30）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/tags/fields-tab-v8-parity.react.test.tsx`<br>`apps/web/src/app/tags/ux-tags-optimistic.test.ts`<br>`apps/web/src/app/tags/ux2-tags-detail.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|tags|`app/tags/list-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（4）|`apps/web/src/app/tags/tag-boards-nodes.test.ts`|
|tags|`app/tags/mark-editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|tags|`app/tags/marks-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|2（10）|`apps/web/src/app/tags/ux-tags-optimistic.test.ts`<br>`apps/web/src/app/tags/ux2-tags-detail.test.ts`|
|tags|`app/tags/new-field-page-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|tags|`app/tags/new-tag-page-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（8）|`apps/web/src/app/api-error-wording-guard.test.ts`|
|tags|`app/tags/search-editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（25）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|tags|`app/tags/searches-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|4（28）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/tags/ux-tags-optimistic.test.ts`<br>`apps/web/src/app/tags/ux2-tags-detail.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|tags|`app/tags/tag-editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（4）|`apps/web/src/app/tags/tag-boards-nodes.test.ts`|
|tags|`app/tags/tags-tab-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|7（36）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/loading-skeleton-ux15-contract.test.ts`<br>`apps/web/src/app/tags/tag-boards-nodes.test.ts`<br>`apps/web/src/app/tags/ux-tags-optimistic.test.ts`<br>`apps/web/src/app/tags/ux2-tags-detail.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/row-roving-wiring-contract.test.ts`|
|tags|`v8/tags/list.module.css`|0 / 1 / 0 / 0|— / —|1（13）|`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`|
|templates|`app/templates/asset-editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`app/templates/carousel/carousel-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`app/templates/carousel/page.tsx`|2 / 1 / 0 / 0|— / —|5（38）|`apps/web/src/app/templates/carousel/page.limit-guidance.test.tsx`<br>`apps/web/src/app/templates/carousel/page.save-retry.test.tsx`<br>`apps/web/src/app/templates/carousel/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/templates/staff-gate.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`app/templates/detail/detail-v8.module.css`|0 / 69 / 0 / 0|— / —|0（0）|—|
|templates|`app/templates/detail/detail-v8.tsx`|0 / 1 / 0 / 0|— / 写し候補|0（0）|—|
|templates|`app/templates/detail/page.tsx`|2 / 0 / 0 / 0|— / —|6（40）|`apps/web/src/app/templates/detail/template-detail-delete-confirm-contract.test.ts`<br>`apps/web/src/app/templates/detail/template-detail-shape.test.tsx`<br>`apps/web/src/app/templates/detail/template-versions-820.test.tsx`<br>`apps/web/src/app/templates/staff-gate.test.tsx`<br>`apps/web/src/app/templates/template-v8-flow.test.tsx`<br>`apps/web/src/app/templates/usage-destinations.test.tsx`|
|templates|`app/templates/edit-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|5（24）|`apps/web/src/app/templates/template-boards-nodes.test.ts`<br>`apps/web/src/app/templates/template-create-board-1152.react.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`|
|templates|`app/templates/edit/page.tsx`|2 / 1 / 0 / 0|— / —|5（64）|`apps/web/src/app/templates/edit/page.behavior.test.tsx`<br>`apps/web/src/app/templates/edit/page.mount.test.tsx`<br>`apps/web/src/app/templates/staff-gate.test.tsx`<br>`apps/web/src/app/templates/template-v8-flow.test.tsx`<br>`apps/web/src/app/templates/usage-destinations.test.tsx`|
|templates|`app/templates/editor-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`app/templates/list-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|7（26）|`apps/web/src/app/template-list-board-1152-contract.test.ts`<br>`apps/web/src/app/templates/list-readonly-band.react.test.tsx`<br>`apps/web/src/app/templates/list-v8-date-col-contract.test.ts`<br>`apps/web/src/app/templates/template-boards-nodes.test.ts`<br>`apps/web/src/app/templates/template-v8-flow.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/row-roving-wiring-contract.test.ts`|
|templates|`app/templates/page.tsx`|2 / 1 / 0 / 0|— / —|21（120）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/folder-swap-contract.test.ts`<br>`apps/web/src/app/templates/broadcast-template-flow.test.ts`<br>`apps/web/src/app/templates/question-template-contract.test.ts`<br>`apps/web/src/app/templates/staff-gate.test.tsx`<br>`apps/web/src/app/templates/template-delete-confirm-contract.test.ts`<br>`apps/web/src/app/templates/template-drawer-close-contract.test.ts`<br>`apps/web/src/app/templates/template-folder-contract.test.ts`<br>`apps/web/src/app/templates/template-folder-count-refresh.test.tsx`<br>`apps/web/src/app/templates/template-folder-scope-react.test.tsx`<br>`apps/web/src/app/templates/template-question-tab-r135.test.tsx`<br>`apps/web/src/app/templates/template-search.test.tsx`<br>`apps/web/src/app/templates/template-v6-layout-contract.test.ts`<br>`apps/web/src/app/templates/template-words-contract.test.ts`<br>`apps/web/src/app/templates/templates-console-error.test.tsx`<br>`apps/web/src/app/templates/templates-list-state-contract.test.ts`<br>`apps/web/src/app/templates/templates-row-keyboard.test.tsx`<br>`apps/web/src/app/templates/usage-destinations.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/shared/table-header-migration-contract.test.ts`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`|
|templates|`app/templates/questions/new/page.tsx`|2 / 1 / 0 / 0|— / —|5（34）|`apps/web/src/app/templates/questions/new/question-save-500-contract.test.ts`<br>`apps/web/src/app/templates/questions/new/question-unsaved-react.test.tsx`<br>`apps/web/src/app/templates/staff-gate.test.tsx`<br>`apps/web/src/app/templates/usage-destinations.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`app/templates/questions/question-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|1（10）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|templates|`v8/templates/list.module.css`|0 / 5 / 0 / 0|— / —|1（2）|`apps/web/src/app/templates/list-v8-date-col-contract.test.ts`|
|users|`app/users/page.tsx`|2 / 0 / 0 / 0|— / —|5（32）|`apps/web/src/app/friends/friends-owner-feedback-contract.test.ts`<br>`apps/web/src/app/users/friend-0910-audit-contract.test.ts`<br>`apps/web/src/app/users/u970-users-layout.test.ts`<br>`apps/web/src/components/merged-person/merged-person-screen.test.tsx`<br>`apps/web/src/components/users/users-v6-contract.test.ts`|
|visit-stamps|`v8/visit-stamps/visit-stamps.module.css`|0 / 12 / 0 / 0|— / —|0（0）|—|
|webhooks|`app/webhooks/apitokens-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|webhooks|`app/webhooks/new/page.tsx`|3 / 1 / 0 / 0|— / —|6（26）|`apps/web/src/app/blur-validation-wiring-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/webhooks/new/new-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/webhooks/new/u067-event-select-contract.test.ts`<br>`apps/web/src/app/webhooks/new/webhook-new-validation-react.test.tsx`|
|webhooks|`app/webhooks/outgoing-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（18）|`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/webhooks/outgoing-1152-overflow-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|webhooks|`app/webhooks/page.tsx`|2 / 1 / 0 / 0|— / —|20（127）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/webhooks/apitokens-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/incoming-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/interactions-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/outgoing-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/samples-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/sheets-v8.react.test.tsx`<br>`apps/web/src/app/webhooks/webhook-account-switch-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-create-route-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-delete-confirm-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-interactions-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-load-state-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-operator-words-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-r32-role-errors-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-role-gating-react.test.tsx`<br>`apps/web/src/app/webhooks/webhook-samples-toggle-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-source-preset-contract.test.ts`<br>`apps/web/src/app/webhooks/webhook-tab-counts.test.tsx`<br>`apps/web/src/app/webhooks/webhook-v6-data-contract.test.ts`<br>`apps/web/src/app/webhooks/webhooks-light-batch7-contract.test.ts`|
|webhooks|`v8/webhooks/api-tokens.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|webhooks|`v8/webhooks/interactions.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|webinar-edit|`v8/webinar-edit/notifications.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|webinar-edit|`v8/webinar-edit/participants.module.css`|0 / 6 / 0 / 0|— / —|0（0）|—|
|webinars|`app/webinars/edit/basic-v8.css`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|webinars|`app/webinars/edit/page.tsx`|2 / 0 / 0 / 0|— / —|17（117）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/reminders/u097-return-links-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/webinars/edit/edit-extras-nav.react.test.tsx`<br>`apps/web/src/app/webinars/edit/review-v8.react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-analytics-lazy-contract.test.ts`<br>`apps/web/src/app/webinars/edit/webinar-detail-status.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-edit-failure-recovery-contract.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-edit-load-failure-react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-participants-classification-react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-participants-role-react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-public-preview-contract.test.ts`<br>`apps/web/src/app/webinars/edit/webinar-registration-form-contract.test.ts`<br>`apps/web/src/app/webinars/edit/webinar-single-fetch-contract.test.ts`<br>`apps/web/src/app/webinars/edit/webinar-unsaved-flow-react.test.tsx`<br>`apps/web/src/components/webinars/webinar-notifications-contract.test.ts`<br>`apps/web/src/v8/webinar-edit/edit.test.tsx`|
|webinars|`app/webinars/new/page.tsx`|2 / 0 / 0 / 0|— / —|4（21）|`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/webinars/new/page.unsaved-guard.test.tsx`<br>`apps/web/src/app/webinars/new/webinar-new-pane-react.test.tsx`<br>`apps/web/src/app/webinars/new/webinar-new-save-failure-react.test.tsx`|
|webinars|`app/webinars/page.tsx`|2 / 0 / 0 / 0|— / —|5（25）|`apps/web/src/app/webinars/webinar-list-v8.react.test.tsx`<br>`apps/web/src/app/webinars/webinars-row-actions.react.test.tsx`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/lib/admin-theme-fixed.test.tsx`|
|webinars|`app/webinars/published/page.tsx`|2 / 0 / 0 / 0|— / —|3（15）|`apps/web/src/app/auto-replies/publish/u098-recovery-contract.test.ts`<br>`apps/web/src/app/webinars/published/published-permission-react.test.tsx`<br>`apps/web/src/components/webinars/webinar-publish-flow-contract.test.ts`|
|webinars|`v8/webinars/list.module.css`|0 / 10 / 0 / 0|— / —|0（0）|—|
|共通/admin-theme-default.ts|`lib/admin-theme-default.ts`|0 / 3 / 0 / 0|— / —|2（12）|`apps/web/src/app/theme-switch-contract.test.ts`<br>`apps/web/src/lib/admin-theme-fixed.test.tsx`|
|共通/app-shell.module.css|`components/app-shell.module.css`|0 / 14 / 0 / 0|— / —|3（21）|`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/layout/mobile-header-contract.test.ts`<br>`apps/web/src/components/layout/shell-gap-contract.test.ts`|
|共通/app-shell.tsx|`components/app-shell.tsx`|3 / 0 / 0 / 1|— / —|11（64）|`apps/web/src/app/hq/hq-console.test.ts`<br>`apps/web/src/app/register/auth-screens.test.ts`<br>`apps/web/src/app/staff/invite/page.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/account-create-shell.test.tsx`<br>`apps/web/src/components/app-shell-settings-remount.react.test.tsx`<br>`apps/web/src/components/layout/single-main-landmark-contract.test.ts`<br>`apps/web/src/components/store-selection-gate.test.ts`<br>`apps/web/src/components/suspended-support-shell.test.tsx`<br>`apps/web/src/lib/admin-theme-fixed.test.tsx`<br>`apps/web/src/lib/design-debt.test.ts`|
|共通/auth-pending-shell.module.css|`components/auth-pending-shell.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|共通/auto-replies|`components/auto-replies/inline-action-list.tsx`|1 / 0 / 0 / 0|— / —|25（141）|`apps/web/src/app/auto-replies/auto-reply-v8-flow.test.tsx`<br>`apps/web/src/app/auto-replies/edit/auto-reply-edit-steps.test.tsx`<br>`apps/web/src/app/auto-replies/edit/edit-viewer-gating.react.test.tsx`<br>`apps/web/src/app/auto-replies/edit/wizard-audit.test.tsx`<br>`apps/web/src/app/auto-replies/edit-dialog-order.test.tsx`<br>`apps/web/src/components/auto-replies/action-options-parity.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-choice-parts.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-condition-guard.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-keyword-all.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-matchtype.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-message-kinds.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-overlay.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-response.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-save-failure.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-weekday.test.tsx`<br>`apps/web/src/components/auto-replies/inline-action-list.test.tsx`<br>`apps/web/src/components/shared/action-list-contract.test.ts`<br>`apps/web/src/v8/hq-templates/console-crumbs.test.tsx`<br>`apps/web/src/v8/hq-templates/console-tag-folder.test.tsx`<br>`apps/web/src/v8/hq-templates/console.test.tsx`<br>`apps/web/src/v8/template-edit/edit.test.tsx`<br>`apps/web/src/v8/template-edit/rich-field-errors.test.tsx`<br>`apps/web/src/v8/template-edit/rich-layout-picker.test.tsx`<br>`apps/web/src/v8/templates/carousel-field-errors.test.tsx`<br>`apps/web/src/v8/templates/carousel-upload.test.tsx`|
|共通/broadcasts|`components/broadcasts/broadcast-form.tsx`|2 / 0 / 0 / 0|— / —|31（171）|`apps/web/src/app/broadcasts/broadcast-ux-delivery.react.test.tsx`<br>`apps/web/src/app/broadcasts/broadcast-v8-rest-contract.test.ts`<br>`apps/web/src/app/broadcasts/broadcasts-issue634-loading-retry.test.tsx`<br>`apps/web/src/app/broadcasts/reserved/broadcast-reserved-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/edit/campaign-insert-toolbar-audit.test.ts`<br>`apps/web/src/app/templates/broadcast-template-flow.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-autosave-policy.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-duplicate-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-final-confirm-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-form-autosave.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-buttons-bubbles-react.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-form-draft-reopen.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-send-flow.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-steps-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-form-tags-status-react.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-test-send.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-validation-step-react.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-form-version.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-message-type-keys.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-pixel-parity-contract.test.ts`<br>`apps/web/src/components/broadcasts/broadcast-template-picker-react.test.tsx`<br>`apps/web/src/components/broadcasts/media-upload-audit.test.tsx`<br>`apps/web/src/components/broadcasts/segment-preset-controls.test.ts`<br>`apps/web/src/components/broadcasts/u615-broadcast-form-react.test.tsx`<br>`apps/web/src/components/broadcasts/video-bubble-checks.test.ts`<br>`apps/web/src/components/shared/action-list-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/folder-select-rollout-contract.test.ts`<br>`apps/web/src/v8/hq-broadcasts/research-b173.test.ts`|
|共通/broadcasts|`components/broadcasts/broadcast-text-bubble.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|共通/chats|`components/chats/friend-info-sidebar.tsx`|2 / 0 / 1 / 0|— / —|7（82）|`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/chats/inbox-panel-a2-contract.test.ts`<br>`apps/web/src/components/chats/inbox-panel-inline-edit-react.test.tsx`<br>`apps/web/src/components/chats/inbox-v6-feature2-contract.test.ts`<br>`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`|
|共通/chats|`components/chats/template-picker.tsx`|2 / 0 / 2 / 0|— / —|13（65）|`apps/web/src/app/chats/send-combined.test.tsx`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/components/chats/inbox-v4-contract.test.ts`<br>`apps/web/src/components/chats/template-folder-select.test.ts`<br>`apps/web/src/components/chats/template-picker-account.test.tsx`<br>`apps/web/src/components/chats/template-picker-pack.test.tsx`<br>`apps/web/src/components/chats/template-picker-perf-12-react.test.tsx`<br>`apps/web/src/components/chats/template-picker-preview.test.tsx`<br>`apps/web/src/components/chats/template-picker-v8.test.tsx`<br>`apps/web/src/components/support/email-memo-saving.test.tsx`<br>`apps/web/src/components/support/email-thread-draft-react.test.tsx`<br>`apps/web/src/components/support/email-thread-perf-11-react.test.tsx`<br>`apps/web/src/components/support/email-thread-react.test.tsx`|
|共通/dashboard|`components/dashboard/dashboard-editor.tsx`|2 / 0 / 0 / 0|— / —|9（95）|`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-editor.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-overlays-mount.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-v4.test.ts`<br>`apps/web/src/components/layout/app-shell-v5.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`<br>`apps/web/src/v8/dashboard/dashboard-align.test.tsx`|
|共通/dashboard|`components/dashboard/qr-dialog.tsx`|0 / 0 / 1 / 0|— / —|9（73）|`apps/web/src/app/dashboard-mid-contract.test.ts`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-overlays-mount.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-v4.test.ts`<br>`apps/web/src/components/dashboard/qr-dialog-stopped.test.tsx`<br>`apps/web/src/components/dashboard/qr-size-contract.test.tsx`<br>`apps/web/src/lib/card-radius-contract.test.ts`<br>`apps/web/src/lib/design-structure.test.ts`<br>`apps/web/src/lib/qr-image.test.ts`|
|共通/events|`components/events/event-form.tsx`|2 / 0 / 0 / 0|— / —|13（68）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/events/edit/lifecycle-status.test.tsx`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/events/event-bulk-dialog.test.tsx`<br>`apps/web/src/components/events/event-draft-shared.test.ts`<br>`apps/web/src/components/events/event-form-publish-a11y.test.tsx`<br>`apps/web/src/components/events/event-form-questions-save.test.tsx`<br>`apps/web/src/components/events/event-form-slot-edit.test.tsx`<br>`apps/web/src/components/events/event-form-slot-range.test.ts`<br>`apps/web/src/components/events/event-form-unsaved.react.test.tsx`<br>`apps/web/src/components/events/event-name-blur.react.test.tsx`<br>`apps/web/src/components/events/event-waitlist-instruction.test.ts`<br>`apps/web/src/lib/confirm-dialog-migration-4-contract.test.ts`|
|共通/events|`components/events/event-wizard.tsx`|2 / 0 / 0 / 0|— / —|12（89）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/events/new/events-new-v8.test.tsx`<br>`apps/web/src/app/issue-975a-ui-audit-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/events/event-draft-shared.test.ts`<br>`apps/web/src/components/events/event-name-blur.react.test.tsx`<br>`apps/web/src/components/events/event-wizard-first-slot-contract.test.ts`<br>`apps/web/src/components/events/event-wizard-unsaved.react.test.tsx`<br>`apps/web/src/components/events/issue-1000-audit.test.tsx`<br>`apps/web/src/components/events/issue-1054b-event-audit.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/lib/confirm-dialog-migration-4-contract.test.ts`|
|共通/friend-fields|`components/friend-fields/mark-list.tsx`|2 / 0 / 0 / 0|— / —|8（76）|`apps/web/src/app/list-state-retry-wiring-contract.test.ts`<br>`apps/web/src/app/tags/issue-1013-attr-contract.test.ts`<br>`apps/web/src/components/friend-fields/friend-attributes-v4-contract.test.ts`<br>`apps/web/src/components/friend-fields/friend-attributes-v6-design-fit.test.ts`<br>`apps/web/src/components/friend-fields/mark-archive-r180.test.tsx`<br>`apps/web/src/components/friend-fields/reorder-keyboard.test.tsx`<br>`apps/web/src/components/friend-fields/support-mark-v6-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|共通/friends|`components/friends/advanced-search-dialog.tsx`|2 / 0 / 0 / 0|— / —|12（101）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/friends/friends-search-audit-contract.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/tags/audit-r181-r190-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/friend-fields/saved-search-v6-contract.test.ts`<br>`apps/web/src/components/friends/advanced-search-dialog-focus.test.tsx`<br>`apps/web/src/components/friends/advanced-search-not-yet-contract.test.ts`<br>`apps/web/src/components/friends/friends-v4-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`<br>`apps/web/src/lib/friends-broadcast-condition.test.ts`<br>`apps/web/src/v8/friends/list/field-search.test.tsx`|
|共通/friends|`components/friends/bulk-run-dialog.tsx`|2 / 0 / 0 / 0|— / —|4（28）|`apps/web/src/app/list-state-retry-wiring-contract.test.ts`<br>`apps/web/src/components/friends/bulk-run-dialog-behavior.test.tsx`<br>`apps/web/src/components/friends/bulk-run-dialog-layout-contract.test.ts`<br>`apps/web/src/components/friends/bulk-run-wiring.test.ts`|
|共通/friends|`components/friends/friend-kpis.tsx`|2 / 0 / 0 / 0|— / —|3（23）|`apps/web/src/app/friends/friends-search-audit-contract.test.ts`<br>`apps/web/src/components/friends/friend-kpis-month.test.tsx`<br>`apps/web/src/components/shared/kpi-card-migration-contract.test.tsx`|
|共通/friends|`components/friends/friend-list-table.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|共通/friends|`components/friends/friend-list-table.tsx`|2 / 0 / 0 / 0|— / —|13（67）|`apps/web/src/app/friends/friend-list-empty.test.ts`<br>`apps/web/src/app/friends/friends-load-state-contract.test.ts`<br>`apps/web/src/app/friends/friends-owner-feedback-contract.test.ts`<br>`apps/web/src/app/list-state-retry-wiring-contract.test.ts`<br>`apps/web/src/components/friends/friend-last-contact.test.tsx`<br>`apps/web/src/components/friends/friend-list-virtual.test.tsx`<br>`apps/web/src/components/friends/friend-list-visual-contract.test.ts`<br>`apps/web/src/components/friends/friend-row-shared-parts.test.tsx`<br>`apps/web/src/components/friends/friend-row-target.test.tsx`<br>`apps/web/src/components/shared/skeleton-contract.test.tsx`<br>`apps/web/src/components/ui/list-controls-contract.test.ts`<br>`apps/web/src/components/ui/list-range-contract.test.ts`<br>`apps/web/src/last-boards-4-contract.test.ts`|
|共通/hq|`components/hq/banners/banner-side-nav-v8.css`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|共通/hq|`components/hq/banners/banner-side-nav-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|0（0）|—|
|共通/hq|`components/hq/banners/image-detail-modal.tsx`|2 / 0 / 0 / 0|— / —|3（23）|`apps/web/src/app/hq/banners/banners.test.ts`<br>`apps/web/src/components/hq/banners/image-detail-modal.test.tsx`<br>`apps/web/src/components/hq/banners/image-detail-tags-v8.test.tsx`|
|共通/hq|`components/hq/banners/library-section.tsx`|2 / 0 / 0 / 0|— / —|6（36）|`apps/web/src/app/hq/banner-library-v8.react.test.tsx`<br>`apps/web/src/app/hq/banners/banner-search-row-contract.test.ts`<br>`apps/web/src/app/hq/banners/banners-shape.test.tsx`<br>`apps/web/src/app/hq/banners/banners.test.ts`<br>`apps/web/src/components/hq/banners/banners-failure-m022.test.ts`<br>`apps/web/src/components/hq/banners/library-pagination-react.test.tsx`|
|共通/hq|`components/hq/banners/reference-picker-dialog.tsx`|2 / 0 / 0 / 0|— / —|3（23）|`apps/web/src/app/hq/banners/banners.test.ts`<br>`apps/web/src/components/hq/banners/reference-picker-v8.test.tsx`<br>`apps/web/src/components/hq/banners/reference-search-zero-react.test.tsx`|
|共通/identity|`components/identity/identity-review.module.css`|0 / 1 / 0 / 0|— / —|1（2）|`apps/web/src/components/identity/identity-review-numfix.contract.test.ts`|
|共通/inflow-links|`components/inflow-links/site-script-v8.tsx`|0 / 0 / 0 / 0|— / 写し候補|3（28）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`|
|共通/inflow-links|`components/inflow-links/site-script.tsx`|2 / 0 / 0 / 0|— / —|7（60）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/glossary-contract.test.ts`<br>`apps/web/src/app/inflow-links/feature18-v6-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-mid-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/components/inflow-links/site-script.test.tsx`|
|共通/layout|`components/layout/header.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/layout|`components/layout/sidebar-identity.module.css`|0 / 8 / 0 / 0|— / —|0（0）|—|
|共通/layout|`components/layout/sidebar-identity.tsx`|0 / 0 / 0 / 2|— / —|3（27）|`apps/web/src/components/layout/sidebar-feature-visibility.test.tsx`<br>`apps/web/src/components/layout/v8-sidebar-groups.react.test.tsx`<br>`apps/web/src/components/layout/v8-sidebar-shortcut.react.test.tsx`|
|共通/layout|`components/layout/sidebar-version.tsx`|0 / 0 / 0 / 3|— / —|2（18）|`apps/web/src/components/layout/sidebar-version.test.tsx`<br>`apps/web/src/components/layout/v8-sidebar-groups.react.test.tsx`|
|共通/layout|`components/layout/sidebar.module.css`|0 / 53 / 0 / 0|— / —|8（71）|`apps/web/src/app/mobile-cards-audit-contract.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/layout/mobile-header-contract.test.ts`<br>`apps/web/src/components/layout/shell-gap-contract.test.ts`<br>`apps/web/src/components/layout/sidebar-design.test.ts`<br>`apps/web/src/components/layout/v8-shell-1152-contract.test.ts`<br>`apps/web/src/components/layout/v8-sidebar-groups.react.test.tsx`<br>`apps/web/src/components/shared/button-press-feel-contract.test.ts`|
|共通/layout|`components/layout/sidebar.tsx`|2 / 0 / 0 / 2|— / —|17（118）|`apps/web/src/app/hq/hq-console.test.ts`<br>`apps/web/src/app/hq/hq-unavailable.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/account-create-shell.test.tsx`<br>`apps/web/src/components/layout/mobile-header-contract.test.ts`<br>`apps/web/src/components/layout/shell-keyboard-contract.test.ts`<br>`apps/web/src/components/layout/sidebar-design.test.ts`<br>`apps/web/src/components/layout/sidebar-feature-visibility.test.tsx`<br>`apps/web/src/components/layout/sidebar-health-summary-contract.test.ts`<br>`apps/web/src/components/layout/sidebar-shell-fidelity.test.ts`<br>`apps/web/src/components/layout/v8-shell-1152-contract.test.ts`<br>`apps/web/src/components/layout/v8-sidebar-groups.react.test.tsx`<br>`apps/web/src/components/layout/v8-sidebar-shortcut.react.test.tsx`<br>`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`<br>`apps/web/src/components/shared/load-shift-reserve.react.test.tsx`<br>`apps/web/src/components/store-selection-gate.test.ts`<br>`scripts/visual-qa/v8-pr-boards.test.ts`|
|共通/ops|`components/ops/impersonation-bar-v8.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/ops|`components/ops/impersonation-bar.tsx`|2 / 0 / 0 / 0|— / —|1（1）|`apps/web/src/components/ops/impersonation-bar-v8.react.test.tsx`|
|共通/ops|`components/ops/ops-shell.tsx`|2 / 0 / 0 / 0|— / —|3（13）|`apps/web/src/app/overlay-focus-wiring-contract.test.ts`<br>`apps/web/src/components/ops/ops-shell-knowledge.test.tsx`<br>`apps/web/src/components/ops/ops-shell-overflow-contract.test.ts`|
|共通/rich-menus|`components/rich-menus/area-properties.tsx`|2 / 0 / 0 / 0|— / —|3（15）|`apps/web/src/components/rich-menus/area-properties-tap.test.tsx`<br>`apps/web/src/components/rich-menus/area-properties.test.tsx`<br>`apps/web/src/lib/audit-cross-contract.test.ts`|
|共通/scenarios|`components/scenarios/carousel-picker.tsx`|0 / 0 / 1 / 0|— / —|5（26）|`apps/web/src/app/scenarios/detail/scenario-simulation-refresh-react.test.tsx`<br>`apps/web/src/app/scenarios/detail/scenario-step-preview-sync-react.test.tsx`<br>`apps/web/src/app/scenarios/first-step/first-step-audit.test.tsx`<br>`apps/web/src/components/scenarios/carousel-picker-audit.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`|
|共通/scenarios|`components/scenarios/insert-toolbar.tsx`|2 / 0 / 4 / 0|— / —|7（35）|`apps/web/src/app/nen-campaigns/edit/campaign-insert-toolbar-audit.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-simulation-refresh-react.test.tsx`<br>`apps/web/src/app/scenarios/detail/scenario-step-preview-sync-react.test.tsx`<br>`apps/web/src/app/scenarios/first-step/first-step-audit.test.tsx`<br>`apps/web/src/components/scenarios/common-vars-feature-gate.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/message-composer.test.tsx`|
|共通/scenarios|`components/scenarios/question-editor.tsx`|0 / 0 / 1 / 0|— / —|12（86）|`apps/web/src/app/issue-975a-ui-audit-contract.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-question-step-contract.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-simulation-refresh-react.test.tsx`<br>`apps/web/src/app/scenarios/detail/scenario-step-preview-sync-react.test.tsx`<br>`apps/web/src/app/scenarios/first-step/first-step-audit.test.tsx`<br>`apps/web/src/app/templates/question-template-contract.test.ts`<br>`apps/web/src/app/templates/questions/question-editor-overflow-contract.test.ts`<br>`apps/web/src/components/scenarios/action-editor-audit-r246-r247.test.ts`<br>`apps/web/src/components/scenarios/question-editor-audit.test.tsx`<br>`apps/web/src/components/shared/action-list-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/v8/templates/question-new.test.ts`|
|共通/scenarios|`components/scenarios/scenario-dialogs.tsx`|0 / 0 / 7 / 0|— / —|16（92）|`apps/web/src/app/api-error-wording-guard.test.ts`<br>`apps/web/src/app/error-wording-guard.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-detail-v6-contract.test.ts`<br>`apps/web/src/app/scenarios/detail/scenario-simulation-refresh-react.test.tsx`<br>`apps/web/src/app/scenarios/detail/scenario-step-preview-sync-react.test.tsx`<br>`apps/web/src/app/scenarios/results/scenario-friend-plan-contract.test.ts`<br>`apps/web/src/app/scenarios/results/scenario-next-delivery-contract.test.ts`<br>`apps/web/src/components/scenarios/action-editor-audit-r240-r245.test.ts`<br>`apps/web/src/components/scenarios/action-editor-audit-r246-r247.test.ts`<br>`apps/web/src/components/scenarios/condition-dialog-empty-or.test.tsx`<br>`apps/web/src/components/scenarios/condition-dialog-overflow.test.tsx`<br>`apps/web/src/components/scenarios/condition-dialog.test.tsx`<br>`apps/web/src/components/scenarios/scenario-dialogs-axes-contract.test.ts`<br>`apps/web/src/components/scenarios/test-send-confirm-layout-contract.test.ts`<br>`apps/web/src/components/scenarios/test-send-dialog.test.tsx`<br>`apps/web/src/lib/card-radius-contract.test.ts`|
|共通/session-lost-notice.tsx|`components/session-lost-notice.tsx`|0 / 0 / 2 / 0|— / —|3（16）|`apps/web/src/components/account-create-shell.test.tsx`<br>`apps/web/src/components/suspended-support-shell.test.tsx`<br>`apps/web/src/lib/session-lost.test.ts`|
|共通/shared|`components/shared/action-menu.module.css`|0 / 10 / 0 / 0|— / —|7（49）|`apps/web/src/components/shared/action-menu-v7-contract.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/menu-portal-height-contract.test.tsx`<br>`apps/web/src/components/shared/v5-b4-overlays-contract.test.tsx`<br>`apps/web/src/components/shared/v8-menu-motion.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`<br>`apps/web/src/components/templates/create-page-notice.test.tsx`|
|共通/shared|`components/shared/activity-item.module.css`|0 / 11 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/avatar.module.css`|0 / 9 / 0 / 0|— / —|1（5）|`apps/web/src/components/shared/avatar.test.tsx`|
|共通/shared|`components/shared/bar-chart.module.css`|0 / 2 / 0 / 0|— / —|1（17）|`apps/web/src/components/shared/bar-chart.test.tsx`|
|共通/shared|`components/shared/bell-popover.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/bulk-bar.module.css`|0 / 1 / 0 / 0|— / —|1（1）|`apps/web/src/components/shared/bulk-bar-sticky-contract.test.ts`|
|共通/shared|`components/shared/button.module.css`|0 / 37 / 0 / 0|— / —|11（91）|`apps/web/src/components/shared/button-press-feel-contract.test.ts`<br>`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/row-actions-contract.test.tsx`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`<br>`apps/web/src/lib/design-debt.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`<br>`apps/web/src/lib/design-token-contract.test.ts`<br>`scripts/visual-qa/v8-pr-boards.test.ts`|
|共通/shared|`components/shared/button.tsx`|2 / 0 / 0 / 0|— / —|133（874）|`apps/web/src/app/auto-replies/edit-dialog-order.test.tsx`<br>`apps/web/src/app/events/bookings/event-booking-interactions.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-priority-init.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-save-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/detail/friend-add-run-detail-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/detail/run-detail-failure-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/detail/run-detail-shape.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/friend-add-runs-redaction-react.test.tsx`<br>`apps/web/src/app/templates/template-button-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/webinars/edit/webinar-edit-failure-recovery-contract.test.tsx`<br>`apps/web/src/app/webinars/webinar-list-behavior.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-condition-guard.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-keyword-all.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-matchtype.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-message-kinds.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-overlay.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-response.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-save-failure.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-weekday.test.tsx`<br>`apps/web/src/components/reminders/reminder-shared-parts-contract.test.ts`<br>`apps/web/src/components/shared/action-list.test.tsx`<br>`apps/web/src/components/shared/action-menu-v7-contract.test.tsx`<br>`apps/web/src/components/shared/auto-form-leave-guard.test.tsx`<br>`apps/web/src/components/shared/bar-chart.test.tsx`<br>`apps/web/src/components/shared/bcommon-audit.regression.test.tsx`<br>`apps/web/src/components/shared/bulk-bar.test.tsx`<br>`apps/web/src/components/shared/button-busy-contract.test.ts`<br>`apps/web/src/components/shared/button-migration-contract.test.ts`<br>`apps/web/src/components/shared/button-press-feel-contract.test.ts`<br>`apps/web/src/components/shared/button-states-v7.test.tsx`<br>`apps/web/src/components/shared/button-width-speed.test.tsx`<br>`apps/web/src/components/shared/cards-v8-interactions.test.tsx`<br>`apps/web/src/components/shared/charts.test.tsx`<br>`apps/web/src/components/shared/color-well.test.tsx`<br>`apps/web/src/components/shared/combobox.test.tsx`<br>`apps/web/src/components/shared/command-palette.test.tsx`<br>`apps/web/src/components/shared/condition-builder-add-picker.test.tsx`<br>`apps/web/src/components/shared/condition-builder-empty-or.test.tsx`<br>`apps/web/src/components/shared/condition-builder-tag-pill.test.tsx`<br>`apps/web/src/components/shared/confirm-dialog-busy.test.tsx`<br>`apps/web/src/components/shared/confirm-leave-dialog.react.test.tsx`<br>`apps/web/src/components/shared/copy-feedback.regression.test.tsx`<br>`apps/web/src/components/shared/create-page-stale-error.test.tsx`<br>`apps/web/src/components/shared/customer-info-panel.test.tsx`<br>`apps/web/src/components/shared/date-field.test.tsx`<br>`apps/web/src/components/shared/date-time-clear.regression.test.tsx`<br>`apps/web/src/components/shared/date-time-field.test.tsx`<br>`apps/web/src/components/shared/date-time-focus.regression.test.tsx`<br>`apps/web/src/components/shared/destination-policy.test.tsx`<br>`apps/web/src/components/shared/detail-panel.test.tsx`<br>`apps/web/src/components/shared/entity-picker-migration.test.tsx`<br>`apps/web/src/components/shared/entity-picker.test.tsx`<br>`apps/web/src/components/shared/entity-remote-field.test.tsx`<br>`apps/web/src/components/shared/external-link.test.tsx`<br>`apps/web/src/components/shared/field-notes.test.tsx`<br>`apps/web/src/components/shared/file-drop.test.tsx`<br>`apps/web/src/components/shared/filter-chip.test.tsx`<br>`apps/web/src/components/shared/focus-visible-contract.test.ts`<br>`apps/web/src/components/shared/folder-add-keyboard.regression.test.tsx`<br>`apps/web/src/components/shared/folder-editor-dialog.react.test.tsx`<br>`apps/web/src/components/shared/folder-failure.test.tsx`<br>`apps/web/src/components/shared/folder-panel-icons.react.test.tsx`<br>`apps/web/src/components/shared/folder-row-actions.test.tsx`<br>`apps/web/src/components/shared/folder-select.react.test.tsx`<br>`apps/web/src/components/shared/form-file-attachments.test.tsx`<br>`apps/web/src/components/shared/friend-picker-field.test.tsx`<br>`apps/web/src/components/shared/help-tip.test.tsx`<br>`apps/web/src/components/shared/image-uploader.test.tsx`<br>`apps/web/src/components/shared/inline-edit.test.tsx`<br>`apps/web/src/components/shared/inline-keyboard.regression.test.tsx`<br>`apps/web/src/components/shared/insert-text-field.test.tsx`<br>`apps/web/src/components/shared/keyboard-guards.test.tsx`<br>`apps/web/src/components/shared/line-preview.test.tsx`<br>`apps/web/src/components/shared/list-kpis-help.test.tsx`<br>`apps/web/src/components/shared/list-navigation.test.tsx`<br>`apps/web/src/components/shared/list-row-rules.test.tsx`<br>`apps/web/src/components/shared/list-state-contract.test.tsx`<br>`apps/web/src/components/shared/list-state-retry-contract.test.tsx`<br>`apps/web/src/components/shared/list-toolbar-contract.test.tsx`<br>`apps/web/src/components/shared/list-url-state.react.test.tsx`<br>`apps/web/src/components/shared/managed-folder-panel.test.tsx`<br>`apps/web/src/components/shared/media-limits.test.tsx`<br>`apps/web/src/components/shared/media-slot.test.tsx`<br>`apps/web/src/components/shared/menu-focus-return.react.test.tsx`<br>`apps/web/src/components/shared/menu-portal-height-contract.test.tsx`<br>`apps/web/src/components/shared/message-composer-media.test.tsx`<br>`apps/web/src/components/shared/message-composer.test.tsx`<br>`apps/web/src/components/shared/mobile-table-cards.test.tsx`<br>`apps/web/src/components/shared/motion-audit.regression.test.tsx`<br>`apps/web/src/components/shared/multi-select.test.tsx`<br>`apps/web/src/components/shared/overlay-discard.test.tsx`<br>`apps/web/src/components/shared/overlay-input-dirty.test.tsx`<br>`apps/web/src/components/shared/pattern-ownership-behavior.test.tsx`<br>`apps/web/src/components/shared/period-picker.test.tsx`<br>`apps/web/src/components/shared/progress.test.tsx`<br>`apps/web/src/components/shared/reorder-handle.test.tsx`<br>`apps/web/src/components/shared/reservation-board.react.test.tsx`<br>`apps/web/src/components/shared/restaurant-floor-editor.react.test.tsx`<br>`apps/web/src/components/shared/row-actions-contract.test.tsx`<br>`apps/web/src/components/shared/row-menu.react.test.tsx`<br>`apps/web/src/components/shared/row-navigation.test.tsx`<br>`apps/web/src/components/shared/row-roving.react.test.tsx`<br>`apps/web/src/components/shared/save-conflict.react.test.tsx`<br>`apps/web/src/components/shared/save-form-errors.test.tsx`<br>`apps/web/src/components/shared/search-field-shortcut.test.tsx`<br>`apps/web/src/components/shared/segmented-size.test.tsx`<br>`apps/web/src/components/shared/select-menu.react.test.tsx`<br>`apps/web/src/components/shared/select-window-react.test.tsx`<br>`apps/web/src/components/shared/source-picker-dialog.test.tsx`<br>`apps/web/src/components/shared/table.test.tsx`<br>`apps/web/src/components/shared/tag-overflow-speed.test.tsx`<br>`apps/web/src/components/shared/tag-picker-field.test.tsx`<br>`apps/web/src/components/shared/tag-pill.test.tsx`<br>`apps/web/src/components/shared/tap-action-field.test.tsx`<br>`apps/web/src/components/shared/tap-area-editor.test.tsx`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/target-missing-v8-label.react.test.tsx`<br>`apps/web/src/components/shared/time-field-portal-click.test.tsx`<br>`apps/web/src/components/shared/time-field-v8.test.tsx`<br>`apps/web/src/components/shared/toast-stack.regression.test.tsx`<br>`apps/web/src/components/shared/toast.test.tsx`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`<br>`apps/web/src/components/shared/uri-tap-action-field.test.tsx`<br>`apps/web/src/components/shared/use-folder-move.test.tsx`<br>`apps/web/src/components/shared/v5-b3-controls-contract.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/components/shared/v8-menu-motion.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`<br>`apps/web/src/lib/design-debt.test.ts`<br>`apps/web/src/lib/design-impact.test.ts`<br>`scripts/visual-qa/v8-pattern-audit.test.ts`|
|共通/shared|`components/shared/card.module.css`|0 / 37 / 0 / 0|— / —|6（27）|`apps/web/src/app/webhooks/webhooks-board-numbers-contract.test.ts`<br>`apps/web/src/components/shared/card-padding-contract.test.tsx`<br>`apps/web/src/components/shared/green-semantics-contract.test.tsx`<br>`apps/web/src/components/shared/v5-b2-parts-contract.test.tsx`<br>`apps/web/src/lib/v8-card-shadow-contract.test.ts`<br>`scripts/visual-qa/v8-pattern-audit.test.ts`|
|共通/shared|`components/shared/check-card.module.css`|0 / 41 / 0 / 0|— / —|1（7）|`apps/web/src/components/shared/card-shape-contract.test.ts`|
|共通/shared|`components/shared/checkbox.module.css`|0 / 14 / 0 / 0|— / —|2（11）|`apps/web/src/components/shared/checkbox.test.tsx`<br>`apps/web/src/components/shared/motion-tokens-contract.test.ts`|
|共通/shared|`components/shared/chip.module.css`|0 / 5 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/color-well.module.css`|0 / 21 / 0 / 0|— / —|2（19）|`apps/web/src/components/shared/color-well.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/color-well.tsx`|2 / 0 / 0 / 0|— / —|1（14）|`apps/web/src/components/shared/color-well.test.tsx`|
|共通/shared|`components/shared/combobox.module.css`|0 / 6 / 0 / 0|— / —|3（14）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/combobox-v8-height.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/condition-builder.tsx`|1 / 0 / 1 / 0|— / —|32（215）|`apps/web/src/app/auto-replies/auto-reply-v8-flow.test.tsx`<br>`apps/web/src/app/auto-replies/edit/auto-reply-edit-steps.test.tsx`<br>`apps/web/src/app/auto-replies/edit/edit-viewer-gating.react.test.tsx`<br>`apps/web/src/app/auto-replies/edit-dialog-order.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-priority-init.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-save-react.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-dirty-guard.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-v8-flow.test.tsx`<br>`apps/web/src/app/scenarios/first-step/first-step-audit.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-choice-parts.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-condition-guard.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-keyword-all.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-matchtype.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-message-kinds.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-overlay.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-response.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-save-failure.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-weekday.test.tsx`<br>`apps/web/src/components/reminders/reminder-publish-flow-loading.react.test.tsx`<br>`apps/web/src/components/reminders/reminder-target-stage.react.test.tsx`<br>`apps/web/src/components/rich-menus/rich-menu-create-form-choice-parts.test.tsx`<br>`apps/web/src/components/scenarios/action-editor-audit-r246-r247.test.ts`<br>`apps/web/src/components/scenarios/condition-dialog.test.tsx`<br>`apps/web/src/components/scenarios/test-send-dialog.test.tsx`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/condition-builder-account.test.tsx`<br>`apps/web/src/components/shared/condition-builder-add-picker.test.tsx`<br>`apps/web/src/components/shared/condition-builder-empty-or.test.tsx`<br>`apps/web/src/components/shared/condition-builder-name-targets.test.tsx`<br>`apps/web/src/components/shared/condition-builder-tag-pill.test.tsx`<br>`apps/web/src/m22c-chip-link-contract.test.ts`|
|共通/shared|`components/shared/copy-text-button.module.css`|0 / 3 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/copy-text-button.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/create-page.module.css`|0 / 5 / 0 / 0|— / —|1（6）|`apps/web/src/components/shared/create-page-head-contract.test.tsx`|
|共通/shared|`components/shared/create-page.tsx`|2 / 0 / 0 / 0|— / —|5（42）|`apps/web/src/app/issue-975a-ui-audit-contract.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/create-page-error.test.ts`<br>`apps/web/src/components/shared/create-page-head-contract.test.tsx`<br>`apps/web/src/components/shared/create-page-stale-error.test.tsx`|
|共通/shared|`components/shared/data-table.module.css`|0 / 153 / 0 / 0|— / —|8（46）|`apps/web/src/app/issue-707-responsive-390-contract.test.tsx`<br>`apps/web/src/app/webhooks/outgoing-1152-overflow-contract.test.ts`<br>`apps/web/src/components/layout/app-shell-v5.test.ts`<br>`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/table.test.tsx`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`<br>`apps/web/src/components/shared/v8-table-row-line-contract.test.ts`|
|共通/shared|`components/shared/date-field.module.css`|0 / 3 / 0 / 0|— / —|4（24）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/date-field-clear-contract.test.ts`<br>`apps/web/src/components/shared/focus-visible-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/date-time-field.tsx`|3 / 1 / 0 / 0|— / —|12（80）|`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/app/reminders/reminder-v8-flow.test.tsx`<br>`apps/web/src/app/scenarios/scenario-v8-flow.test.tsx`<br>`apps/web/src/components/friends/bulk-run-dialog-behavior.test.tsx`<br>`apps/web/src/components/shared/date-time-clear.regression.test.tsx`<br>`apps/web/src/components/shared/date-time-field-width-contract.test.ts`<br>`apps/web/src/components/shared/date-time-field.test.tsx`<br>`apps/web/src/components/shared/date-time-focus.regression.test.tsx`<br>`apps/web/src/components/shared/time-field-portal-click.test.tsx`<br>`apps/web/src/components/shared/time-field-v8.test.tsx`<br>`apps/web/src/v8/booking-menus/slot-check-race.test.tsx`<br>`apps/web/src/v8/broadcasts/quick-send-flow.test.tsx`|
|共通/shared|`components/shared/delete-button.module.css`|0 / 15 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/delta-chip.module.css`|0 / 6 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/detail-panel.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/dialog.module.css`|0 / 75 / 0 / 0|— / —|8（38）|`apps/web/src/components/shared/dialog-danger-band.test.tsx`<br>`apps/web/src/components/shared/dialog-design-header.react.test.tsx`<br>`apps/web/src/components/shared/dialog-design-size-contract.test.tsx`<br>`apps/web/src/components/shared/dialog-tall-panel-contract.test.tsx`<br>`apps/web/src/components/shared/dialog-warning-band.test.tsx`<br>`apps/web/src/components/shared/proposal-e-props.react.test.tsx`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`<br>`apps/web/src/components/shared/v5-b4-overlays-contract.test.tsx`|
|共通/shared|`components/shared/disclosure.module.css`|0 / 6 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/drawer.module.css`|0 / 45 / 0 / 0|— / —|2（13）|`apps/web/src/components/shared/proposal-e-props.react.test.tsx`<br>`apps/web/src/components/shared/v5-b4-overlays-contract.test.tsx`|
|共通/shared|`components/shared/entity-picker-sources.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/entity-picker.module.css`|0 / 1 / 0 / 0|— / —|2（20）|`apps/web/src/app/friends/friends-search-audit-contract.test.ts`<br>`apps/web/src/v8/hq-templates/saved-distribution-layout.test.tsx`|
|共通/shared|`components/shared/filter-chip.css`|0 / 11 / 0 / 0|— / —|4（28）|`apps/web/src/components/shared/filter-chip.test.tsx`<br>`apps/web/src/components/shared/selected-chip-no-black.test.ts`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/folder-add-dialog.tsx`|2 / 0 / 0 / 0|— / —|7（39）|`apps/web/src/app/overlay-focus-wiring-contract.test.ts`<br>`apps/web/src/app/templates/template-folder-contract.test.ts`<br>`apps/web/src/components/shared/folder-add-keyboard.regression.test.tsx`<br>`apps/web/src/components/shared/folder-editor-dialog.react.test.tsx`<br>`apps/web/src/components/shared/keyboard-guards.test.tsx`<br>`apps/web/src/lib/card-radius-contract.test.ts`<br>`scripts/visual-qa/broadcasts-capture-contract.test.ts`|
|共通/shared|`components/shared/folder-dot.module.css`|0 / 1 / 0 / 0|— / —|1（8）|`apps/web/src/components/shared/folder-dot.test.tsx`|
|共通/shared|`components/shared/folder-editor-dialog.module.css`|0 / 1 / 0 / 0|— / —|1（4）|`apps/web/src/components/shared/folder-failure.test.tsx`|
|共通/shared|`components/shared/folder-panel.module.css`|0 / 42 / 0 / 0|— / —|3（10）|`apps/web/src/components/shared/folder-menu-over-count.test.ts`<br>`apps/web/src/components/shared/folder-panel-menu-slot.test.ts`<br>`apps/web/src/components/shared/v8-folder-menu-space-contract.test.ts`|
|共通/shared|`components/shared/folder-panel.tsx`|3 / 0 / 38 / 8|— / —|14（102）|`apps/web/src/app/booking/bookings/booking-folder-panel-contract.test.ts`<br>`apps/web/src/app/templates/template-folder-contract.test.ts`<br>`apps/web/src/app/webinars/button-accessible-names.test.tsx`<br>`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`<br>`apps/web/src/components/shared/folder-menu-over-count.test.ts`<br>`apps/web/src/components/shared/folder-panel-contract.test.ts`<br>`apps/web/src/components/shared/folder-panel-count-react.test.tsx`<br>`apps/web/src/components/shared/folder-panel-icons.react.test.tsx`<br>`apps/web/src/components/shared/folder-panel-menu-slot.test.ts`<br>`apps/web/src/components/shared/folder-row-actions.test.tsx`<br>`apps/web/src/components/shared/folder-select.react.test.tsx`<br>`apps/web/src/components/shared/v8-rule-values.test.ts`<br>`apps/web/src/lib/design-debt.test.ts`<br>`scripts/visual-qa/broadcasts-capture-contract.test.ts`|
|共通/shared|`components/shared/folder-select.module.css`|0 / 2 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/form-controls.module.css`|0 / 28 / 0 / 0|— / —|3（20）|`apps/web/src/components/shared/optional-badge.test.tsx`<br>`apps/web/src/components/shared/text-field-unified.react.test.tsx`<br>`apps/web/src/components/shared/u976-design-unification-contract.test.ts`|
|共通/shared|`components/shared/grid-table.module.css`|0 / 7 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/help-tip.module.css`|0 / 15 / 0 / 0|— / —|2（12）|`apps/web/src/components/shared/help-tip-mark-font.test.ts`<br>`apps/web/src/components/shared/help-tip.test.tsx`|
|共通/shared|`components/shared/icon-button.module.css`|0 / 16 / 0 / 0|— / —|6（54）|`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`<br>`apps/web/src/components/shared/button-press-feel-contract.test.ts`<br>`apps/web/src/components/shared/row-menu.react.test.tsx`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/v5-b2-parts-contract.test.tsx`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`|
|共通/shared|`components/shared/icon-tile.module.css`|0 / 5 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/insert-text-field.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/insert-text-field.tsx`|2 / 1 / 0 / 0|— / —|1（13）|`apps/web/src/components/shared/insert-text-field.test.tsx`|
|共通/shared|`components/shared/kpi-band-v8.css`|0 / 19 / 0 / 0|— / —|3（27）|`apps/web/src/components/shared/kpi-band-contract.test.tsx`<br>`apps/web/src/components/templates/list-template-spec-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`|
|共通/shared|`components/shared/kpi-card.module.css`|0 / 51 / 0 / 0|— / —|6（43）|`apps/web/src/components/shared/kpi-band-contract.test.tsx`<br>`apps/web/src/components/shared/kpi-card-label-overflow.test.tsx`<br>`apps/web/src/components/shared/load-shift-reserve.react.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`<br>`apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`|
|共通/shared|`components/shared/kpi-card.tsx`|0 / 0 / 0 / 5|— / —|14（91）|`apps/web/src/app/friend-add-settings/runs/friend-add-runs-redaction-react.test.tsx`<br>`apps/web/src/app/friends/friends-shared-parts-contract.test.ts`<br>`apps/web/src/app/issue-673-visual-quality-contract.test.tsx`<br>`apps/web/src/components/shared/icon-less.test.tsx`<br>`apps/web/src/components/shared/kpi-card-description-react.test.tsx`<br>`apps/web/src/components/shared/kpi-card-label-overflow.test.tsx`<br>`apps/web/src/components/shared/kpi-card-migration-contract.test.tsx`<br>`apps/web/src/components/shared/kpi-card-signed.test.tsx`<br>`apps/web/src/components/shared/kpi-card-value-missing.test.tsx`<br>`apps/web/src/components/shared/list-row-rules.test.tsx`<br>`apps/web/src/components/shared/list-state-contract.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/lib/design-debt.test.ts`<br>`scripts/visual-qa/v8-pattern-audit.test.ts`|
|共通/shared|`components/shared/line-preview.module.css`|0 / 50 / 0 / 0|— / —|5（45）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/line-preview-bubble.test.ts`<br>`apps/web/src/components/shared/line-preview.test.tsx`<br>`apps/web/src/components/shared/radio-card-contract.test.tsx`<br>`apps/web/src/components/shared/text-contrast-contract.test.ts`|
|共通/shared|`components/shared/line-preview.tsx`|0 / 4 / 0 / 0|— / —|5（34）|`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-pixel-parity-contract.test.ts`<br>`apps/web/src/components/shared/cards-v8-interactions.test.tsx`<br>`apps/web/src/components/shared/line-preview.test.tsx`<br>`apps/web/src/components/shared/phone-frame-rules.test.tsx`|
|共通/shared|`components/shared/list-state.module.css`|0 / 14 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/list-state.tsx`|2 / 0 / 0 / 0|— / —|22（181）|`apps/web/src/app/conversions/conversion-points-v6-contract.test.ts`<br>`apps/web/src/app/events/bookings/event-booking-interactions.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-priority-init.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-save-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/detail/friend-add-run-detail-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/detail/run-detail-shape.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/friend-add-runs-redaction-react.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-idea18-orders-contract.test.ts`<br>`apps/web/src/app/inflow-links/inflow-links-v6-contract.test.ts`<br>`apps/web/src/app/nen-members/photo-workspace-contract.test.ts`<br>`apps/web/src/app/reminders/reminder-empty-vs-error-contract.test.ts`<br>`apps/web/src/app/templates/templates-list-state-contract.test.ts`<br>`apps/web/src/app/webinars/webinar-list-state-contract.test.ts`<br>`apps/web/src/components/friend-fields/friend-attributes-v4-contract.test.ts`<br>`apps/web/src/components/shared/list-state-contract.test.tsx`<br>`apps/web/src/components/shared/list-state-failure-status.test.tsx`<br>`apps/web/src/components/shared/list-state-retry-contract.test.tsx`<br>`apps/web/src/components/shared/pattern-ownership-behavior.test.tsx`<br>`apps/web/src/components/shared/skeleton-contract.test.tsx`<br>`apps/web/src/components/webinars/webinar-notifications-contract.test.ts`<br>`apps/web/src/components/webinars/webinar-notifications-skip-reasons.test.tsx`|
|共通/shared|`components/shared/list-toolbar.module.css`|0 / 34 / 0 / 0|— / —|2（17）|`apps/web/src/app/issue-636-responsive-contract.test.ts`<br>`apps/web/src/components/shared/list-toolbar-contract.test.tsx`|
|共通/shared|`components/shared/multi-select.module.css`|0 / 2 / 0 / 0|— / —|2（12）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/notice.module.css`|0 / 22 / 0 / 0|— / —|3（15）|`apps/web/src/components/shared/green-semantics-contract.test.tsx`<br>`apps/web/src/components/shared/notice-info-contract.test.ts`<br>`apps/web/src/components/shared/v5-b4-overlays-contract.test.tsx`|
|共通/shared|`components/shared/notification-panel.module.css`|0 / 1 / 0 / 0|— / —|2（12）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/v5-b4-overlays-contract.test.tsx`|
|共通/shared|`components/shared/otp-input.module.css`|0 / 21 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/page-header.module.css`|0 / 14 / 0 / 0|— / —|2（7）|`apps/web/src/components/shared/page-header-enlyo-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`|
|共通/shared|`components/shared/pagination.module.css`|0 / 20 / 0 / 0|— / —|3（30）|`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/lib/design-impact.test.ts`|
|共通/shared|`components/shared/progress.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/radio-card.module.css`|0 / 79 / 0 / 0|— / —|3（27）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/radio-card-contract.test.tsx`<br>`apps/web/src/components/shared/v6-parts-contract.test.ts`|
|共通/shared|`components/shared/radio.module.css`|0 / 9 / 0 / 0|— / —|1（3）|`apps/web/src/components/shared/radio-size.test.tsx`|
|共通/shared|`components/shared/refresh-cover.tsx`|2 / 0 / 0 / 0|— / —|2（19）|`apps/web/src/components/shared/motion-audit.regression.test.tsx`<br>`apps/web/src/components/shared/skeleton-contract.test.tsx`|
|共通/shared|`components/shared/reorder-handle.tsx`|2 / 0 / 0 / 0|— / —|4（19）|`apps/web/src/components/shared/bcommon-audit.regression.test.tsx`<br>`apps/web/src/components/shared/reorder-handle.test.tsx`<br>`apps/web/src/components/shared/row-roving-wiring-contract.test.ts`<br>`apps/web/src/lib/use-live-reorder-wiring.test.ts`|
|共通/shared|`components/shared/reservation-board.tsx`|0 / 1 / 0 / 0|— / —|1（6）|`apps/web/src/components/shared/reservation-board.react.test.tsx`|
|共通/shared|`components/shared/retry-label.tsx`|2 / 0 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/row-actions.module.css`|0 / 1 / 0 / 0|— / —|3（23）|`apps/web/src/components/shared/row-actions-contract.test.tsx`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/v6-parts-contract.test.ts`|
|共通/shared|`components/shared/search-field.module.css`|0 / 15 / 0 / 0|— / —|2（11）|`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/v5-b3-controls-contract.test.tsx`|
|共通/shared|`components/shared/section-header.module.css`|0 / 10 / 0 / 0|— / —|1（20）|`apps/web/src/v8/dashboard/dashboard-align.test.tsx`|
|共通/shared|`components/shared/segmented.module.css`|0 / 35 / 0 / 0|— / —|2（12）|`apps/web/src/components/shared/segmented-size.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/select-menu.module.css`|0 / 2 / 0 / 0|— / —|3（24）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/select-menu.react.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/select.module.css`|0 / 26 / 0 / 0|— / —|6（39）|`apps/web/src/components/shared/bcommon-wiring.regression.test.ts`<br>`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/focus-visible-contract.test.ts`<br>`apps/web/src/components/shared/select-width-text.test.tsx`<br>`apps/web/src/components/shared/v5-b3-controls-contract.test.tsx`<br>`apps/web/src/components/shared/v6-parts-contract.test.ts`|
|共通/shared|`components/shared/select.tsx`|2 / 0 / 0 / 0|— / —|99（817）|`apps/web/src/app/affiliates/new/affiliate-registration-flow.test.tsx`<br>`apps/web/src/app/affiliates/offer-actions-boundary.test.tsx`<br>`apps/web/src/app/affiliates/offer-form-labels.test.tsx`<br>`apps/web/src/app/analytics/analytics-controls-react.test.tsx`<br>`apps/web/src/app/analytics/analytics-measure-retry-react.test.tsx`<br>`apps/web/src/app/auto-replies/edit/wizard-audit.test.tsx`<br>`apps/web/src/app/automations/new/audit-detail-regression.test.tsx`<br>`apps/web/src/app/automations/new/automation-condition-audit.test.tsx`<br>`apps/web/src/app/automations/new/automation-new-audit.test.tsx`<br>`apps/web/src/app/automations/new/automation-new-options.test.tsx`<br>`apps/web/src/app/automations/new/automation-v8-pending-account.test.tsx`<br>`apps/web/src/app/automations/new/resume-read-failure-r532.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.draft.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.instant.test.tsx`<br>`apps/web/src/app/booking/bookings/new/page.r534-menus-429-react.test.tsx`<br>`apps/web/src/app/booking/menus/new/menu-form-blur.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/menu-form-v8-skeleton.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/page.test.tsx`<br>`apps/web/src/app/booking/menus/page.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.member-load-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.r310-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/page.r578-react.test.tsx`<br>`apps/web/src/app/booking/staff/new/staff-new-blur.react.test.tsx`<br>`apps/web/src/app/booking/staff/new/staff-new-v8-skeleton.react.test.tsx`<br>`apps/web/src/app/booking/staff/shifts/page.react.test.tsx`<br>`apps/web/src/app/chats/inbox-stale-response-react.test.tsx`<br>`apps/web/src/app/chats/quote-schedule-react.test.tsx`<br>`apps/web/src/app/contents/vars/edit/page.load-sections.test.tsx`<br>`apps/web/src/app/contents/vars/edit/page.redisplay.test.tsx`<br>`apps/web/src/app/contents/vars/edit/page.schedule.test.tsx`<br>`apps/web/src/app/contents/vars/new/page.behavior.test.tsx`<br>`apps/web/src/app/contents/vars/new/page.load-failure.test.tsx`<br>`apps/web/src/app/conversions/conversion-points-v6-contract.test.ts`<br>`apps/web/src/app/dashboard-issue-1006-react.test.tsx`<br>`apps/web/src/app/emergency/emergency-control-mount.test.ts`<br>`apps/web/src/app/emergency/operation-history-summary.test.tsx`<br>`apps/web/src/app/events/bookings/event-booking-interactions.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-priority-init.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-m21t-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/friend-add-rule-editor-save-react.test.tsx`<br>`apps/web/src/app/friend-add-settings/runs/friend-add-runs-redaction-react.test.tsx`<br>`apps/web/src/app/friends/detail/friend-detail-permission.test.tsx`<br>`apps/web/src/app/friends/detail/friend-detail-progressive.test.tsx`<br>`apps/web/src/app/friends/friends-shared-parts-contract.test.ts`<br>`apps/web/src/app/hq/members/hq-members-change-confirm-react.test.tsx`<br>`apps/web/src/app/inflow-links/inflow-links-v6-contract.test.ts`<br>`apps/web/src/app/nen-campaigns/nen-create-entry-618.test.tsx`<br>`apps/web/src/app/ops/announcements/ops-announcements-react.test.tsx`<br>`apps/web/src/app/reminders/detail/registrants-panel.react.test.tsx`<br>`apps/web/src/app/reminders/new/reminder-new-trigger.react.test.tsx`<br>`apps/web/src/app/reminders/reminders-list-controls.react.test.tsx`<br>`apps/web/src/app/reminders/reminders-reorder.react.test.tsx`<br>`apps/web/src/app/rich-menus/edit/schedule-idempotency-react.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-dirty-guard.test.tsx`<br>`apps/web/src/app/rich-menus/rich-menu-v8-flow.test.tsx`<br>`apps/web/src/app/tags/tag-field-v8-flow.test.tsx`<br>`apps/web/src/app/templates/edit/page.behavior.test.tsx`<br>`apps/web/src/app/templates/edit/page.mount.test.tsx`<br>`apps/web/src/app/templates/template-asset-save.test.tsx`<br>`apps/web/src/app/webinars/edit/basic-v8.react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-edit-failure-recovery-contract.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-participants-classification-react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-participants-role-react.test.tsx`<br>`apps/web/src/app/webinars/edit/webinar-unsaved-flow-react.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-choice-parts.test.tsx`<br>`apps/web/src/components/auto-replies/edit-dialog-response.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-approval.test.tsx`<br>`apps/web/src/components/broadcasts/broadcast-template-picker-react.test.tsx`<br>`apps/web/src/components/chats/inbox-panel-inline-edit-react.test.tsx`<br>`apps/web/src/components/dashboard/dashboard-overlays-mount.test.tsx`<br>`apps/web/src/components/dashboard/qr-dialog-stopped.test.tsx`<br>`apps/web/src/components/dashboard/qr-size-contract.test.tsx`<br>`apps/web/src/components/events/event-form-publish-a11y.test.tsx`<br>`apps/web/src/components/events/event-form-questions-save.test.tsx`<br>`apps/web/src/components/events/event-form-slot-edit.test.tsx`<br>`apps/web/src/components/events/event-form-unsaved.react.test.tsx`<br>`apps/web/src/components/events/event-name-blur.react.test.tsx`<br>`apps/web/src/components/events/issue-1000-audit.test.tsx`<br>`apps/web/src/components/events/issue-1054b-event-audit.test.tsx`<br>`apps/web/src/components/merged-person/merged-person-screen.test.tsx`<br>`apps/web/src/components/scenarios/question-editor-audit.test.tsx`<br>`apps/web/src/components/scenarios/trigger-editor.test.tsx`<br>`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/date-time-field.test.tsx`<br>`apps/web/src/components/shared/entity-picker-guard.test.ts`<br>`apps/web/src/components/shared/field-errors-controls.react.test.tsx`<br>`apps/web/src/components/shared/save-form-errors.test.tsx`<br>`apps/web/src/components/shared/select-menu.react.test.tsx`<br>`apps/web/src/components/shared/select-width-text.test.tsx`<br>`apps/web/src/components/shared/select-window-react.test.tsx`<br>`apps/web/src/components/shared/v5-b3-controls-contract.test.tsx`<br>`apps/web/src/components/support/email-thread-react.test.tsx`<br>`apps/web/src/components/support/support-inbox-failure-react.test.tsx`<br>`apps/web/src/components/support/support-inbox-react.test.tsx`<br>`apps/web/src/components/webinars/webinar-form.react.test.tsx`<br>`apps/web/src/components/webinars/webinar-notifications-contract.test.ts`<br>`apps/web/src/v8/broadcasts/quick-send-flow.test.tsx`<br>`apps/web/src/v8/tags/list.test.tsx`<br>`apps/web/src/v8/tags/tags-tab-reorder.test.tsx`|
|共通/shared|`components/shared/skeleton.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/slide-panel.module.css`|0 / 2 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/status-badge.module.css`|0 / 34 / 0 / 0|— / —|3（20）|`apps/web/src/app/issue-702-badge-contrast-contract.test.tsx`<br>`apps/web/src/components/shared/green-semantics-contract.test.tsx`<br>`apps/web/src/components/shared/v5-b2-parts-contract.test.tsx`|
|共通/shared|`components/shared/status-pill.module.css`|0 / 15 / 0 / 0|— / —|1（9）|`apps/web/src/app/issue-702-badge-contrast-contract.test.tsx`|
|共通/shared|`components/shared/sticky-bar.module.css`|0 / 4 / 0 / 0|— / —|2（25）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/sticky-bar-contract.test.ts`|
|共通/shared|`components/shared/table-presentation.module.css`|0 / 21 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/table.module.css`|0 / 11 / 0 / 0|— / —|3（28）|`apps/web/src/app/automations/list-board-numbers-contract.test.ts`<br>`apps/web/src/components/shared/table.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`|
|共通/shared|`components/shared/table.tsx`|2 / 0 / 0 / 0|— / —|19（157）|`apps/web/src/app/contents/vars/common-vars-v6-contract.test.ts`<br>`apps/web/src/app/duplicates/duplicates-contract.test.ts`<br>`apps/web/src/app/issue-461-table-header-spacing-contract.test.ts`<br>`apps/web/src/app/issue-707-responsive-390-contract.test.tsx`<br>`apps/web/src/components/shared/bar-chart.test.tsx`<br>`apps/web/src/components/shared/create-row-highlight.test.tsx`<br>`apps/web/src/components/shared/destination-policy.test.tsx`<br>`apps/web/src/components/shared/list-navigation.test.tsx`<br>`apps/web/src/components/shared/list-row-rules.test.tsx`<br>`apps/web/src/components/shared/list-state-failure-status.test.tsx`<br>`apps/web/src/components/shared/row-entrance-speed.test.tsx`<br>`apps/web/src/components/shared/row-navigation.test.tsx`<br>`apps/web/src/components/shared/segmented-size.test.tsx`<br>`apps/web/src/components/shared/table.test.tsx`<br>`apps/web/src/components/shared/v5-v6-parts-contract.test.tsx`<br>`apps/web/src/components/shared/v8-row-motion.test.tsx`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`<br>`apps/web/src/components/support/pending-inbox-card-header-action.test.ts`<br>`apps/web/src/lib/design-debt.test.ts`|
|共通/shared|`components/shared/tabs.module.css`|0 / 33 / 0 / 0|— / —|6（41）|`apps/web/src/app/line-notifications/customer-notifications-v6-contract.test.ts`<br>`apps/web/src/components/shared/proposal-e-props.react.test.tsx`<br>`apps/web/src/components/shared/tabs-height-contract.test.ts`<br>`apps/web/src/components/shared/tap-target-hover-639-contract.test.tsx`<br>`apps/web/src/components/shared/v6-parts-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/tag-pill.module.css`|0 / 2 / 0 / 0|— / —|1（5）|`apps/web/src/components/shared/tag-pill.test.tsx`|
|共通/shared|`components/shared/tap-action-field.module.css`|0 / 1 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/target-missing.tsx`|0 / 1 / 0 / 0|— / —|5（21）|`apps/web/src/app/tags/marks/edit/missing-id.test.tsx`<br>`apps/web/src/components/shared/list-state-failure-status.test.tsx`<br>`apps/web/src/components/shared/target-missing-v8-label.react.test.tsx`<br>`apps/web/src/components/shared/target-missing.test.tsx`<br>`apps/web/src/v8/automations/definition-entry.test.tsx`|
|共通/shared|`components/shared/text-field.module.css`|0 / 20 / 0 / 0|— / —|6（35）|`apps/web/src/app/webhooks/webhooks-board-numbers-contract.test.ts`<br>`apps/web/src/components/shared/control-dimensions-contract.test.ts`<br>`apps/web/src/components/shared/focus-visible-contract.test.ts`<br>`apps/web/src/components/shared/text-field-unified.react.test.tsx`<br>`apps/web/src/components/shared/v5-b3-controls-contract.test.tsx`<br>`apps/web/src/components/shared/v6-parts-contract.test.ts`|
|共通/shared|`components/shared/text-link.module.css`|0 / 4 / 0 / 0|— / —|0（0）|—|
|共通/shared|`components/shared/toast.module.css`|0 / 9 / 0 / 0|— / —|3（15）|`apps/web/src/components/shared/card-shape-contract.test.ts`<br>`apps/web/src/components/shared/toast-leave-motion-contract.test.ts`<br>`apps/web/src/components/shared/v8-spec-motion-contract.test.ts`|
|共通/shared|`components/shared/toggle.module.css`|0 / 11 / 0 / 0|— / —|1（1）|`apps/web/src/components/shared/v6-parts-contract.test.ts`|
|共通/shared|`components/shared/top-bar.module.css`|0 / 57 / 0 / 0|— / —|3（27）|`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/shared/top-bar.test.tsx`<br>`apps/web/src/components/shared/v8-spec-dimensions-contract.test.ts`|
|共通/shared|`components/shared/top-bar.tsx`|0 / 0 / 0 / 17|— / —|7（66）|`apps/web/src/app/theme-switch-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/layout/v8-sidebar-shortcut.react.test.tsx`<br>`apps/web/src/components/shared/top-bar.test.tsx`<br>`apps/web/src/components/shell/bell-notifications.react.test.tsx`<br>`apps/web/src/components/shell/no-head-back.react.test.tsx`|
|共通/shared|`components/shared/virtual-rows.tsx`|2 / 0 / 0 / 0|— / —|1（5）|`apps/web/src/components/shared/virtual-rows.test.tsx`|
|共通/shell|`components/shell/app-top-bar.tsx`|2 / 0 / 0 / 0|— / —|13（102）|`apps/web/src/app/hq/hq-console.test.ts`<br>`apps/web/src/app/hq/members/hq-account.test.ts`<br>`apps/web/src/app/theme-switch-contract.test.ts`<br>`apps/web/src/app/unsaved-guard-wiring-contract.test.ts`<br>`apps/web/src/app/v8-outer-shell-contract.test.ts`<br>`apps/web/src/components/account-create-shell.test.tsx`<br>`apps/web/src/components/app-shell-settings-remount.react.test.tsx`<br>`apps/web/src/components/layout/mobile-header-contract.test.ts`<br>`apps/web/src/components/shared/top-bar.test.tsx`<br>`apps/web/src/components/shell/app-top-bar-hq.react.test.tsx`<br>`apps/web/src/components/shell/no-head-back.react.test.tsx`<br>`apps/web/src/components/shell/page-chrome-title-contract.test.tsx`<br>`apps/web/src/lib/manual-screen-key.test.ts`|
|共通/support|`components/support/email-thread.tsx`|2 / 0 / 0 / 0|— / —|8（42）|`apps/web/src/components/chats/inbox-v4-contract.test.ts`<br>`apps/web/src/components/support/email-memo-saving.test.tsx`<br>`apps/web/src/components/support/email-thread-draft-react.test.tsx`<br>`apps/web/src/components/support/email-thread-perf-11-react.test.tsx`<br>`apps/web/src/components/support/email-thread-polling-contract.test.ts`<br>`apps/web/src/components/support/email-thread-react.test.tsx`<br>`apps/web/src/components/support/email-thread.test.ts`<br>`apps/web/src/components/support/email-thread.test.tsx`|
|共通/support|`components/support/support-inbox.tsx`|2 / 0 / 0 / 0|— / —|4（23）|`apps/web/src/components/support/support-inbox-failure-react.test.tsx`<br>`apps/web/src/components/support/support-inbox-polling-boundary.test.tsx`<br>`apps/web/src/components/support/support-inbox-polling-contract.test.ts`<br>`apps/web/src/components/support/support-inbox-react.test.tsx`|
|共通/templates|`components/templates/create-parts.module.css`|0 / 3 / 0 / 0|— / —|1（4）|`apps/web/src/components/templates/create-parts.test.tsx`|
|共通/templates|`components/templates/page-templates.module.css`|0 / 219 / 0 / 0|— / —|9（87）|`apps/web/src/components/shared/folder-rail-owner-contract.test.ts`<br>`apps/web/src/components/shared/proposal-e-props.react.test.tsx`<br>`apps/web/src/components/templates/create-page-notice.test.tsx`<br>`apps/web/src/components/templates/create-page-spacing.test.tsx`<br>`apps/web/src/components/templates/list-page-folder-nav.test.tsx`<br>`apps/web/src/components/templates/list-template-spec-contract.test.ts`<br>`apps/web/src/components/templates/page-templates-head-contract.test.ts`<br>`apps/web/src/components/templates/steps.test.tsx`<br>`apps/web/src/v8/dashboard/dashboard-align.test.tsx`|
|共通/templates|`components/templates/steps.module.css`|0 / 1 / 0 / 0|— / —|1（7）|`apps/web/src/components/templates/steps.test.tsx`|
|共通/ui|`components/ui/sort-select.tsx`|2 / 0 / 0 / 0|— / —|1（6）|`apps/web/src/components/ui/list-controls-react.test.tsx`|
|共通/use-admin-theme.ts|`lib/use-admin-theme.ts`|1 / 1 / 0 / 0|— / —|37（171）|`apps/web/src/app/accounts/detail/account-detail-edit-react.test.tsx`<br>`apps/web/src/app/accounts/new/registration-v8.test.tsx`<br>`apps/web/src/app/analytics/readonly-v8.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/menu-form-blur.react.test.tsx`<br>`apps/web/src/app/booking/menus/new/menu-form-v8-skeleton.react.test.tsx`<br>`apps/web/src/app/booking/menus/settings-optimistic.react.test.tsx`<br>`apps/web/src/app/booking/menus/staff/assign-v8-ux.react.test.tsx`<br>`apps/web/src/app/booking/staff/booking-staff-readonly.test.tsx`<br>`apps/web/src/app/broadcasts/broadcast-v8-flow.test.tsx`<br>`apps/web/src/app/broadcasts/reserved/reserved-cancel-success.test.tsx`<br>`apps/web/src/app/ec-commerce/ec-subscriptions-pagination.test.tsx`<br>`apps/web/src/app/hq/banner-library-v8.react.test.tsx`<br>`apps/web/src/app/hq/templates/template-console-v8.test.tsx`<br>`apps/web/src/app/hq/templates/template-console.test.tsx`<br>`apps/web/src/app/hq/templates/template-message-v8.test.tsx`<br>`apps/web/src/app/inflow-links/detail/inflow-copy-fallback-react.test.tsx`<br>`apps/web/src/app/nen-campaigns/edit/column-edit-race.test.tsx`<br>`apps/web/src/components/account-create-shell.test.tsx`<br>`apps/web/src/components/app-shell-settings-remount.react.test.tsx`<br>`apps/web/src/components/auto-replies/action-options-parity.test.tsx`<br>`apps/web/src/components/friends/friend-kpis-month.test.tsx`<br>`apps/web/src/components/ops/impersonation-bar-v8.react.test.tsx`<br>`apps/web/src/components/rich-menus/area-properties-tap.test.tsx`<br>`apps/web/src/components/shared/folder-editor-dialog.react.test.tsx`<br>`apps/web/src/components/shared/message-composer-media.test.tsx`<br>`apps/web/src/components/shared/message-composer.test.tsx`<br>`apps/web/src/components/shared/tag-picker-field.test.tsx`<br>`apps/web/src/components/shared/tap-action-field.test.tsx`<br>`apps/web/src/components/shared/uri-tap-action-field.test.tsx`<br>`apps/web/src/components/shell/app-top-bar-hq.react.test.tsx`<br>`apps/web/src/components/support/support-inbox-polling-boundary.test.tsx`<br>`apps/web/src/lib/use-admin-theme.test.tsx`<br>`apps/web/src/v8/booking-staff/shifts.test.tsx`<br>`apps/web/src/v8/events/change-review.test.tsx`<br>`apps/web/src/v8/events/create.test.tsx`<br>`apps/web/src/v8/hq-templates/attributes.test.tsx`<br>`apps/web/src/v8/hq-templates/message-form.test.tsx`|

## 進捗・検査

- 台帳：444ファイル。useAdminThemeを使う139ファイル、未使用V8写し候補95件、*-v7ファイル0件。ダッシュボードから順番に着手する。
- ダッシュボード変更前：168/168件合格（`/tmp/v7rm2-dashboard-before.json`）。
- 開始時web全試験：12,409件、失敗0件（12,407合格、既存の保留1・todo1）。`/tmp/v7rm2-web-before.json`。
- 済んだ機能：ダッシュボード・受信箱・友だち。予約は日の来店印まで完了、メニュー・担当・営業時間は未完了。
- ダッシュボード：旧編集の描画を削除し、配置・4枠制限の計算だけを残した。現役V8本体の変更なし。旧チェックボックス・スイッチの外見契約3件を現役V8の操作へ書き換え、表示ON/OFF・並べ替え・保存中の操作禁止・Escape・Tabの焦点循環・焦点復帰・保存失敗・409・再読込を残した。
- ダッシュボード：関係する360件すべて合格、web型検査合格、差分検査合格。消した試験0件。旧カードの例外登録1行と読まれない旧編集ソースの読み口を外し、影・用語・板IDの読み先は現役V8へ移した。
- 変更前の10画面をmeasure.shで撮影済み（`/tmp/v7rm2-visual-before`）。WQmep・eovoG・nF4ts・l5V9a・axFrW・uE9gf・apLqS・I3L41O・I1E7Bt・rZEGN。変更後との比較は最後に実施。
- 削除した試験：2件（予約の使われない写しの外見契約。詳細は再開後の進捗）。
- 全削除後の最終検査（web/worker全試験・型・ビルド・scripts・CIブラウザ・主な10画面の前後比較）：未実施。上記の開始時確認・機能別検査とは別の工程。

## 前回の受信箱の途中経過（2026-10-11再開指示で解消）

- 顧客情報・メール会話・メール一覧の3部品のテーマ分岐を削除。現役V8の中身・配置は変更していない。
- 受信箱の関係試験428件すべて合格。web型検査合格。旧テーマで確認なしにタグを外す試験1件は、旧属性を置いてもV8の確認を通す動きへ書き換えた。タグ追加・削除・キャンセル・対象切り替え・権限・失敗・メモ競合・再読込・返信・下書き・ポーリングの動作試験は残した。削除した試験0件。
- テンプレート選択は未完了。削除を試した段階の428件中26件の失敗を調べ、文言の差・旧画面の要素・変換の不足と、本当に移し先がない動きを分けた。
- **動きの不足：解決済み本文の表示。** `components/chats/template-picker.tsx` は `api.chats.renderPreview` の結果を `resolvedPreview` に受けるが、V8の `templates` には元の `messageContent` のみを渡す。`v8/inbox-chat/template-picker-view.tsx` に解決済み本文を渡す口はなく、現在は未解決の差し込み名の警告だけが表示へ渡る。
- `components/chats/template-picker-preview.test.tsx` の「差し込みを含むテンプレートは解決済み本文を見せ、未解決名を警告する」は動作試験なので削除・緩和しない。V8のみへ固定すると失敗する。この動きを直すには「分岐を外すだけ」の範囲を広げる判断が必要。
- このファイルへの試行変更だけを開始時の内容へ戻し、旧コードと動作試験を残した。そのため関係試験428件は再び全件合格し、失敗した試験を残したままコミットしない。前回の `lh-pages-v7rm` は変更していない。
- 予約の未使用 `app/booking/bookings/booking-day-v8.tsx` の来店・遅刻・無断不来店・印の取消にも現役V8への移し先がない。飲食店の席予約の来店処理は別のAPI・予約対象なので代用しない。ここも動作試験と旧ファイルを保持する判断を依頼済み。
- 2件とも返答待ち。V8の動きを追加する変更は実施しない。受信箱が終わらないため、依頼の機能順を守り、友だち以降へは進めていない。

## 再開時の次の工程

1. テンプレートの解決済み本文の扱いを司令塔が決める。修正を別束へ分けるなら、この部分は保留として明示する。
2. V8の動きがそろった後にテンプレート選択の分岐とV7の要素・文言の試験を移行し、受信箱の全試験を通す。
3. 友だち以降を機能ごとに進める。未使用写し85TSX＋10CSSの削除は、読む試験・動きの移し先を先に確かめる。
4. 共通部品・CSS・CIのV7画素比較・V8だけの見張り。その後にweb/worker全試験・型・ビルド・scripts・CIのブラウザ検査と10画面の前後比較（差0）。

この途中段階では最終検査・見た目の不変確認を完了したと扱わない。push・PR・D1・配備は実施していない。

- この段階でV8本体（試験を除くsrc/v8全ファイル）のSHA-256を変更前と照合し、変更0件を確認。これは画像の不変確認の代用ではない。
- 不要になったV7だけの空の保存effectと定数の依存を整理した後、関係試験428件を再検査した。

## 再開後の進捗（2026-10-11）

- 再開SHA：`9500f27f10`。Doctor合格・クリーンを確認。本線は取り込まず同じ枝で続ける。
- 司令塔から受信箱の解決済み本文・人の予約の来店印を現役V8へ移す許可あり。以後も動きを残し、根拠のない動きは下の確認表に記す。
- **受信箱完了**：テンプレート選択の旧窓とテーマ分岐を削除。検索・フォルダ・ページ追加・アカウント境界・古い応答の排除・連続送信の順番・除外・5通上限をV8の操作で確認。
- 解決済み本文をV8の既存カード本文へ渡す。解決した値はB-57の既存の緑の札、未解決名は文字と従来の警告。保存・挿入へ渡す元の差し込み文字列は変えない。別会話から遅れて届く値も採用しない。
- APIは本文文字列だけを返すため、隣接する差し込みの解決値は1つの札へまとめる。本文と照合できないときはAPIの文字列をそのまま表示し、解決値を推測しない。
- 試験削除0件。旧窓の形・文言・独自の焦点処理を固定した契約2件はV8のフォルダ列・共通窓・挿入経路へ書き換え。動作試験は保持。旧窓専用の影の例外登録1行を外した。
- 確認：関係446/446件合格（`/tmp/v7rm2-inbox-final4.json`）、web型検査合格、差分検査合格。設計検出器の指摘0件。最終の全体試験・10画面の不変照合は未実施。
- 次：友だち→以降の機能→共通部品/CSS/CI→最終検査。人の予約の来店印は予約の工程で移す。

## 司令塔に確認



|機能|要件・採用済みの絵に根拠がない既存の動き|残した方法|判断|
|---|---|---|---|
|運営の自分の操作とスマホの閉じ方|旧だけのプロフィール/メンバー/二段階認証のメニューと矢印移動、Escapeで閉じる/背面停止がV8には無い。要件/採用済みの個別配置は確認できない|現在の上の帯の同じ名前から共通ActionMenuを開く。現役の引き出しに共通の焦点/Escape/スクロール停止を足す。通常の文字/並び/CSSは維持|欠けた操作の置き方を確認。旧の動作試験を同じケースで移して先へ進む|
|ECつなぎ先の影響と再試行の補足|現役の絵でタグ/分析の件数と再試行の全文が省略されていた|同じつながる先の行のtitleへ全体との区別と未取得/実数・再試行の場所を移す|通常の内容/配置/CSSは維持。補足の置き方を確認|
|アカウント詳細の上限/警告人数の補足|現役の同じ数では警告人数の表示が省略されていた|現在の友だち数のtitleへ上限/警告人数を移す。未設定を0にしない|通常の表示/CSSは維持。補足の置き方を確認|
|アカウント登録のID取り込み中の詳細移動|旧の動作試験ではID取り込みが終わるまで禁止。現役ではリンクが常時有効。要件にこのボタンの明示が無い|同じボタンを取り込み中だけ停止へ最小で移し、hydrating_profilesから移動可を実物で確認|配置の確認|
|サイト計測の今日の受信と停止理由/日時の補足|旧の今日の件数とページの種類/停止理由/受信の全文は現役では表示を省略していた|現在の見出し/停止の札/受信時刻の同じ項目のtitleへ元の値を移す。取得待ちと0/未受信を区別|通常の文字/配置/CSSは維持。補足の置き方を確認|
|広告へ返す名前の手入力とGoogleの成果ID|成果対応は要件v6-18 §の成果対応にある。現役の対応表には自動/停止だけで旧の手入力と成果IDが無かった|既存の名前の欄から共有の編集窓を開く。版つき保存/Googleの成果ID/未保存確認/失敗時の入力を保持|通常の表/配置/CSSは維持。編集窓と開き口の置き方を確認|
|広告連携の以前の設定金額|旧の設定に金額と通貨があり、現役の費用記録とは別の情報。個別の採用済み配置は確認できない|媒体の既存の補足行へ表示。現在の記録がある媒体では出さず、集計には加えない|通常の配置/CSSは維持。以前の情報の補足の置き方を確認|
|流入詳細の完全削除の名前確認|要件v6-18 §4-6に経路名の入力があるが現役の窓には無かった|現在の削除の窓の末尾へ共有の入力欄を移す。名前一致と権限のAPI直前の保護/名前つき要求を保持|通常の配置/CSSは維持。欠けた動作を移した入力欄の置き方を確認|
|テンプレート詳細の履歴が空と開けない使用先の案内|履歴の確認/使用先の移動は要件v6-11 §4-8にある。現役では空の履歴と旧形式で開けない理由が読めなかった|同じ履歴の段へ既存の空表示の部品で1行を移し、旧形式の同じ名前のtitleへ理由を移す|通常の配置/CSSは維持。データが空の案内と補足の置き方を確認|
|テンプレート一覧の詳細パネルの公開と使用先|動作は要件v6-11 §4-8・§6にある。採用済みの現役パネルには使用数だけで個別リンクと版つき公開が無かった|同じ使用先の段の下に現役の行部品で個別リンクを出し、同じ操作の段に版つき公開を最小で移す。配置/CSS/通常の一覧は維持|最小で移したパネル内の置き方を確認。閲覧権限/所属/連打/409/切替の試験は成功|
|資産テンプレートの自分への送信の案内|旧だけに送れないボタンと一斉配信から確かめる理由があり、現役の採用済み画面はその操作を出さない|現役の「届き方」の同じ見出しのtitleに理由を移す。送れない操作を出さず、理由と勝手な保存/送信なしを試験で確認|見える文/配置/CSSは維持。補足の置き方を司令塔へ報告|
|カルーセルの画像寸法と本文上限の補足|旧だけの推奨画像寸法と上限2条件の一覧は現役の同じ説明では省略|現在の画像の統一を説明する同じ行のtitleへ1024×678と60/120文字の条件を移す。現役の入力の上限/超過した文字数/保存前の検証を維持|見える文/配置/CSSは維持。補足の置き方を司令塔へ報告|
|メッセージテンプレートの所属ちがいの補足|旧だけに選択中アカウント名と候補の所属の補足があり、現役は候補を固定する案内だけ|現役の同じ知らせを共有の関数へ出し、選択中の名前と候補の所属をtitleへ移す。保存と候補の境界は同じ|見える文/配置/CSSは維持。補足の置き方を司令塔へ報告|
|メッセージテンプレートの使用先なしの補足|現役の絵は使用先0件の囲みを出さず、旧だけの「どこからも呼ばれていません」が無い|既存の「送るときの名前」の説明のtitleへ0件と補足を移す。保存は下書き/公開で反映の説明は現役のものを使用|見える囲み/配置/CSSは維持。補足の置き方を司令塔へ報告|
|質問テンプレートからシナリオへ移る操作|旧だけの「シナリオで使う」リンクは現役に無く、個別の採用済み配置は確認できない|現在の「この質問を使う場所」に同じ行き先のリンクだけを移し、未保存の確認を維持。統括の編集には出さない|リンクの置き方を司令塔へ報告。その他の配置/CSSは維持|
|Googleプロフィールの営業時間3方式と比較範囲|現役のV8に文章/日付指定/毎週の編集は無く、対応する採用済みV8の補助画面は見つからない。旧の比較範囲の説明も現役で省略|同じプロフィール/変更案APIと入力の検証を共通のカード/入力/暦/時刻選択/操作帯へ移す。通常のプロフィールの既存の説明のtitleへ比較範囲を移す|通常のプロフィール/他タブの見える内容・配置・CSSは維持。補助画面と補足の置き方を司令塔へ報告|
|Googleプロフィールの編集|現役のV8には項目/住所/写真の変更案づくり・未保存の確認・途中失敗の扱いの画面が無い。対応する採用済みV8の補助画面は見つからない|現役の外枠へ共通のカード/入力/通知/画像枠/選択ボタン/操作帯で最小の編集画面を作る。旧と同じ変更案のAPIを順番に呼び、全件成功後に確認へ|通常のプロフィール/他タブの内容・配置・CSSは維持。補助画面の置き方を司令塔へ報告|
|Googleプロフィールの変更履歴|現役のV8には種類/結果/期間/検索・記録から確認へ・CSVの画面が無い。対応する採用済みV8の補助画面は見つからない|現在の外枠へ共通の見出し/タブ/道具の段/カード/表/ページ送りで移す。旧と同じ絞り込みとAPI、CSVの全ページ取得・上限を維持|通常のプロフィール/他タブの内容・配置・CSSは維持。補助画面の置き方を司令塔へ報告|
|Googleプロフィールの変更確認|現役のV8には確認・送信・競合・送信結果不明・取消・複数変更の画面が無い。対応する採用済みV8の補助画面は見つからない|現在のGoogleの外枠へ移し、共通の見出し/札/カード/通知/確認チェック/操作帯で最小の確認画面を作る。同じAPIで動きを維持|通常のプロフィール/他タブの内容・配置・CSSは維持。補助画面の置き方を司令塔へ報告|
|飲食の在庫に時間帯を追加する操作|旧写しは既存の枠があっても30分刻みの不足分を生成できるが、現役は空の時だけ。追加操作の採用済み配置は見つからない|現在の時間帯の頭の共通メニューへ追加を移す。既存API/営業時間の版/配分を送り、空の時と同じ処理で読み直す。処理中/権限なし/不正配分は送らない|通常の表/列/CSSは維持。頭のメニューの置き方を司令塔へ報告|
|飲食の店舗追加の入力補足|旧のR174試験が守る入力と補足の結び付けが現役では包みの部品で失われ、略称の補足も読み上げでは取れない|現在の入力自体へid/説明を渡し、既にある補足と空欄時の扱いを読み上げ専用の説明で結ぶ|通常の文字/配置/CSSは維持。読み上げ専用の説明を司令塔へ報告|
|NENペットのごはん設定の切替の知らせ|旧は未保存の破棄を知らせるが、現役はキーで作り直して知らせを捨てる|現役で対象の切替を確かめ、既存の知らせに破棄を出し、古い取得/保存成功/失敗を採用しない|通常の文字/配置/CSSは維持。知らせの置き方を司令塔へ報告|
|NEN会員の旧の購入/マイルの集計|旧一覧に通年/累計/マイル残高/今月使用があり、現役の帯は別の集計を出す|現役の同じ帯のtitleへ元の4値を移す。タグ無しのランクも行のtitleで会員数を読める|通常の文字/配置/CSSは維持。補足の置き方を司令塔へ報告|
|NEN会員のランク保存競合の日時|読まれない旧V8の写しは日付と時刻を出すが、現役の帯は時刻だけ|現在の帯の同じ場所のtitleへ日付と時刻を移し、同じ競合確認/比べる/最新の読込を保持|通常の文字/配置/CSSは維持。補足の置き方を司令塔へ報告|
|NEN会員の設定をアカウント切替で破棄する知らせ|旧タブは未保存の入力を破棄した時に知らせるが、現役はキーで切り替えるため知らせが無い|現役のタブ自身が対象を確認して入力/競合/確認窓を破棄し、既存の知らせの場所へ案内する。切替前の応答は捨てる|対象を混ぜない動作を保持して先へ進む。通常の内容/配置/CSSは維持。知らせの置き方を司令塔へ報告|
|NEN会員のペット未登録の絞り込み|旧だけに登録あり/未登録/全員の3条件があり、現役の札は登録ありだけ|現役の札を選んだ時だけ共通の選択欄を出し、未登録を選べるようにする。札を外すと全員へ戻る|APIの条件を保持して先へ進む。通常の札/文字/配置/CSSは維持。選択時の欄の置き方を司令塔へ報告|
|運営ナレッジの記事を開く窓|問い合わせからの確認には旧の記事の窓が使われ、未解決の問い合わせは承認を止める。通常の記事の画面には元の件名/記事の種類の表示が無い|現在の記事本体を共通の窓でも使い、未解決時の確認/警告/承認禁止を移す。既存の根拠のtitleへ種類/件名を移す|承認の動きを保持。通常の全画面の内容/配置/CSSは維持。窓と補足の置き方を司令塔へ報告|
|運営契約先の細かな情報と移動|旧だけの利用/請求の両状態、請求/トライアル両日付、最終ログインの全文があり、作成後の移動先も違った|情報は現在の同じ項目のtitleへ移す。作成後は現役の一覧で作成行を示し、代理ログインは詳細の確認窓を使う|通常の列/文字/配置/CSSと現役の移動を保持。補足と移動の違いを司令塔へ報告|
|運営お問い合わせの集計と細かな情報|旧だけの初回返信/解決率/解決時間の比較、受付/起票者/登録分母/過去件数、全件数とAIの作成日時が現役では省かれていた|現在の説明/一覧/問い合わせ元/AIの見出しのtitleへ最小で移す。実際の返信/下書き/起票/知識の更新は同じAPIで保持|補足の置き方を司令塔へ報告。通常の文字/配置/CSSは維持|
|運営お知らせの保存競合後の再読込|旧は競合時にも一覧を自動で読み直し、入力を残す。現役は帯と比較/読込の口だけだった|現在の競合の帯を残し、同じ条件で一覧を読み直す。入力と元の版は自動で上書きしない|動作を保持して先へ進む。通常の箱/文字/配置/CSSは維持|
|運営監査ログのIP・表示範囲|旧だけにIPの列と全件数/表示範囲があり、現役の絵は5列と脚注だけ|理由の同じセルのtitleへIP/公開範囲、脚注のtitleへ全件数/範囲を移す。同じ条件の全件CSVは維持|補足の置き方を司令塔へ報告。通常の列/文字/配置/CSSは維持|
|運営メンバーの二段階の集計と日時全文|旧だけの設定済みの分母/未設定数と、短縮前の日付時刻が現在の表示にはない|既存の有効人数の補足と、最終ログインの同じセルのtitleへ移す|補足の置き方を司令塔へ報告。通常の列/文字/配置/CSSは維持|
|運営ダッシュボードの細かな内訳|旧だけに前月比/返金/解約/精密な使用量/登録分母などの情報がある|現在の同じ数の補足/一覧の値のtitleへ最小で移す。同じAPIで同期・再取得を維持|補足の置き方を司令塔へ報告。見える文字/配置/CSSは維持して動きを残す|
|統括のリッチメニュー例外時のフォーム|保存未確定や未対応の参照を含む時は旧の入力本体を使う。対応する採用済みの絵は見つからない|V8共通の板/欄/選択/知らせへ最小移行し、入力固定・複数ページ/参照の保持・面の編集を残す|通常の採用済み作成画面は維持。例外時の配置を司令塔へ報告し、動きを残して先へ進む|
|リッチメニュー履歴の版と修復後の案内|旧だけに公開版と下書きの違い、再試行する版の対象、未修復の取り込み案内がある|現役の説明/履歴のtitleと、違う時の共通警告へ情報を移す。実際のずれは既存の修復の確認窓へ渡し、残りは既存の知らせに出す|要件v6-12の公開版/下書きの区別と照合を保持。補足/窓の置き方は司令塔へ報告。通常の行/箱/CSSは維持|
|リッチメニュー編集の順番と部分取り下げ|旧だけに順番の入力と、部分失敗の分類した案内があった。現役は順番変更の口がなく、部分失敗でも一覧へ進んでいた|現在の順番の段から共通の数の窓へ移し、部分失敗は既存の確認窓へ理由と再試行を残す|要件v6-12の優先順/LINEの状態を保持。窓と案内の置き方は司令塔へ報告。通常の箱/並び/CSSは維持|
|リッチメニューの公開予約の一覧と取消|旧公開手順だけに一覧/取消/期間終了の戻し先/再試行予定があり、現役には入力だけがある|現在の「いつ公開するか」の段から共通の窓/表を開き、未実行予約だけを取り消す。同じAPIで最新状態を再取得する|要件v6-12 §5-5の公開日時/期間の動きを保持。窓の入口の置き方は司令塔へ報告。既存の段/箱/CSSは維持|
|リッチメニューの本人LINEテスト|旧公開手順だけに本人へ適用/復元する口があり、要件v6-12 §5-6には動きがある|現役の実機確認の既存の補足から共通の窓を開く。owner/adminだけ・連携済みの本人だけ・適用前と変更済みを区別して復元する|動作は要件に従い移行済み。窓の入口の置き方は司令塔へ報告。既存の3行/箱/CSSは維持|
|リッチメニューの公開途中の状態|旧だけに未実行・処理中の説明があり、現役は進捗が存在すれば完了と表示していた|APIの完了状態だけを完了とし、途中の説明は現在の進捗本文へ移す|状態の説明の置き方は司令塔へ報告。通常の完了画面/配置/CSSは維持|
|リッチメニュー編集の公開対象と確認|旧だけに登録のみの対象保持と、対象別の公開の確認があり、現役は対象未設定を全員へ変えていた|対象未設定を保持し、公開前は既存の共通確認窓へ対象別の説明を出す。日時/期間/すぐ公開の詳細は既存の補足のtitleへ移す|要件v6-12 §5-5の公開と条件・実機確認の動きを保持。確認窓と説明の置き方は司令塔へ報告。箱/並び/CSSは維持|
|リッチメニュー編集の未保存の条件と人数|現役は編集中の条件で数えるが、旧だけに保存状態と未保存人数の説明がある|既存の条件の補足と人数の補足へ最小で移す。空条件の公開案内は0人と明示し、形の手順では既存の「？」へ補足する|説明の置き方は司令塔へ報告。箱/並び/CSSは維持|
|リッチメニュー編集の公開予定の控え|旧だけに明示破棄時の控えの除去と、復元しても予約は未完とする離脱判断がある|現役の既存の未保存確認へ破棄処理を移し、入力したIDだけへ控えを書く。公開・予約成功の除去は保持|通常の中身/配置/CSSは維持。ブラウザの控えの扱いを司令塔へ報告|
|リッチメニュー作成の別店の選択除去|旧作成だけに前の店のタグ/テンプレートを外して知らせる動きがあり、現役には候補の絞り込みしかなかった|現在の全タブの面を既存判定で整理し、成功した同じ店の候補だけを使う。古い応答を捨て、別店の元下書きは保存しない|元の動作を保持。知らせは既存の帯へ最小で移し、通常の配置/CSSは維持。司令塔へ報告|
|リッチメニューのLINE側だけの削除|旧でも呼ばれない処理をソース契約が支えていた。要件v6-12 §7にはadmin以上の外部LINEメニュー削除がある|現役の取り込み画面の選んだメニューへ共通の「…」を足し、既存の確認窓とAPI・店の世代を使う。閲覧のみでは出さない|動作は要件に従い移行済み。追加操作の置き方は司令塔へ報告。通常の一覧/CSSは維持|
|自動処理の実行記録のCSV上限の事前案内|旧だけに5,000件を超えた時の事前の警告があり、現役には書出し後の件数案内だけがある|現在の案内の帯へ上限を超えた時だけ共通の警告を移す。書出し後の全件数/残り/絞込の案内は保持|要件v6-25の上限と解消方法の表明に沿う。5,000件の具体値と帯の置き方は司令塔へ報告。通常の配置/CSSは維持|
|自動処理一覧の削減時間|旧一覧だけに実行回数から求める削減時間があり、現役の帯には対応する置き場がない|現在の「？」へ同じ1回30秒の概算を移す。未取得は0にせず理由を示す|補足への置き方は司令塔へ報告。閉じた通常の配置/CSSは維持|
|自動処理下書きの飲食のきっかけ|共有の正本にある飲食8種類を旧編集は選べるが、現役の「すべて」の分類から落ちていた|現在の「友だちやお客さんの動き」の中へ正本の順で移す。通常の代表3種類は維持し、店の指定を保存しても消さない|全種類を開いた時の追加分の置き方は司令塔へ報告。通常の配置/CSSは維持|
|NENコラムの紹介文の一覧編集|?key=なしの既存の紹介文編集は現役V8と対応する採用済みの絵が無い|共通の詳細/段/入力/通知へ最小で移す。同じ取得/版付き保存/競合の最新別表示/未保存の離脱を保持し、閲覧のみでは保存を隠す|外枠の置き方は司令塔へ報告。動作を残して先へ進む|
|NEN配信の任意のマイル数|旧編集は1〜1,000,000の任意の整数を入力できるが、現役は決まった候補だけ。任意入力の採用済み配置は見つからない|現在の選択欄へ「ほかの数を入れる」を足し、共通の窓/数の欄で指定する。範囲外は変更も保存もしない。通常の欄/節/CSSは維持|窓への入口は司令塔へ報告。旧の動作を残して続ける|
|NENコラム作成の画像と分類の見本|旧作成の見本にあった画像/分類が現役の右欄では失われていた|画像か分類を入れたときだけ、同じ右欄の共通LINE表示へ一覧と同じ記事カードを出す。何も指定しない現在の見本/欄/節/CSSは維持|見本での画像/分類の見せ方は司令塔へ報告。旧の情報を残して続ける|
|NEN配信の旧概要の情報と操作|旧だけに注文/失敗等の全体の数字、紹介文→記事カードの見本、EC取り込みと待機分を送る操作があった。現役は入口から渡るヘッダー操作を使っていない|数字は既存の今月の補足へ、見本は既存の行末メニューから共通の窓へ、入口の操作は同じヘッダーの操作口へ引継ぐ。閲覧のみは変更操作を隠す。見本の名前も既存の代わりの値を使用|補足/窓/操作の置き方は司令塔へ報告。通常の表/列/CSSは維持|
|NENコラムの停止・再開|要件v6-21はコラム停止の判定を必要とするが、現役の一覧には切替の口がない。停止の採用済み配置も見つからない|既存の道具のメニューの中へ停止/再開を移し、同じ既存APIを呼ぶ。停止中だけ既存の共通帯で送れない理由を示す|メニュー内の操作の置き方は司令塔へ報告。通常の一覧の配置/CSSは維持|
|イベントのお客様表示の外枠|現役V8の対応する採用済みの絵が見つからず、旧カードと旧パンくずだけだった|共通の詳細・段・画像枠・表へ最小で移す。オンラインURLは本文もリンクも出さず、公開中の枠だけを見せる|外枠の置き方は司令塔へ報告。動作を残して先へ進む|
|イベント編集の外枠|既存の公開状態変更・状態再読込・変更影響/お客様表示/申込一覧への行き先は旧編集だけ。編集全体の現役V8と対応する採用済みの絵が見つからない|共通の詳細画面・数の帯・理由付き確認窓へ同じAPIで最小移行。入力フォームは次の小分けで移す|外枠の置き方は司令塔へ報告。動作を残して先へ進む|
|イベント作成の名前の即時検査・開催時間の下限|旧Wizardだけに名前を離れた時の検査と15分未満の保存停止があった|現役の既存の入力の誤りを出す口へ移し、名前255字/詳細20000字の送信前検査も保持。通常の中身/配置/CSSは変更なし|根拠のない下限を勝手に外さず、動作を残して司令塔へ報告|
|イベント一括追加の同じ長さへの分割|旧Wizardだけに時間帯を30/45/60/90/120分の枠へ分ける動きがあった。現役の作成は1枚で完了し、追加は編集で続ける|編集の一括追加窓に共通のチェックと日時/長さの欄を最小で移し、同じ既存の分割計算を使う。通常は従来の個別パターン入力を保持|分割の入口の置き方は司令塔へ報告。動きを残して先へ進む|
|イベント作成の見本の会場案内|旧見本だけにAPIが返した会場URLを開く口があった|現役の同じ会場名をURLがある時だけ外部リンクにした。見本の申込は無効のまま、公開も送信もしない|会場名へのリンクの移設は司令塔へ報告。窓の配置/CSSは維持|
|イベント申込記録の確認口|要件v6-29 §9-1の回答/通知予定/結果と、旧一覧の全状態/ページ送りが現役で不足。開く場所は採用済みの絵にはない|共通の開閉欄へ記録を最小で移した。開いたときだけ既存の予約一覧APIから選択中の開催回を取得し、回答/備考/同行者/通知と個別トークを同じ記録で確認する。残席/当日受付の履歴/待ちの見送りと、記録の承認・拒否・取消・参加印も同じ詳細へ移した|詳細の口の置き方は司令塔へ報告。既存の帯/表/配置/CSSは維持。動きを残して先へ進む|
|イベント作成の未選択案内|旧の作成枠だけにアカウントを選ぶ案内があった|現役の同じ知らせの場所へ案内を移し、未選択なら保存・公開を押せず通信しない|選択済みの通常の配置/CSSは維持。未選択の引継ぎを司令塔へ報告|
|イベント一覧の開催までの日数|旧一覧だけに申し込みが少ない回の日付と残り日数があった|既存の画面の説明の中へ同じ集計値と日数を移し、実描画で確認する|閉じた通常の配置/CSSは維持。補足への引継ぎを司令塔へ報告|
|ウェビナーの比較の中身と無い操作|旧比較だけにボタンの言葉があり、比較の処理が無いときは押し口を出さなかった|現役の比較の同じ表のセルへボタンの言葉を移す。共通の帯は比較する処理も比較先も無い場合は押し口を隠す|通常の配置/CSSは維持。比較窓の引継ぎと処理のない操作の除去を司令塔へ報告|
|ウェビナー公開前の設定概要|試験だけの旧概要には動画/公開/配信枠/申込数と、不足・未取得の理由があった|現役の既存の説明へ実値と理由をまとめて移す。公開可否は現役の公開前APIの検査で守る|閉じた通常の配置/CSSは維持。説明への引継ぎを司令塔へ報告|
|ウェビナー一覧の集計不能の理由|旧一覧だけに取得不能な指標の理由のまとめがあった|現役の既存の「？」へ指標ごとの理由を移す。同じ理由は一度にまとめ、別の理由は指標名を付ける|閉じた通常の配置/CSSは維持。補足への引継ぎを司令塔へ報告|
|ウェビナーの未入力プレビュー|試験だけの旧処理は動画なし/空のCTAなら見本を作らないが、現役は再生の見本と「ボタン」を出していた|動画なしは案内を出し、空のCTAは見本のボタンを出さない。設定済み動画の説明は既存の説明へ移す|未入力だけの表示を最小で引き継ぎ。通常の設定済みの配置/CSSは維持。司令塔へ報告|
|ウェビナー分析の詳しい数字|旧分析だけに項目ごとの到達人数と、視聴でいちばん離れた区間があった|現役の既存の畳んだ詳細へ同じ値を移す。§11/§18の分析を保ち、通常の配置/CSSは維持|詳細内の置き方は司令塔へ報告。動きを残して先へ進む|
|ウェビナーの申込フォームだけの競合|旧編集はフォームだけを最新版へ置き換えてCTA入力を残すが、現役はカードまで読み直して消していた|版付きのフォームを先に保存し、競合ならカードを送らない。フォームの競合ではカードを保持し、カード自身の競合だけ確認後にカードを置き換える|通常の配置/CSSは維持。確認の説明を対象に合わせた。司令塔へ報告|
|ウェビナー公開前のテストと監視の要約|旧確認だけにテストが全部通ったかの要約と監視の失敗件数があった。要件v6-10 §11の公開前確認を残す|現役の既存の説明の中へ値に連動する要約と件数を移した。閉じた通常の画面/配置/CSSは維持|補足の置き方は司令塔の確認待ち。動きを残して先へ進む|
|ウェビナー一覧の300msの検索|旧一覧の2件を実画面へ移すと、共通欄と一覧がそれぞれ300ms待ち600msになっていた|共通欄の300msへ一本化し、一覧側の2度目の待ちを外した。見た目/配置/CSSは維持|二重の待ちを直し、最後の入力から300ms後の1要求を確認。司令塔へ報告|
|ウェビナーの実ファイル名と通知の要約|旧編集だけに実ファイル名/種別/長さの照合と、通知の有効フラグによる要約があった。要件v6-10 §5/§11の動画と通知の確認を保つ|動画の既存の名前を実名にし、種別/実際の長さは同じtitleへ移す。通知の既存の補足の中へ4状態と有効フラグによる要約を移す。配置/CSSは維持|補足の置き方は司令塔の確認待ち。動きを残して先へ進む|
|ウェビナー編集の読む口と参加の補足|旧編集の参加者・分析・コメントへの口と、ライブ/録画・予約から来たかの確認が現役の設定から不足。要件v6-10 §11/§18の参加と分析を保つ|既存の「…」へ読む3項目を足し、変更の項目は権限で隠す。回数/ライブ/録画は既存の最終参加のtitleへ移す。通常の配置/CSSは維持|メニューと補足の置き方は司令塔の確認待ち。動きを残して先へ進む|
|運用状態の履歴の詳細|期間指定・同じ期間の集計/CSV・新しい変更10件/続き/未反映件数が旧履歴だけにあった。要件v6-32 §10の停止/復旧/配備/リリース内容の記録を保つ|現在の履歴タブの頭の操作欄へメニューを最小で足し、共通Dialog/期間Select/数の帯/表/CSVへ移した。現在の版の表と既存CSSは維持|詳細窓への入口と置き方は司令塔の確認待ち。動きを残して先へ進む|
|運用状態の解消済み通知|旧側には解消済みでも失敗した通知・未設定の通知先を再送する口があり、現役では解消済みの行を除外していた。要件v6-32 §6-3の解消と受領・通知の履歴を保持する|既存の異常欄に再送が必要な解消済みだけを残し、既存の札に解消済みを出す。通常の異常行・配置・CSSは維持。実際の健全性画面から再送する試験も追加|例外状態の置き方は司令塔の確認待ち。動きを残して先へ進む|
|ログインユーザーの状態の補足|旧一覧の名寄せ未確認と他人の二段階認証の状態の表示は現役で不足。招待期限は現役では行のtitleで確認する|名寄せ未確認を名前、二段階の状態を役割の既存titleへ移した。本人だけ二段階の操作があることは実際の行メニューで検査。招待の再送中も既存項目に送信中を出して二重送信を防ぐ|補足の置き方は司令塔の確認待ち。通常の行・配置・CSSは維持して動きを残した|
|統合ユーザー詳細の補足|旧詳細にあった採用元/確認日時/担当者/更新方法/版/状態/確からしさ/用途別の順位の表示が現役で不足。要件v6-03 §10の採用元と解除の履歴を確かめる動き|両方の現役の既存項目のtitleに補足を移し、友だちを開くリンクを既存の名前へ移した。0件の節だけ案内を補い、通常の列・配置・CSSは維持|補足と友だちへのリンクの置き方は司令塔の確認待ち。動きを残して先へ進む|
|統合ユーザーの友だち数|旧の帯にあった「紐付く友だち」の全体件数は現役の3枠にない。旧の集計の失敗/再試行/古い返答の守りも不足|集計の処理を共通のhookへ分け、両方の現役の集計へ接続。友だち数は既存補足のtitleと説明の中で確認し、失敗時だけ既存の枠で再試行を出す。正常時の配置・CSSは維持|件数の補足の置き方は司令塔の確認待ち。動きを残して先へ進む|
|行動スコアの補足|旧側にだけ前後の点数/実行者/自動か手動かと帯から友だち検索への口があった|現役の明細の既存行のtitleに前後/方法/担当者を移し、未取得も区別。既存の説明の中にマイルとの違いと同じ条件の友だち検索を残した。調整の追記/二重反映防止も既存の補足へ移した|補足の置き方は司令塔の確認待ち。通常の表/CSSは維持して先へ進む|
|マイル履歴の条件|開始日/終了日/5種類/3状態/方法を自由に指定する動きと、日付逆転/400で入力の直しを案内する動きが旧側だけにあった|現役の既存の絞り込みメニューから共通Dialogを開き、共通の暦/Selectで指定。URLに条件を残し、無効な期間は取得しない。通常の一覧の配置・CSSは維持|条件を選ぶ窓の置き方は司令塔の確認待ち。検索と入力エラーの動きを残して先へ進む|
|マイルの使い道|未交換人数・ランクの使い道の必要マイル/届く人数/交換済み人数・各使い道の届く人数が旧側にあり現役で表示不足|既存の数の帯の補足、渡るものの見出しと名前のtitleへ移した。人気の回数は未取得/0回を区別し、0回では名前を出さない|補足の口は司令塔の確認待ち。通常の配置・CSSを維持して先へ進む|
|マイル履歴|現役の「いつ・だれに」の列に発生日時がなく、旧側の日時確認と手動/確定待ち件数の確認が不足|名前のtitleへ日本時間の日時を移した。CSVにも同じ記録の日時を残す。件数は既存の補足のtitleへ移し、未取得と0を区別。通常の行の配置・CSSは維持|全文確認の口は司令塔の確認待ち。動きを残して先へ進む|
|友だちのマイル詳細|ランク未公開/最高到達/次のランクの区別、本人確認済みの接続先、付与回数の未取得が旧側にあり現役で表示不足|現役の残高の補足とトークを開く操作のtitleへ移し、未公開時だけ既存の使い道リンクを作成の案内にした。接続先はアカウント単位で重複を除く|補足の置き方は司令塔の確認待ち。通常の配置・CSSを維持して動きを残した|
|共通情報一覧|差し込みキーの全文コピーと、削除の窓で送信済みの利用先を分ける説明が旧の試験にあるが現役で不足。FM94Mの通常の行は名前だけ|コピーは既存の行メニューへ共通CopyTextButtonで移し、閲覧のみでもコピーだけ使えるようにした。送信済みの名前と「これから変わらない」は削除窓の既存の補足の形で表示し、差し込みを外すリンクとは分けた|口の置き方は司令塔の確認待ち。通常の管理者の一覧の行・配置・CSSは維持。動きを残して先へ進む|
|共通情報作成|空欄で保存できない種別の「必須」の印が旧VAR-06の検査にあるが、現役では入力検査だけで印が無かった|中身の既存FieldへCOMMON_VAR_VALUE_REQUIREDによるrequiredを渡した。標準/長文/数値/URL/画像の通常の見た目は変更なし|真偽/日付/日時を選んだ場合の印の置き方は司令塔の確認待ち。保存を止める動きは維持|
|共通情報編集|履歴の変更理由・影響の状態別の補足の置き方は現役の板に無いが旧の検査にある。履歴・変更前の確認はv6-14 §6の要件|既存の履歴と影響の説明のtitleで全文を確認できるようにした。標準の200字上限も既存の入力欄へ移した。使用先が送信済みだけのとき、未使用と表示せず「すぐ変わる使用先の文はありません」と区別|補足の置き方は司令塔の確認待ち。通常の配置・CSSを保ち、動きを残して先へ進む|
|マイル一覧|公開した版の内容・未公開の下書きの区別、平均残高の分母、ランク別人数と次の失効日時が旧側にあり現役で不足|公開版/下書きの参照を現役の行メニューと共通Dialogへ移した。平均の分母/0人の未計算は残高の帯の補足のtitle、ランクの人数/並び順/全体の失効額は現役の見出しのtitle、次の失効日は行のtitleで確認|補足と参照窓の置き方は司令塔の確認待ち。通常の配置・CSSは維持して先へ進む|
|予約メニュー作成|マイルの設定へ別タブで進むリンク。要件の連携表示は確認できるが、リンクの形は採用板QqER7にない|既存のマイル欄の見出しに共通TextLinkを最小で移した。元の画面を離れず入力を保持|司令塔の確認待ち。動きは残して先へ進む|
|予約メニュー編集|設備だけを独立して保存するボタンの形。必要資源と消費数・権限はv6-28 §7/§8/§17にあるが、独立保存の置き方は採用板QqER7で確認できない|既存の設備欄に共通の必要数入力と副ボタンを最小で移した。ほかの入力は保存しない|司令塔の確認待ち。動きは残して先へ進む|
|予約の受付枠|旧設備欄の利用件数（メニュー・予約・休業日）の置き方は採用板で確認できない|現役の設備名のtitleで件数を確認できるようにした。値が無いときは「—件」。一覧の配置は維持|司令塔の確認待ち。動きを残して先へ進む|
|予約の受付枠|旧「つながる先」の予約担当/ログインユーザーへのリンクの置き方は採用板に無い|既存の空き確認の「？」の中へ、共通TextLinkで移した。通常表示の配置は維持|司令塔の確認待ち。動きを残して先へ進む|
|シナリオ詳細|全体の対象条件の編集は要件v6-05 §4にあるが、V8では開く口が無かった。開始日時の即時確認も旧画面にだけあった|対象の編集を既存の頭の「…」へ最小で移した。開始日時は既存の「始めた記録を見る」のtitleで確認。通常表示の配置は維持|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|分析|参照切れの理由の確認と、削除（保管）が戻せないことの明示。既存の動作試験にあるが、現在のV8の説明口には不足|既存の未使用項目の数の「？」へ理由を渡し、既存の削除確認の説明に取消不可を足した。集計不能時の対象者作成もガード|口と文言の置き方は司令塔の確認待ち。動きを残して先へ進む|
|Webhook作成|保存失敗の生のAPI文面を運用者向けに言い換える動きは旧作成にあったが、現役V8では不足|既存の失敗欄を共通の保存失敗文へ接続し、403・5xx・通信失敗の立て直しを残した。配置は維持|動きは旧の試験に従って保持。通常の画面の変更なし|
|重複検出|集計と候補の両方が失敗した時の一括再読込と、候補403の権限案内は旧画面にあったが、現役V8の失敗欄では不足|既存の候補取得失敗の題を403だけ権限案内にし、既存の再試行から集計も無ければ両方を取り直す。配置は維持|案内の置き方は司令塔の確認待ち。動きを残して先へ進む|
|成果地点一覧|金額を記録する成果地点の件数と、前の30日の実件数の確認が旧の動作試験にあるが、現役V8の数の帯で不足|既存の帯の補足のtitleへ移した。未取得を0件と見せない。通常の文・数値・並びは維持|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|成果地点作成|起点に合う対象の説明と集計対象アカウント固定の説明の確認は旧の動作試験にあるが、現役の説明口で不足|既存の起点見出しと固定アカウント名のtitleへ最小で移した。通常の文・配置・CSSは維持|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|フォーム編集|名前欄を離れたときに空欄を知らせる動きは旧の動作試験にあるが、現役V8では保存時だけになっていた|現役の名前欄のonBlurと既存の名前エラーに接続した。通常の文・配置・CSSは維持|動きを残して先へ進む。根拠と置き方は司令塔の確認待ち|
|フォームの見た目設定|開いた時点のテーマ/カードへ戻す、テーマ全体を初期化する、誤った色コードは消さずエラーを出す動きが旧の試験にあるが現役で不足|既存のリンク設定窓に2つの戻す操作を移した。フォームの色だけ共通ColorWellのretainInvalidInputを使い、通常の色選択/配置は維持。色の決まりは既存の説明のtitleへ移した|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|管理画面の二段階認証|管理画面向けの現役V8が無く、旧V7だけにブランド/メール・LINEの方法/約30秒の説明/戻りリンクがあった|現役V8の6桁入力へ管理画面の用途を足し、既存の補足の形で方法・ブランド・戻りリンクを移した。運営の通常の文・配置・CSSは維持|管理画面側の補足の置き方は司令塔の確認待ち。動きを残して先へ進む|
|Webhook記録|成功率・平均時間・対象期間・遅れの補足、再送対象外/結果不明/受け取り失敗の内訳の確認が旧の契約にあるが、現役V8の帯で不足|既存の数の帯の補足のtitleへ移し、通常の文・件数・列は維持。旧符号の日本語訳も不足分だけ言葉の共通変換へ移した|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|Webhook受け取り口|複数一致から人を選んで結び付ける口、閲覧者への依頼案内、見本の差し込み名/日時/50項目で省略したことの確認が現役V8で不足|既存の候補欄に各候補と共通ボタンを移し、権限が無ければ依頼案内。既存のマスク済み見本のtitleで差し込み名・日時・省略を確認。通常時の配置は維持|口の置き方は司令塔の確認待ち。動きを残して先へ進む|
|Google Sheets|止まった同期から復旧できる案内と、解除するアカウント名の確認は旧の動作試験にあるが、現役V8で表示が不足|既存のV8 Noticeに止まった同期だけの案内を移し、既存の解除窓の説明に対象名を入れた。通常表示の配置は維持|案内の置き方は司令塔の確認待ち。動きを残して先へ進む|
|リマインダ確認|差し込み値のテスト値と本番の取得元の確認は旧画面にあったが、採用済みの確認板には置き場所が無い|現在の送信先表示のtitleへ、本文にある対応済み差し込みだけの値/取得元を移した。通常の配置は維持|口の置き方は司令塔の確認待ち。動きを残して先へ進む|

- **友だち完了**：タグの含む/除外、一括操作の手順、集計、一覧の大量行表示をV8固定。旧属性を置いてもV8の行の窓が動く。V7でだけ描いたページ送り外側の件数を削除（V8の帯の件数を保持）。
- 未使用の写し `app/friends/identity-candidates/identity-candidates-v8.tsx` と `app/friends/migrations/migrations-v8.tsx` を削除。台帳の読む試験1/2ファイルを現役入口へ移し、CSV/UIDの権限・失敗・読み直し・実行の検査を保持。
- 共通VirtualRowsのテーマ分岐も一覧の依存として削除。窓の計算・焦点のある行を保持・少ない行の全表示の試験は保持。消した試験0件。旧テーマ全描画1件を旧属性でもV8の窓を使う試験に更新。
- 関係313/313件合格（`/tmp/v7rm2-friends3.json`）。共通Buttonの利用先台帳から削除済みの4ファイルだけを除いた（前のダッシュボード・受信箱を含む）。
- 台帳にある友だちの読み手34試験ファイルも再検査し275/275件合格（`/tmp/v7rm2-friends-readers.json`）。web型検査・差分検査合格。


### 予約：日の来店印（完了）

- 人の予約の現役入口 `app/booking/bookings/page.tsx` の日表示・軸「一覧」に、採用B-1 `lS8qh` の予約行と印を移した。時間×スタッフの盤の配置は変更しない。
- 来店は行の「来店した」で直接付ける。遅刻は分数を選択、来なかったは「…」の中。取消と通知の「元に戻す」も接続。成功時は予約・印・集計・空き枠を取り直す。
- 人の既存API `getToday(mode:staff)` / `postVisitMark` / `deleteVisitMark` のみ使用。席予約の来店処理は使わない。連打・失敗・権限・取得失敗の読み直し・対象切替後の古い返事を保護。
- 使用されない `app/booking/bookings/booking-day-v8.tsx` と専用CSSを削除。直接読む試験は台帳どおり1ファイル4件だった。動作2件を現役V8へ移し、遅刻・通知の取消・連打・失敗・対象切替・権限・取得失敗の6件、実際の予約入口から操作する1件を追加。
- **消した試験2件**：使われない写しの「5枚の集計・時刻順・空き待ちの箱がある」「人/席の札がある」の外見固定。現役の予約盤を旧写しの骨格へ戻す検査になるため削除。来店・来なかったを付ける動作の試験は削除していない。
- メニュー・担当・営業時間の一括切替では旧編集窓の読み手が153件失敗したため、その未完了の変更だけを戻し、再開用差分を `/tmp/v7rm2-booking-menus-staff-migration.patch` に保存した。失敗した状態はコミットしない。以後は設定の中でも小さく切り替える。
- 確認：予約全体457/457件合格（`/tmp/v7rm2-booking-day-final.json`）、追加した入口の試験3/3件合格（`/tmp/v7rm2-day-integration2.json`）、web型検査合格。最終の全体・画像検査は未実施。
- 残り：予約メニュー・担当・営業時間→配信等の各機能→共通部品/CSS/CI→全体の最終検査。


### 予約：担当スタッフの追加と編集（完了）

- スタッフ追加を現役 `v8/booking-staff/staff-new.tsx` へ固定。旧フォームと使用されない `app/booking/staff/new/staff-new-v8.tsx` の写しを削除。V8本体の配置・内容の変更なし。編集窓の保存中表示もV8固定。
- 削除前の直接読み手：旧入口8試験ファイル、旧写し1試験ファイル（未保存ガードの分類表）。分類表から写しの重複行だけを外し、現役V8の離脱ガード検査を保持。
- APIの試験にはパンくず・ルーター・スマホ見本用の担当一覧の口を追加。候補は実物のV8の選択窓で操作し、保存値のtrim、入力エラー、割当だけの再試行で二重作成しない、取得失敗の読み直し、入力保持、権限、離脱確認の試験を保持。旧文言をV8へ更新。消した試験0件（累計2件）。
- 確認：担当スタッフ関係・共通の台帳検査を含む130件、web型検査。残りは予約メニュー・勤務/営業時間から再開する。


### 予約：担当メニューの一括割当（完了）

- 入口を現役 `v8/booking-menus/assign.tsx` へ固定。旧割当表と読まれない `app/booking/menus/staff/assign-v8.tsx` を削除。直接読む契約は台帳の旧入口4/旧写し1ファイルを確認してから移した。
- 停止中の担当の割当保持、受付できないメニューの警告、料金の区別、升目の変更と選択した升の時間/料金、閲覧のみ、保存・取消・通知から元に戻す、取得失敗と読み直しを現役V8で保持。旧表の人数の列・旧文言・保存帯の骨格の固定をV8の実際の入力・警告へ書き換えた。試験削除0件（累計2件）。
- 旧画面にあった403後の読み直しも、V8の既存の失敗欄の口に移した。権限の再設定後は画面を捨てずに取り直せる。根拠のない新機能の追加はなし。
- 関係31件合格（`/tmp/v7rm2-assign3.json`）、web型検査合格。画像照合は最終工程。残りは予約メニュー・勤務/営業時間と、他の機能・共通部品/CSS/CI。


### 予約：メニュー作成（完了）

- 入口を現役 `v8/booking-menus/menu-form.tsx` へ固定。旧作成フォームと読まれない `app/booking/menus/new/menu-form-v8.tsx` を削除。削除前に旧入口8/旧写し3試験ファイルを確認。
- タグ取得の遅延中の入力保持、候補のアカウント・整理済み境界、実物のV8窓の検索/選択/解除、アカウント切替、保存値、タグ削除時の選び直し、担当だけの再試行・失敗した担当のみ再実行・作成キーの再利用と切替・取得失敗/権限・離脱確認の試験を保持。
- V8の既存の「予約を受けたときにすること」に、旧画面にしかなかった通知・リマインドの説明を移した（要件v6-27 §の連携処理の見える化）。既存のマイル値はそのまま。マイル設定の別タブリンクも最小で移し、上の「司令塔に確認」に記録。
- 旧プルダウンの外見契約・文言を現役V8の選択窓へ更新。価格（問い合わせ/無料/固定）と店舗ルールを継承するnullの送信を実物の保存3件で追加確認。試験削除0件（累計2件）。
- 予約全体と関連する共通台帳の検査480件、web型検査。残りはメニュー一覧/編集、勤務/営業時間、それ以外の機能・共通部品/CSS/CI・最後の画像/全体検査。


### 共通契約の追従（予約3入口・受信箱）

- web全試験の中間確認は12,422件中7件失敗。すべて、移行済みの予約3画面・受信箱を旧V6/V7の文字や骨格へ戻す契約だった。V8本体と共通の型の接続・現在の文言へ書き換え、削除0件（累計2件）。入口だけを読むボタンの契約も現役本体まで読むようにした。
- 関係178件合格（`/tmp/v7rm2-global-contract.log`）。画面本体の変更なし。
- Worker中間確認は10,938件合格、統括テンプレート5件が5秒の時間切れ。失敗ファイルを単独で再実行して55/55件合格（`/tmp/v7rm2-worker-r2-repeat.log`）。最終工程では全試験を負荷を抑えて再実行する。
- 次は予約メニュー一覧/編集の動きをV8へ移して試験を合わせる。全体の最終検査はまだ完了していない。

### 予約：メニュー編集の設備（動きの移行完了・入口の切替は次）

- 現役V8の既存設備欄へ、必要数・設備だけの独立保存を移した。作成時の設備の並びは変えない。要件はv6-28 §7/§8（必要資源と消費数）・§17（資源設定の権限）。ボタンの形は上の確認表へ記録。
- 連打の単一要求、版つき保存、1〜1000の整数検査、409/通信失敗時の入力保持と再試行、旧アカウント応答の排除、閲覧のみ、停止済み/候補から消えた設備の保持と解除を維持。他の入力を勝手に保存せず、他の未保存変更の離脱確認も残す。設備だけを保存した後は保存済みとして扱い、次の版を送る。
- 旧編集窓の4件と同じ動作を現役V8で確認し、必要数の不正値・再試行・未保存境界・版更新・停止済み設備を含め13件を追加。旧入口の試験は入口切替時に移すため今は残している。試験削除0件（累計2件）。
- 予約関係と共通契約684/684件合格（`/tmp/v7rm2-resources-all2.json`）、web型検査・差分検査合格。実装SHA `dc0e40d5ca`。台帳追記のコマンドが失敗したため、直後の文書コミットで記録を補った。
- 次：メニュー一覧/編集入口とタグ・ルール・版管理の試験をV8へ移し、旧一覧と写しを削除。その後は勤務/営業時間・他の機能・共通部品/CSS/CI・最終検査。

### 予約：メニュー編集の使えないタグ（動きの移行完了）

- 整理済みや別アカウントの設定済みタグを、V8でも黙って「なし」に変えず、元の名前と使えない理由を出す。既存の選択窓から選び直し・解除できる。通常の候補・作成画面の配置は変えない。
- 旧編集窓の動作6件を現役V8の実物の選択窓で再現し、保存値・対象アカウントの候補・切替・整理済み/別アカウントの警告・候補なしを確認。旧入口の試験は切替時に移すため残している。試験削除0件（累計2件）。
- 予約関係と骨格の共通契約690/690件合格（`/tmp/v7rm2-menu-edit-tags3.json`）、web型検査・差分検査合格。メニュー一覧/編集入口の切替とルール・版管理の移行は次。全体の最終検査は未完了。

### 予約：メニュー一覧・編集・設定入口（完了）

- メニュー一覧の入口を現役 `v8/booking-menus/settings.tsx` に固定。旧一覧・編集窓と、描かれない旧設定の写し・分割タブ・携帯見本・旧担当詳細の写し（計13ファイル）を削除。現役V8の配置や並びは変更していない。
- 削除前の読み手は、旧一覧10試験ファイル（宣言111件）、設定の写し4ファイル（37件）、連携の写し2ファイル、支払い/担当詳細の写しは未保存ガード分類表各1、携帯見本0。CSSの読み手1も現役へ移した。現役のガードと利用先一覧を保持し、重複した旧写しの行だけ除いた。
- 旧編集窓の設備4件・使えないタグ6件は、前の区切りで追加した現役V8の実操作試験へ移したため、旧一覧の試験42件を32件へ整理した。**動作試験の削除は0件、累計の削除は外見固定の2件のまま**。離脱確認・焦点・価格・店舗設定の継承・版管理・競合・読み直し・並べ替え/失敗後の再試行・ページ送りを現役の操作で保持。
- 予約ルールの保存中にアカウントを切り替えた際の古い応答を排除し、空の選択値を0分と誤保存しない保護を現役に移した。旧画面にあった動作を維持する変更で、通常表示は変更しない。
- 旧V6/V7の文言・節・色を固定した契約は、現役V8の入口と共通の型・採用済みの色を確認する契約へ同じ件数で書き換え。関係746/746件合格（`/tmp/v7rm2-menu-entry-all2.json`）、web型検査・差分検査合格。
- 次は勤務/営業時間。それ以外の機能・共通部品/CSS/CI・全体試験と前後の画像比較は未完了。push・PR・D1・配備は実施していない。

### 予約：営業時間・設備・休業日の動作移行（完了・勤務入口の切替は次）

- 旧店舗営業時間の実操作30件を、現役V8の予約設定の受付枠/休業日タブへ移した。曜日別の複数区間・重複/日またぎの拒否・版つき保存と読み直し・離脱確認・旧アカウント応答の排除・設備の編集/停止/削除/再試行/連打・休業日編集/削除/競合/権限・日時指定の空き確認を保持。削除0件（累計2件）。設備追加中のアカウント切替の動作1件を追加。
- V8にも既にある操作は現在の窓・行の「…」で確認。設備の書きかけは編集窓の共通の破棄確認を通してから、保存済み設備の状態だけを変える。取消ボタンを共通の操作段へつなぎ、本文側から破棄確認を飛び越えないようにした。
- V8に無かった、保存中の対象切替後の旧応答排除、営業時間の競合後の読み直し、設備読込失敗からの再試行を移した。空き確認の担当別の残数表示は要件v6-28の空き/残数の表示に従って既存の結果欄へ移した。設備利用件数は上の確認表へ記録。
- 関係691/691件合格（`/tmp/v7rm2-hours-all1.json`）、追加後の実操作31/31件合格（`/tmp/v7rm2-hours-added.json`）、web型検査・差分検査合格。
- 残りは勤務入口・旧担当詳細・旧携帯見本の読み手の移行と削除。その後は予約以外・共通部品/CSS/CI・最終検査。旧勤務入口は、この区切りではまだ残している。

### 予約：勤務入口と旧担当詳細・携帯見本（完了）

- 勤務入口を現役 `v8/booking-staff/shifts.tsx` に固定。旧店舗画面・担当詳細・携帯見本・重複した空き不可理由の実装を削除。担当IDがあると担当勤務、管理者の指定なしは予約設定の受付枠、スタッフの指定なしは本人の解決へ進む現在のV8を維持。
- 台帳の直接読む7試験ファイルに加え、パスを部品として組み立てる読み込み状態/画面名の2ファイルも確認して現役へ移した（合計9）。本人勤務の二経路の取得失敗と紐付けなしを区別・再試行、勤務/休憩/日別/外の予定のAPI・版管理・権限・入力保持・日時の扱い・14日の枠の再取得を保持。
- 旧携帯見本の外見固定「カレンダーなら月の表が7列」1件を削除。描かれない見本の骨格へ戻す要求になるため。ほかの7件は実LIFFの契約と現役V8のデータ・未取得/空きなしの区別・読み直しの実操作へ更新。**削除累計3件（すべて未使用画面の外見固定）、動作試験の削除0件**。
- 現役の読み込みと共通の画面名の契約も更新。関係696/696件合格（`/tmp/v7rm2-shifts-all2.json`）、web型検査・差分検査合格。画像の前後比較は最終工程。次は配信等の機能と残る未使用の写し、その後は共通部品/CSS/CI・全体検査。

### 全体試験の中間確認：予約メニュー（修正完了）

- web全試験12,441件中11件失敗。10件は旧一覧の横スクロール/操作配置/期限表示/順位交換APIを固定した契約だった。現役V8の縮む名前欄・狭い板の列の省略・共通の並べ替えと版つき一括保存・期限の人間向け表示へ同じ件数で更新。削除0件（累計3件）、動作試験の削除0件。
- 残り1件は設備だけの保存で入力欄へ理由を返す処理が不足。必要数をAPIの設備番号に結び付け、入力保持・訂正・同じ版での再試行を実操作1件で追加確認。通常表示の配置は変更しない。
- 関係試験・web型検査・差分検査合格（`/tmp/v7rm2-global-contract3.json`、`/tmp/v7rm2-global-contract3-type.log`）。全体の最終検査は引き続き未完了。

### 一斉配信：旧詳細・予約完了・携帯見本（完了）

- 入口は既にV8固定。現役の中身は変更せず、未使用の詳細/予約完了/携帯見本とCSSの計5ファイルを削除。削除前の読み手は詳細5ファイル（宣言18件）、予約完了2（9件）、携帯見本0。
- 競合時だけの帯・最新の読み込み・下書きのテスト送信・送信後はテスト操作を出さない、の4件を現役V8の実物へ移した。現在の共通帯のボタンと権限確認済みの土台を使う。試験削除0件（累計3件）。
- 利用先一覧から削除した2行を外し、もう検査対象にならない宛先部品の角丸例外を外した。共通工程で、角丸検査の入口を「V8の写し」から「V8に固定した入口」へ広げる必要がある。試しに広げると予約/受信箱の残る旧本文・窓7規則が拾われたため、旧本文の整理後に再点検する（宛先部品も再び対象になる）。
- 関係418/418件・web型検査・差分検査合格（`/tmp/v7rm2-broadcast3.json`、`/tmp/v7rm2-broadcast-type.log`）。全体検査・共通/CSS/CI・画像比較は未完了。

### シナリオ配信：未使用のV8の写し（削除完了・旧詳細は次）

- 初通/方式/詳細/結果の未使用の写し4本とCSS4本を削除。台帳の読み手は順に2/1/5/1試験ファイル（宣言18/12/43/17件）。組み立てたCSSパスと細かい板の契約も削除前に確認。
- 詳細の開始/停止/試算の準備待ち/複製の失敗/読み直し/閲覧のみ、結果の購読操作/確認キー/失敗した購読の再送/取得失敗の区別は現役へ移した。数の帯の名称・共通の型・CSSのトークン接続をV8に合わせ、試験の削除0件（累計3件）。現役V8の中身は変更しない。
- 共通の未保存分類・角丸・APIエラー文の旧写しの行だけ除いた。共通の競合検査は現役詳細へ移し、現役の未保存ガードを保持。利用先一覧から削除した4行を除いた。
- 関係492/492件合格（`/tmp/v7rm2-scenario-copies1.json`）、型検査：`/tmp/v7rm2-scenario-copies-type.log`。次は未使用の旧詳細 `scenario-detail-client.tsx` の実操作2ファイルと契約の移行。旧詳細はまだ残している。

### シナリオ配信：旧V7詳細の削除（完了）

- 未使用の旧詳細本体を削除。削除前の読み手19試験ファイル（宣言136件：契約17ファイルと実操作2ファイル）。旧APIエラーの例外・未保存分類・共通利用先の行を外し、現役V8のガードを保持。
- 保存後の試算更新3件・経過時間/遅延の編集プレビュー2件を現役V8の実物へ移した。同時購読は既存の鉛筆の窓で変えて保存し、取り直し中は旧人数を出さず、遅い旧応答を捨てることを保持。対象の絞り込みを既存の「…」から開けるようにし、フォルダ取得中/失敗中の変更を止める旧保護も移した。
- 旧V6/V7の帯・表・専用編集画面・ノードID・文言は、現在のV8の段・行内編集・共通の未取得表示・権限・APIへ同じ件数で書き換え。削除した試験0件（累計3件）、動作試験の削除0件。開始日時の確認は上の確認表へ記録。
- 関係635/635件合格（`/tmp/v7rm2-scenario-old-contract4.json`）。型検査：`/tmp/v7rm2-scenario-old-type.log`。画面の配置・並び・CSSは変更していない。次はリマインダ等の残る機能、その後共通/CSS/CI・全体試験・画像比較。

### リマインダ：使われないV8の写し（完了・旧編集と登録者は次）

- 基本設定・編集・詳細の写しと詳細CSSの計4ファイルを削除。削除前の読み手は基本3試験ファイル（宣言20件）、編集5（21件）、詳細1（10件）。組み立てたパスの契約も現役へ移した。
- 保存衝突の比較・最新の読み込み・次の版での再保存と、1152/1440の通知編集の動作を現役V8で確認。フォルダ作成の権限・取得失敗後の再試行・未保存ガードを保持。試験削除0件（累計3件）、動作試験の削除0件。
- 関係301/301件合格（`/tmp/v7rm2-reminder-copies4.json`）、web型検査・差分検査合格。現在の画面の中身・配置は変更していない。次は旧編集の複数通/テスト送信と旧登録者の動作移行。全体検査は未完了。

### リマインダ：旧V7編集・テスト送信の削除（完了）

- 未使用の旧編集/テスト送信本体を削除。削除前の読み手10試験ファイル（宣言54件）。複数通の編集10件・差し込み3件・403/429の実描画3件・テスト送信9件を現役V8へ移した。試験削除0件（累計3件）、動作試験の削除0件。
- 追加/最終1通の削除禁止/並べ替え・全通保存/版IDと時刻/競合/離脱確認、差し込みカーソル/保存文字/見本、宛先未設定/取得失敗/設定へ進む/再確認/古い応答排除/同じキーで再送/成功後の別キー/窓内の失敗と成功時の消去を保持。V8は宛先が未設定なら送信を止めるため、設定済み宛先が送信直前に外された422を再現して再試行を確認。
- V8に失われていた403/429の理由と再読み込みを既存の失敗欄へ移した。差し込みの値と取得元は既存の送信先表示で確認できるようにし、実操作1件を追加。口の位置は上の確認表に記録。外見契約は現在の型の狭い幅と140pxの時刻欄へ同じ件数で更新。
- 関係305/305件合格（`/tmp/v7rm2-reminder-old-all2.json`）、web型検査・差分検査合格（`/tmp/v7rm2-reminder-old-type.log`）。現役V8の配置・並び・CSSは変更していない。次は登録者管理の旧部品を整理。共通/CSS/CI・全体検査・画像比較は未完了。

### リマインダ：旧登録者部品の削除（完了）

- 未使用の登録者部品と実行履歴のCSSを削除。削除前の読み手は登録者2試験ファイル（宣言11件）、CSS0。現役詳細の登録者タブを直接描いて、友だち側で登録した結果の表示・名前/版番号つきの基準日保存・取消/取消後の版での再開・0件/失敗の区別・アカウント切替・配列以外の拒否・日本時間を確認。
- 現在のV8は基準日を変えたときだけ保存ボタンを出すため、UTCの01:00を日本の10:00と表示→10:30を選ぶ→UTCの01:30を送る実操作で端末の時間帯に左右されないことを確認。旧V7の時/分の選択は、現役のV8の時刻欄で確認。試験削除0件（累計3件）、動作試験の削除0件。
- 現役の中身・配置・APIは変更していない。利用先一覧から削除した1行を外した。関係305/305件合格（`/tmp/v7rm2-reminder-registrants-all.json`）、型検査・差分検査合格。次は分析など残る機能。共通/CSS/CI・全体検査・画像比較は未完了。

### 分析：入口と旧V7本体（完了）

- 入口を現役V8だけに固定し、旧V7の集計画面・グラフ・一覧・編集を削除。ファネルの編集/作成と結果保存の現役スロットはそのまま残した。レポート作成の見出しもV8固定。
- 削除前に旧入口の読む試験21ファイル・174ケースを確認。追加で使われない二段ナビ/成果レポートの写しも確認し、どちらも読む試験0件・製品の呼び口0件で削除。Search Consoleが使う見出しとCSSは保持（同機能の工程で整理する）。
- 期間のAPI引数、URL状態で絞った全件CSV、ファネル3種の対象者POST、先頭/次の段、定義版/副条件を保つ保存、停止/再開/取消不可の削除、権限、競合、アカウント切替と遅延応答排除、集計待ち/再接続、未取得の数、固定結果/定期レポート/検索の動作試験をV8の操作へ移した。削除0件（累計3件）。
- 棒の読み上げは、現役の共通グラフのボタン名が実際の日付/時間/人数を持つことを確認。旧クラス・ノードID・文字寸法の契約3件は現役V8の共通部品/値へ同じ件数で移行。検索は共通部品の300ms待ち後に確かめる。
- 参照切れの理由と削除の取消不可を既存の説明口へ最小で移した（上の確認表）。集計不能の結果からは対象者を作らない。保存結果のCSVは既存の履歴の書出し口を保持し、新しい配置は足していない。
- 関係235/235件合格（`/tmp/v7rm2-analytics8.json`）、web型検査合格。未使用写し2件を削除した後の利用先契約を含む再検査も合格してからコミット。共通/CSS/CI・全体検査・画像比較は未完了。

### 通知：旧V7一覧（完了）

- 削除前に旧入口を読む2試験ファイル・6ケースを確認。V8入口へ固定して旧一覧を削除。複数機能で使う閲覧見出しの板の印もV8固定。
- 403/429、単件既読の503/失敗応答で未読と数を戻す、再試行の成功、まとめて既読、アカウント切替後の失敗を捨てる動作試験は保持。旧ボタンは現役V8のリンクへ移し、行き先URLも確認。削除0件（累計3件）。
- 未読先・新しい順の動きを旧一覧から引き継いだ。APIの通常の新しい順の応答では表示は変わらない。行・見出し・本文の構成はそのまま。
- 関係89/89件合格（`/tmp/v7rm2-notifications3.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### 共通アクション：旧V7と未使用V8写し（完了）

- 削除前の読者は一覧8ファイル52ケース・作成3ファイル24ケース・版4ファイル25ケース。未使用のV8写し3件は2/1/1ファイル・18/8/8ケース（失敗文/離脱監視の台帳）で、製品の呼び口が無いことを確認して削除。
- 一覧・作成・版をV8固定。選択肢503後の再取得と未保存入力の保持、真の0件との区別、版公開の409/参照更新理由・再取得後の理由の保持・再試行成功、月次件数のみの失敗でも版と利用先を読む試験をV8へ移した。動作試験の削除0件。
- 件数のためだけに共通アクションをもう1度全取得しない旧契約を現役V8にも引き継いだ。タブの件数は一覧が返す集計を使う。ほかの機能のタブは従来の取得を保持。マニュアルは現在の共通上部バーの正本URLから開くことを確認。
- 旧見出し・タブ・6列の固定幅を守る契約3件はV8の型・タブ・縮める名前列へ同じ件数で移行。試験削除0件（累計3件）。現役の中身・列順・配置は変更していない。
- 関係130/130件合格（`/tmp/v7rm2-common-actions5.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### Search Console：旧V7本体（完了）

- 削除前の入口の読者2ファイル・6ケースを確認してV8固定。403だけを閲覧権限の案内にし、通信断/500/429/失敗応答は読み直せることを現役V8で確認。削除した試験0件（累計3件）。
- 最後の呼び口が消えた分析の旧見出し（読者0件）・CSS（読者1ファイル7ケース）を削除し、不要になった形の例外を整理。現役の中身・配置は変更していない。
- 共通アクションの旧写し削除で分岐編集の形の例外も検査対象から外れた。現役の旧編集には部品が残るため、共通検査の対象を固定入口へ広げる工程で、使われる部品を再照合する（先のbroadcastsと同じ検出範囲の課題）。
- 関係24/24件合格（`/tmp/v7rm2-searchconsole2.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### はじめの設定：旧V7本体（完了）

- 削除前の旧入口の読者3ファイル11ケースを確認してV8固定。進捗を実物から判断する計算・6段の完了条件の試験は保持。読み込み失敗を共通部品へ渡す口・再読込の契約は現役V8へ読み先を移した。試験削除0件（累計3件）。
- 現役の中身・配置・APIは変更していない。関係56/56件合格（`/tmp/v7rm2-started1.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### プール管理：旧V7一覧・作成（完了）

- 削除前の一覧の読者8ファイル42ケース、作成の読者3ファイル17ケースを確認してV8固定。使われない旧CSS（読者0件）も削除。試験削除0件（累計3件）、動作試験の削除0件。
- 旧作成窓のラベルの実描画4件は現役の作成画面へ移した。項目名と入力欄の結び付き・説明がラベルに混ざらないこと・入力例を保持。旧単一選択の文字契約は、現役の複数選択の読み上げ名へ更新。説明の場所・保存列のV6指定の契約はV8の共通部品へ同じ件数で移した。
- 機能が無効ならAPIを呼ばない/403の共通案内、作成・削除・外す際の二度押し禁止/失敗理由/成功時だけの画面遷移、所属の読み直し/失敗を0件と見せない/選択を保持、未発行URLの案内を維持。現役の中身・配置・APIは変更していない。
- 関係61/61件合格（`/tmp/v7rm2-pools4.json`）、web型検査・差分検査合格（`/tmp/v7rm2-pools-type.log`）。共通/CSS/CI・全体検査・画像比較は未完了。

### ページが見つからない案内：旧V7本体（完了）

- 削除前の旧入口を直接読む試験0件を確認してV8固定。現役の題・説明・前へ戻る/ダッシュボードの導線は変更していない。試験削除0件（累計3件）。
- 現役V8とページ名の関係試験合格、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### 重複検出：旧V7本体（完了）

- 台帳の旧入口の読者8ファイル51ケースを確認してV8固定。現在のV8の候補・集計の別々の失敗欄を使い、権限不足の理由と両方を取り直す動きを最小で移した（上の確認表）。通常の画面・配置・並びは維持。
- 実描画10件で、集計だけ503/403でも候補が残ること、未取得の内訳を0と見せないこと、回復時に内訳が戻ること、両方失敗時の読み直しを確認。旧の件数行はV8では51件以上だけ表示するため、総数18組を確認し、存在しないページ範囲は要求しない。
- 旧の表・指標カード・影の文字契約は現役V8の見出し/数の帯/トークンへ同じ件数で更新。専用見出しは既存の12個の監視を保持。試験削除0件（累計3件）。前の見つからない入口の利用先1行も整理。
- 関係62/62件合格（`/tmp/v7rm2-duplicates3.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧V7一覧・6タブの分岐（完了）

- 台帳の旧入口の読者20ファイル127ケースを確認。送る/受け取る/記録/API接続/Google Sheets/見本を現在のV8へ固定し、旧一覧・作成窓・切替・鍵更新・削除の本体を削除。現在のV8の各画面は変更していない。旧作成の入口と未使用の写しは次の区切りで整理する。
- 6タブの旧テーマの否定試験は、旧属性でも現在のV8が出る回帰検査へ同じ件数で更新。重複切替を止める行ごとの印/送信中の理由/失敗時の戻し/成功時の読み直し/アカウントと世代の照合/秘密値の消去、削除の二度押し/窓内の理由/取消不可/既定の記録保持を現役V8の処理で確認。
- 作成の権限・見本のリンク・入力の項目別エラー・タブの実件数の実描画は保持。URLの試験は現在の受け取り口を選んで、共通の省略表示の読み上げ名にある完全なAPIのURLを確認。選択中のタブはボタン、ほかはリンクなので両方を対象にした。
- 旧部品名を固定するソース契約を現役の処理へ移し、試験削除0件（累計3件）。旧見本から専用作成へ進む1件も保持。使われなくなった旧ページ/部品の利用先を整理。
- 関係219/219件合格（`/tmp/v7rm2-webhooks7.json`）、web型検査・差分検査合格（`/tmp/v7rm2-webhooks-type2.log`）。Webhook作成・写し、共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧V7作成（完了）

- 台帳の旧作成の読者6ファイル26ケースを確認し、現在のV8へ固定。旧作成約400行を削除。入力検証5件・未保存3件の実描画は現在の入力欄と操作へ移し、動作試験を保持。
- 現役V8では送る種類を明示で選ぶため、送信成功/405失敗を調べる試験では実際に「すべて送る」を選ぶ。見本の既知/未知、種類の正本、受け取り口の種類、秘密の鍵、離れた欄の検証/まとめ/先頭誤りへの移動の契約を現在のV8へ同じ件数で移した。旧テーマ属性の否定はV8固定の検査へ更新。試験削除0件（累計3件）。
- 405のAPIエラー文をそのまま出す不足を、既存の失敗欄から共通の保存失敗文へ接続して解消。下書き作成後の停止失敗/停止だけの再試行の既存試験も合格し、現在の入力や配置は保持。
- 関係224/224件合格（`/tmp/v7rm2-webhookcreate3.json`）、web型検査・差分検査合格（`/tmp/v7rm2-webhookcreate-type.log`）。次はWebhookの使われない写し。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：使われない一覧・API接続の写し（完了）

- 削除前の製品の呼び口0件を確認（API接続の写しから一覧の写しへだけ依存）。一覧の読者4ファイル21ケース、一覧CSS1ファイル4ケース、API接続とCSSは読者0件。2写しと2CSSを削除。
- 旧CSSの数の帯の余白/題/表見出し/検索幅4件は、現在の共通の帯・表・検索幅へ同じ件数で更新。現役の題は共通V8の13pxであり、旧写しの12pxへ戻す検査は残さない。1152の伸縮する名前列/固定するほかの列の検査は現役を直接読む。試験削除0件（累計3件）。
- 現役の内容・配置・CSSは変更していない。関係234/234件合格（`/tmp/v7rm2-webhookcopies3.json`）、web型検査・差分検査合格。次は旧API接続/Sheets/記録のパネル。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧API接続パネル（完了）

- 削除前に製品の呼び口0件、試験の読者1ファイル6ケースを確認。旧パネルを削除し、6件すべてを現役V8で実操作する試験へ移した。試験削除0件（累計3件）。
- 正常/0件/通信失敗と再試行/機能停止を区別。鍵の発行は現役の窓から名前を入力し、対象アカウントへ送信、平文の1回表示と閉じた後の消去、入れ替え確認/停止確認と実際のAPI要求を確認。閲覧権限の実描画試験は既存の現役V8のものも保持。
- 現役の画面・配置・APIは変更していない。関係213/213件合格（`/tmp/v7rm2-tokenpanel3.json`）、web型検査・差分検査合格。次は旧Sheets/記録/受け取り詳細のパネル。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧Google Sheetsパネル（完了）

- 削除前に製品の呼び口0件、試験の読者2ファイル16ケースを確認。14件の実描画と2件の期限付き読込の契約を現役V8へ移し、旧パネルを削除。試験削除0件（累計3件）。
- 接続・出力先設定・同期・期限切れ・権限・OAuth結果・不正応答の再読込・解除確認・Google側取消失敗・記録だけ失敗時の復旧・止まった同期・保存成功と読込失敗の区別・アカウント切替の応答破棄と窓の消去を保持。不足した案内と対象名は上の確認表に記載。
- 関係208/208件合格（`/tmp/v7rm2-sheetpanel3.json`）、web型検査・差分検査合格。次は旧記録/受け取り詳細。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧送信/受信の詳細パネル（完了）

- 削除前に製品の呼び口0件、台帳の読者10ファイル60ケースを確認。旧2パネルを削除。未照合の実描画7件は現役V8へ移し、500・403・409・閲覧権限・取得失敗・51件・0件の検査を保持。試験削除0件（累計3件）。
- 旧の設定メニューのキー/焦点/外側/Escapeの契約は、現役が使う共通ActionMenuへ移した。試し送信は送り先確認・完全URL・結果の読取・成功Toast・閉じられる失敗帯・アカウント照合を保持。個別取得失敗で一覧を失わない/受信と送信の別々の取得と回復/集計/再送可否/マスク済み見本の検査も保持。
- V7の初期並びは固定せず、現役の名前/回数の並びと送信中を失敗扱いしない判定を検査。V7の空状態の文字は、現役の最初の作成操作へ更新。複数候補の選択と見本の確認は不足した動きとして上の確認表に記載。通常の画面の並びは変更していない。
- 関係221/221件合格（`/tmp/v7rm2-overviews3.json`）、web型検査・差分検査合格。次は旧やり取り記録。共通/CSS/CI・全体検査・画像比較は未完了。

### Webhook：旧やり取りの記録・CSS（完了）

- 削除前に製品の呼び口0件、台帳の読者5ファイル34ケース・CSS1ファイル6ケースを確認。旧記録とCSSを削除。試験削除0件（累計3件）。
- 結果不明の単体再送は相手先確認とconfirmed=trueを保持。一括では除外した件数/残件/続きの案内、成功だけToast・残件は消せる失敗帯を保持。本人の役割とAPIでの権限/選んだアカウントと読込世代/遅い応答の破棄/再送中の解除/取得失敗を0件と見せない/受け取りの試しを実受信と混同しない検査を現役へ移した。
- 旧V6の4指標・KNG00・1180で列を隠す形・ListRangeの部品名は現役V8の数の帯/板Uv9AA/伸縮する名前列と1行省略/実件数と範囲へ同じ件数で更新。詳細DA0AgではF-18の伏せ字の本文だけを読むことと、URL/秘密値を表示しない検査を保持。通常の画面・CSSは変更していない。補足の不足は上の確認表に記載。
- 関係257/257件合格（`/tmp/v7rm2-interactions4.json`）、web型検査・差分検査合格（`/tmp/v7rm2-interactions-type2.log`）。Webhookのブラウザ試験は最終工程でV8の実操作へ移す。共通/CSS/CI・全体検査・画像比較は未完了。

### 成果地点：旧V7一覧（完了）

- 台帳の旧入口の読者22ファイル132ケースを確認し、V8へ固定。旧一覧約1800行を削除。紹介者/送り元を含む旧タブURLは引き続き成果とアフィリエイトへ送る。旧作成と写しは次の区切りで扱う。
- 編集は現役の専用ページへ実際に進み、開いた版/409競合/200の失敗応答/空の名前/起点に合う金額/空のOR/URL/計測期間/保存後の読み直しを確認。窓を待つ旧試験は、移動を記録して実際の編集ページを描く共通の土台へ移した。閲覧/本人確認の待ち/失敗/停止済みのときに操作を出さない検査も保持。
- 一覧と集計の別々の失敗と再試行、0件と未取得の区別、遅い旧アカウントの再試行の成功/失敗を捨てること、キャッシュせず先頭5000件までcursorをたどること、検索/並び/CSV/作った行の強調を保持。旧数の帯の不足2項目は上の確認表に記載。
- 旧停止窓の形・ノードIDは現役V8の3択欄へ更新。理由が空なら押せないこと、影響取得中/二度押し/権限の禁止、3操作の応答/失敗/版/実際の利用件数/取消後に記録を残す検査は保持。共通の折畳み/件数部品名の契約はV8の帯/実件数と範囲に同じ件数で移した。試験削除0件（累計3件）。
- 関係211/211件合格（`/tmp/v7rm2-conversionlist8.json`）、権限の操作名の確認も再検査、web型検査・差分検査合格（`/tmp/v7rm2-conversionlist-type2.log`）。次は成果地点の旧作成と未使用の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 成果地点：旧V7作成（完了）

- 台帳の読者12ファイル86ケースを確認し、旧作成を外して現役V8へ固定。試験削除0件（累計3件）。保存前の試算・実IDの利用先・同名確認の失敗/再試行・アカウント固定/切替・空のORで保存しない/条件を入れて保存・未保存確認を保持。
- 旧V6のノード属性・長い選択肢・固定窓の形の契約は現役の板j8p3yj/起点と金額の対応表/詳細設定/利用先を選ぶ窓へ同じ件数で移した。権限は本人確認の土台を追加して現役の編集権限で検査し、候補の空200/403/失敗/部分失敗を分けたまま残した。
- 起点に合う対象説明と固定アカウントの説明は現役の既存の文字のtitleへ最小で移した。通常の文字・配置・CSSは変更なし。要件や絵との採用判断を必要とする補足として司令塔へ確認（R41/DETAIL-17の動きの維持）。
- 成果地点130/130件合格（`/tmp/v7rm2-conversionnew3.json`）、共通の未保存/用語/件数の関係検査は163件合格、共通Buttonの削除済みの利用先を一覧から外して再検査合格。web型検査・差分検査合格（`/tmp/v7rm2-conversionnew-type.log`）。次は成果地点の未使用の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 成果地点：未使用の一覧・窓・CSS（完了）

- 削除前に現役からの呼び口0件を確認。旧一覧の数字の直接読者は1ファイル2ケース、旧CSSも同じ1ファイル2ケース。旧窓への残存参照は既に現役の窓を読む契約と注記のみ。旧一覧・旧窓・専用CSS3枚を削除し、削除済みの共通Button/用語/未保存/負債/専用CSSの一覧行も除いた。
- 表の行余白と共通の見出し2件は現役V8のCSSと正本の変数へ移し、見た目を旧写しへ戻すことなく同じ件数で確認。現役の内容・配置・CSSは変更していない。試験削除0件（累計3件）。
- 関係152/152件合格（`/tmp/v7rm2-conversioncopies1.json`）、web型検査・差分検査合格。次は回答フォーム。共通/CSS/CI・全体検査・画像比較は未完了。

### 回答フォーム：集まった回答（完了）

- 台帳の読者7ファイル32ケースを確認し、現役V8へ固定。旧一覧/詳細/まとめ約890行を削除。試験削除0件（累計3件）。通常のV8の中身・配置・CSSは変更なし。
- 後処理の403/500/通信断/日本語の理由、取得403では再試行を出さず一覧へ戻る、検索語を一覧とCSVの全ページに同じ値で渡す、済み/未完/記録なしを分ける動作を保持。最初のまとめから回答のタブへ進む操作と編集権限の土台に試験を移した。CSVのダウンロードが試験環境でblobへ遷移することだけを止め、実際のAPI要求とCSV内容の別試験は保持。
- 共通Button/Paginationの削除済みの利用先と、解消済みの旧文言の例外を除いた。関係74/74件合格（`/tmp/v7rm2-formresponses6.json`）、web型検査・差分検査合格。次はフォーム編集。共通/CSS/CI・全体検査・画像比較は未完了。

### 回答フォーム：旧V7編集（完了）

- 台帳の読者11ファイル64ケースを確認し、現役V8へ固定。旧編集約1800行を削除。試験削除0件（累計3件）。名前欄を離れた空欄チェックだけを既存のV8へ移した（上の確認表）。通常の内容・配置・CSSは保持。
- 下書き保存/公開確認/更新1回＋公開1回、壊れた選択肢/URL/期限は要求を送らない、プレビューの即時反映、カード画像のhttps/trim/取消とnull保存、403/500/通信断の日本語の案内、409で同じ中身なら保存済み・違えば競合/読み直しを保持。成功は現役の共通Toastを実描画し、競合の帯と出口は現役の共通部品で確認。
- 旧タブリンクは別URLへ移動して破棄したが、現役は要件§3の同じ編集ページの状態で入力を保つため、タブを往復して入力保持→離脱で確認/破棄へ同じ1件を更新。キャンセル/編集を続ける/破棄後の再移動の4件は保持。旧のPreview/Inspectorの属性、ノードWOPjZ、狭幅の印は現役のスマホ/入力/足す口のrating・address/板ITBABへ更新。見た目の印は画像合格の証拠には数えない。
- 未保存の番兵を現役へ移し、削除済みのButton/負債/browser promptの例外を除いた。関係182/182件合格（`/tmp/v7rm2-formedit6.json`）、web型検査・差分検査合格。次は旧フォームのデザイン設定部品。共通/CSS/CI・全体検査・画像比較は未完了。

### 回答フォーム：旧デザイン設定部品（完了）

- 削除前に製品の呼び口0件、直接読者2ファイル17ケースを確認。使われない旧部品406行を削除。17件は現役の受付と見た目を実際の親の状態へつなぐ共通の試験の土台に移した。試験削除0件（累計3件）。
- 色コードの1文字編集/無効なら反映しない・残して直す/blurとEnterの確定、5色だけのおまかせ/全体の初期化/開いた時点へカードも戻す、文字と背景の差の警告、窓のEscape・焦点復帰・Tab巡回を保持。元に戻す試験は実際にカードの見出しを変えてから初期値へ復元することを確認。リンクの3欄の親への反映/初期値/窓内で本保存しない/すべての操作の接続/メディア・書体・角の丸みも保持。
- 旧の全画面設定窓/戻るURL/常設の色コード欄は、現役のリンク設定窓・ColorWell・書体と角の丸みの操作へ更新。通常のV8の文・配置・CSSは変えず、不足した戻す操作と無効コードの案内だけ移した（上の確認表）。共通ColorWellのほかの利用先の無効コードの扱いは変更なし。
- 関係196/196件合格（`/tmp/v7rm2-formdesign2.json`）、復元を強めた11件も再検査合格（`/tmp/v7rm2-formdesign-reset3.json`）、web型検査・差分検査合格。次は二段階認証。共通/CSS/CI・全体検査・画像比較は未完了。

### ログイン：二段階認証の旧V7（完了）

- 台帳の読者5ファイル16ケースを確認。旧V7の認証画面約140行を削除し、現役V8の6桁入力へ固定。認証前に管理画面/運営の用途を判断し、合言葉を二度取り込まない。試験削除0件（累計3件）。
- 6桁入力時の送信/通信断/誤コード/回数制限/入力消去、合言葉なしでは要求を送らずログインへ戻す、メール/LINEの方法と再読込時の保持、セッションの保存/運営への戻り先と権限確認/成功の印を保持。旧V7を選ぶ外見の試験は属性が残ってもV8を出す見張りへ同じ1件を更新。旧の2列の見た目の固定はV8の縦並び/幅100%へ同じ1件を更新。
- 運営の通常の画面の文・配置・CSSは変更せず、管理画面だけの不足した補足は上の確認表に記載。関係48/48件合格（`/tmp/v7rm2-twofactor3.json`）、web型検査・差分検査合格。次は登録メディア。共通/CSS/CI・全体検査・画像比較は未完了。

### 登録メディア：旧V7一覧（完了）

- 台帳の読者17ファイル130ケースを確認し、現役V8へ固定。旧一覧約1750行を削除。通常のV8の内容・配置・CSSは変更なし。試験削除0件（累計3件）。
- 使用先を確認できないと選択/削除しない、一括/単体削除の影響再照合・版・遅い応答の破棄・選択中アカウント・二度押し、保管/復帰の理由必須・409の読み直し・担当者の禁止、詳細URLの戻る/進む/再読込を保持。詳細の口は現役の行メニュー、保管の棚は「よく使う絞り込み」へ移した。
- 検索/種類/上限/保管/フォルダの0件と未取得を分け、総数は絞り込み前の数を維持。容量は一覧の取得失敗とは別に取得し、帯の容量の欄に12%の実値が残ることを確認。名前変更/削除のフォルダ操作は現役の共通部品のAPI・権限・確認窓を読む。旧V6/V7のノード・配置を守る試験は現役の板O7hUt7/共通道具欄/空の一覧へ同じ件数で更新。
- 関係393件は共通利用先の最終修正を含め合格（`/tmp/v7rm2-media6.json`の登録メディア等388件＋`/tmp/v7rm2-media-design7.json`の5件）、web型検査・差分検査合格。次は使われない一覧と窓の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 登録メディア：使われない一覧・窓・CSS（完了）

- 削除前に入口からのimport経路を調べ、下記7実装の製品の呼び口0件を確認。旧一覧の読者は初期台帳3ファイル26ケース。窓の直接の動作試験は検査停止の帯1ファイル2件、詳細3ファイル18件、プレビュー1ファイル3件、容量案内1ファイル4件、差し替え2ファイル5件。加えてソース契約・共通の例外表の読者を確認し、現役の読者へ更新してから約4100行を削除。

| 対象 | 削除した旧実装 |
| --- | --- |
| 一覧とCSS | `app/contents/list-v8.tsx`・`list-v8.module.css` |
| 検査停止の帯 | `app/contents/file-scan-stopped-banner.tsx` |
| 詳細・プレビュー | `app/contents/media-detail-dialog.tsx`・`media-preview-overlay.tsx` |
| 容量・差し替え・登録 | `app/contents/media-quota-guidance.tsx`・`media-replacement-dialog.tsx`・`media-upload-dialog.tsx` |

- 版の互換性/未確認なら未使用と見せない/同意と期限の保存/版ごとの取得、51件の候補の検索/次ページ/古い応答の破棄/部分実行、プレビューのEscape/焦点の復帰/Tab巡回/閉じる操作、容量stateと検査停止の表示を保持。モックも現役のアップロード口へ移した。操作の日本語と共通窓の閉じる名前だけ現役へ更新。試験削除0件（累計3件）。
- 消した実装の共通Button/未保存/文言/CSS/カードの例外行を除き、写しを両方直すという古い注記も整理。現役の描画・CSSは変更していない。関係424/424件合格（`/tmp/v7rm2-mediacopies2.json`）、web型検査・差分検査合格。次は共通情報。共通/CSS/CI・全体検査・画像比較は未完了。

### 共通情報：旧V7一覧（完了）

- 台帳の読者15ファイル150ケースを確認し、現役V8へ固定。旧一覧約1450行を削除。試験削除0件（累計3件）。作成・編集・未使用の一覧の写しは次の区切り。
- 削除の使用先を窓を開けてから読む/キーと理由が揃うまで禁止/未確認の禁止/別アカウント・対象・世代の応答破棄/409の再読込/差し替え候補と版、まとめ削除の失敗だけ残す/二度押し/閉じる禁止/20件上限を保持。名前・件数・消える物・残る物・取消不可も保持。削除の印は現役xxKtWへ同じ件数で更新。
- フォルダ503/403は一覧と空欄警告を消さず、一覧403/503は未知の数を0と見せず、再試行後は実数へ戻す検査を保持。現役の列統合/共通道具欄/型の1100px未満の折畳み/空の一覧へ外見の契約を更新。日時のJST/中身と次回予約の整形/省略した内容の全文確認は保持。
- 不足した全文コピーと送信済みの利用先の説明は上の確認表に記載。コピーの全文・成功・一時表示を実操作で確認し、閲覧のみのメニューでは変更項目が無いことを確認。共通ActionMenuの既存のcontent口を描くようにし、コピー結果をその場で表示。通常の管理者の一覧の内容・配置・CSSは保持。
- 関係270/270件合格（`/tmp/v7rm2-varslist6.json`）、送信済みを分ける実描画を強めた6件も再検査合格（`/tmp/v7rm2-varslist-historical7.json`）、web型検査・差分検査合格。共通/CSS/CI・全体検査・画像比較は未完了。

### 共通情報：旧V7作成（完了）

- 台帳の読者5ファイル40ケースを確認し、現役V8へ固定。旧作成約730行を削除。試験削除0件（累計3件）。
- 期間と代替値の保存/同じ時刻の禁止/長文5000字・真偽・日付・日時の保存と再表示、URL/画像URL/代替値の型検査、400の理由/409のキー欄への焦点/通信失敗、社内メモの保存と再表示、秘密値の日本語の検知と通常文の誤検知防止を保持。警告から入力へ戻る/アカウント切替で古いメモを送らない/未保存のキャンセルで確認と破棄の検査も保持。
- 旧ラジオのinput/value、登録ボタン、一覧へ戻るリンクは現役の8種のradioボタン/保存して公開/キャンセルへ更新。本人が編集できるという土台を追加して実際の権限判定で保存を検査。中身の必須の印だけ不足として上の確認表へ記録。通常の文・配置・CSSは変更なし。
- 番兵と共通Buttonの利用先を現役へ整理。関係243/243件合格（`/tmp/v7rm2-varsnew3.json`、共通メニュー15件も含む）、web型検査・差分検査合格。次は共通情報編集。共通/CSS/CI・全体検査・画像比較は未完了。

### 共通情報：旧V7編集（完了）

- 台帳の読者5ファイル76ケースを確認し、現役V8へ固定。旧編集約1500行を削除。試験削除0件（累計3件）。
- UTCから日本時間へ戻す/期間と代替値/長文・日付・日時/社内メモの再表示、型違いの保存禁止と入力の近くの理由、フォルダ503・予定404でも本体と履歴を消さない/欄だけ再読込、予定を追加・削除しても入力中の名前・値・メモを消さない検査を保持。日時は現役の数値入力、予定は現役の窓と削除の確認・入力の破棄の確認へ更新。
- 影響の未取得と0件/取得権限/文字数超過/変更先と送信済みの区別、競合で入力を消さず版だけ読み直す検査も保持。旧「1件ずつ見る」画面への案内は現役の3行と展開へ、古い保存完了の帯は共通の一時通知へ、同じケースで更新。不足した初回の履歴の理由/200字上限/影響の補足は上の確認表へ記録。
- 成果地点・外部連携・メディア・共通情報・プール作成・フォーム編集の共通の骨格検査にも、消した旧画面の語と節が残っていたため、同じ2ケースずつを現役の入口と共通の型への接続へ更新。動きの検査は各機能で保持。描かれない旧影響確認はPaginationの利用先から外した。
- 関係455件のうち454件合格（`/tmp/v7rm2-varsedit6.json`）、最後の予定キャンセル1件を含む4件も修正後合格（`/tmp/v7rm2-varsedit-schedule7.json`）。web型検査・差分検査合格。通常の配置・CSSは変更なし。次は使われない一覧の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 共通情報：使われない一覧・窓・CSS（完了）

- 削除前に入口からのimport経路を確認し、`app/contents/vars/list-v8.tsx`・`list-v8.module.css`・`export-panel.tsx`・`impact-review.tsx` の製品の呼び口0件を確認。初期台帳の一覧の読者5ファイル25ケースに加え、CSV窓7件・影響の集計5件・影響のソース契約と共通の例外表を確認。
- 一覧の期限切れの絞り込み/件数/更新と予定の全文確認、CSVの依頼・進捗・完了・失敗・期限切れ・再生成・未選択の禁止、送信済みをCSVに混ぜない/状態の数は未取得と0件を分ける/口の数を優先する検査を現役へ移した。試験削除0件（累計3件）。
- 旧影響窓の集計は現役の補足のtitleへ、行ごとの文字数と超過の印は現役の変更後の文のtitle/data属性へ移した（通常の配置・CSSは維持）。ソース契約を死んだ窓で支えないようにした。旧CSSの6件は現役の列幅と共通の数の帯・行の型の値へ更新。
- 関係372件のうち371件合格（`/tmp/v7rm2-varscopies1.json`）、最後の更新日時の表示1件を含む3件も修正後再検査。web型検査・差分検査を確認してコミット。次はマイル。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7一覧（完了）

- 台帳の読者20ファイル146ケースを確認。旧一覧約1250行を削除し、5タブの現役V8へ固定。試験削除0件（累計3件）。新規・編集・友だち詳細・未使用の写しは次の区切り。
- 101件を全頁取得し、全IDを一括で並び順の口へ1回送る（実WorkerとSQLite）、店を切り替えたあとの旧2ページ目の成功/失敗の破棄、公開は確認したときだけ版とヘッダーを付けて1回送る/取消/409の再送禁止を保持。その他操作の名前・件数・下へ動かす操作は現役へ更新。
- 承認待ちの通信断は本体を消さず再試行/依頼の再表示、検索の自動取得と再計算でも条件の保持、選んだ店のルールCSVの取得、失効とランク/平均の分母/未取得と実数を分ける検査も保持。既定タブの違いは試験で残高タブを明示。旧カード/横スクロール/タブの骨格は現役の共通Tabsと列の型へ同じ3ケースで更新。
- 公開した版の参照・平均の根拠・ランクと失効の補足を最小で移した（上の確認表）。公開版の参照と平均625の根拠、次の失効日時を現役の実描画でも確認。通常の配置・CSSは変更なし。
- 関係417件のうち414件合格（`/tmp/v7rm2-mileagelist4.json`）、最後のソース契約3件を含む174件も修正後合格（`/tmp/v7rm2-mileagelist5.json`）、停止失敗の通知の検査を実際の関数へ絞った33件も合格（`/tmp/v7rm2-mileagelist6.json`）。web型検査・差分検査を確認し、補足の実描画も再検査してコミット。次はたまる決めごと作成。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：たまる決めごと作成の旧分岐（完了）

- 台帳の読者2ファイル13ケースを確認し、入口を現役の作成へ固定。旧の作成の写しは後の区切りで利用先を照合して消す。通常のV8の中身・配置・CSSは変更なし。試験削除0件（累計3件）。
- 名前の入力欄を現役のer-nameへ更新し、未入力のキャンセルでは確認しない/入力後は確認して残ると保持/破棄すると一覧へ進む3件を保持。共通の番兵の利用先も現役へ整理。
- 関係44/44件合格（`/tmp/v7rm2-mileagenew2.json`）、web型検査・差分検査合格。次は決めごと編集。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：たまる決めごと編集の旧V7（完了）

- 台帳の読者2ファイル22ケースを確認し、現役の編集へ固定。旧編集約390行を削除。通常のV8の内容・配置・CSSは変更なし。試験削除0件（累計3件）。
- 前のルールの遅い取得で現在の入力を上書きしない/名前とマイルの入力ミスは口を呼ばず欄で知らせ最初の欄へ移る/下書きだけを版付きで保存して公開中の内容は変えない検査を保持。共通の番兵とButtonの利用先を現役へ整理。
- 関係25/25件合格（`/tmp/v7rm2-mileageedit2.json`）、web型検査・差分検査合格。次は友だち別のマイル詳細。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：友だち別詳細の旧V7（完了）

- 台帳の読者2ファイル12ケースに加え、共通の内部ID/マイル契約/部品利用先の検査を確認。旧詳細約490行を削除し、現役へ固定。使われない詳細と調整窓は次の区切りで消す。試験削除0件（累計3件）。
- 友だちIDと選択アカウントでの取得/対象未指定と404と通信断の案内/内部IDを出さない/調整の権限と通知再送・確定待ちの操作の検査を保持。未公開ランク/最高到達と接続先の未取得/0件/重複、付与回数の未取得を現役の補足へ移し、実描画の2ケースも追加。通常の配置・CSSは変更なし。
- 関係71/71件合格（`/tmp/v7rm2-mileagefriend4.json`）、web型検査・差分検査合格。次はマイルの使われない写しと旧窓。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：使われない作成・使い道編集の写し（完了）

- import経路を確認し、製品から呼ばれない `app/mileage/earning-rules/new/v8-earning-rule-new.tsx`（490行）と `app/mileage/rewards/edit/v8-reward-edit.tsx`（555行）を削除。初期台帳に拾われなかったv8-接頭辞の写しも追加確認した。

|削除する写し|機能の契約を直接読む試験ファイル|宣言ケース数（ファイル全体）|ほかの分類表|
|---|---|---:|---|
|決めごと作成|mileage-audit-541 / mileage-v6 / earning-rules-v6|3ファイル35件|用語・APIエラー・未保存ガード・Button利用先|
|使い道編集|mileage-audit-541 / rewards/edit/reward-form|2ファイル20件|未保存ガード・Button利用先|

- 機能の契約は現役の入口へ読む土台で接続済み。使い道の数の入力/版付き保存/公開前確認/共通アクション/交換テスト/条件保存、決めごとの条件/途中失敗の片付け/未保存の確認を保持。削除した試験0件（累計3件）。旧作成のCSSは現役の決めごと編集がまだ使っているため残した。
- マイル全体と分類表を含む291/291件合格（`/tmp/v7rm2-mileagecreatecopies1.json`）、web型検査・差分検査合格。次は詳細・調整窓の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：使われない友だち詳細・調整窓（完了）

- 製品からのimportが0件の詳細（697行）・V8調整窓の写し（452行）・旧V7調整窓（397行）を削除。旧窓の読者は調整の失敗8件・score-rules契約7件・mileage契約18件に加え、角丸/APIエラー/Button/設計負債の分類表を確認してから移した。詳細とV8調整窓は分類表だけが直接参照。
- 失敗の言い分け、承認境界の未設定で依頼先を分ける、理由と元の記録/通知/有効期限/残高不足の入力検査、変更前後の確認、冪等キー、別オーナー承認と通知の再送を現役へ接続。旧窓の別確認画面の骨格は、現役の同じ窓内で変更前後を確認する形へ更新。試験削除0件（累計3件）。
- 関係278/278件合格（`/tmp/v7rm2-mileagefriendcopies1.json`）、web型検査・差分検査合格。次は旧一覧の各タブ。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：5タブの実描画試験を現役へ（完了、写しの削除は次）

- 古いV8一覧のタブを直接描いていた9試験ファイル30ケースを現役の5タブとMileageShellへ移した。古い頭の操作のコールバックを採集せず、現役の画面のCSVボタンをそのまま操作。関係全体266/266件合格（`/tmp/v7rm2-mileagetabretarget4.json`）、web型検査・差分検査合格。
- 止めているだけの絞り込み/公開前の操作/複製は停止中の下書き/件数を殻へ伝える/申請者と日時/CSVの数式無害化・同じ件数でも新しい表を使う・店の切替中や取得失敗中は出さない・保存の失敗後も一覧を残して再試行を保持。履歴の追加集計取得はモックをlimitで分け、店の切替と絞り込みの動作を削らず確かめた。
- 固定された旧の骨格は、現役の30日帯・日本時間の日時・説明ボタンで開く補足・利用できる「すべて」だけのフォルダに同じケースで更新。失われた履歴日時は名前のtitleへ移した（上の確認表）。試験削除0件（累計3件）、通常の配置・CSSは変更なし。
- 旧V7タブを直接描く交換の再送試験と、旧V7を読むソース契約は次に移す。その後、未使用の一覧と各タブ/CSSを消す。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：使われない旧V8一覧・5タブ・CSS（完了）

- 製品からのimportが0件の旧一覧（152行）と5タブ（604/939/536/900/1197行）・専用CSS（729行）を削除。入口に到達しないだけでなく、試験に残っていた相互参照も切り終わってから削除。

|削除対象|削除前に移した実描画試験|その他の読み手|
|---|---|---|
|旧V8一覧・決めごと|止めている絞り込み1件、表・操作・件数を含む6件|Button/未保存ガード/用語/APIエラー/設計負債の分類表|
|残高|絵合わせ3件と殻の件数1件（上の6件に含む）|Button/用語/APIエラー/設計負債の分類表|
|履歴|絵合わせ3件、CSVの切替・失敗3件|Button/APIエラー/設計負債の分類表|
|使い道|絵合わせ・操作・複製・CSVの6件、CSVの店切替と失敗3件、殻の件数1件（上の6件に含む）|Button/設計負債の分類表|
|行動スコア|絵合わせ3件、CSV1件|Button/未保存ガード/設計負債の分類表|
|専用CSS|直接読者0件|CSS予算の分類表|

- 先の区切りで9ファイル30ケースを現役へ移して合格済み。今回の試験削除0件（累計3件）。関係293/293件合格（`/tmp/v7rm2-mileagetabcopies1.json`）、web型検査・差分検査合格。次は旧V7の交換再送と各契約。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7だけにあった交換再送の安全処理（完了）

- 旧V7の本物のReactによる交換再送12件を現役の使い道へ移した。同時に押した3クリックを1回へまとめる同期の旗、使い道/交換の取得を別々に守る札、店の世代の比較と再送後の各取得前の確認が旧側だけにあったため、現役へ移した。
- 製品が使う側の守りの関数に純粋な試験も移し、前の店の遅い一覧/再送の成功と失敗の後着を現役の実描画で検査する3件を追加。店を替えたら再送の旗を降ろし、切替後の店を古い応答で読み直さないことを確認。返却で最後の行が消えた後も返却完了の通知を残す。
- 回数とページ送りの文を現役に更新し、理由/最終日時/確認中/失敗だけの一覧/未選択の取得禁止/25件の2ページ目/失敗後の再試行/返却完了の案内を保持。試験削除0件（累計3件）。通常の行と配置・CSSは変更なし。これは再送・失敗時・再取得の要件の引継ぎ。
- マイル全体269/269件合格（`/tmp/v7rm2-mileageretry3.json`）、web型検査・差分検査合格。旧V7のソース契約を現役へ移して各タブを消すのは次。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7の使い道一覧（完了）

- 旧V7一覧646行と、現役へ写した旧の再送の守り117行を削除。読者は使い道のソース契約・入力/保存/公開の契約・Issue947の復帰/調整の契約・実描画の交換再送・純粋な守りの試験とButtonの分類表を確認して現役へ移した。前の区切りの再送の試験は現役で合格済み。
- 未取得の人数/引換コードを0にしない、種類の日本語訳、下書き、応答の形と権限、停止から復帰、失敗/確認中だけを並べる、ページ送り、返却結果の案内、二重再送と店の世代・各取得の守りを同じケースで保持。未交換人数/ランクと届く人数の不足は既存の補足のtitleへ移した（上の確認表）。
- 人気の回数が未取得の場合を0回と分け、0回の名前を人気として出さないことを実描画でも追加確認。消した試験0件（累計3件）。通常の行・配置・CSSは変更なし。
- 関係274/274件合格（`/tmp/v7rm2-mileagerewardlegacy1.json`）、追加の0件区別を含む48/48件も合格（`/tmp/v7rm2-mileagerewardlegacy2.json`）、web型検査・差分検査合格。次は旧V7の履歴と行動スコア。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7だけにあった履歴の条件指定（完了、旧タブは次に削除）

- 日付の純粋な検査と逆転/400の配線の契約を現役へ移した。現役で不足していた開始日・終了日・種類・状態・方法を指定する口を既存の絞り込みメニューと共通Dialog/DateField/Selectへ最小で移し、通常の列・配置・CSSは維持。口は既存の履歴API、条件はURLで保持。
- 無効な期間では一覧と集計を取得せず、日付の直し方を出す。400も通信障害の再読み込みへ誘導しない。実物のカレンダーで10月1日→11月1日へ直して種類/状態/方法をAPIへ渡す、逆転のまま確定したら両欄で理由を出して取得しない、400では入力を直す案内とCSV禁止、の3件を追加。動作試験の削除0件（累計3件）。
- マイル全体273/273件合格（`/tmp/v7rm2-mileagehistoryperiod5.json`）、条件指定を選んだ状態の表示も再検査（`/tmp/v7rm2-mileagehistoryperiod6.json`）、web型検査・差分検査合格。旧履歴の他のソース契約と残る旧スコアは次。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7の履歴一覧（完了）

- 旧履歴361行と現役へ移した期間検査21行を削除。マイル契約・監査契約・内部IDの検査とAPIエラー/文言/Buttonの分類表を削除前に確認し、現役の履歴と板の接続へ移した。
- 理由必須/日本語の種類と状態/記録の日時/CSV/内部IDを出さない検査を維持。手動と確定待ちの件数は既存の補足のtitleへ移し、未取得と0件を分けた。店が未選択なら履歴と集計を取得しない動きも現役で実描画検査を追加。通常の配置・CSSは変更なし。
- 関係302/302件合格（`/tmp/v7rm2-mileagehistorylegacy3.json`）、web型検査・差分検査合格。消した試験0件（累計3件）。次は旧V7の行動スコア。共通/CSS/CI・全体検査・画像比較は未完了。

### マイル：旧V7の行動スコア一覧・調整・明細（完了）

- 製品から呼ばれない一覧357行・調整184行・明細123行を削除。削除前にマイル契約/監査契約/Issue947/IDEA17/帯の引継ぎの5ファイルの読者とButton分類を確認。旧のノード/窓名/別確認段の骨格を、現役の板と窓の接続・同じ窓内の変更前後の確認へ更新した。
- 保存/理由必須/冪等キー/権限/選択アカウントの取得/失敗の案内/CSV/採点済みだけを友だち検索と配信へ渡す検査を保持。明細に不足した前後/担当者/方法は既存のtitleへ移し、未取得と0を分けた。帯の人数も未取得を0人にしない。通常の表の配置・CSSは変更なし。
- 明細の補足、閲覧のみの調整非表示と明細閲覧、店未選択の取得禁止、理由をtrimして再送も同じ札で送る4件を実描画で追加。消した試験0件（累計3件）。削除後の関係301/301件合格（`/tmp/v7rm2-mileagescore3.json`）、web型検査・差分検査合格。
- マイルのテーマ分岐と旧一覧/旧窓は除去済み。残るスコア設定の旧骨格は共通部品の整理時にも確認する。次はLINE通知。共通/CSS/CI・全体検査・画像比較は未完了。

### LINE通知：入口と顧客一覧（完了）

- 削除前の台帳の読者16ファイル145ケースと、現役の試験用の口の接続を確認。旧入口約1314行を現役の既定の書き出しへ固定し、試験用の口も現役が実際に使う関数と編集部品へそろえた。旧の顧客一覧/編集の死んだ写しは入口から除去。
- 保存/公開/停止/理由と宛先を確かめたテスト送信/控えとdirty/店の世代/遅い応答/403と500/その場で再取得/長文と最小幅/実値0/送信履歴と取り込み数の区別を同じケースで維持。旧のクラス/タブ部品/固定文は現役の共通Tabs・表・CSSと読み上げ名へ更新した。
- 現役で取得失敗の状態が説明の中に隠れていたので、失敗時に既存の数の帯へ「取得失敗」を戻した。正常時の文・配置・CSSは変更なし。消した試験0件（累計3件）。
- 関係207/207件合格（`/tmp/v7rm2-linenotification4.json`）、web型検査・差分検査合格。運用者一覧/実行記録と古い作成の写しは次の区切り。共通/CSS/CI・全体検査・画像比較は未完了。

### LINE通知：使われない運用者一覧・作成・数の写し（完了）

- 製品からのimportが0件の運用者一覧188行・古いV8作成755行と専用CSS273行・旧の数の表示64行を削除。削除前に一覧のリンクの実描画3件、運用者契約・数字・一覧件数・読み直しの読者、作成のAPIエラー/未保存ガード/CSS予算、数の0/未取得/送信枠/失敗注記/用語の読者を確認した。
- 名前から編集へのリンクとURLのIDの復元/クリックを止めない/検索を同じ3ケースで現役へ移し、一覧へ戻る条件も確かめた。理由付きCSV/状態変更/未取得を0にしない/一覧の件数と失敗の再取得の契約も現役へそろえた。古いモックの対象も現役の運用者・記録タブへ移した。
- 数の純粋な検査は製品が使う方へそろえ、題と数字・単位の分離だけ現役へ更新。きっかけの正本はWorkerとの比較が使う純粋な定義なので残した。消した試験0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 関係250/250件合格（`/tmp/v7rm2-linenotifycopies4.json`）、web型検査・差分検査合格。次は現役が使う実行記録の取得の関数を旧表示から切り離す。共通/CSS/CI・全体検査・画像比較は未完了。

### LINE通知：実行記録の旧表示（完了）

- 削除前に明細/試行/版付き再送と対応済み/店の世代の実描画6件、取得と再送の純粋な11件、履歴7件と数字2件・ページ送り/文言の分類表を確認。取得・絞り込み・再送・対応済みと世代の守り257行を表示なしの関数へ分け、現役と純粋な検査がそちらを使うようにした。旧一覧606行は製品からの参照0件を確かめて削除。
- 実描画6件は現役の行から実際に詳細の窓を開いて操作する形へ移した。B描画後・Bの取得前という隙間でAの成功/403/409/500を返しても通知/再取得が漏れない、Bの取得後のA成功でもBを上書きしない検査を保持。
- 再送の通知は実物の知らせの領域を検査。正常な同じ店なら通知して読み直す1件を足し、古い領域を読むだけで常にnullになる誤った検査を避けた。成功/失敗は読み上げのstatus/alertも付けた。旧の行の骨格/文字は現役の詳細窓・共通検索/CSSの同じ2ケースへ更新。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 削除後の関係183/183件合格（`/tmp/v7rm2-notifyruns3.json`）、web型検査・差分検査合格。通知のテーマ分岐と旧表示は除去済み。共通/CSS/CI・全体検査・画像比較は未完了。

### 統合ユーザー：入口（完了、旧部品は次）

- 旧入口約148行を現役の画面へ固定。所有者の操作/検索/絞り込み/再取得と、現役の幅・見出しの折り返しの契約へ同じケースを移した。現役の内容・配置・CSSは変更なし。
- 関係42/42件合格（`/tmp/v7rm2-users2.json`）、web型検査・差分検査合格。試験削除0件（累計3件）。次は旧一覧部品と集計の失敗・再試行の引継ぎ。共通/CSS/CI・全体検査・画像比較は未完了。

### 統合ユーザー：旧の集計・選び口・表・行（完了）

- 削除前に業務/内部IDの5件、行のID非表示4件、左右余白2件、指標の共有2件、指標の共通化2ケース、寸法/再取得/ページ送り/詳細の接続の読者を確認。型を表示から切り離し、製品の入口からの参照0件を確認して旧4部品525行を削除。APIの型と現役の2画面は保持。
- 旧の取得失敗/再試行/古い返答の守りを現役が使う共通の集計へ移した。友だち数は既存の補足へ残した（上の確認表）。両現役で実際の再試行から0件と友だち数を出す、古い成功/失敗で新しい人数を上書きしない、再取得失敗で以前の人数を残さず取り直す5件を追加。
- 動作試験削除0件（累計3件）。旧の表の骨格/余白/状態の文字/詳細ノードを現役の同じケースへ更新。正常時の列・配置・CSSは変更なし。
- 関係87/87件合格（`/tmp/v7rm2-usersparts3.json`）、追加の統合タブを含む実描画7/7件合格（`/tmp/v7rm2-usersparts4.json`）、web型検査・差分検査合格。旧の詳細の部品も引き続き確認。共通/CSS/CI・全体検査・画像比較は未完了。

### 統合ユーザー：旧詳細と各節（完了）

- 削除前に各節を描く業務7ケースと窓の4ケース/接続4ケース、解除の409/権限不足の実描画2ケース、一覧失敗の配線とButton分類を確認。製品からの参照0件を確かめて旧詳細202行・各節290行を削除。旧CSS307行は現役の順位の窓が使う12クラスの宣言だけを変更せず別名へ残した。
- 採用元/更新方法/確認日時/担当者/版/状態/確からしさ/用途ごとの順位は既存項目のtitleへ移した（上の確認表）。友だちを開く口は既存の名前へ移し、正常時の表の列・配置・CSSは維持。0件の節は失敗と区別して案内する。
- 節の7ケースと解除/403の2ケースは両方の現役でそれぞれ検査。マスク済みの値だけを出す/内部IDを本文へ出さない/未取得の確からしさを0にしない/採用の記録/用途別の順位/版/0件/解除の理由と版/409で窓を閉じ最新を読み直す/403から戻る動きを保持。消した試験0件（累計3件）。
- 削除後の関係77/77件合格（`/tmp/v7rm2-personlegacy2.json`）、理由と版・名前のリンクも含む詳細40/40件合格（`/tmp/v7rm2-personlegacy4.json`）、web型検査・差分検査合格。次はログインユーザー。共通/CSS/CI・全体検査・画像比較は未完了。

### ログインユーザー：一覧と編集の入口・旧見出し（完了）

- 開始時の入口の読者28ファイル130宣言と、現役の編集の入口を確認。旧一覧/窓など約978行を現役へ固定。製品からの参照0件を確かめ、旧のV8見出し26行と専用CSSも削除。現役の一覧/編集/窓の配置・CSSは変更なし。
- 権限の三段階/個別と部分設定/伏せ字/保存済みの表外のキー/版/冪等キー/二度押し/取消/保存失敗と503/本人確認428から同じ保存を再試行/招待の再送/期限/端末失効/利用再開/検索のフィールド別照合と0件を同じケースで保持。旧の表・押し口の名前と固定骨格は現役のroleとCSSへ更新。試験削除0件（累計3件）。
- 編集の試験は実際の行メニューから実際の編集入口へ移る共通の試験の土台へ移した。検索や利用状態が次のケースへ残らないようURLも初期化。ページの設定メニューの口を共通モックへ足し、試験収集の失敗も0件まで確認。
- 他人の二段階の状態と名寄せ未確認は既存titleへ移し、再送中の案内は既存項目へ残した（上の確認表）。本人だけ操作可能、送信中は押せず、失敗後に押し直せることを実描画で確認。
- 関係158/158件合格（`/tmp/v7rm2-staff11.json`、収集失敗0）、web型検査・差分検査合格。次は純粋な関数の写しと招待の画面の残りを点検。共通/CSS/CI・全体検査・画像比較は未完了。

### ログインユーザー：純粋な処理の写し（完了）

- 操作・権限の下書き・権限名の旧3ファイル258行は、現役とコメント以外同じだった。製品の招待と試験の読者を現役へ移し、重複を削除。処理・画面の配置・CSSは変更なし。
- 権限の組み合わせ・保存・招待・純粋な変換の試験137/137件合格（`/tmp/v7rm2-staffpure1.json`、収集失敗0）、web型検査・差分検査合格。消した試験0件（累計3件）。共通/CSS/CI・全体検査・画像比較は未完了。

### 運用状態：健全性・異常の受領と通知（完了、制御・履歴は次）

- 削除前に受領/失敗した通知の再送/未設定/解消済み/店の境界7件、影響を断定しない/古い確認6件、手動実行の連打/失敗/世代/再マウント/終了後の解放6件と表示/サーバー契約の読者を確認。旧の健全性と異常欄など約600行を削除し、試験は現役の部品へ直接移した。
- メモを開いて受領、補足のtitle、共通の判定札、現在の読み上げ名・文字の空白へ同じケースを移した。動作のケースは削除0件（累計3件）。解消済みでも再送が必要な行を残す処理を引き継ぎ、実際の健全性から再送/閲覧のみの操作非表示の2件を追加。通常の配置/CSSは変更なし。
- 関係143/143件合格（`/tmp/v7rm2-emhealth6.json`、収集失敗0）、web型検査・差分検査合格。旧の主要操作のクラスの読者は現役の共通Buttonへ更新（プールの古い指定も同じケースへそろえた）。次は制御の競合と再読込・更新履歴。共通/CSS/CI・全体検査・画像比較は未完了。

### 運用状態：緊急コントロールと V8 固定（完了、履歴の旧部品は次）

- 削除前に旧制御の実操作9件・純粋な世代/ロック/再読込6件・復旧の差分4件・現在の制御11件と確認窓/サーバー/補足/台帳の読者を確認。旧制御・古い送信経路の写し・旧の外枠など約890行を入口から削除し、V8へ固定。旧履歴だけは次の区切りで動作を移す。
- 実操作9件は現在の画面の頭から、実際の共通alertdialog/OTP/復旧窓へ進む同じケースに移した。表示できない操作は権限で隠す契約へ更新。古い自作DOMの土台は既存のHappy DOMへ置き換え、停止の窓も消えたことを必ず検査。復旧の差分4件は現在の入口から同じAPIを送る。
- 世代・競合の純粋な関数を現在の取得・制御へ接続。競合で古い確認を捨てる/再取得中もロック/失敗後もロックと出口を残す/成功で最新の版に戻す/400や冪等キーの競合を版競合と混ぜない/403の窓を閉じる動きを引き継いだ。知らせの部品は現役の同じDOM/CSSを分けただけ。
- 旧の未保存の離脱確認も現役へ引き継ぎ、連打の再取得1要求/停止1要求と実行中の閉じる防止/未保存→条件を元に戻すの3件を追加。消した試験0件（累計3件）。確認窓の低い画面は現在の共通Dialogの高さ上限とスクロールの同じ1ケースへ更新。正常時の配置/CSSは変更なし。
- 関係149/149件合格（`/tmp/v7rm2-emcontrol8.json`、収集失敗0）、web型検査・差分検査合格。次は旧履歴の件数・期間・CSV・更新内容の引継ぎ。共通/CSS/CI・全体検査・画像比較は未完了。

### 運用状態：旧履歴と入口の残り（完了）

- 削除前に更新内容の0/4/10/12件/未反映/要約6件、期間をそろえる/30日境界/200件上限3件、更新要約の純粋な契約とCSV/日付の読者を確認。旧履歴・集計・脇の説明など入口の約178行を削除し、試験用だけの旧表示も無くした。復旧と更新の純粋な181行は動かす側へ集め、処理を変えず共有の場所へ移した。
- 更新内容6件と期間3件は、実際のV8入口のメニューから実際の詳細窓を開く形で同じケースを保持。30日境界は固定した現在日時からちょうど30日前を確かめる形に強めた。動作試験削除0件（累計3件）。
- 取得失敗を0件/記録なし/空CSVにしない→実際の読み直し、日付の読めない記録を別に数える、同じ期間のCSVと式・引用符の無害化、更新内容の取得失敗から復帰する4件を追加。長文は共通の省略と全文確認へ渡し、現在の版の表/CSSは変更なし。入口のメニューの置き方は上の確認表へ記録。
- 削除済みの旧集計の登録/負債/Buttonの分類/古いエラー文の例外を除去。関係165/165件合格（`/tmp/v7rm2-emhistory4.json`、収集失敗0）、web型検査・差分検査合格。運用状態のテーマ分岐と旧表示の試験用の口は除去済み。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：一覧・作成・公開完了のテーマ分岐（完了、旧部品と編集は次）

- 一覧/作成の入口2本は現役へ固定し、公開完了の古い頭の戻り口を除去。現役の中身/配置/CSSは変更なし。旧の表示部品の読者は削除前に引き続き確認する。
- 未保存確認4件・作成成功/失敗と段の共有3件・保存/フォルダ失敗と再取得/権限4件・一覧の行メニュー2件・アーカイブから復帰する実操作は同じケースのまま現役の入力ID/メニュー名/キャンセル/現在の戻り先へ更新。閲覧のみは押せないボタンを隠す契約へ合わせ、変更APIが呼ばれない確認を保持。試験削除0件（累計3件）。
- 共通のnavigationモックを足し、未保存確認もサーバーで確認した本人の権限を使う土台に統一。関係311/311件合格（`/tmp/v7rm2-webinarentries3.json`、収集失敗0）、web型検査/差分検査合格。次は旧の作成・一覧・編集の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：旧作成の写し（完了）

- 削除前に旧作成の実描画1件・blur3件・数字の2件・離脱番兵/画面CSS予算/Button利用先の読者を確認。製品の入口から届かない旧作成369行と専用CSS246行を削除。現役の見た目/CSSは変更なし。
- blur3件は同じ名前/URLの操作を現役へ、作成1件は現役の5段/開催形式/申込の見え方へ移した。数字2件は現役の共有の箱の余白と共通入力の高さ/角へ更新。本人の確認済みの権限を試験の土台へ追加。試験削除0件（累計3件）。
- 旧作成のCSS予算/番兵/利用先の行を除去。運用状態の新しい2部品の共通Button利用先を追記し、描かれなくなったウェビナー旧一覧をページ送りの利用先から除いた。関係318/318件合格（`/tmp/v7rm2-webinarnewcopy3.json`、収集失敗0）、web型検査/差分検査合格。次は編集の入口/旧の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：編集入口と実操作（完了、試験用の旧表示は次）

- 入口は現役へ固定。試験用の概要/動画名を読む10ケースと旧表示の契約は、次の区切りで移して旧本体を削除する。試験削除0件（累計3件）。
- 実挙動10件は自作DOMを実際のHappy DOMへ移し、CTA/フォームの遅い応答・切替直後・保存不可・取得失敗と再試行・404・現在の分析を確認するケースを保持。選ぶ欄の保存/API境界は既存Selectの土台へ合わせ、実際のclick/changeで操作する。
- 未保存の通知・段の往復・公開後の離脱確認解除・保存失敗・参加者201人と全カーソル/検索・参加者の失敗部分だけの再取得・コメントを取らない・権限/CSVの各ケースを現役へ更新。将来の段は絵のとおり押せないため、未保存の往復は画面内の履歴で確認。0秒はエラー/入場のみ/見ていないを区別し、公開状態は現在の説明の口を開いて確認。
- 設定から読む3つの口と参加の回数/種別の補足を最小で移した（上の確認表）。実際のメニューから参加者へ進みURLも変わる/閲覧のみには変更の項目がない2件を追加。
- 保存済みでも自動番兵が残っていたため、入力4段は親の番兵へ一本化。フォーム候補の取得中は下書き保存を押せず、保存関数も止める。候補の取得失敗時にURLのカードだけなら保存できる経路は保持。通常の配置/CSSは変更なし。
- 関係318/318件合格（`/tmp/v7rm2-webinareditentry6.json`、収集失敗0）、web型検査/差分検査合格。コードは `5d7c0e408e`。台帳追記が文字コードエラーで失敗したため、記録は次の文書コミットで補完。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：旧編集の試験用の概要・動画名（完了、本体の残りは次）

- 削除前に概要の2件/有効フラグの4件/実ファイル名の4件を確認。旧編集にあった約150行は現役が使う処理へ移し、試験も現役を直接読む形へ変更。旧表示の本体は次の区切りで外す。試験削除0件（累計3件）。
- 未設定/確認中/失敗を「送る」と混ぜず、全OFF・1件ON・混在・既定の時刻が残っている場合も元のケースで確認。状態の札は共通のStatusPillへそろえ、実際の通知の補足から送る分だけの要約を見る1件を追加。閉じた通常の画面とCSSは変更なし。
- メディアIDと店があるときだけ実名を取得し、取得失敗/IDなしを偽名へ変えない。種別と登録メディアの長さは既存titleへ移した。逆順で届くA/Bと、店だけの切替で古い実名を即座に隠し失敗後も残さない2件を追加。
- 関係321/321件合格（`/tmp/v7rm2-webinareditmetadata4.json`、収集失敗0）、web型検査/差分検査合格。次は旧編集本体と一覧の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：旧編集本体（完了）

|削除前のファイル|直接読む動作試験|表示・取得の契約試験|
|---|---|---|
|`app/webinars/edit/page.tsx`（903行）|未保存19宣言（20ケース）、分類2、段の移動3宣言（4ケース）、読込失敗4、復帰10、参加者の権限6|機能契約15、単一取得3、公開前確認5、分析取得3、通知10と、見出し・戻り先・登録の横断契約|

- 動作の読者を現役へ移した後、試験のためだけに残した旧編集を削除。入口は現役を直接描く7行にした。試験用だけの旧描画の口も無くした。現役の中身・配置・CSSは変更なし。
- 取得回数、通知の保存と報告、分析の遅延取得、公開不可の案内と外部リンクの保護を、現役の親と子・共通Buttonを読む同じケースへ更新。旧ノードIDは現在の板へ移した。消した試験0件（累計3件）。
- 通知の失敗を「読み込めませんでした」へそろえ、古い文言の例外から旧編集を外した。旧編集の負債とButtonの登録、使われない旧参加者のページ送り登録を除去。
- 関係331/331件合格（`/tmp/v7rm2-webinareditbody3.json`、収集失敗0）、web型検査/差分検査合格。次は旧一覧と編集の各段の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：基本設定の旧写し（完了）

- 削除前の読者は動作6件と未保存/共有Buttonの登録。現役に届かない基本設定と専用CSSを削除し、6件は現役の基本設定を直接描く形へ移した。受け口の共通の試験の土台を追加。現役の配置・CSS・処理は変更なし。
- 保存する内容と順番、部分成功後の再試行、版競合、別段の保存で未保存入力を消さない、閲覧のみの入力/送信/保存禁止、テスト送信前の確認と保存を同じ6件で保持。閲覧のみは操作非表示と保存関数の未登録を確認。消した試験0件（累計3件）。
- 関係321/321件合格（`/tmp/v7rm2-webinarbasic2.json`、収集失敗0）、web型検査/差分検査合格。旧の登録だけを外した。次は一覧・動画などの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：旧一覧の写し（完了）

- 削除前に旧一覧の検索2件/状態と再取得5件/アーカイブ2件、無名ボタン1件、旧CSSの数字4件と一覧契約15件、共通道具/集計/未保存の登録の読者を確認。入口から届かない一覧1116行と専用CSS379行を削除。
- 検索の連打/逆順の応答/取得中の前の一覧/0件の意味/初回失敗からの再取得/検索失敗からの復帰/公開中のアーカイブ禁止/確認後の1要求を、実際の現役入口と共通の押し口を操作する同じ9件へ移した。無名ボタンも現役の実DOMで確認。消した試験0件（累計3件）。
- 300msの待ちの二重化だけを直した（上の確認表）。現役の配置/CSSは変更なし。旧の文字順は現役の検索/札/末尾の部品を渡す順へ、数字の4件は現役の共通の帯/表/検索の幅へ更新。旧の負債/利用先/番兵の登録を除去。
- 関係366/366件合格（`/tmp/v7rm2-webinarlistcopy4.json`、収集失敗0）、web型検査/差分検査合格。次は編集の動画・通知などの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：公開前確認の旧写し（完了）

- 削除前に旧確認の描画/公開不可/版更新後の公開と連打3件、要約の純粋な6件、公開検査/フォーム/未保存/共有Buttonの読者を確認。旧確認152行と要約40行を削除。要約は現役の表示が使う処理へ移し、試験だけの処理を残さない。
- 元の9件を現役へ移した。未取得/確認中/失敗/未確認を確認済みと混ぜない、失敗があれば件数を出す動きを保持。既存の説明から未確認の2種類と監視の3件を確認する実描画1件を追加。失敗の古い文言の例外登録は除去。試験削除0件（累計3件）。
- 関係324/324件合格（`/tmp/v7rm2-webinarreview2.json`、収集失敗0）、web型検査/差分検査合格。補足の置き方は上の確認表に記録。次は動画・通知・コメントなどの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：コメント演出の旧写し（完了）

- 削除前に旧コメントの実描画/不正な行/読み直し/保存失敗と連打4件、件数上限3件、番兵/エラー文/共有Buttonの読者を確認。旧コメント241行を削除し、現役の部品と本物の保存通知を直接描く試験へ移した。
- 現在の入力名の空白/本文/追加操作へ同じ4件を更新。空の行を送らず入力を残す、取得失敗を空や保存可能にしない、二重クリック1要求と再試行、成功の通知を保持。件数の3件は現役の上限と一括入力の説明を読む。試験削除0件（累計3件）。現役の処理/配置/CSSは変更なし。
- 関係325/325件合格（`/tmp/v7rm2-webinarcomments2.json`、収集失敗0）、web型検査/差分検査合格。旧の登録だけを除去。次はCTA・動画・通知・参加者と分析の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：CTAと申込フォームの旧写し（完了）

- 削除前に旧CTAの実描画/未入力/失敗再試行/2枚保存/フォームの版競合5件、入力検査6件、フォームの契約7件と取得の一本化3件、番兵/共有Buttonの読者を確認。旧CTA461行と旧検査46行を削除。
- 元の5件を現役へ移し、未入力のカードがあればフォームもカードも送らないことを強めた。フォーム競合時のカード保持と、比較→置き換える前の確認を引き継いだ（上の確認表）。競合中は保存関数を未登録にし、カードの送信も0件のまま確認。通常の配置/CSSは変更なし。
- 元の入力検査6件は、現役の欄を検査する同じ関数へ移した。空/URL/フォーム/時刻/動画の長さ/複数カードを保持。秒数だけの入力を戻し、実際に600秒で送る1件、フォームだけ成功後はカードの失敗再試行でフォームを再保存しない1件を追加。試験削除0件（累計3件）。
- フォーム候補/権限/保存版/拒否理由/公開前確認/別の用途/外部送信なしの7件は現役の受け口と共有の文言へ更新。CTAの初回取得と比較のときだけの取得を分け、保存結果を親へ流す3件を保持。
- 関係324/324件合格（`/tmp/v7rm2-webinarcta6.json`、収集失敗0）、web型検査/差分検査合格。次は動画・通知・参加者と分析の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：通知の旧写し（完了）

- 削除前に通知保存/読み直し/失敗の3件、全OFFの初期表示/保存/送信内容3件、見送りの理由3件、表示の契約10件と取得の一本化3件、番兵/共有Buttonの読者を確認。旧通知142行と旧部品394行・専用CSS3行を削除。
- 元の動作9件は実際の現役の段・保存する口・共通の通知を使う試験へ移した。未設定でも6種類OFF、全OFFの送信内容、予定と取消、失敗後の入力保持と再試行、見送りの人数/原因と再取得を保持。試験削除0件（累計3件）。
- 取得していない件数は既存の補足でも「—」とし、単位だけを残す「—件」を防ぐ1件を追加。実人数と延べ予約は現在の同じ補足で区別する。通常の配置/CSSは変更なし。
- 関係328/328件合格（`/tmp/v7rm2-webinarnotifycopy6.json`、収集失敗0）。web型検査/差分検査合格。次は動画・参加者と分析の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：参加者の旧写し（完了）

- 削除前に描画とチャットの導線/分類の切替/続きを待つ間の古い応答3件、遅延取得3件と機能契約15件、番兵/共有Buttonの読者を確認。入口から届かない旧参加者381行と専用CSS11行を削除。
- 元の3件は実際の現役の参加者を直接描く形へ移した。分類を変えて取り直し、後から届く古い続きが混ざらないことを保持。試験のURLは各回初期化し、現役の共有の受け口を使う。親から集計を渡し、参加者とコメントを別に取得してカーソルで読み切る契約を現在の受け口へ更新。
- 現役の中身/配置/CSSは変更なし。旧分析の型の参照だけを、その削除まで自身の中へ置いた。試験削除0件（累計3件）。関係325/325件合格（`/tmp/v7rm2-webinarparticipantscopy2.json`、収集失敗0）、web型検査/差分検査合格。次は分析・動画の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：分析の旧写し（完了）

- 削除前に数の帯と人数の増減4件、視聴の線/完了率/空/異常の除外4件、回別・日別・フォーム3件、コメントの実データ/再取得/権限/0件/古い応答5件と遅延取得/機能契約の読者を確認。旧分析・内訳・コメント・共通の旧分類の写し計596行を削除。使われない通知の古いモック3本も外した。
- 元の16件は現役の分析の段を直接描く形へ移した。現在の空白とマイナスの文字、共有グラフへ更新。直接参加の増加でも棒は100%以内、完了人数を最終区間で代用しない、観測なしを0と混ぜない、コメントの失敗だけ再取得、403/空/逆順を保持。試験削除0件（累計3件）。
- 項目ごとの到達人数と、始まり・完了人数・最も離れた区間は既存の畳んだ詳細へ移した（上の確認表）。閉じた通常の配置/CSSは変更なし。関係328/328件合格（`/tmp/v7rm2-webinaranalyticscopy2.json`、収集失敗0）、web型検査/差分検査合格。次は動画と残る小物の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：動画・開催回の旧写し（完了）

- 削除前に描画/公開期間/枠の追加と削除/開催回の人数/動画の処理状況/別の保存で入力を消さない7件、定員の表示/失敗の再試行/小数拒否と無制限/再取得/閲覧のみ5件、番兵/共有Buttonの読者を確認。旧動画585行・旧の段156行・開催回75行・最後の旧編集CSS20行を削除。
- 元の12件を現役の段と親の保存する口へ移した。日時欄は実際のV8の時刻入力とblurで確定する。変更せず保存した場合は現在の「未変更なら送らない」経路で開始日時と終了なしの表示が残ることを確認。変更した公開期間だけを保存しても、差し替える窓の未保存の長さは残る同じケースを保持。
- 現在のメニュー名と空白へ更新。定員の入力保持/再試行/整数検査/空欄の無制限/再取得後の実数/未保存解除を保持。閲覧のみは操作非表示で送信0件を確認。現役の処理/配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係328/328件合格（`/tmp/v7rm2-webinarvideocopy2.json`、収集失敗0）、web型検査/差分検査合格。次は試験だけのプレビュー処理と一覧の小物の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：試験だけのプレビュー処理（完了）

- 削除前に設定済みの動画/動画なし/CTAの言葉/CTAなし/通知の本文/通知なし/見本の固定値なし7件を確認。製品の入口から届かない旧プレビュー処理52行を削除。
- 元の7件は現役の動画・CTA・通知の段と通信の受け口を使う実描画へ移した。通知は実際の吹き出しの本文を確認し、null/未定義/空白には吹き出しを作らない。CTAの言葉は現在のカードの実データを読む。
- 動画なしの見本の再生表示と、未入力のCTAの仮の「ボタン」を外す動きを最小で移した（上の確認表）。設定済み動画の説明は既存の説明の中へ置き、設定済みの通常の配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係328/328件合格（`/tmp/v7rm2-webinarpreview1.json`、収集失敗0）、web型検査/差分検査合格。次は一覧の小物と競合の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：一覧の重複した小物（完了）

- 削除前に全条件/途中失敗/店の切替/引用と計算式/アーカイブのCSV3件、失敗理由4件と一覧の状態6件、実測値6件/通知対象2件の読者を確認。試験だけが読む旧CSV36行・旧理由42行・旧集計155行を削除。
- CSVと失敗理由の元の各ケースは現役が使う同じ関数へ移した。実測値の6件も現在の帯が使う値と補足へ移し、0と未取得、実人数と延べ予約、小数の視聴率、CTAの延べ回数と押した人数の区別を保持。通知対象2件は現役の同じ表示処理へ移した。試験削除0件（累計3件）。
- 集計の取得不能の理由は既存の「？」へ引き継いだ（上の確認表）。現役の帯の値/並び/配置/CSSは変更なし。同じ理由が実際の補足に一度だけ出る実描画1件を追加。関係329件のうち新しい描画の参照を修正し、該当6/6件も合格（`/tmp/v7rm2-webinarhelpers3.json`、`/tmp/v7rm2-webinarhelpers4.json`、収集失敗0）。web型検査/差分検査合格。次は段と競合の旧写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：段と概要の旧処理（完了）

- 削除前に段の名前と行き先2件、段の完了/未入力/不明/現在/CTAの件数5件、概要の未取得/不足/内部語なし3件、公開可否1件と撮影の目印2件を確認。試験だけが読む旧段の処理132行を削除。
- 段の7件は現役の同じ処理へ移し、行き先の言葉は実際の次へ進む口が使う処理へ一本化。概要の3件は既存の説明が使う実値と理由へ移した（上の確認表）。公開不可の1件は実際の公開前APIの検査結果から不足の2つを出し、押せず公開APIも0件のままであることへ移した。
- 古い撮影の目印2件は、現役の各段の現在の板の登録と重ならない段のキーへ更新。現役の段/行き先/配置/CSSは変更なし。試験削除0件（累計3件）。関係329/329件合格（`/tmp/v7rm2-webinarsteps1.json`、収集失敗0）、web型検査/差分検査合格。次は競合の旧写し。共通/CSS/CI・全体検査・画像比較は未完了。

### ウェビナー：競合の旧写し（完了）

- 削除前に版競合の見分け2件と帯の再読込1件、無いカード/カードの内容/多い側まで比べる3件と比べる処理がある時だけの操作1件を確認。試験だけが読む旧競合64行と旧比較147行を削除。
- 元の7件は現役の競合判定と実際の共通の帯、現役の比較が使う行の組み立てへ移した。競合の返事の不正な最新は信頼せず、現役の読み直す口を使う。カードの時刻と見出しにボタンの言葉も移した。最新が未取得なら「無い」と混ぜず「—」のまま比較する。
- 共通の帯は比較する処理もリンク先も無い時は押し口を隠す（上の確認表）。比較処理がある時の配置/CSSは変更なし。試験削除0件（累計3件）。関係350/350件合格（`/tmp/v7rm2-webinarconflictcopy1.json`、収集失敗0）、web型検査/差分検査合格。
- ウェビナーの入口の分岐と旧表示の写しは除去済み。次はイベントなど残る機能の分岐。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：一覧の入口（完了）

- 削除前に旧一覧の削除5件・権限/失敗7件・状態と条件2件・検索3件、件数6件と読み込み状態/共有KPI/日時/自動案内/表幅の読者を確認。入口578行を現役V8だけの7行へ切り替えた。
- 元の動作17件は現役のAPIと実際の行末メニュー/確認窓へ移した。削除成功後の再取得、409で窓と理由を残す、閲覧のみの操作非表示、403と通信失敗の区別、検索200文字の上限と再試行を保持。空状態の0と未取得の「—」も実描画で確認する。
- 申込条件は現役のタグ札と共通の1行省略/全文の読み上げへ更新。「全員」の旧表示と2ボタン分の旧列幅を固定しない。件数を操作にしない1件は旧の自作DOM試験から現役の実描画へ移動。試験削除0件（累計3件）。
- 申し込みが少ない回の日付と残り日数を既存の説明へ移し、実描画1件を追加（上の確認表）。閉じた通常の中身/配置/CSSは変更なし。関係233/233件合格（`/tmp/v7rm2-eventsentry4.json`、収集失敗0）、web型検査/差分検査合格。
- 次は一覧の旧写し、申込者と日時変更の分岐。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：一覧の旧写し（完了）

- 削除前に旧写しを直接描く10件、フォルダの共通幅と権限の契約/共有Button/CSSの登録を確認。入口から届かない旧一覧816行と専用CSSを削除。
- 同じ10件を現役の一覧へ移し、行の詳細と次の行、右クリック、名前と版の保存、フォルダの取得と色を保持。403は権限確認後の再取得へ、現在使える複製口へ更新。フォルダ追加は採用済みB-136の共通窓を使い、実際の追加APIへ名前/種類/アカウントが届く確認も加えた。
- 旧フォルダ幅を固定していた共通試験は、先に切替済みのメディア/共通情報/ウェビナーについて同数のまま現役の型へ更新。試験削除0件（累計3件）。現役の処理/配置/CSSは変更なし。
- 関係236/236件合格（`/tmp/v7rm2-eventlistcopy3.json`、収集失敗0）、web型検査/差分検査合格。次は申込者と日時変更の分岐。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：日時変更の入口（完了）

- 削除前に未指定/取得失敗/影響確認と理由付き変更/定員不足の停止4件と共有Buttonの読者を確認。入口373行を現役V8だけの7行へ切り替えた。
- 同じ4件は実際の時刻入力を確定して自動の影響確認を待つ形へ更新。確定と待ちの人数/版/理由/冪等キー/通知の完了人数を保持。人数付きの確認窓を押すまでは変更APIが0件、定員を申込人数未満へ下げると理由と無効な操作でAPIも0件を確認する。
- 旧の手動確認ボタンと旧の「この内容で変える」の骨格は固定しない。試験削除0件（累計3件）。現役の処理/配置/CSSは変更なし。関係217/217件合格（`/tmp/v7rm2-eventchangeentry2.json`、収集失敗0）、web型検査/差分検査合格。
- 次は日時変更の旧写しと申込者の分岐。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：日時変更の旧写し（完了）

- 削除前に旧写しの実描画/変更と通知1件、型とCSSの契約1件、旧処理296行の読者、共通の影/ネイティブ入力/CSSの登録を確認。旧写し423行と専用CSS170行、現役と重複した旧処理296行を削除。
- 同じ2件は現役の入力・自動確認・人数入りの確認窓を使う形へ移した。実際の変更と通知を保持し、確定操作前にはAPIを呼ばないことを強めた。旧CSSだけのlayer固定を現在のCreatePageと値の決まりへ更新。試験削除0件（累計3件）。現役の処理/配置/CSSは変更なし。
- 共通の影の検査で、以前に入口から使われなくなったウェビナーの旧フォームの例外が残っていたため、その登録だけも外した。旧フォーム自体は動作試験の移行が必要なので、共通部品の残作業として残す。新たな試験失敗は理由と対象を出すようにした。
- 関係231/231件合格（`/tmp/v7rm2-eventchangecopy3.json`、収集失敗0）、web型検査/差分検査合格。次は作成の旧写しと申込者の分岐。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：作成の旧枠（完了）

- 削除前に旧枠の入力/アカウント未選択/型と値の3件、影/CSSの登録を確認。入口から届かない旧枠46行と専用CSS42行を削除。
- 同じ3件を現役の作成入口と実際の入力へ移した。旧Wizardの見本で包む試験をやめ、イベント名の欄と保存する口を直接確認する。未選択の案内と保存・公開停止を現役へ最小で引き継ぎ、API0件も確認（上の確認表）。選択済みの中身/配置/CSSは変更なし。
- 旧Wizardの影の登録は不要になったため外した。Wizard自体はまだ動作試験の移行が必要なので、共通部品の残作業として残す。試験削除0件（累計3件）。関係229/229件合格（`/tmp/v7rm2-eventnewcopy2.json`、収集失敗0）、web型検査/差分検査合格。
- 次は申込者の分岐と旧写し、旧側だけの通知予定・操作の切替への対応。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：申込者の旧写し（完了）

- 削除前に旧写しの実描画/承認/確認後の送信3件、型と値の1件、番兵/共有Button/CSSの登録を確認。入口から届かない旧写し877行と専用CSS185行を削除。
- 同じ4件は現役の実描画と実際の入力へ移した。初参加/過去参加/待ちの履歴、承認のAPIと再取得、送信対象の固定を保持。人数入りの確認窓を押すまでは送信APIが0件であることを強めた。スタッフ権限は実際の確認口から取得する。
- 現役の処理/配置/CSSは変更なし。試験削除0件（累計3件）。関係225/225件合格（`/tmp/v7rm2-eventbookingcopy1.json`、収集失敗0）、web型検査/差分検査合格。
- 申込者の入口のV7分岐と旧側の動作試験は残っている。通知予定/当日受付/残席の説明と、操作中の店・開催回の切替や古い応答を無視する処理を現役へ移してから分岐を外す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：申込者の切替と操作の失効（引継ぎ完了）

- 旧側の店/開催回の切替、送信対象の無効化、参加印の同時更新と古い応答を読む試験を確認。現役に無かった失効処理を、機能内の同じ仕組みで一覧取得・承認/拒否・取消・参加印・待ち操作・CSV・一斉送信へ移した。
- 店/イベント/開催回が変わった描画時点で前の処理を失効させ、入力/確認窓/操作中の状態を戻す。A→B→Aでも新しい処理として扱う。同じ操作の2回目を描画前でも止め、別の行の参加印は並行で扱う。読み込み失敗と不正な応答は空の一覧と混ぜない。通常の中身/配置/CSSは変更なし。
- 現役の実描画へ6件を追加：古い名前の混入なし/対象確認の二重押し1要求/戻った後の古い送信対象の除外/前の店の送信完了で新しい文を消さない/参加印の二重押しと戻った後の操作中維持/別の行の成功で失敗を消さない。試験削除0件（累計3件）。旧側の動作試験自体の移行はまだ残る。
- 関係224/224件合格（`/tmp/v7rm2-eventbookingscope2.json`、収集失敗0）、web型検査/差分検査合格。次は通知予定/当日受付/残席の説明と旧側の実操作試験の移行を終え、申込者の分岐を外す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：申込記録・回答・通知予定（引継ぎ完了）

- 旧一覧を読む通知予定4件と要件v6-29 §9-1を確認。現役に無かった記録の確認を共通の開閉欄へ移した。既存の予約一覧APIを開催回/状態/ページで読み、予約の同じ行に回答/備考/同行者/通知の種類・日時・状態/個別トークを出す。新しいWorker/APIは増やさない。
- 共通の開閉欄に開閉の通知だけを足し、閉じている通常の画面では記録を取得しない。読み込み失敗は空と区別し、開き直しで再試行する。ページ/条件/店/開催回の切替や閉じた後は前の応答を使わない。現在の帯/申込者の表/配置/CSSは変更なし。詳細の口は上の確認表へ記録。
- 通知予定4件は現役の記録へ移行。実描画へ回答/5状態の通知/個別トーク、失敗後の再取得、次ページと閉じた後の応答除外の3件を追加。試験削除0件（累計3件）。関係213/213件合格（`/tmp/v7rm2-eventbookingrecords2.json`、収集失敗0）、web型検査/差分検査合格。
- 次は記録の操作/当日受付/残席の説明と旧側の実操作試験の移行を終え、申込者の分岐を外す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：当日受付・待ちの見送り・記録の操作（引継ぎ完了）

- 旧側だけの席数の説明/記録済みの受付の行/待ちの見送り/記録の操作を確認。先に移した詳細へ最小で引き継いだ。待ちの個別トークも残した。待ちの見送りは理由なしでは押せず、理由と開催回の版を既存APIへ送る。記録の承認/拒否/取消/参加印は現役の同じ操作処理と確認窓を使い、成功後に通知予定を含む記録を読み直す。
- 旧応答の案内中/受諾済みの人数は実際の行から数える。履歴/受付の未取得と0は混ぜない。当日受付は既に確定から除かれた参加済/無断の人数を二度引かず、確定のままの人数を受付前にする。取消の窓には通知予定の停止/送信済みの履歴の保持/送った通知の取消不能、拒否の窓には友だちへ届く範囲を引き継いだ。IDなしならAPIを呼ばない。
- 実描画へ4件追加：受付前の二重減算なし/旧応答の案内人数と未取得/記録の参加印と再取得/理由必須の見送り。試験削除0件（累計3件）。関係233/233件合格（`/tmp/v7rm2-eventbookingattendance1.json`、収集失敗0）、web型検査/差分検査合格。通常の配置/CSSは変更なし。
- 次は旧側の実操作試験を現役へ移して申込者の分岐を外す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：申込者の実操作試験（移行完了）

- 旧側の実操作25件を、現役の実描画/実際のButton・確認窓・入力・表へ移した。自作の疑似DOMと操作部品の見本を外し、共通のRouter/画面タイトルの試験の土台を使う。保存/API境界のSelectの差し替えだけは従来どおり保持。ログイン担当者の役割は確認APIから読む。未使用の旧全回集計のモックを外し、実際の開催回の人数を検査する。
- 待ちの案内/見送り/並替え/版と理由/送信対象固定/二重押し/店と開催回の切替/A→B→A/古い応答/古い後片付け/行ごとの並行印/別行の失敗保持/確定と後片付けの隙間の守りは全件保持。待ち順は採用済みの現役の並び（案内中/受諾済みも順位に数える）へ見た目の固定だけを変更。
- 実際の確認窓へ移すと、前の店の実行ロックが未完了のまま次の操作を妨げる問題が出た。店/イベント/開催回ごとに確認窓を作り直し、旧窓の非同期状態を次へ持ち越さないようにした。通常の中身/配置/CSSは変更なし。
- 試験削除0件（累計3件）。関係233/233件合格（`/tmp/v7rm2-eventbookinginteractions4.json`、収集失敗0）、web型検査/差分検査合格。次は申込者の入口をV8に固定し、残るソース契約を現役へ移す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：申込者の入口（完了）

- 削除前に旧入口を読む操作の契約6件/取消確認4件/選び直し1件/状態の契約16件中の申込者関係、共有KPI/自動案内の各1件、番兵/禁止文言/部品利用先の登録を確認。動作25件は前の小分けで現役へ移行済み。入口1579行を現役へ渡す7行にし、V7の本体/テーマ分岐を外した。
- 全開催回の状態別件数と残席・次の行動の説明は、同じ詳細へ既存の小さい集計APIで引き継いだ。記録の絞り込み/ページ送りでは予約一覧だけを読み直し、全体集計/開催回/イベント名を重ねて取り直さない。集計の取得失敗/再試行/店切替前の遅い応答の除外も実描画3件で確認。
- 入口から読まれなくなった数え方の重複137行も削除し、同じ計算を持つ現役の8件へ試験の参照先を移した。操作の契約は旧骨格/ノードID/変数名の固定を現役の確認窓と現在の処理へ変更。動作/取得失敗/二重実行/通知の範囲/取消不能/名前の未取得の検査は保持。番兵/禁止文言/設計負債/部品利用先の不要な旧登録を外し、記録の現在の利用先を足した。
- 試験削除0件（累計3件）。関係246/246件合格（`/tmp/v7rm2-eventbookingentry4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventbookingentry-type3.log`）/差分検査合格。既存の申込者の表/配置/CSSは変更なし。
- イベントの一覧/作成/日時変更/申込者の入口と写しは完了。旧の編集/作成Wizardの動作と見た目がまだ残るので、次はそちらを確認して移す。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：編集の外枠・公開の状態（完了、入力フォームは次）

- 旧編集入口の公開状態の取得失敗/変更後の再読込2件と、読み込み状態/禁止文言/部品利用先の読者を確認。入口390行を現役の編集へ渡す3行にした。現役の編集が無かったため、共通の詳細画面・数の帯・確認窓へ最小で移した。入力フォームはまだ旧側を使うため、この区切りだけで編集全体の除去済みとはしない。
- 既存の変更影響/お客様表示/申込一覧への行き先と、承認待ちが席を使う説明を保持。公開/一時停止/再開/終了/中止は同じ既存APIへ理由と冪等キーを渡す。失敗後の理由と鍵を保持し、店/イベントの切替では前の応答を使わない。状態変更成功時に件数と状態を読み直す。
- 元の2件を実際の入力/確認窓へ移し、理由なしの中止停止/二重押し1回/失敗後に同じ鍵で再送1件を追加。共通の「停止中」の表示へ見た目の固定だけを変更し、状態変更APIと再読込も検査。試験削除0件（累計3件）。関係231/231件合格（`/tmp/v7rm2-eventeditouter5.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventeditouter-type3.log`）/差分検査合格。
- 次は入力フォーム・予約枠の窓・旧Wizardの動作と見た目。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：編集の概要・公開対象の入力（完了、旧枠は次）

- 旧フォームを読む名前を離れた時の検査/質問の続けて保存/未保存の離脱/共有の字数上限と公開対象の読者を確認。概要の手書きの箱・入力・横断対象の押し口を共通FormSection/Field/TextInput/TextArea/RadioCardへ移した。住所のテーマ分岐を外し、V8の欄を常に出す。イベント名/場所/住所/URL/画像/詳細/中央揃え/質問/予約回数/複数アカウントの保存内容は保持。
- 横断公開は編集中のアカウントを自動で対象に入れ、単一へ戻すと対象配列を送らない。実際の共通ラジオと保存APIでこの往復1件を追加。質問を続けて保存しても消えない元の検査も保持。試験削除0件（累計3件）。
- 関係230/230件合格（`/tmp/v7rm2-eventformoverview2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventformoverview-type2.log`）/差分検査合格。フォーム全体の旧枠/公開設定/予約枠の窓と旧Wizardはまだ残る。次はそれらを小分けで移す。

### イベント：編集フォームの枠・タブ・予約URL（完了）

- 旧フォームの未保存の離脱3件/保存と質問3件/公開選択2件/予約枠編集6件などの読者を確認。手書きの旧パンくず・カード・タブ・URL箱を共通FormSection/Tabs/Field/入力/Noticeへ移した。保存する帯は既存の共通StickyBarを使い続ける。
- 一覧へ戻る/予約確認/複製の行き先、単一の公開URL、横断配信の差し込みURLと対象アカウント別の固定URL、手動選択とコピー、未設定/未選択/下書きの案内を保持。タブと保存して次へ、保存中の停止、未保存の離脱確認も同じ動きのまま。
- 試験削除0件（累計3件）。関係230/230件合格（`/tmp/v7rm2-eventformshell1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventformshell-type1.log`）/差分検査合格。公開設定/予約枠の窓と旧Wizardの旧表示は次に移す。

### イベント：予約枠一覧・追加/編集の窓（完了）

- 予約枠編集6件（保存値/定員変更/日本時間からUTC/予約数未満の禁止/時刻の逆転/409と最新差分）の読者を確認。旧の手書きの窓2つを共通Dialog/Field/日時/数値入力へ移した。予約枠の箱・空状態・失敗帯・操作も共通FormSection/ListState/Notice/Buttonへ移す。
- 同じ6件は共通窓の実際のポータル内へ参照先を移した。旧のfixedクラスと旧のDOM位置は固定しない。既存のAPI/版/読込/定員検査/競合の説明を保持し、保存中の閉じる停止は共通窓に任せる。試験削除0件（累計3件）。
- 関係230/230件合格（`/tmp/v7rm2-eventformslots1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventformslots-type1.log`）/差分検査合格。次は一括追加/公開設定の旧表示と旧Wizard。

### イベント：一括追加・公開設定の入力（完了）

- 一括追加の実操作4件/公開状態のラジオ2件/締切と取消の共有契約/待ちの自動案内の説明3件の読者を確認。曜日ボタンの手書きの色と時刻パターンの箱、公開設定のカードと生の入力を共通Button/Field/FormSection/TextAreaへ移す。曜日は既存のaria-pressedと共通の選択色で伝える。
- 一括生成の期間・曜日・時刻・定員と12パターン時の操作/Escape、承認期限/待ち/公開対象/保存済みの締切/取消期限/前日と時間前の通知/確定と通知の追記/公開ラジオ/OGの保存内容を保持。一括生成の実行はPromiseを共通窓へ返し、二度押しの停止も共通窓に任せる。
- 試験削除0件（累計3件）。関係230/230件合格（`/tmp/v7rm2-eventformpublish1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventformpublish-type1.log`）/差分検査合格。次はフォームを現役の置き場へ移し、旧Wizardの動作の参照先を移して削除する。

### イベント：編集フォームの置き場と旧ファイル（完了）

- 削除前に旧フォームを直接読む実操作7本と、共有の保存契約/自動案内の説明/確認窓/番兵/禁止文言/設計負債/部品利用先の読者を確認。共通部品へ移したフォームを`v8/events/edit-form.tsx`へ移し、旧`components/events/event-form.tsx`を削除。試験のための旧表示や再exportは残さない。
- 同じ全件が現役を直接読む形へ移行。最後の未指定時の手書き空状態も共通ListStateへ移し、使われない旧タブの補足/輸入を除去。旧フォームの直書きの登録を外し、番兵/禁止文言/共通Buttonは現役を見張る。成果地点が移行対象から外れた後も作成先の検査は必要なので、共通Buttonの同じ契約を現役の成果地点の入口も読む形へ直した。
- 試験削除0件（累計3件）。関係256/256件（`/tmp/v7rm2-eventformmove1.json`）と設計/部品利用先11/11件（`/tmp/v7rm2-eventformmove-design3.json`）合格、収集失敗0。web型検査（`/tmp/v7rm2-eventformmove-type1.log`）/設計負債/差分検査合格。次は旧Wizardの動作を現役の作成/編集へ移して削除する。

### イベント：旧Wizardの入力検査・未保存の離脱（移行完了）

- 名前を離れた時の1件/未保存の離脱3件/定員0・空の日付・15分未満でAPI0件の3件を確認し、現役の作成へ移した。共通のRouter/画面タイトル/実際の権限確認APIを試験の土台に使う。旧パンくずや旧入力IDの固定はやめ、現在の入力とキャンセルの行き先を使う。破棄を決めるまでは入力を残し、決めた時だけ一覧へ進む。
- 現役の既存の誤りの欄へ名前の即時検査と15分未満の停止、字数上限の送信前検査を引き継いだ。通常の中身/配置/CSSは変更なし（上の確認表）。試験削除0件（累計3件）。
- 関係230/230件合格（`/tmp/v7rm2-eventwizardname2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventwizardname-type2.log`）/差分検査合格。次は予約枠を間違えず更新する操作/一括追加の部分失敗/公開と締切の旧試験を現役へ移す。

### イベント：旧Wizardの同じ長さの一括追加（引継ぎ完了）

- 旧側だけの時間帯の分割を確認し、現役の編集の一括追加へ既存の`splitBand`で引き継いだ。チェックを入れた時だけ時間帯/1枠の長さを共通入力で出し、通常の個別パターン入力は保持。0パターンになる条件は生成を止め、同じ説明を窓に出す（上の確認表）。
- 実際のDialogはbusyを明示すると内部のPromiseロックを使わないため、追加/編集/一括生成の入力窓側にも描画前のロックを付けた。削除と一括作成のConfirmDialogには実行Promiseを返し、同じ描画の二重押しも止める。前の「共通窓に任せる」はこの処理まで含めて成立する。
- 実描画2件を追加：14〜17時を90分の2枠に分割/同じ描画の生成を1回にして失敗後に同じ入力で再試行。試験削除0件（累計3件）。関係244/244件合格（`/tmp/v7rm2-eventwizardband2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventwizardband-type2.log`）/差分検査合格。旧Wizardの部分失敗と枠の識別の試験は次に移す。

### イベント：旧Wizardの公開・締切・枠の再読込の試験（移行完了）

- 旧Wizardの定員変更後の再取得1件/公開OFFとON2件/取消期限2件/締切の既存値2件を現役の編集へ移した。旧3段階とボタン名の固定はやめ、実際の予約枠の編集窓と現在の公開設定を操作する。
- 7件は全て保持。公開の2件はラジオの選択だけでなく実際の保存APIへ0/1が届く検査へ強めた。取消期限の0も保存APIで確認。枠は選んだIDへ定員2を送り、一覧APIを再取得して表が2へ変わることを確認する。試験削除0件（累計3件）。
- 関係232/232件合格（`/tmp/v7rm2-eventwizardpublish1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventwizardpublish-type1.log`）/差分検査合格。現役の中身/配置/CSSは変更なし。次は残る3件（枠の識別2/部分失敗1）とソース契約を移して旧Wizardを削除する。

### イベント：旧Wizardの枠の識別・部分失敗の試験（移行完了）

- 残った動作3件を現役の編集へ移した。早い日時を追加して公開設定を保存しても枠の更新が0件、先頭へ新しい枠が入っても選んだ元のIDだけを更新、一括追加の1件成功後は残り2件だけを元と同じ鍵で再送、を実際の入力/表/行末メニュー/確認窓とAPIで確かめる。
- 現役のV8の時刻入力は文字を入れてblurで確定する形へ試験の操作を更新。旧プルダウンのポップアップを残したまま別の欄を操作することを避け、開始・終了の値もAPIで確認する。一括は確認前API0件と全3件の鍵の一意性も追加。試験削除0件（累計3件）。
- 関係232/232件合格（`/tmp/v7rm2-eventwizardslots2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventwizardslots-type1.log`）/差分検査合格。旧Wizardの実描画を読む試験は全て現役へ移行済み。次は残るソース契約を移し旧本体を削除する。

### イベント：旧Wizard本体・旧KPI（除去完了）

- 削除前に残った最初の枠の契約4件/共有保存値14件/確認窓4件/長文欄の契約1件、番兵/禁止文言/部品利用先/設計負債の読者を確認。動作試験は前の小分けまでに全て現役へ移行済み。旧Wizard1639行を削除。入口からも試験からも読まれない旧KPIも読者0件を確認して削除。
- 最初の枠は現役の作成の日時/終了時刻/定員と固定の再送防止キーへ、追加・削除・部分失敗の契約は継続先の編集へ、長文欄は現役の編集の共通TextAreaへ移した。取消期限のnull=不可/締切の既存値/版競合/承認期限/日本時間/変更後の再取得は保持。作成と編集の同じ既定値・字数上限・横断対象の解決器を共用し、既定値の写しを無くす。現在の表示文字・配置・CSSは変更なし。
- 共通の見本選択の試験に旧アクション作成の上書きCSSの固定が残っていたため、同じ1件を現役のEntityKindField/共通の選ぶ欄へ移した。旧番兵/禁止文言/直書きの登録を外して現役を見張る。試験削除0件（累計3件）。
- 関係268/268件合格（`/tmp/v7rm2-eventwizardremove3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventwizardremove-type1.log`）/差分検査合格。次は旧の見本窓・お客様表示の外枠。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：旧の申込見本の窓（除去完了）

- 削除前に旧見本を直接描く1件と共通Buttonの登録を確認。入口から使われない旧見本の窓を削除。元の1件は現役の実際のDialogと入力/申込ボタンを描く形へ移し、窓の見本を使う試験をやめた。
- 書きかけの住所と日本時間の枠をAPIへ送り、住所を表示し、申込が押せない動きを保持。旧側だけにあった会場URLへの行き先を現役の同じ会場名へ最小で移し、同じ試験でリンクも検査（上の確認表）。URLは管理者が見本APIへ渡した値。お客様表示の別画面で確定前にオンラインURLを出さない契約は維持する。
- 試験削除0件（累計3件）。関係232/232件合格（`/tmp/v7rm2-eventpreviewcopy1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventpreviewcopy-type1.log`）/差分検査合格。次はお客様表示の外枠。共通/CSS/CI・全体検査・画像比較は未完了。

### イベント：お客様表示の外枠（除去完了）

- 変更前に未指定/取得失敗/正常/アカウント切替の動作4件と、共通Buttonの登録を確認。現役の置き場へ移し、入口を3行にした。旧のカード・パンくず・時間の箱を共通の詳細画面/段/画像枠/表/空状態へ最小で移す（上の確認表）。オンラインURLを出さないまま、説明と会場・公開中の時間と定員を保持する。
- 4件を保持し、未指定の通信0件/読み直しで回復の検査を強め、非公開の枠を出さず空状態になる1件を追加。店/イベントごとに描き直し、切替直後に前の内容を見せない。実際にはURLを出さないのに「全部見えています」とする旧の注記だけを実態に合わせた。試験削除0件（累計3件）。
- 関係233/233件合格（`/tmp/v7rm2-eventpreviewroute2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-eventpreviewroute-type1.log`）/差分検査合格。イベントの旧入口/フォーム/写しの除去は完了。次は残る別機能。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：一覧の入口（固定完了、旧の写しは次）

- 変更前に入口の書きかけ保護6件/作成の行き先と再読込2件/429案内2件を確認。旧一覧への分岐を外し現役V8へ固定。取得/保存/タブ別の失敗/紹介文の保存と離脱/続きの取得は元の処理のまま。読み込みの旧の余白箱だけを共通状態へ置き換えた。
- 旧の「選ぶ」ボタンと行操作の読み上げ名の固定を、現在の行のリンクと共通の行末操作へ更新。役割を読む現在の画面には試験の管理者を用意し、未保存の確認/破棄/APIエラーの案内を全件保持。試験削除0件（累計3件）。
- NEN関係152/152件合格（`/tmp/v7rm2-nenentry3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenentry-type1.log`）/差分検査合格。現役の一覧の中身/配置/CSSは変更なし。次は旧一覧を直接描く動作試験を現役へ移し、旧の写しを削除する。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧一覧の実描画（移行完了）

- 旧概要を直接描く誕生日方針2件/履歴検索5件/再送の条件4件/コラム件数と確認と日時6件/停止再開2件の計19件を確認し、現役V8の実部品へ参照先を移した。試験固有の役割/Routerを共通の土台へ用意。現役の自動検索は二段階の待ちのあとサーバへ渡るので、旧の送信フォームを押す操作から入力して待つ操作へ変更。URLに残る条件は各試験開始時に戻す。
- 上限5回/理由500字/回答済みや友だち側の事情では再送しない/検索語を絞り込みとページ送りでも保持/空状態で解除/誕生日3択/全体件数と読み込んだ範囲/日本時間/過去と空の予約日時で操作不能の検査は全件保持。確認ボタンと説明の文字だけを現役へ更新する。
- 旧側だけのコラム配信の停止/再開を現役の既存の道具メニューへ最小で移した。同じ決めごとと既存APIを使い、停止中だけ送れない案内を出す（上の確認表）。履歴を離れた時は検索待ちを取り消し、前の窓から後の取得が始まらないようにした。通常の配置/CSSは変更なし。
- 試験削除0件（累計3件）。NEN関係152/152件合格（`/tmp/v7rm2-nenlistbehaviors4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenlistbehaviors-type2.log`）/差分検査合格。次は古い写しの残るソース契約を現役へ移して削除する。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：使われない一覧の写し（除去完了）

- 削除前に古い一覧を直接描く4件と用語の番兵/CSS寸法の登録を確認。入口から使われない919行の写しと253行の専用CSSを削除。3表の契約と紹介文変更の動作1件を、現役V8の同じ表/共通入力へ移す。文字の空白と読み上げ名だけを現役に合わせ、動作は保持。
- 用語の番兵を現役へ移し、削除した専用CSSと部品利用先の登録を外した。旧概要は入口から描かれなくなっているため、同じPagination利用先の契約から除外し、現役の利用先は保持。試験削除0件（累計3件）。
- 関係170/170件合格（`/tmp/v7rm2-nencopy2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nencopy-type1.log`）/差分検査合格。現役の中身/配置/CSSは変更なし。次は旧概要のソース契約と残る情報を引き継いで削除する。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧概要だけの情報・操作（引継ぎ完了）

- 旧概要の数字/見本/ヘッダー操作を守るソース契約を読み、現役で欠けることを確認。先月/注文と金額/送信失敗/解除/ブロックの数は既存の今月の補足へ移し、0と未取得を区別する。自動配信の題名と本文の見本は同じ代わりの名前・クーポン値へ置き換える。
- コラムの紹介文→記事カードの見本を既存の行末から共通のLINE表示の窓へ移した。書きかけの紹介文を使い、記事の画像/分類/題/抜粋/ボタンと「大切なご家族」の代わりの名前を保持。見本では配信もテスト送信もしない。EC取り込み/待機分を送る入口は、すでに親から渡る操作を現在のヘッダーへ接続。閲覧のみでは隠す（上の確認表）。
- 実描画3件を追加し、操作と権限/見本の画像と名前/数字と未取得を検査。試験削除0件（累計3件）。関係155/155件合格（`/tmp/v7rm2-neninformation3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-neninformation-type2.log`）/差分検査合格。通常の表/列/CSSは変更なし。次は旧概要のソース契約を現役へ移して本体を削除する。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧概要の契約と本体（除去完了）

削除前の読者：

|旧ファイル|直接読む試験|件数|処理|
|---|---|---:|---|
|nen-overview.tsx|取得と操作の契約/数が無い時/用語/登録済み送信先|14/4/4/7|同じ全件を現役へ移行。未取得と0の4件はソースの旧骨格から実描画へ変更|
|nen-overview.tsx|全文確認/表の操作欄/狭幅の操作/KPI/一覧の範囲/見出し|各1（範囲は2）|同じ契約を現役の列/共通の帯/現在の見出しと範囲へ変更|
|nen-overview.tsx|用語と禁止文言/未保存の番兵/部品利用先の登録|登録だけ|古い登録を外し、用語/取得/操作は現役を見張る。未保存の保護は親の実操作で移行済み|

- 旧概要1224行を削除。V6/V7の骨格・クラス・右パネル・旧の語や変数名の固定だけを、現役の選択中の操作/共通窓/行末操作へ変更。取得/タブ別の失敗/再送500字/紹介文1500字/日本時間/版と対象/未保存の検査は保持。古い不確かな宣伝の文字列を固定する表明は、現在のコラムの説明へ変更。
- 取得失敗でも自動配信とコラムが0になる箇所を直し、未取得と0の実描画4件で検査。旧側だけの下書きの「配信したい日時」も現役の同じ札へ残し、予約済みと混ぜない実描画1件を追加。配信名の省略では題名をtitleへ残す。通常の表/列/CSSは変更なし。
- 横断の試験に残った、移行済みアクション/重複検出/ウェビナーの旧骨格の固定も同じケースの参照先を現役へ移した。試験削除0件（累計3件）。関係276/276件合格（`/tmp/v7rm2-nenoverviewremove4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenoverviewremove-type2.log`）/差分検査合格。NENの一覧の旧分岐/写し/概要は除去完了。次は編集/コラム作成の旧側。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：紹介文の編集と編集の入口（移行完了）

- 変更前に読込競合1件/保存競合4件/記事一覧2件/各記事の保存2件と、字数上限/未保存/禁止文言/共通部品の番兵を確認。編集の入口を現役V8へ固定。鍵なしの紹介文編集は共通の詳細画面/段/入力/状態表示へ移した（上の確認表）。既存の配信編集の配置/CSSは変更なし。
- 記事ごとの1500字/版付き保存/相手の最新内容と自分の入力の比較/ほかの記事の書きかけ/離脱保護を保持。競合時の最新値なしの再取得でも全記事の入力を残すよう検査を強めた。同じ瞬間の二重保存と失敗後の再試行、閲覧のみでは変更操作を隠す2件を追加。試験削除0件（累計3件）。
- 関係175/175件合格（`/tmp/v7rm2-nencolumnintros3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nencolumnintros-type3.log`）/差分検査合格。次は使われない旧配信編集を読む動作と契約の移行。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧編集の保存・字数・未保存（移行完了）

- 旧編集を実際に描く本文と保存9件/保存500と競合2件を現役へ移した。4500字の保存/4501字で操作不能/API0/超過入力を切らない/差し込み展開の注意/実際の待機件数/リンクとブラウザを閉じる保護/版付き保存/競合時に自分の本文を残す動作を全件保持。試験の本文操作は現在の緑の札の入力へ変更し、説明は現在の「？」を開いて確認する。
- 超過時の保存を押せない動作を現役へ引き継いだ。競合は採用済みの比較を開いて最新を取り、入力を書き換えないことを確認。500の日本語案内も保持。試験削除0件（累計3件）。
- NEN関係158/158件合格（`/tmp/v7rm2-neneditorbehavior2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-neneditorbehavior-type1.log`）/差分検査合格。次は旧編集のフォーム/任意のマイルと残るソース契約。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧編集のフォーム・任意のマイル（移行完了）

- 旧編集を描くフォーム不足/非公開/公開の3件と、節と保存/マイルの範囲と任意入力の2件を現役へ移した。本文や既存のフォーム/版を送る検査は保持。削除済みフォームでは設定不足と欄の理由を示し、API0。非公開は理由付きで選べず、公開中を選ぶとそのID/名前を保存することまで確認した。
- 現役で失われていた任意のマイル入力は現在の選択欄から共通の窓/数の欄へ移す（上の確認表）。0では変更も保存もせず、350なら元のフォームとともに保存。店/配信/権限が変われば窓を閉じる。共通の候補変換は指定された選択不能をそのまま渡す口だけを追加し、未指定の他画面は変えない。フォーム不足の案内も欄の同じ場所へ保持。
- 試験削除0件（累計3件）。NENと共通の選ぶ窓171/171件合格（`/tmp/v7rm2-neneditorform2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-neneditorform-type2.log`）/差分検査合格。次は旧編集のソース契約と本体の除去。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：旧配信編集の本体（除去完了）

- 削除前の読者は実描画9+2+3+2件（前の小分けで移行済み）、文言4件/差し込み1件/テスト送信先7件/二重見出しの横断1対象と未保存/部品利用先/CSS寸法の登録。残った契約を現役へ移し、使われない512行の旧本体と280行の専用CSSを削除。
- 内部の起点名を出さない/誕生日は3日前10時固定/一覧へ戻る/共通の差し込み/1通/フォームとマイルの保存/選択中アカウントだけの候補と通信は保持。固定された旧の骨格と言い方だけを現役の同じ表示/操作へ更新。試験削除0件（累計3件）。
- 関係177/177件合格（`/tmp/v7rm2-neneditorremove1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-neneditorremove-type1.log`）/差分検査合格。NEN一覧と配信編集の旧側の除去は完了。次はコラム作成の分岐と旧の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：コラム作成の入口（固定完了）

- 変更前に作成の入口と日時ありの保存→一覧再取得の2件/旧部品を描く節と保存の1件を確認。入口の旧分岐を外して現役V8に固定し、旧部品の1件も現役へ移した。動作試験は現在の時刻の入力と確定へ操作を合わせ、日本時間の保存値と作成した行への印つきの戻り/再取得を保持。
- 試験削除0件（累計3件）。NEN関係158/158件合格（`/tmp/v7rm2-nencolumnentry2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nencolumnentry-type1.log`）/差分検査合格。現役の中身/配置/CSSは変更なし。次は旧作成の残るソース契約と見本の情報。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN配信：コラム作成の旧の写し（除去完了）

- 削除前の読者は実描画1件（前の小分けで移行済み）、保存位置1件/下敷きの入口1件/対象と予約と読了の操作を含む契約14件/未保存と共通部品とCSS寸法の登録。使われない旧作成279行とCSS162行、最後の旧見本101行を削除。現役と完全に同じ209行の入力/保存の写しも、24件の試験の参照先を現役へ移して削除した。
- 旧側だけで見えていた画像/分類は、同じ右欄の共通記事カードへ最小で引き継ぐ（上の確認表）。画像か分類を入れたときだけ使い、未指定の現在の見本は保持。画像/分類/題名/概要が見え、文字だけへ戻すと画像が消え、見本で保存しない実操作1件を追加。現在の欄/節/通常の配置/CSSは変更なし。
- 試験削除0件（累計3件）。関係175/175件合格（`/tmp/v7rm2-nencolumnremove2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nencolumnremove-type2.log`）/差分検査合格。NEN配信の一覧/編集/コラム作成の旧分岐と写しは除去完了。残る入口のテーマ参照44ファイルと共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：下書きの入口（固定完了）

- 変更前に対象IDの切替/未指定の実描画2件を確認。旧編集器への分岐を外し、現在のV8の下書き仕上げへ固定。ルールIDから開く経路と未指定の理由/戻り先は保持。対象IDがA→Bへ変わると初期値もBから作り直すことを同じ試験で強め、古い表示と保存先を残さない。現役の中身/配置/CSSは変更なし。
- 試験削除0件（累計3件）。自動処理関係160/160件合格（`/tmp/v7rm2-automationdraftentry1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationdraftentry-type1.log`）/差分検査合格。旧の共通下書き編集器は実描画/契約の読者が残るため次に移行してから除去する。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：一覧の入口（固定完了）

- 変更前に入口の二重取得を守る実描画2件を確認。現役の一覧/見本へ直接渡して旧分岐を外した。旧の印を入れる対照の1件は、旧設定が残っていても現役へ固定し別の取得を始めない見張りへ更新。同じ2件を保持し、試験削除0件（累計3件）。現役の中身/配置/CSSは変更なし。
- 自動処理関係160/160件合格（`/tmp/v7rm2-automationlistentry1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationlistentry-type1.log`）/差分検査合格。旧一覧を読む確認窓5件/状態12件/寸法4件/見本4件と横断の読者は次に現役へ移す。旧本体はそれまで保持し、死んだ実装だけで動作を守った扱いにはしない。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：旧一覧の操作の安全条件（引継ぎ完了）

- 旧確認窓と状態の契約を読んで、現役で欠けていた編集失敗の理由別案内/同期ロック/店切替後の応答除外/変更失敗後の再取得を移した。404と409の編集は一覧を読み直し、権限や通信・サーバ失敗は直し方を分ける。画面の通常の文字/配置/CSSは変更なし。
- 実操作7件を追加：編集を同時に押しても下書き1つ/切替後に古い下書きへ移動しない、403/404/409/500の案内と再取得回数、状態変更の連打と失敗後の読み直し/再試行、変更中の店切替で前の窓を出さず新しい店の操作を古いロックで止めないこと。古い応答で新しい一覧を上書きもしない。試験削除0件（累計3件）。
- 自動処理関係167/167件合格（`/tmp/v7rm2-automationlistsafety4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationlistsafety-type4.log`）/差分検査合格。次は旧一覧の残るソース契約と見本の情報。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：旧一覧の確認と取得の契約（移行完了）

- 旧確認窓5件/取得状態12件を現役の一覧と案内の処理へ移した。同期ロック/店と権限/失敗後の再取得/未取得と0/通信の世代/作成と状態変更/一覧の範囲を全件保持。旧変数名・骨格・窓の文言だけを現在の操作へ更新した。試験削除0件（累計3件）。
- 旧だけの削減時間を既存の説明へ移し、未取得は0にしない/取得した回数から1回30秒で求める実操作1件を追加（上の確認表）。閉じた通常の配置/CSSは変更なし。自動処理関係168/168件合格（`/tmp/v7rm2-automationlistcontracts-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationlistcontracts-type1.log`）/差分検査合格。残る寸法と見本の契約を移してから旧本体を削除する。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：一覧の旧本体（除去完了）

- 削除前の読者は確認5件/取得12件（前の小分けで移行済み）、寸法4件/見本4件と共通の帯/名前/利用先/見出し/用語の横断契約。寸法は現役の共通の帯のトークンへ、見本は現役の取得/絞込/冪等鍵と仕上げへの入口へ同じケースで移した。下書き編集の契約だけは、旧の共通編集器の動作試験を移すまで保持する。
- 使われない旧本体を除去し、一覧の入口を866行から27行へ整理。現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係222/222件合格（`/tmp/v7rm2-automationpageprune1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationpageprune-type1.log`）/差分検査合格。次は不要になった旧一覧と見本の写し/下書き編集/作成と実行記録。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：使われない一覧と見本の写し（除去完了）

- 削除前の読者：旧list-v8は板と操作の2件、旧templates-v8は板と取得/絞込の2件（ほかの寸法4件/見本4件は前の小分けで現役へ移行済み）。同じ4件も現役へ移した。共通の旧見本は本番の参照0/試験の参照0を確認。旧一覧527行/旧見本219行/専用CSS390行/共通の旧見本179行を削除した。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係206/206件合格（`/tmp/v7rm2-automationlistcopies1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationlistcopies-type1.log`）/差分検査合格。次は旧の共通下書き編集器の動作と契約。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：旧の下書き編集の実操作（移行完了）

- 旧共通編集を描く保存/処理の保持と日本時間5件、選択と設定の保持/空の日時6件を全件現役へ移した。2処理の順序/ID/中身を名前だけの保存で保つ。現役で不足していた既存IDの保持、新しく足す処理とのID重複防止、飲食8種類と店の指定の保持、未選択のきっかけのタグの保存停止を移した。保存しても動き始めない説明は既存の「？」へ残す。通常の代表3種類/配置/CSSは維持。
- 旧の選択の文字の順番は現役の全種類のラジオ/追加のメニューへ移した。通知の選択は旧では保存時に通常の文面に化けるため、その壊れた保存へ戻さない。共有の4種類を足せることと、既存通知のID/中身を実際の保存で保持することを同じ1件で検査する。読めない条件を直す安全条件も保持し、試験の空条件は正本の大文字へ揃えた。
- 試験削除0件（累計3件）。実操作2件/ID重複1件を追加。関係182/182件合格（`/tmp/v7rm2-automationdraftactual-all3.json`）、通知保持を強めた選択8/8件合格（`/tmp/v7rm2-automationdraftoptions4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationdraftactual-type3.log`）/差分検査合格。次は旧共通編集のソース契約と本体。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理：旧の共通下書き編集器（除去完了）

- 削除前の読者は実描画5+6件（前の小分けで全件移行済み）、見本から編集する契約4件の中の取得/保存/実データを選び直す/失敗の表明と未保存の例外登録。残る表明を現役へ移し、使われない旧編集器を削除した。現役の離脱保護は検査対象のまま保持する。
- 旧だけの保存失敗の日本語案内を現役へ移し、内部の英語は表示しない。既存の日本語のAPI案内や公開の結果不明の専用案内は保持。実描画1件を追加して失敗時の入力保持/同じ下書きへの再試行を検査した。通常の配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係208/208件合格（`/tmp/v7rm2-automationdraftremove1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationdraftremove-type1.log`）/差分検査合格。自動処理の一覧/見本/下書きの旧本体と写しは除去完了。次は作成と実行記録の旧側。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：再開の取得失敗（試験移行完了）

- 旧作成を描くR532の3件を現役へ移した。通信断では同じ下書きの再試行だけを出し、保存と新規作成をしない。再試行で読めた後だけ保存できる。404では明示で白紙に戻すまで保存せず、戻したURLからだけ作り直せる。成功の知らせは現役の右下の知らせへ検査先を移し、試験の土台は共通の画面の頭/移動を使う。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。3/3件合格（`/tmp/v7rm2-automationresumeactual1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationresumeactual-type1.log`）/差分検査合格。作成の旧入口は残る実操作/契約を移してから外す。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：選択肢とシナリオ保存（試験移行完了）

- 旧作成を描く3件を現役へ移した。全種類を開いたラジオの値と文言/順番は共有の正本に一致する。処理を足す候補は現在の編集可能な4種類を共有から確認し、既存通知の保存は前の仕上げの実描画で保持する。旧の通知が本文へ化ける選び口へは戻さない。
- シナリオ開始の1件は現役の行を削除→メニューからシナリオを足す→選ぶ窓で対象を確定→動かす前の確認→版付き保存/公開まで実際に操作する。対象のIDを送る検査は保持。現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。3/3件合格（`/tmp/v7rm2-automationnewoptionsactual1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationnewoptionsactual-type1.log`）/差分検査合格。作成の旧入口は残る実操作/契約を移してから外す。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：下書きの結び付けと店切替（試験移行完了）

- 旧作成を描く7件を現役へ移した。素の新規URLは古い控えを使わない/番号と中身と版で再開する/取得待ちは保存しない/応答消失と更新失敗の再試行は同じ冪等鍵/店別の入力と保存先/保存済みとその後の変更を全件保持。再開の保存は新版を読み直して成功することまで強めた。
- 試験用の共通操作を追加し、実際の行メニュー/タグの窓/処理の追加・削除を操作する。現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。移行済みの選択と再開を含む13/13件合格（`/tmp/v7rm2-automationidentityactual2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationidentityactual-type2.log`）/差分検査合格。次は条件とテスト送信/公開の安全条件。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：条件と人数確認（試験移行完了）

- 旧作成を描く4件を現役へ移した。名前の条件の要約/計算側が読める保存値/再開時の条件/古い文字列の条件は本人が外すまで保存しない/人数確認の失敗と再試行は保存と別を全件保持。条件は現役の窓を開いて共通の検索と入力を操作し、確定してから保存する。人数の語と数字の間隔だけを現在の表示へ合わせた。
- 保存を試した時の読めない条件の理由が現役で描かれていなかったため、既存の付け直す操作の下へ理由を移し、その操作へ読み上げの関係も付けた。通常の配置/CSSは変更なし。試験削除0件（累計3件）。関係183/183件合格（`/tmp/v7rm2-automationconditionactual-all3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationconditionactual-type2.log`）/差分検査合格。次はテスト送信/公開の安全条件。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：テスト送信と公開（試験移行完了）

- 旧作成を描く10件を現役へ移した。未保存時の送信停止/編集後の再保存/公開の失敗と同じ鍵での再試行/人数確認の失敗は公開とは別/対象と既存タグの指定/競合時の入力保持を全件保持。対象はIDの手入力ではなく、現役の友だちを選ぶ窓で指定する。共通の試験の土台も現在の操作へそろえた。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。作成と現役の関係32/32件合格（`/tmp/v7rm2-automationauditactual2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationauditactual-type1.log`）/差分検査合格。次は旧作成のソース契約と本体。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：旧入口の本体（除去完了）

- 削除前の読者：実描画27件（前の小分けで全件移行済み）、保存・権限・発火元の照合9件/段階的な選択と公開6件/曜日と友だち5件/はみ出し2件/未保存の例外。残る22件は現役の本体と共通の選ぶ窓・処理の行へ同じケースで移し、発火元と保存値の検査を保持した。閲覧だけの操作は現在の隠す形と内部の停止を確かめる。
- 旧作成の本体を除去し、入口はV8を直接描く。現在の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係181/181件合格（`/tmp/v7rm2-automationcreateentry-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationcreateentry-type1.log`）/差分検査合格。次は旧作成の写し・曜日/友だちの部品と実行記録。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の作成：使われない写しと選ぶ部品（除去完了）

- 削除前の読者：旧作成の写しは未保存の例外だけで本番からは読まれない。旧曜日/友だちは実描画6件、同じ99行の整形は8件、旧CSSは寸法3件/箱の例外/寸法台帳。6件と8件を現役へ移し、名前で探す/読み込みと失敗/札で外す/店が無いと選べない/余分なカンマと100人制限を保持した。候補は窓で確定するまで入力へ反映しないことも確かめる。
- 古い作成の写し2818行/曜日58行/友だち154行/整形99行/CSS456行（計3585行）を削除。寸法の3件は現役の共通カード/トークン/旧高さへ分岐しない入口へ移した。現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。
- 横断の骨格試験が以前移した10画面の旧節/文言を要求していたため、同じ20件を現在の入口/本体と共通の型へ移した（全151件の数は維持）。イベント/予約者/編集、ウェビナー作成/編集、運用状態、自動処理一覧/作成、NEN配信、担当者。古いJSONの文字の一致を見た目の証拠にしない。
- 関係356/356件合格（`/tmp/v7rm2-automationcreatecopies2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationcreatecopies-type2.log`）/差分検査合格。次は実行記録の旧側。入口のテーマ/旧専用値の参照43ファイル、共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の実行記録：取消・再試行・CSVの実操作（試験移行完了）

- 旧実行記録を描く監査8件/再試行3件を現役へ移した。店切替で詳細/取消の確認を捨てる/古い応答を別店へ書かない/通信と403と空の違い/再試行の応答消失を読み直して受付済みと示す/CSVの切れた件数と分け方/直リンクの失敗と再読込/受付後の再取得/409では実行したと言わない/閲覧だけでは操作を隠すを全件保持。役割は本物の権限処理が本人APIの返事で判断する。窓や行のメニューも差し替えない。
- 現役で欠けていたCSV上限の事前案内だけを、上限を超えた時の既存の帯へ最小で移した（上の確認表）。通常の配置/CSSは変更なし。試験削除0件（累計3件）。関係56/56件合格（`/tmp/v7rm2-automationrunsactual-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationrunsactual-type1.log`）/差分検査合格。次は実行記録の旧入口とソース契約。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の実行記録：旧入口の本体（除去完了）

- 削除前の読者：実描画11件（前の小分けで移行済み）、一覧/詳細/権限/CSV/再試行/応答の形とWorkerの状態の往復13件/ページ送り4件と横断の件数/帯/名前/失敗の案内/利用先。全17件を現役へ移し、画面・実口・見本の集計/行のキーと全状態の照合を保持。件数を選べる現在の口とlimit/offset/条件変更時の先頭戻しを確かめる。
- 旧本体を除去し、現役V8を直接描く入口だけにした。以前削除した作成の3ファイルと今回の旧実行記録のButton利用登録も除去し、件数は自動の実利用先と一致する。現在の中身/配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係137/137件合格（`/tmp/v7rm2-automationrunsentry2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationrunsentry-type2.log`）/差分検査合格。次はもう読まれない実行記録の写しと旧外枠/CSS。共通/CSS/CI・全体検査・画像比較は未完了。

### 自動処理の実行記録：使われない写しと外枠（除去完了）

- 削除前の読者：旧実行記録は失敗表明2か所の持ち越し/用語/利用先の登録だけで、本番からは読まれない。旧外枠はその使われない写しの型だけが読み、外枠の本番/試験の読者は0。現在の失敗表明の持ち越しと用語の検査は残す。旧実行記録695行/外枠126行/CSS1049行（計1870行）を削除し、登録も除去した。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係161/161件合格（`/tmp/v7rm2-automationrunscopies1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-automationrunscopies-type1.log`）/差分検査合格。自動処理の一覧/見本/下書き/作成/実行記録の旧側は除去完了。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー：切替のつながりの旧本体（除去完了）

- 削除前の読者：実描画2件、切替/取得/別店/古い応答/状態6件、型を確かめる契約1か所、取得失敗と対象未指定の横断契約/利用登録。旧設定の2件目は、旧値が残っていても現役V8へ固定する見張りへ更新。残る6件は現在のカードと実データからの行き来・取得の世代・再試行・所属の一致へ同じケースで移した。解析と戻り道の動作は現役の試験も保持。
- 旧本体を除去して現役へ渡す入口だけにした。現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係285/285件合格（`/tmp/v7rm2-richconnectionsentry2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richconnectionsentry-type1.log`）/差分検査合格。次は同じ解析の写しと使われない旧見出し、その後は一覧/作成/編集。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー：切替のつながりの写し（除去完了）

- 削除前の読者：旧見出しは本番/試験0、解析は本番0/試験5件。解析は現役と注釈以外121行すべて同じで、5件の参照先を現役へ移した。切替の無い時/正常な戻り道/切替先が消えた時/来られないページ/帰れないページの検査は保持。旧見出し30行と解析121行を削除した。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係288/288件合格（`/tmp/v7rm2-richconnectionscopies1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richconnectionscopies-type1.log`）/差分検査合格。次は一覧/作成/編集の旧側。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー一覧：集計と行の操作（試験移行完了）

- 旧一覧を描く集計4件/行メニュー1件を現役へ移した。公開中・下書き・タップ・最多・出し分けの実数/読み込み中は0と言わない/0と失敗を区別/店切替後の古い応答を捨てる/編集・表示先・複製・切替・削除を行のメニューへ集める検査を保持。旧撮影の印と状態属性への依存を現在の読み上げ名と見える状態へ置き換え、間隔と失敗の文を現在へ合わせた。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係288/288件合格（`/tmp/v7rm2-richlistactual3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richlistactual-type1.log`）/差分検査合格。次は一覧の旧入口とソース契約。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー一覧：旧入口・削除・取り込み（除去完了）

- 削除前の読者：一覧の描画5件（移行済み）/通し操作/タップ、一覧・削除・取り込み・並び替えなどを読む契約65件（各ファイル全体なので編集/作成の検査も含む）と横断の件数/フォルダ/余白/状態/利用登録。旧一覧1164行を7行のV8入口へ置き換え、同じケースを現役の取得/全件をそろえる入替/影響照合/共有の検索・空・フォルダへ移した。並び替えは全件読めた時だけ1口で保存、複製は現役の二重押下防止と一覧内の成功表示を守る。
- 横断の旧箱や札への依存も現在へ移行し、以前移した共通アクション/共通情報/メディア/重複候補の古い骨格の検査を同じ件数で修正。ButtonとPaginationの旧入口の利用登録を除去。
- 旧外部メニュー削除は呼ばれない関数を契約が支えていた。要件v6-12 §7のadmin以上の操作にあるため、現役の取り込み画面の「…」から既存の確認窓とAPIへ移した。確認前は送らない/同じ店に送る/店切替は確認を捨てる/閲覧のみは口を隠すを実操作3件で確認。置き方は上の確認表へ記録。通常の一覧/配置/CSSは変更なし。
- 試験削除0件（累計3件）。関係420/420件合格（`/tmp/v7rm2-richlistentry5.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richlistentry-type1.log`）/差分検査合格。次は使われない一覧/取り込みの写しと作成/編集。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー一覧：取り込み・判定の写し（除去完了）

- 削除前の読者：旧取り込み170行は本番/動作試験0、失敗表明とButton/箱の登録だけ。旧エラー50行は本番/試験0で現役と全文同じ。旧削除判定149行は本番0/試験16件で現役と人数の間隔以外同じ。旧並び順52行は現役作成の参照1/試験5件で現役と全文同じ。合計421行を削除し、21件と作成の参照は現役へ移した。未取得/部分集計/0/参照/影響の世代/安定した全件順の判定は保持。旧登録だけ除去。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係287/287件合格（`/tmp/v7rm2-richlistcopies2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richlistcopies-type1.log`）/差分検査合格。次は作成/編集の旧側。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー作成：店の候補と選択（試験移行完了）

- 旧作成を描くタグ2件/テンプレート2件を現役の4手順へ移した。下書きを再開して、現在の面の動きを操作し、共通の選ぶ窓で確定してから店を切り替える。タグ/テンプレートの取得に店IDが付く/前の店だけの選択を外して理由を出すを保持し、別店では元の下書きにPATCHしないことも同じケースで確認。
- 現役で欠けていた選択の除去を、共通の既存の判定で全タブへ移した。取得済みで同じ店の成功した候補だけを根拠にし、読み込み中・失敗は選択を消さない。古い店/古い再試行の候補の応答は捨てる。知らせは必要な時だけ既存の帯へ出し、通常の中身/配置/CSSは維持。別店の下書きは保存しない停止も移した（上の確認表）。
- 試験削除0件（累計3件）。関係317/317件合格（`/tmp/v7rm2-richcreateactual-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richcreateactual-type1.log`）/差分検査合格。次は作成の旧入口とソース契約。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー作成：未保存の離脱（試験移行完了）

- 旧作成を描く4件を現役の作成へ移した。未入力では確認しない/名前の入力後は離脱を止める/編集を続けると入力が残る/保存せずに移ると一覧へ進む/再読み込みは止めるを全件保持。現役のキャンセルと名前の読み上げ名を使い、窓は閉じる動きが終わってから消えたと判断する。編集側の42件はこの小分けでは維持。
- 現役の中身/配置/CSSは変更なし。試験削除0件（累計3件）。関係317/317件合格（`/tmp/v7rm2-richcreatedirty-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richcreatedirty-type1.log`）/差分検査合格。次は作成の旧入口とソース契約。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー作成：旧入口と画像の店切替（除去完了）

- 削除前の読者：実描画8件（前の小分けで移行済み）、作成の保存・登録画像を読む契約2ファイルの4件とButton利用登録。旧入口339行を7行の現役V8入口へ置き換え、保存値・候補・順序・未保存の表明は同じケースで現役へ移した。採用済みの作成本体 create-v8.tsx は現役なので保持する。
- 旧側にだけあった店切替時の画像選択の破棄を現役へ移した。前の店の画像と選ぶ窓を残さず、手元画像のURLも解放する。実操作1件を追加して別店へ画像を保存しないことを確認。通常の中身/配置/CSSは変更なし。
- 試験削除0件（累計3件）。関係330/330件合格（`/tmp/v7rm2-richcreateentry3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richcreateentry-type2.log`）/差分検査合格。次は編集の旧側。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：未保存と手順移動（試験移行完了）

- 旧編集を描く未保存5件を現役の4手順へ移した。読み込み直後は確認しない/変更後は離脱を止める/保存後は確認しない/相手の条件でも確認が届く/手順間では確認せず入力を保つを全件保持。現在のキャンセル・保存の読み上げ名と、URLを動かさず手順内で移る動きを使う。
- 現役では編集の読込と新規再開が重なり、戻れる手順を途中までに減らしていた。編集時は編集の読込だけを使い、すでにある4手順へ戻れる動きを残した。通常の中身/配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係319/319件合格（`/tmp/v7rm2-richeditdirty-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditdirty-type1.log`）/差分検査合格。次は編集の公開日時・条件・公開と履歴の試験、旧本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開日時の保持・破棄・店別の控え（試験移行完了）

- 旧編集を描く日時の保持7件/ブラウザの控え6件を現役へ移した。現在の日時の窓・時刻入力・終わりのチェック・戻すメニューの窓を実際に操作する。手順の往復/離脱の取消/明示破棄/保存失敗/予約成功/再読込/別メニューの控え/LINE登録後の除去を全件保持。期間の戻す先の復元と、日本時間をUTCへ直す予約の要求も同じケースで強めた。
- 現役で欠けていた明示破棄時の控えの除去と初期化、復元した控えを予約未完のまま扱う動きを移した。控えは入力したメニューだけへ書き、切替途中の入力を別IDへ写さない。すでに画面が持つ未保存の判断だけを使い、自動検出の二重登録で予約成功後も離脱を止める状態を解消した。通常の中身/配置/CSSは変更なし。
- 試験削除0件（累計3件）。関係319/319件合格（`/tmp/v7rm2-richeditplan-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditplan-type1.log`）/差分検査合格。次は条件の表示と公開・履歴の試験、旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：条件の保存状態と人数（試験移行完了）

- 旧編集を描く保存状態1件/空条件2件/未保存人数4件を現役へ移した。条件は現在の手順で直接直し、編集中の条件を人数APIへ渡す。保存済みと変更後を区別/未保存で数えた注記/保存済みには注記しない/空条件は相手・公開・右欄のどこでも0人で案内する検査を全件保持。形の手順の補足は既存の「？」で確認する。
- 現役に無い保存状態と未保存人数の説明は、既存の条件の補足・検査の文・人数の補足へ最小で移した。空条件の公開案内も全員へ出るように読める説明を0人へ揃えた。箱・並び・CSSは変更なし。説明の置き方は上の確認表へ記録。試験削除0件（累計3件）。
- 関係319/319件合格（`/tmp/v7rm2-richeditcondition-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditcondition-type1.log`）/差分検査合格。次は対象別の公開の説明・確認・複製の試験、履歴と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：対象別の公開の説明と確認（試験移行完了）

- 旧編集を描く公開の効果4件/確認4件/すぐ公開4件/日時と期間3件を現役へ移した。全員の既定・条件の順次切替・空条件0人・登録だけを区別する。いまの短い補足は残し、詳細は同じ補足のtitleで確認する。確認窓は現役の共通窓を操作し、確定前・取消では公開しない。既存の通し1件も同じ確認を通す。
- 現役で対象未設定を全員の既定へ写していたため、対象未設定を保持する状態を移した。名前の編集や公開でも全員化しないことを実際の更新要求で確認。登録のみの完了も全員へ出たと言わない。既存の案内の帯は条件の順次と登録のみを言い分け、通常の箱/並び/CSSは維持。確認窓と説明の置き方は上の確認表へ記録。
- 試験削除0件（累計3件）。関係319/319件合格（`/tmp/v7rm2-richediteffect-all2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richediteffect-type1.log`）/差分検査合格。次は複製・履歴・検査と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：複製の成功・失敗（試験移行完了）

- 旧編集を描く複製2件を現役の公開済み詳細へ移した。現在の「そのほかの操作」→複製→共通の確認を実際に操作する。成功は一度だけ複製し、窓を閉じてコピーの手順①へ進む。失敗は窓と再試行口を残し、内部の英語ではなく現在の日本語の理由を出す。成功の知らせだけ、現役の共通の右下通知へ移した。
- 編集の同ファイルの42件はすべて現役の作成/詳細へ移行済み。旧編集の読込・旧日時の選択・旧手順の試験用の土台は除去。移動のモックは同じルーターを返し、再描画で読み直しを無限に起こさない。通常の中身/配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係319/319件合格（`/tmp/v7rm2-richeditduplicate-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditduplicate-type1.log`）/差分検査合格。次は公開の進み・履歴・実機検査・予約の再試行と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開済みの状態と旧設定の見張り（試験移行完了）

- 旧の公開手順の内部関数だけを描く2件を、現役の公開済み詳細へ移した。現在の状態と出す相手を確認し、旧設定が残っていても旧手順へ戻らないことを同じ2件で確かめる。旧の板を描くことを正とする試験を除去し、試験の件数は保持。文字と板の印は見た目の合格証拠とはしない。
- 共通の移動の試験の土台も、同じルーターを返す形にした。返す物が再描画ごとに変わり、読み直しが無限に続く状態を解消する。製品の画面/CSSは変更なし。試験削除0件（累計3件）。
- 共通の土台を読む221ファイルとリッチメニューの関係1484/1484件合格（`/tmp/v7rm2-richpublishedstate-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richpublishedstate-type1.log`）/差分検査合格。次は公開履歴・実機検査・予約の再試行と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：予約の通信断・再試行（試験移行完了）

- 旧公開手順と試験用の親だけを描く4件を、現役の作成/編集本体へ移した。実際の日時の窓・時刻入力・LINEの検査・下書き保存・予約まで通す。通信断/サーバの拒否は同じ内容を同じ鍵で再試行し、内容を直すと別の鍵にする。予約成功後は編集を開き直して次の予約を作り、別の鍵で送る。保存要求も2回の実処理として確認。
- 日時を確定する共通の試験操作を抽出し、編集の42件も同じ実際の選ぶ窓を使う。旧公開手順の内部関数を読む試験は0件になった。製品の中身/配置/CSSは変更なし。試験削除0件（累計3件）。
- 関係319/319件合格（`/tmp/v7rm2-richeditschedule-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditschedule-type1.log`）/差分検査合格。次は公開履歴・進み・実機検査と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開の進み・履歴（試験移行完了）

- 旧進捗5件/旧履歴2件を現役の公開済み詳細へ移した。読み込み中・失敗・未実行・処理中・完了と、履歴の応答が壊れた時を全件保持。再試行は試験用の関数でなく、現役の公開APIを実際に呼ぶ要求で確認した。
- 現役は進捗が存在するだけで完了としていたため、完了状態を区別し、処理中・未実行の説明を既存の本文へ最小で移した。通常の完了画面/配置/CSSは維持。試験削除0件（累計3件）。
- 関係284/284件合格（`/tmp/v7rm2-richeditprogress-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditprogress-type1.log`）/差分検査合格。次は実機検査・本人LINEのテストと旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開前の実機・LINE・ページ数（試験移行完了）

- 旧検査セクション4件を現役の編集本体へ移した。自前/LINE/実機/面の数を確認し、実機の記録とLINEの検査は実APIへの要求まで確かめる。取得失敗は画面を落とさず読めなかったと示す。すべて同じケースを保持。
- 現役で状態に持つ面の数は、既存の検査の補足のtitleへ移し、3行の現在の配置を保った。箱/並び/CSSは変更なし。試験削除0件（累計3件）。
- 関係313/313件合格（`/tmp/v7rm2-richeditcheck-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditcheck-type1.log`）/差分検査合格。次は本人LINEへのテスト・予約の取消と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：本人LINEのテスト適用・復元（動作移行完了）

- 削除前の読者：旧テスト適用は旧公開手順だけが読み、ソース契約1件だけが支えていた。要件v6-12 §5-6にあるため、現役の既存の実機確認の補足から共通の窓へ移す。連携済みの本人だけを宛先として明示し、任意の友だちは選べない。元のAPI/確認/同じ操作の鍵/適用前の表示の記録と復元を保持。
- 現役を実際に操作する13件を追加。確認前/取消は送らない・通信断の再試行は同じ鍵・二重押下は1口・4種類の復元結果を区別・復元不能な失敗には戻す口を出さない・未連携は案内だけ・staff/viewerは操作を隠す・店切替は古い確認を破棄を確認。旧のソース契約も現役へ移行した。窓の入口の置き方は上の確認表へ記録。
- 試験削除0件（累計3件）。関係326/326件合格（`/tmp/v7rm2-richedittestapply-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richedittestapply-type1.log`）/差分検査合格。次は予約取消・順番・取り下げの部分失敗と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開予約の一覧と取消（動作移行完了）

- 削除前の読者：公開予約の一覧/取消は旧公開手順だけにあり、予約の動作試験は旧内部の土台を読んでいた（前の小分けで現役へ移行済み）。欠けていた一覧/取消は現役の「いつ公開するか」の段から共通の窓/表へ最小で移した。既存APIと全7状態、期間/戻し先/再試行予定を保持。取消は未実行分だけで、閲覧のみは操作を隠す。
- 現役を実際に操作する12件を追加。取消成功後の再取得、実行開始との競合時の最新確認、二重押下1口、4種類の戻し先、取得失敗/再試行と本当の空の区別、閲覧のみと店切替を確認。窓の入口の置き方は上の確認表へ記録。通常の段/箱/CSSは維持。
- 試験削除0件（累計3件）。関係357/357件合格（`/tmp/v7rm2-richeditcancel-all1.json`、表の横断検査込み、収集失敗0）。ボタンの寸法指定を共通の正規値へ修正後、12/12件再確認（`/tmp/v7rm2-richeditcancel2.json`）、web型検査（`/tmp/v7rm2-richeditcancel-type2.log`）/差分検査合格。次は順番/形違い応答/取り下げの部分失敗と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：順番・取得の形・部分取り下げ（動作移行完了）

- 削除前の読者：旧編集の順番を読む契約1件、取得/画像/部分失敗の契約5件、公開失敗の保存状態の契約1件。現役の同じ取得/画像/下書き保存へ移し、取得だけを範囲にして形の検査を守る。現役で欠けていた1番始まりの順番変更は既存の順番の段から共通の数の窓へ移し、保存時は0番始まりへ戻す。
- 取り下げの部分失敗も現役へ移した。内部ID/英語を出さず種類ごとにまとめ、完全に片付くまでは確認窓に説明と再試行を残す。全部成功した時だけ従来どおり一覧へ戻る。置き方は上の確認表へ記録。通常の箱/並び/CSSは維持。
- 実操作8件を追加して、順番の保存/取消/閲覧のみ、形違い2種類の取得、部分失敗/成功/再試行を確認。試験削除0件（累計3件）。関係346/346件合格（`/tmp/v7rm2-richeditmissing-all2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richeditmissing-type2.log`）/差分検査合格。次は履歴の版の情報/照合後の案内と旧編集本体。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：公開版・修復後の案内・集計権限（動作移行完了）

- 旧履歴だけにあった公開中の版/面の数/下書きとの違い/履歴の版とLINE ID件数/失敗理由を、既存の説明と履歴のtitleへ移した。下書きが違う警告だけは見える共通帯で残す。再試行の窓に保存版と対象と、下書きが変わっていた時の停止理由を移し、修復の確認窓にも実際のずれと直し方を渡す。
- 修復後の未適用分は既存の知らせに件数と外部取り込みへの案内を残す。旧のowner/adminだけの履歴/進捗と、staff/viewerは集計だけを読む動きも現役へ移した。条件の編集も閲覧のみでは操作できない。通常のownerの行/箱/CSSは維持。補足と窓の置き方は上の確認表へ記録。
- 同じ旧契約4件を現役へ移し、公開履歴の実操作7件を追加。公開版/相違/未公開、保存版の再試行、読取り照合→確認→修復と残る取り込み、2役割の集計だけを確認。試験削除0件（累計3件）。関係353/353件合格（`/tmp/v7rm2-richedithistoryscope-all1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richedithistoryscope-type1.log`）/差分検査合格。次は旧編集本体と旧セクションの除去。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー編集：旧本体と旧セクション（除去完了）

|削除/置換する旧ファイル|元の動作試験/契約の読者|削除直前の残る読者|
|---|---|---|
|edit/page.tsx（2254行→27行）|未保存/日時/条件/公開/複製42件・旧公開状態2件・予約の再試行4件、取得/順番/保存/権限の契約と横断の見張り。相対参照で旧だけを支えていた面の選択1件/共通部品3件/候補の店1件も現役へ移した|旧本体を描く動作試験0。残す入口の読者は現役へつながる|
|publish-progress-section.tsx（131行）|5件を現役の詳細へ移行済み|本番は旧本体だけ・試験0|
|publish-history.tsx（374行）|2件と契約2件を現役の詳細へ移行済み。現役の不足分の実操作7件も追加|本番は旧本体だけ・試験0|
|prepublish-check-section.tsx（175行）|4件を現役の編集本体へ移行済み|本番は旧本体だけ・試験0|
|test-apply-section.tsx（224行）|契約1件を現役へ移行済み。実操作13件も追加|本番は旧本体だけ・試験0|

- 旧本体/旧4セクションの3158行を、現役V8だけを読む27行の入口へ置き換えた（3131行除去）。ID/手順の指定と未指定の案内を保持。採用済み create-v8.tsx と、予定の控え/手動公開/予約の純粋な処理は現役なので残す。
- 旧入口の未保存の本文の例外、失敗文の持越し、Button5か所の登録を除去し、移した現役2部品を登録。ページ札の濃さは現役Stepsの色で同じケースを守る。ウェビナーの同じ横断の色の検査も、すでに除去済みの写しから現在の共通札へ同じケースで移した。予約一覧の取得失敗は現役の用語へそろえ、新たな禁止文の例外を足さない。
- 試験削除0件（累計3件）。旧V7の共通部品を正とする3件は現役へ書き換えてファイル名も更新。関係398/398件合格（`/tmp/v7rm2-richeditentry2.json`、横断検査込み、収集失敗0）、改名後3/3件（`/tmp/v7rm2-richeditentry-rename1.json`）、web型検査（`/tmp/v7rm2-richeditentry-type2.log`）/差分検査合格。リッチメニューの一覧/作成/編集の旧本体は除去完了。次は統括の例外時にも使われる旧共通フォーム、その後に残る各機能。共通/CSS/CI・全体検査・画像比較は未完了。

### リッチメニュー共通フォーム：統括の例外時もV8へ（移行完了）

|旧ファイル|削除前に読む試験|扱い|
|---|---|---|
|components/rich-menus/rich-menu-create-form.tsx|共通選択2件・旧部品3件・見本3件、作成/編集の契約8件、統括編集6件と保存未確定の試験|現役の統括で保存未確定/未対応参照時にも使うため、入力本体はV8共通部品へ移す。純粋な型/初期値/面の見本は現在も読むため保持|

- 入力・タブ・面の動作・出す相手・既定・画像の操作口を同じ状態/処理のまま、V8の共通の欄/選択/板/知らせへ移行。互換性エラーや保存未確定時の固定、複数ページ保持、面の編集/保存/取消を維持。古い進行表示だけを探す確認は現在の見出しへ更新し、名前変更の要求を同じ件数で守った。
- 旧の板2か所の例外を除去し、共有ボタンの読者登録を移行。旧部品の3件は現役の共有部品の確認へ移し改名。試験削除0件（累計3件）。関係693/693件合格（`/tmp/v7rm2-richcompat2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-richcompat-type3.log`）/差分検査合格。
- 通常の採用済み作成画面/詳細の配置/CSSは変更なし。例外時のフォームに対応する採用済みの絵は見つからず、最小の共通部品へ移した配置を司令塔に確認表へ記録。次は残る運営/テンプレート/流入/アカウント等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：ログイン・二段階認証（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/login/page.tsx|失敗理由3件・二段階6件・V8/旧表示2件・横断のログイン失敗契約/動作|V8だけを読む入口へ。現役は同じログイン要求/用途/二段階への秘密値の引渡し/権限確認/LINEログインを実装済み|
|ops/two-factor/page.tsx|確認失敗/成功/QR準備失敗5件・V8の未完成停止/QR再表示2件・横断のQR契約/動作・表示時読込|V8だけを読む入口へ。現役は同じ準備/確認/再試行/招待状態/ログアウト案内を実装済み|

- 旧本体を除去。旧表示を正とする1件は「旧テーマ指定でも現在のログインとLINEの口を出す」へ書き換え、試験の数は保持。横断のログイン/QRのソース検査は現役を読む。共有ボタンの旧読者2件を除去。
- 試験削除0件（累計3件）。関係40/40件合格（`/tmp/v7rm2-opsauth2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsauth-type1.log`）/差分検査合格。現在のV8の内容/配置/CSSは変更なし。次は運営ダッシュボード。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：ダッシュボード（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/dashboard/page.tsx（460行）|表記1件・表示/権限/同期/期間/再取得9件、行き先1件・V8表示1件・一覧失敗契約1件・数字重複1件|同じ動作を現在のV8で確かめ、V8だけの入口7行へ置換|

- 現役に欠けていた契約内訳/定価補完数/前月比/返金/新規/解約率/クローズ/初回返信の精密値/プラン割合/使用量と上限/LINE登録の分母を、現在の項目のtitleへ最小で移した。既存の見える文字/配置/CSSは保持。補足の置き方は確認表へ記録。
- 同じ動作試験の9件で、権限・12か月同期の要求・同期中停止・成功後の再読込・失敗後の押し直し・期間・未登録者一覧を保持。旧の印/骨格の期待だけを現在へ更新。V8の事前の未登録者取得には、そのAPIの応答を返す共通の試験の土台を付けた。横断の2要素API例外のソース検査も、前の小分けで除去した旧入口から現役へ修正。
- 試験削除0件（累計3件）。関係40/40件合格（`/tmp/v7rm2-opsdash2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsdash-type1.log`）/差分検査合格。次は運営のメンバー等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：メンバー管理（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/members/page.tsx（271行）|取得失敗/再取得2件・V8表示1件・一覧/例外契約3件・表の確認2件。現役にも役割の動作試験あり|V8だけの入口へ。招待/再送/停止/再開/本人の操作非表示/閲覧のみ/取得失敗を現役で保持|

- 現役で欠けた二段階認証の集計の分母・未設定数は既存の有効人数の補足のtitleへ、短縮した最終ログインの全文も同じセルのtitleへ移した。見える文字/配置/CSSは維持。
- 古い読み取り試験へ共通の移動の土台を足した。同じ一覧/例外/余白の契約は現在を読む。前のダッシュボードの余白の契約も現在の伸びる列/右寄せを同じ件数で確認する形へ移行。
- 試験削除0件（累計3件）。関係41/41件合格（`/tmp/v7rm2-opsmembers2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsmembers-type1.log`）/差分検査合格。次は運営の招待/監査等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：招待の受け取り（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/invite/page.tsx（179行）|期限切れ/使用済み/既存パスワード/新規設定4件、横断の確認失敗/再試行のソースと動作|V8だけの入口7行へ。招待値の引渡し・パスワード確認・登録後の二段階・403/429/通信断を現在の同じ処理で保持|

- 横断の招待のソース読者を現役へ移行。現在のV8の内容/配置/CSSは変更なし。共有ボタンの旧読者を除去。試験削除0件（累計3件）。関係21/21件合格（`/tmp/v7rm2-opsinvite1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsinvite-type1.log`）/差分検査合格。次は監査/問い合わせ等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：監査ログ（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/audit/page.tsx（272行）|日時/CSV2件・V8表示1件・一覧失敗2件・表の確認1件・件数/重複2件・ページ送りの利用先|V8だけの入口へ。50件のページ送り・同じ種類/日付の条件・500件ずつ全件CSV/2万件上限を現在へ保持|

- 現役に無いIPと契約先への公開範囲は理由のtitleへ、全件数と表示範囲は既存脚注のtitleへ移した。現在の列/見える文字/配置/CSSは維持。CSVの試験は全120件の内容・全件取得をそのまま検査し、保存名だけ現役の日本語規則へ更新。旧Tailwindの日時幅の固定は現役の折返し/幅の確認に同じケースで移行。
- 旧だけの表/件数/ページ送りのソース読者を現役へ移行し、実際に描く読者の一覧から旧入口を除去。試験削除0件（累計3件）。関係84/84件合格（`/tmp/v7rm2-opsaudit3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsaudit-type1.log`）/差分検査合格。次はお知らせ/問い合わせ等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：お知らせ配信（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/announcements/page.tsx（389行）|表記/一覧/送信/予約/未設定停止/入力検査/離脱/再実行キー/同時保存/保存後の版の11件、横断の失敗/再試行と未保存のソース|V8だけの入口へ。全ケースを現在の作成/確認/保存/競合で保持|
|announcements-v8.css（19行）|試験の読者0。本番は旧本体だけ|読者0を確認して除去|

- 旧だけにあった保存競合後の一覧の自動再読込を、現在の競合の帯へ移した。入力と元の版は残し、最新一覧を読み直す。現在の見える文字/配置/CSSは維持。置き方は確認表へ記録。
- 現在の送り方は画面/メールが初期値なので、LINE送信の試験は利用者が送り方を実際に選んで要求を確かめる。予約も実際の日時の窓→送る前の確認→APIまで通した。一覧の余白/旧文言だけを現在へ更新し、送信成功の知らせは共通の右下通知の要求で確認。未入力は現在の誤りの欄と無効状態を確認する。
- 下書きの選択は対象名で指定し、配信済みを写す口と区別。旧の未保存の登録とボタンの利用先を除去し、横断のソース検査は現在へ移行。試験削除0件（累計3件）。関係45/45件合格（`/tmp/v7rm2-opsann3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsann-type1.log`）/差分検査合格。次は運営の問い合わせ/契約先等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：お問い合わせ（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/support/page.tsx（926行）|表記3件・表示/返信/AI/知識処理の11件・起票2件・V8表示1件、横断の件数2件/未保存/利用先。現役にも続きを読む/書きかけ保持/送信後状態の3件|V8だけの入口へ。動作の全ケースを現役で保持|

- 初回返信/解決の集計と比較、受付/起票者/LINE登録の分母/過去件数、一覧の全件数/範囲、やり取りの日時全文、AIの作成時刻を既存の同じ項目のtitleへ移した。見える文字/配置/CSSは維持。補足は司令塔に確認表へ記録。
- 起票の試験は実物の契約先選択窓で相手を選び、APIの内容・成功の知らせ・窓が閉じることを守る。同じAI返信の試験も実物の確認窓から送信し、本文/AIの印を検査。旧の骨格/印/送り方の文言だけを現在へ更新した。
- 知識の1回だけの自動処理・読み取り権限・403停止・処理中の書きかけ保持・根拠の除外/蓄積・作り直し失敗・時間切れ後の手入力は同じケースを維持。旧の未保存の登録と共有ボタンの読者を除去。
- 試験削除0件（累計3件）。関係81/81件合格（`/tmp/v7rm2-opssupport3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opssupport-type2.log`）/差分検査合格。次は契約先/ナレッジ等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：契約先の一覧・詳細（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/tenants/page.tsx（289行）|起票3件・横はみ出し1件・失敗/再試行の横断ソースと動作・利用先|V8だけの入口へ。作成は現役の作成後一覧で示す動作を検査。代理ログインは現役の詳細の確認窓から使える|
|ops/tenants/detail/page.tsx（380行）|概要/余白2件・飲食店機能3件・代理ログイン確認/再試行2件|全ケースを現役で維持してV8だけの入口へ|
|tenants-v8.css・detail/detail-v8.css|前者は旧の横はみ出し契約1件、後者0件。本番は各旧本体だけ|横はみ出し契約を現役の伸び縮み/補助列を畳む確認へ更新して除去|

- 現役でも作成・検索/状態・詳細タブ・停止/アーカイブ/再開・飲食店機能の保存/再読込・代理ログイン確認/再試行を保持。飲食店機能の3件は保存値・読み直し回数・失敗時の未変更を検査。旧の余白クラス/行名は現在の板/項目へ同じ件数で更新した。
- 旧だけの利用/請求の両方の状態・請求/トライアルの両日付・最終ログイン全文を既存項目のtitleへ最小で移し、司令塔に確認表へ記録。通常の列/文字/配置/CSSは維持。移動と運営の本人取得の試験の土台を足した。
- 試験削除0件（累計3件）。関係46/46件合格（`/tmp/v7rm2-opstenants2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opstenants-type1.log`）/差分検査合格。次はナレッジ等。共通/CSS/CI・全体検査・画像比較は未完了。

### 運営：ナレッジ一覧・記事・問い合わせからの確認（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|ops/knowledge/page.tsx・components/ops/knowledge-list.tsx（141行）|一覧/件数/取得失敗の4件、横断の失敗/再試行、帯1件・旧狭幅2件・ページ送り/利用先|現役の一覧を読むように全ケースを移行し、旧一覧を除去|
|components/ops/knowledge-editor.tsx（185行）|記事/根拠/保存/承認/再試行の9件。現役の問い合わせの2か所から使う確認窓|V8の記事本体へ共通化する8行の窓の入口に置換。元の問い合わせが未解決なら承認を止める動きも移行|
|ops/knowledge/{knowledge,article}-v8.module.css（計33行）|本番の旧一覧/旧記事のみ。直接の試験読者0|読者0で除去|
|components/ops/knowledge.module.css（202行）|旧狭幅の2件。現役は回答の根拠の7種類のクラスだけ使う|現在の根拠表示の見た目を保ち、残りの旧一覧/返信/記事のCSSを除去|

- 一覧の検索/種類/記事の種類/状態/50件送り・明示して開く・見送る/無効は現役に保持。記事の保存してから承認・版の引渡し・元の根拠が古い時の停止・回答無し時の停止・失敗後の再試行・承認済み変更の警告を同じケースで確認。旧の印/ボタン名だけを現在へ更新した。
- 現役の記事を問い合わせからの共通の窓でも使い、元の問い合わせが未解決の場合の2つ目の確認/赤帯/承認禁止を移した。通常の全画面の内容/並び/CSSは維持。記事の種類と元の件名は既存の根拠のtitleへ移し、置き方を確認表へ記録。
- 旧の狭幅のカード骨格を固定する2件は、現在の項目/伸び縮み/省略した全文を読む同じ2件へ更新。帯/ページ送りの利用先と未保存の登録も現在へ移行。試験削除0件（累計3件）。関係73/73件合格（`/tmp/v7rm2-opsknowledge2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-opsknowledge-type2.log`）/差分検査合格。次はNEN会員/健康/ペット等。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN会員：入口のV8固定（旧タブの除去は継続中）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/members/page.tsx（160行）|未選択/選択2件・アカウント応答/保存の世代1件・形違い1件・横断の未指定1件|全ケースを維持し、現在のV8のタブを使う入口へ固定|

- APIの取得/対象スナップショット/古い応答の破棄/選択中だけの保存反映は共通の状態と処理をそのまま残した。試験のタブの捕捉先を現在へ移し、パンくず/移動の共通の土台を足した。現在の画面の内容/並び/CSSは変更なし。
- 試験削除0件（累計3件）。関係21/21件合格（`/tmp/v7rm2-nenmembersentry1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenmembersentry-type1.log`）/差分検査合格。会員の旧タブ/旧写しはまだ残る。次はそれらの読者/動作を現在へ移して除去。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN会員：旧の会員一覧の除去（設定/旧写しは継続中）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/members/members-tab.tsx（216行）|逆順応答1件・列幅1件・設定の表契約2件内の一覧・帯の契約1件・ページ送りの利用先|全ケースを現在の一覧/帯/共通グリッドへ移行して除去|

- アカウントBを開いた後にAの応答が届いても混ざらない試験を保持。旧の列のクラス文字を固定する確認は、現在の同じグリッドと見出し/行の両方で列を畳む確認へ更新。数字の帯/ページ送りの利用先は現在へ移行した。
- 旧だけにあるペット未登録の条件は、現在のペットの札を選んだ時だけ出す共通の選択欄へ移した。札の選択→登録ありの要求→未登録の要求→札解除で全員の要求を実物で確かめる試験を1件追加。通常の文字/配置/CSSは維持。置き方を司令塔に確認表へ記録。
- 試験削除0件（累計3件）。関係41/41件合格（`/tmp/v7rm2-nenmemberslist4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenmemberslist-type2.log`）/差分検査合格。ランク設定/ライフタイムの旧タブと読まれない旧V8の写しはまだ残る。次はそれら。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN会員：設定のアカウント切替の動きを移行（旧本体の除去は継続中）

- 旧ランク設定/ライフタイムの「切替で破棄したことを知らせる」動きが現役では無く、現役の既存の知らせへ移した。タブ自身がアカウントを確認して入力/競合/確認窓/処理中を戻し、対象ごとに印を持って切替前の保存・削除・同期・取得の応答を採用しない。通常の文字/配置/CSSは維持。置き方を確認表へ記録。
- 旧の切替/保存4件を現在のタブへ移し、ライフタイムは実物の「…」→編集の窓から入力する。保存中にA→B→Aと戻っても古いAの応答で新しい入力が消えない1件を追加。動作試験は削除なし。
- 関係15/15件合格（`/tmp/v7rm2-nenmemberstarget3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenmemberstarget-type2.log`）/差分検査合格。試験削除0件（累計3件）。ランク設定/ライフタイムの旧タブと旧V8の写しはまだ残る。次は残る読者/動作を現在へ移して旧本体を除去。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN会員：読まれない旧V8の写し（除去完了、旧設定タブは継続中）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/members/members-v8.tsx（1152行）|集計の帯2件・並び替え1件・同期日時/CSV/固定値/保存競合3件、未保存とボタンの利用先。本番の読者0|同じ6件を現在の帯/一覧/設定に移し、読者0の写しを除去|
|nen/members/members-v8.module.css（404行）|本番は旧写しだけ。試験の直接の読者0|旧写しとともに除去|

- 数の帯は実データと未取得、並び替えはAPIの新しい並びの要求を同じケースで確認。設定の日時/CSV/基準ランク/競合の3件は現在の外枠を使い、現在の共通の日付の桁と帯の文言だけに更新。試験の現在日時を固定し、日本時間の時刻を確認する。
- 現役の帯に無い競合の日付は同じ場所のtitleへ移した。見える文字/配置/CSSは維持。補足の置き方を確認表へ記録。旧の未保存の登録/共有ボタンの利用先を除去。
- 試験削除0件（累計3件）。関係53/53件合格（`/tmp/v7rm2-nenmemberscopy3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenmemberscopy-type2.log`）/差分検査合格。次は旧ランク設定/ライフタイムの残る読者/動作を現在へ移して除去。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN会員：旧ランク設定/ライフタイム（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/members/rank-settings-tab.tsx（340行）|行操作5件・保存失敗1件・追加位置1件・表契約4件内、未保存/ボタンの利用先。本番0|同じ動作/現役の列幅/共通部品を確認し、旧本体を除去|
|nen/members/lifetime-tab.tsx（221行）|保存失敗1件・列幅1件・追加位置1件・表契約3件内、帯/未保存/ボタンの利用先。本番0|同じ失敗案内/現役の列幅/帯へ移行して除去|
|nen/members/rank-view.tsx（40行）|直接の試験0。本番は除去する旧ライフタイムだけ|現在の純関数はpartsにあるため旧の札/金額の写しを除去|

- 保存403/429は生の失敗文を出さず共通案内、保存済み削除は確認前に送らず移し先/版を送信して読み直す、未保存の行はAPI/確認なしに外す。同じケースを現役で実行。旧の幅/文字固定だけの契約は現在の同じ列/省略全文/追加位置へ更新した。
- 旧の通年/累計/マイル残高/今月使用を既存の帯のtitleへ移し、タグ無しのランクの会員数も既存のtitleで読める。通常の内容/配置/CSSは維持。補足の置き方を確認表へ記録。入口の動きの文書をV8固定/対象の世代/破棄の知らせに更新した。
- 試験削除0件（累計3件）。関係67/67件合格（`/tmp/v7rm2-nenmemberstabs3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenmemberstabs-type1.log`）/差分検査合格。NEN会員の旧本体/旧写しは除去完了。次はNEN健康日記/ペット。共通/CSS/CI・全体検査・画像比較は未完了。

### NEN健康日記（旧の全画面/旧写しの除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/health/page.tsx（152行）|まとめの対象/遅い応答/印刷3件・失敗2件|現役の対象/世代の処理を同じ5件で実行し、入口だけへ固定|
|health-tab.tsx（267行）|体重の棒2件・狭幅の契約3件・帯とページ送り|同じ2件を現役の棒へ、契約3件を現在の幅/省略全文へ移す|
|summary-drawer.tsx（167行）/print.css（34行）|種別の印刷1件・カード例外1行|現役の印刷面で種別を保持。印刷CSSは現在に同じものがあるため除去|
|items-tab.tsx（63行）|直接の試験0・本番0|現在の項目表だけへ固定して除去|
|health-v8.tsx（633行）/health-v8.module.css（393行）|一覧/項目/行操作/まとめ4件、本番0|同じ4件を現役の表と行メニューへ移して旧写しを除去|

- 閉じた後の遅いAの応答がBのまとめ/印刷を入れ替えない、B取得中は印刷不可、アカウント切替でまとめ/印刷を閉じる3件を現役で確認。失敗403/429の案内/読み直し2件・その他の種別を犬に変えない印刷1件は同じケースで保持した。
- 旧モバイルのカード/Tailwindの文字固定は、現在の狭い板で見出し/行をともに畳む・省略全文の同じ3件へ更新。横断契約に残っていた旧成果地点の骨格1件も既に移行済みの現役一覧へ更新。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 関係53/53件合格（`/tmp/v7rm2-nenhealth4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenhealth-type2.log`）/差分検査合格。次はNENペット。共通/CSS/CI・全体検査・画像比較は未完了。

### NENペット：入口のV8固定（旧の本体は継続中）

- 入口の136行の旧のCSV/一覧/主食の分岐を外し、現役の外枠だけへ固定。CSV安全性の契約2件は現役のpartsにある同じ共通csvCell/種別ラベルを確認する。現役の内容/配置/CSSは変更なし。
- 関係10/10件合格（`/tmp/v7rm2-nenpetsentry1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenpetsentry-type1.log`）/差分検査合格。試験削除0件（累計3件）。次は旧の主食/一覧/編集/旧V8写しの読者と動作を移行。共通/CSS/CI・全体検査・画像比較は未完了。

### NENペット：旧ごはん設定（除去完了、一覧/編集/旧写しは継続中）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/pets/feeding-tab.tsx（364行）|アカウント切替3件・保存/取得失敗2件、未保存/ボタン利用先。本番0|同じ5件を現役へ移し旧本体を除去|

- 未保存の切替はその瞬間にデータ/入力/処理中を捨て、既存の知らせで破棄を伝える。親のキーで知らせを捨てない。逆順の取得/切替前の保存成功/失敗は世代で捨てる。取得の429は共通の混雑案内へ渡す。
- 元の5件を現在の商品名→入力の操作へ移し、切替前の保存失敗がBの入力/案内/保存状態を変えない1件を追加。通常の内容/配置/CSSは維持。知らせの置き方を確認表へ記録。
- 関係20/20件合格（`/tmp/v7rm2-nenpetsfeeding3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenpetsfeeding-type2.log`）/差分検査合格。試験削除0件（累計3件）。次は旧ペット一覧/編集/旧V8写し。共通/CSS/CI・全体検査・画像比較は未完了。

### NENペット：旧一覧/編集/旧写し（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|nen/pets/pets-tab.tsx（319行）|器の取得2件・操作/幅/全文7件・帯/ページ送り/カード例外|同じ2件を現在の一覧へ、旧の幅固定7件を現在の共通メニュー/列/全文へ更新して除去|
|nen/pets/pet-editor.tsx（172行）|保存500/競合409の2件・ボタン/未保存の利用先。本番0|同じ2件を現役の窓へ移して除去|
|nen/pets/pets-v8.tsx（923行）/pets-v8.module.css（538行）|一覧/ごはん設定/失敗3件・未保存/ボタン/カード例外、本番0|同じ3件を現役へ移して旧写しを除去|

- 保存500は共通の日本語案内を出し、生の失敗文を出さず入力/版を保持。競合409の入力保持/版更新/再読込は現在の同じ処理で確認。APIの器が想定と違えば、旧と同じく読み込み失敗にする確認を現役へ移した。
- 旧のボタン/幅/カード/Tailwind文字の固定7件は現在の共通メニュー/見出しと行の幅/狭い板での列の畳み方/省略全文へ更新。避妊去勢と運動量の全文は既存の文字のtitleで読める。通常の内容/配置/CSSは維持。
- 関係60/60件合格（`/tmp/v7rm2-nenpetslist3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-nenpetslist-type2.log`）/差分検査合格。試験削除0件（累計3件）。NEN会員/健康日記/ペットは旧本体/旧写しの除去完了。次は飲食/テンプレート/流入/アカウント等。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：承認/組織/利用規約の入口（V8固定、旧本体は継続中）

- 承認/組織の各11行の分岐と利用規約32行の旧本文の骨格を外し、現役V8だけへ固定。旧入口を直接読む動作試験0。規約の本文/仮の表示/同意/目次は現役が同じ文書を読む。戻る口の1契約は現役の採用済みパンくず「店舗を追加」へ更新した。
- 関係47/47件合格（`/tmp/v7rm2-restaurantentries2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantentries-type1.log`）/差分検査合格。試験削除0件（累計3件）。通常のV8の内容/配置/CSSは変更なし。次は本番の読者0になった旧飲食コンソールと未使用の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食の旧コンソール：動作試験の移行（旧本体の除去は継続中）

- 旧コンソールを直接描くR107の7件を現役の卓/メニュー/組織へ移した。変更→保存→停止確認、停止済みの再開3件、昼夜両方の設定保持を同じケースで確認。現役の行メニュー/確認の口だけへ操作を更新し、所属変更の再実行キー/版を含む要求の実際の形に合わせた。アプリ本体の変更はなし。
- 関係29/29件合格（`/tmp/v7rm2-restaurantconsole-runtime2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantconsole-runtime-type1.log`）/差分検査合格。試験削除0件（累計3件）。次は残る読み取り契約を現役へ移して旧コンソールを除去。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食の旧コンソール（除去完了、旧V8写しは継続中）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|restaurant-test/restaurant-console.tsx（738行）|R107動作7件（前の区切りで移行済み）、台帳/集計/承認5件、取り込み/店舗2件、名簿3件、取得失敗2件、未登録の案内1件、横断契約の利用先。本番0|すべて同じケースを現在の予約台帳/店舗集計/承認/組織/外枠へ移し旧本体を除去|

- 予約の期間/状態/ページ送り、取消の確認と在庫を戻す案内、版を付けた取消/復活、固定の客単価を使わない集計、LINE異常、承認の前後、取り込みアドレスの発行/コピー/再発行、使用中LINEの選択不可、名簿と権限の区別、取得失敗の読み直しを保持した。コピーは現役の共通部品の処理を確認する。
- 関係50/50件合格（`/tmp/v7rm2-restaurantconsole-source1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantconsole-source-type1.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。次は未使用の飲食V8写しと店舗追加。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用の承認/集計/LINEフォローの写し（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|restaurant-test/v8/approvals.tsx|価格反映の失敗/開始待ち2件、本番0|同じ2件を現在の承認へ移し、成功は現在のトーストで確認|
|restaurant-test/v8/dashboard.tsx|直接の試験0、本番0|現在のダッシュボード/店舗集計に固定済み。旧写しを除去|
|restaurant-test/v8/line-followup.tsx・line-followup.module.css|印/取得と保存/本送信の停止3件、本番0|同じ契約を現役のフォローへ移し、旧写しを除去|

- 関係18/18件合格（`/tmp/v7rm2-restaurantcopiesa3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantcopiesa-type2.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。次は店舗追加/残りの飲食の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：店舗追加（V8固定、旧の本文/同意の部品を除去）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|restaurant-test/stores/new/page.tsx（293行）|入力ラベル2件・離脱2件・案内1件・はみ出し4件・規約1件・HQ動線5件・アカウントからの手順1件、未保存/ボタン/題の横断契約|現役の同じ動作/幅の仕組みへ移し入口だけへ固定|
|terms-consent.tsx/terms-state.ts|規約同意/版/読了4件、ボタン/失敗の利用先。本番は旧入口だけ|同じケースを現在の同意/純関数へ移し旧部品を除去|

- 最後まで読む/チェック/同意保存、現行版だけ手順2へ、入力とラベル/補足の結び付け、離れると確認/継続で入力保持/破棄してHQへ、5段階と秘密値の入力を維持。現役で失われていた読み上げ補足を入力へ移し、現在の画面にある文字の読み上げ専用の説明へ結ぶ。見える文字/配置/CSSは維持。
- 旧の幅/Tailwindの固定4件は現在のflex/最小幅/確認の長い名前/規約の枠と表幅へ更新。同意済みの印は現在のStepsのdoneを確認。試験削除0件（累計3件）。関係51/51件合格（`/tmp/v7rm2-storeentry4.json`、収集失敗0）、web型検査（`/tmp/v7rm2-storeentry-type2.log`）/差分検査合格。次は残る飲食の写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用の組織の写し（除去完了）

- 旧の `restaurant-test/v8/organization.tsx` 574行の本番の読者0。直接読むログイン連携/本人確認して同じ鍵で再送/本人確認中止の3件を現役の変更窓と共通の選択/行メニューへ移した。ログイン役割と版は現役の補足で確認する。旧の未保存/ボタンの利用先も除去。
- 関係30/30件合格（`/tmp/v7rm2-restaurantorgcopy2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantorgcopy-type1.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。次はメニュー/在庫/予約/卓/Googleの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用のメニューの写し（除去完了）

- 旧の `restaurant-test/v8/menu.tsx` 245行/専用CSSの本番の読者0。直接読む数と一覧/再開/変更/変更と停止の確認/開始待ち/開始日時を添えた価格申請の7件を現在へ移した。開始待ちの新価格は現在の同じ札の補足、開始日時は共通の日時の窓から指定し、保存して申請する口へ送る。旧の未保存/ボタンの利用先も除去。
- 関係35/35件合格（`/tmp/v7rm2-restaurantmenucopy2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantmenucopy-type1.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。次は在庫/予約/卓/Googleの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用の在庫/予約経路の写し（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|restaurant-test/v8/inventory.tsx（496行）/inventory.module.css|一覧と配分/行の保存/媒体を閉じる記録/409/営業時間の版で生成/全枠の版付き保存6件、未保存/ボタンの利用先。本番0|同じ6件を現役の下の保存/媒体の実データ/比較の窓へ移し除去|
|restaurant-test/v8/inventory-channels.tsx（147行）|取り込みアドレス/媒体/読めないメール1件、ボタンの利用先。本番は旧在庫だけ|同じ1件を現在のAPIとタブへ移し除去|

- 既存の枠に不足分を足す操作を現在の時間帯の頭の共通メニューへ移した。営業時間の保存後の新しい版を使い、既存の枠がある状態でも同じ生成APIへ送る。確認表に配置を記録。通常の表/列/CSSは維持。
- 関係30/30件合格（`/tmp/v7rm2-restaurantinventorycopy3.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantinventorycopy-type1.log`）/差分検査合格。試験削除0件（累計3件）。次は予約/卓/Googleの写し。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用の予約台帳/電話予約の写し（除去完了）

- `restaurant-test/v8/reservations.tsx` 939行/専用CSS・`reservation-phone.tsx` 421行は本番の読者0、直接読む動作/読み取り試験0。旧の未保存/ボタンの横断契約だけが読んでいたため、現役の見張り先を残して旧の利用先を除去。現在の変更/押さえの解除/電話予約/不足入力/閲覧のみ/期間と取消・復活の試験は保持した。
- 関係36/36件合格（`/tmp/v7rm2-restaurantreservationcopy1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantreservationcopy-type1.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。次は卓/Googleと最後の旧外枠。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用の卓の写し（除去完了）

- `restaurant-test/v8/tables.tsx` 260行/専用CSSの本番の読者0。直接読む8件を現役へ移した。数/詳細/自動配席/結合線と卓の選択、変更/停止の確認/再開、数値の座標と結合グループ、配置の保存と失敗を保持。旧の未保存/ボタンの利用先も除去。
- 旧の列順を入れ替える配置2件は採用済みの座席図（`restaurant-fusion-contract.md` §座席図）に従い、現在の共通座席図を実際にドラッグして、階の版を付けて保存→再取得した座標、保存失敗の入力保持/保存済みの座標が変わらないことへ更新。動きの試験は同じ2件を残す。現役の内容/配置/CSSは変更なし。
- 関係41/41件合格（`/tmp/v7rm2-restauranttablecopy2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restauranttablecopy-type2.log`）/差分検査合格。試験削除0件（累計3件）。次はGoogleと最後の旧外枠。共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：未使用のGoogleの写しと旧外枠（除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|restaurant-test/v8/google.tsx（346行）/google.module.css|一覧/状態の絞り込み/編集後の受信日時3件・子画面の印9件・用語/ボタンの利用先。本番0|12件を現役の一覧/URLの分岐へ移して除去。説明は現在のヘルプから読めることを確認|
|restaurant-test/v8/shell.tsx（235行）/shell.module.css|失敗の横断契約の例外1行。本番は未使用のGoogleの写しだけ|現在の外枠の取得失敗/再読込を保持し、旧外枠を除去|

- 関係54/54件合格（`/tmp/v7rm2-restaurantgooglecopy2.json`、収集失敗0）、web型検査（`/tmp/v7rm2-restaurantgooglecopy-type1.log`）/差分検査合格。試験削除0件（累計3件）。現役V8の内容/配置/CSSは変更なし。飲食のapp内のV8写しはすべて除去完了。**Googleのプロフィールの補助画面（営業時間/確認/履歴/編集）は旧の実装が現役のため、V8へ移す作業が残る**。テンプレート/流入/アカウント等・共通/CSS/CI・全体検査・画像比較も未完了。

### 飲食：Googleプロフィールの変更確認（V8へ移行完了）

- 旧 `google-profile.tsx` の変更確認とその表示の道具198行を除去。削除前に直接読む動作/読み取り試験は0件、旧入口だけが本番の読者。現役の外枠へ `profile-confirm.tsx` を追加し、通常のプロフィール/他タブの内容・配置・CSSは維持。採用済みV8の補助画面は見つからず、共通部品の最小の形を確認表へ記録。
- 同じ変更案の取得/送信/取消API、変更前後と影響範囲、予約への影響、確認チェック、権限/送信不可の環境、競合時の最新値と停止、反映確認中、失敗の案内、取消失敗時の内容保持、複数案を1件ずつ送る動作を保持。送信結果不明の再取得で消えていた案内を残し、同じ描画での連打も1要求へ制限する。
- 関係54/54件合格（`/tmp/v7rm2-profileconfirm2.json`、収集失敗0）。意味のある動作試験8件と現役のURLの行き先1件を追加し、試験削除0件（累計3件）。web型検査（`/tmp/v7rm2-profileconfirm-type2.log`）/差分検査合格。次はGoogleの営業時間/履歴/編集。テンプレート/流入/アカウント等・共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：Googleプロフィールの変更履歴（V8へ移行完了）

- 旧 `google-profile.tsx` の履歴112行を除去。削除前に直接読む動作/読み取り試験0件（横断のページ送り/カード/ボタンの契約は旧の残る実装も読む）、本番は旧入口だけ。現在の外枠と共通の表/道具の段/タブ/ページ送りへ移し、通常のプロフィール/他タブの内容・配置・CSSは維持。最小の補助画面の置き方を確認表へ記録。
- 同じ種類/結果/期間/300msの検索/ページ送り、件数/日時/担当/失敗理由、記録からクリック/キーボードで変更案を開く、現在の絞り込みでCSVを全ページ取得（100件ずつ最大25ページ）する動きを保持。古い検索応答は捨て、取得/CSV失敗後も再試行でき、失敗したCSVは保存しない。初期の空検索でページを戻していたタイマーも止める。
- 関係61/61件合格（`/tmp/v7rm2-profilehistory3.json`、収集失敗0）。動作試験6件と現役のURLの行き先1件を追加、試験削除0件（累計3件）。web型検査（`/tmp/v7rm2-profilehistory-type2.log`）/差分検査合格。次はGoogleの営業時間/編集。テンプレート/流入/アカウント等・共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：Googleプロフィールの編集（V8へ移行完了）

- 旧 `google-profile.tsx` の編集/自前の入力欄/写真の枠186行を除去。削除前に直接読む動作/読み取り試験0件、旧入口だけが本番の読者。現在の外枠と共通の入力/カード/画像枠/操作帯へ移し、通常のプロフィール/他タブの内容・配置・CSSは維持。最小の補助画面の置き方を確認表へ記録。
- 変更した項目/住所1件/写真の追加・削除を順に変更案にし、全件成功後に確認へ移る。途中失敗は作成済み件数を案内し入力を保持。変更案を作るだけではGoogleへ送らない。未保存の戻る/タブ/店舗の切替を共通の確認へ結び、成功後は警告を外す。写真の選択は旧と同じ画像60件/新しい順、失敗後に再試行でき、閉じた後の遅い応答を捨てる。休業/閲覧のみの制約、写真の取消/入力クリア、連打の重複防止も確認。
- 関係76/76件合格（`/tmp/v7rm2-profileedit5.json`、収集失敗0）。動作7件・外枠からの未保存確認1件・URLの行き先1件を追加し、番兵の横断契約へ現役の編集画面を追加（外枠は編集を持たず子の番兵に委ねる理由を記録）。試験削除0件（累計3件）。web型検査（`/tmp/v7rm2-profileedit-type3.log`）/差分検査合格。次はGoogleの営業時間。テンプレート/流入/アカウント等・共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：Google営業時間3方式・旧本体/プロフィール（移行/除去完了）

|旧ファイル|削除前の試験の読者|扱い|
|---|---|---|
|google-business.tsx（827行）|直接の動作/読み取り0件、ページ送り/ボタン/未保存/失敗/カードの横断契約|プロフィールの4補助画面をV8へ移し、本番の読者0を確認して除去|
|google-profile.tsx（744行、前の確認/履歴/編集を除去後）|比較範囲/未知の項目の導線R108・スマホの縦並びR109の2件、同じ横断契約|2件を現在のプロフィールと共通の縦カード/全幅時刻選択へ更新。営業時間3方式を現役へ移して除去|

- 文章の変更案/追加質問/失敗時の入力保持、カレンダーの日ごとの編集/複数日保持/休業/特別営業時間の取消・通常へ戻す案/日ごとの変更取消、毎週の編集/曜日の休業/変わった枠の比較、空の枠/同時刻/重複/最後以外の翌日跨ぎの停止、3枠/15分/24:00/最後の翌日跨ぎ、未保存の方式変更/戻る、休業/AI無し/閲覧の制約、クリア/連打の重複防止を保持。確認画面に移るだけではGoogleへ送らない。
- 日付の選択は共通のV8の暦（今日〜366日先）と登録済み/変更する日の一覧へ移す。通常のプロフィール/他タブの見える内容・配置・CSSは維持。比較範囲は既存の説明のtitleへ移し、最小の補助画面とともに確認表へ記録。未使用の旧Googleの全体グリッド/カレンダー/編集/比較/履歴/口コミ絞り込みのCSS44行も除去。
- 関係93/93件合格（`/tmp/v7rm2-profilehours4.json`、収集失敗0）。意味のある動作試験10件を追加、既存2件は現在の仕組みへ更新、試験削除0件（累計3件）。web型検査（`/tmp/v7rm2-profilehours-type3.log`）/差分検査合格。共通の利用先は現役4補助画面を追加し、旧2ファイル/ページ送り/カードの古い例外を除去。次は読まれなくなった旧投稿/集計の試験を現在へ移して写しを除去。テンプレート/流入/アカウント等・共通/CSS/CI・全体検査・画像比較は未完了。

### 飲食：最後の旧Googleの投稿/集計/表示の道具（除去完了）

- `google-posts.tsx` 671行・`google-performance.tsx` 207行・旧の `google-format.ts` 85行は本番の読者0。投稿の端末アップロード3件と集計の表示/未取得/期間3件は既に現役V8へ移っていたため、その6件を保持して旧の写しを除去。直接旧画面を読む動作/読み取り試験0件。旧表示の道具を指定する失敗文言の1行は現役の同じ道具を残して除去し、未保存/ボタン/カードの旧の利用先も除去。
- 関係94/94件合格（`/tmp/v7rm2-googlelastcopies1.json`、収集失敗0）、web型検査（`/tmp/v7rm2-googlelastcopies-type1.log`）/差分検査合格。試験削除0件（累計3件）。通常の現役の内容/配置/CSSは変更なし。Googleは入口だけと現役V8に一本化できた。次はテンプレート/流入/アカウント等。共通/CSS/CI・全体検査・画像比較は未完了。

## 2026-10-11 質問テンプレートの旧分岐を削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/questions/new/page.tsx の旧本体366行|保存500の1件・分類/保存の2件・自由入力禁止の1件・権限の1件・使用先の1件・未保存の3件（9件）。ほかに共通の入力/未保存の契約|現役V8の入口7行へ固定。9件の動作/保存/権限を維持し、現役の読み取り先と試験の土台へ更新|

- 関連63件すべて成功、web型検査成功。試験削除0件（累計3件の見た目専用のみ）。権限は編集欄/保存/公開が出ないことと現役の説明を検証。未保存の確認は元のシナリオへの移動/編集継続/破棄/未変更の3件を維持。
- 旧だけのシナリオへのリンクを現在の使用先へ最小で移し、司令塔に確認表へ記録。通常の質問/選択肢/保存/公開の配置とCSSは変更しない。
- 残り：テンプレートのメッセージ/カルーセル/一覧/詳細、流入、アカウント、EC、共通/CSS/CI、全体検査、主な10画面の前後画像比較。push/PR/DB/配備なし。

## 2026-10-11 メッセージテンプレートの旧本体を削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/edit/page.tsx の旧本体/テーマ分岐|実操作の31件（共有関数含む）・実マウントの9件・staff1件・利用先3件・分類/保存2件・URL/差し込み1件。共通Buttonの利用先1行|現在のV8の入口に固定。保存/読み替え/所属ちがい/遅延応答を守る9件は実際のV8をmountするhappy-domへ更新。共通の試験用の土台を使用|

- 関連125件すべて成功、web型検査成功。試験削除0件（累計3件）。読み込み中は現役の保存を押せないことを検証し、旧のボタン有無の見張りを更新。既存編集は保存後も現役の同じ画面に残る。
- 使用先/下書きと公開の区別を現役の説明で確認。使用先0件の旧の補足だけを既存の説明のtitleに移す。通常の内容/配置/CSSは維持。
- 古いedit-v8の写し/共有の旧部品は、そこを読む試験を数え、次の区切りで削除する。残るテンプレート/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 読まれないメッセージ編集の旧V8写しと旧部品を削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/edit-v8.tsx 651行|実際の画面の読者0。1152/広幅/届き方の3件、幅/競合/共通帯の3契約、共通の未保存の分類|3件のmountを現役の入口へ移し、契約の読取先を現役へ。全件保持|
|templates/edit/edit-core.tsx 408行|旧写しと試験用の入口だけ。実操作31件とmount9件が入口から使用|実際に現役の画面が使うV8の保存/取得/所属/世代の関数と現役の知らせを同じ入口で使う。旧の見た目の知らせを削除|

- 関連108件すべて成功、web型検査成功。試験削除0件（累計3件）。単なる未使用の本体を残して試験だけ通す形を解消。
- 所属ちがいの知らせの見える文を維持し、旧だけの選択中の名前は同じ知らせのtitleへ最小で移す。通常の内容/配置/CSSは維持。
- 次はカルーセル。残る一覧/詳細/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 カルーセルの旧本体を削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/carousel/page.tsx の旧本体/テーマ分岐|保存/再試行9件、未保存4件、本文上限/届き方4件、staff1件、分類/保存2件、枚数/ボタン/画像1件（21件）と共通の未保存/入力の分類|現役V8へ固定し、保存の共有関数も実際に現役が使うものへ。全21件保持|

- 関連74件すべて成功、web型検査成功。試験削除0件（累計3件）。作成→更新の2段階と途中失敗後の同じIDへの再試行、409、連打、入力不備、未保存の破棄/継続/未変更を維持。
- 現役の必須の本文/ボタン/URLを試験でも入力。失敗後は現役の下書き保存で再試行。新規保存は現役の一覧で行を示し、既存編集は同じ画面に残る。
- 上限は現役の入力の説明と超過した文字数を検証。旧だけの推奨寸法/2条件の補足を同じ画像説明のtitleへ移す。通常の内容/配置/CSSは維持。
- 次は残る読まれないテンプレートの写し。残る一覧/詳細/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 カルーセル/質問の読まれない旧V8写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/carousel/carousel-v8.tsx 697行・questions/question-v8.tsx 373行|実際の画面の読者0、直接読む動作/見た目の試験0。未保存の共通分類だけ|分類の旧の行と写しを削除。直前に現役へ移した動作試験はそのまま|
|templates/carousel/carousel-core.ts 222行|旧の写し1件だけ、試験の直接読者0。現役と試験用入口は既に現役のcore|写しと旧のエラー文言の例外を削除|

- 関連63件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の保存/再試行/未保存/上限/画像の登録の試験を保持。通常の内容/配置/CSSは変更なし。
- 次はクーポン/リサーチ/リッチメッセージの旧写しと旧本体。残る一覧/詳細/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 クーポン/リサーチ/リッチメッセージの旧本体を削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/template-asset-editor.tsx の旧本体|保存値/入力不備/面数変更/質問10件（うち未対応送信3件）、メディア3件、共通Button1件、保存先1件、成功/二度押し1件（16件）。共通の未保存の未判定1行|現役のリッチ/クーポン/リサーチへ渡す入口だけに。全16件の試験を現役へ更新し、未判定の旧行を除く|

- 関連70件すべて成功、web型検査成功。試験削除0件（累計3件）。期間/回数/公開対象/抽選、6面の保存座標、設定した面を消す確認、質問の本文/形式/必須/選択肢/順序/削除、メディアID/種別/URLとアカウント切替を維持。
- 質問削除の試験は削除後の保存値も検証。未対応送信の3件は、送れない操作を出さず理由を読めることと勝手に保存しないことを現役で検証。旧だけの理由は現在の届き方の見出しのtitleへ最小で移す。
- 通常の内容/配置/CSSは維持。旧V8写しと旧の面/質問の補助値は次の区切りで削除。残る一覧/詳細/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 資産テンプレートの旧V8写し/外枠/CSSを削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/asset-editor-v8.tsx 807行|実際の画面の読者0、直接読む動作/見た目の試験0。共通の未保存の分類とButtonの利用先だけ|旧の分類/利用先と写しを削除。現役の動作試験は保持|
|templates/editor-v8.tsx 208行・editor-v8.module.css 440行|旧の資産の写し1件のみ、直接読む試験0。共通の未保存/入力/CSS分類|写しを削除した後に外枠とCSSも削除。古い分類/利用先/CSSの予算を除く|
|templates/template-asset-editor.tsx の面/質問/表示の旧補助値149行|削除する旧の資産の写しだけ。試験は現役を呼ぶ入口を読む|未使用の値を削除し、現在の3種類の入口8行だけに整理|

- 関連72件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の面/質問/クーポンの保存とメディアの試験を保持。通常の内容/配置/CSSは変更なし。
- 次はテンプレートの一覧/詳細。流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 テンプレート一覧をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|templates/page.tsx 旧本体1606行とテーマ分岐|開始台帳21ファイル120件。今回の直接契約・実物試験と横断の読者を現役へ更新|入口を4行へ。検索/権限/削除/フォルダ/件数/質問/キーボードのケースは全件保持|

- 関連348件すべて成功（従来341件保持＋公開/切替/権限5件、移動の連打/失敗2件追加）、web型検査成功。試験削除0件（累計3件）。
- V6/V7のNode・寸法・モバイルカードを固定する契約は、採用済みV8の型/狭い板/共通タブ/詳細パネルへ書き換えた。未知の使用数と0、検索の1000件×約5万字の索引、遅い前アカウントの応答、最新下書きの検索と抜粋を維持。
- 旧だけのパネルの使用先リンクと版つき公開を現役パネルへ最小で移した（要件v6-11 §4-8・§6）。所属/世代/権限/連打/409と再取得を保持し、通常の一覧の内容/配置/CSSは維持。置き方は司令塔に確認表へ記録。
- フォルダ移動は採用済みV8の即時反映と失敗時復元を維持。旧の「成功後に書き換え」の契約を、失敗時に復元・一覧/件数再取得する検査へ更新。同じ安全性を実物の失敗と連打で確かめ、処理のロックとアカウントの境界を移した。
- 削除できない窓の採用済み2行＋残件数は維持し、全件は詳細へ渡して各使用先の個別リンクを確認。キーボードは現役の行名をTabの止まりにし、行のEnter/Spaceと内側のリンクを分けて検査。
- 次は読まれない一覧の写しとCSS。残る詳細/流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 テンプレート一覧の読まれない写しと旧CSSを削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/list-v8.tsx 1911行|実際の画面の読者0。開始台帳7ファイル26件。実マウントの閲覧2件/通しの窓1件と板/日時/共通の行/未保存の分類|試験を現役の一覧へつなぎ直し、同じケース数を保持して写しを削除|
|templates/list-v8.module.css 699行・templates-v6.module.css 37行|実際の画面の読者0。日時/一括バー/フォルダの契約とCSS予算|日時は現役の同じ列へ。一括バー/フォルダは現役が使う共通部品へ。ケース数を保持し、古いCSSと分類だけ削除|

- 関連274件すべて成功、web型検査成功。試験削除0件（累計3件）。通常のV8の内容/配置/CSSは変更なし。
- 次はテンプレート詳細。流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 テンプレート詳細をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|templates/detail/page.tsx の旧本体/テーマ分岐 732行|開始台帳6ファイル40件。形が違う応答/権限/公開/利用先/版履歴/削除と横断の読者|Suspenseと現役V8を呼ぶ8行だけに。全ケースを保持して現役を読む|

- 関連249件成功（全体248件成功の後、最後の読み上げ名の修正を該当2件で再確認）、web型検査成功。試験削除0件（累計3件）。
- 使用先は現役の4行＋残件数から全件へ展開し、各行の個別リンクを検査。版を固定した送信待ち/取消と、一斉配信の版/状態を保持。使用中の削除は採用済みの「まだ消せません」の窓とAPI直前の保護で検査。
- 版比較/戻す前の確認/版番号つき要求/取得失敗の再読み込みを現役で検査。nullの版は現役の「いまの版」（最新版を追う）と確認し、未取得の送信数は0にしない。
- 旧だけの履歴が空の知らせを現役の同じ履歴の段へ最小で移す（要件v6-11 §4-8）。開けない旧形式の理由は現在の同じ名前のtitleへ移す。通常の内容/配置/CSSは維持。置き方は司令塔に確認表へ記録。
- 次は読まれない詳細の写しとCSS。流入/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 テンプレート詳細の読まれない写しと旧判定の写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|templates/detail/detail-v8.tsx 901行・detail-v8.module.css 392行|実際の画面の読者0、直接読む動作/見た目の試験0。Button利用先とCSS予算だけ|写し/CSS/古い分類だけ削除。現役の動作試験は維持|
|list-state-kind.ts 100行・template-detail-data.ts 51行・template-delete-message.ts 23行・template-message-type.ts 19行|画面の読者は削除する旧写しだけ。状態4件/応答の形4件/削除の本文3件は古い判定の写しを使用|11件を実際に現役が使うwords/modelへつなぎ直し、旧判定の写しを削除。全部同じケースを保持|

- 関連239件すべて成功、web型検査成功。試験削除0件（累計3件）。通常の現役V8の内容/配置/CSSは変更なし。
- テンプレートの一覧/メッセージ/カルーセル/質問/クーポン/リサーチ/リッチ/詳細のテーマ分岐と旧V8画面の写しは完了。未使用のstaff資産一覧と共通の旧値は、共通部品の区切りで整理する。
- 次は流入。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入リンク作成をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/new/page.tsx 旧本体743行とテーマ分岐|開始台帳9ファイル42件。発行/所属/候補/競合/失敗/未保存と共通のQR・番兵|入口を4行へ。従来のケース数を保持し、実際のV8へつなぎ直す|

- 関連80件すべて成功、web型検査成功。試験削除0件（累計3件）。通常の現役V8の内容/配置/CSSは変更なし。
- 発行後は現役の一覧の発行した行へ戻る動きを検査。未入力のURLは例だけ、入力中は未発行の案内、QRを作らないことを保持。所属は現在の説明の「?」を開いて検査。
- 候補のアカウント指定と切替時の3種類の選択解除/警告、403/400/409/機械コードの失敗、競合の比較と最新値取込、REF変更による競合解除、未保存の確認を全件保持。
- 共通の番兵の重複分類・Buttonの旧利用先と旧本体だけの予算を除く。次は作成の旧CSSと流入詳細。流入一覧/広告/アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入詳細をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/detail/page.tsx 旧本体889行とテーマ分岐|開始台帳11ファイル50件。削除安全性/コピー/集計/リンクと横断の流入の契約|入口を4行へ。現役が持つSuspenseと詳細を呼ぶだけに|

- 流入全体と共通の関連205件すべて成功、web型検査成功。試験削除0件（累計3件）。
- 旧だけにあった完全削除の名前一致の確認を現在の同じ窓へ移す（要件v6-18 §4-6）。入力が正確に一致するまで実行不可・入力した値をAPIに渡す・開くたびリセット・API直前の一致確認を保持。置き方は司令塔に確認表へ記録。
- 受付停止/転送先の明示選択、owner/adminのみ完全削除、staffの編集と停止、409の履歴保護、処理中の二度押し/取消/Escape、焦点の復帰/循環、コピー失敗時の手動欄を保持。画面の通常の内容/配置/CSSは変更なし。
- 未取得の値は現役の共通の「—」、注文カードと明細は同じ集計、空の友だち一覧でも月別の集計を出すことを保持。作成の横断の読者も現役の入口/戻り先へ更新。次は旧CSSと流入一覧/広告。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入の作成/詳細の旧CSSを削除

|対象|削除前の読者|対応|
|---|---|---|
|new/inflow-create-v8.module.css 348行・detail/inflow-detail-v8.module.css 440行|実際の画面の読者0、直接読む試験0。CSS予算と直値の記録のみ|読まれないCSSとその記録だけ削除|

- 関連59件すべて成功、直前の作成/詳細のweb型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- 次は流入一覧/広告。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入一覧と入口をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/page.tsx 旧一覧/一括操作の本体とテーマ分岐1568行|開始台帳23ファイル110件。検索/件数/権限/失敗/候補と横断の型/フォルダ/ボタン|1693行を125行の入口へ。URLの行き先・サイト計測のゲート・確定前の取得停止を維持し、全本文を現役V8へ|
|inflow-list-v8.module.css 365行|実際の画面の読者0。フォルダ幅の契約1件とCSSの予算|契約を実際に使う型の幅と現役のフォルダへ書き換え、ケース数を保持して旧CSSを削除|

- 流入全体と横断の関連252件すべて成功、旧CSS削除後の追加確認20件すべて成功、web型検査成功。試験削除0件（累計3件）。通常の現役V8の内容/配置/CSSは変更なし。
- 旧タブの数字の4件は、現在の数の帯/フォルダ/媒体ごとの状態へ移す。実数2件/0件/取得待ち/接続2件と非接続の区別を保持。旧の横送り/手書きの行の余白の契約3件は、採用済みV8の共通の列と幅の中に収める配置/同じ行の余白へ更新。
- 検索0件と解除・友だち追加なし・フォルダの切替で全体の数を変えない7件を保持。省略/混在/行の合計と違う集計・取得失敗の「—」・本物の0人・別アカウントへの切替を維持。URLに保存する条件の試験は各ケースの開始でURLを初期化する。
- 403/429/500の言い分けと再試行、古い返事の破棄、アカウント指定、停止/未登録の区別、一括の件数/対象/結果、検索結果0で作成を勧めない、閲覧のみの操作を隠すことを維持。
- 共通のフォルダ/ボタン/表の見張り先を現役へ移す。次は読まれなくなった広告/編集/注文/QRの旧写し。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 広告連携の旧本体と読まれない写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/ad-integration.tsx 1028行|実際の画面の読者0。開始台帳8ファイル63件。通貨/集計/アカウント/費用の記録と取消の実物試験を含む|現役の広告/接続/送信履歴へ全ケースを移して削除|
|ad-integration-v8.tsx 1306行・同名CSS|実際の画面の読者0。開始台帳2ファイル20件。共通の分類/予算と利用先|読まれない写し/CSSと古い分類だけを削除|

- 流入全体と共通の関連229件すべて成功、web型検査成功。試験削除0件（累計3件）、現在の費用を以前の設定金額で二重集計しない動作試験1件追加。
- 以前の設定に残る金額と通貨の表示だけが現役に無かったため、媒体の既存の補足行へ最小で移す。現在の費用記録があればそちらだけを使用し、以前の金額を現在の集計へ加えない。円/ドル/0/不明な通貨/遅い別アカウントの応答を保持。置き方を司令塔に確認表へ記録。
- 未入力と明示的な0の区別、取消理由の必須、再取消不可、集計の経路/通貨/期間の境界と未取得値を保持。通常の現役V8の配置/CSSは変更なし。削除済みの旧流入一覧/詳細/注文の利用先の記録も実際の到達先へ更新。
- 次は流入の旧接続/編集/注文/QRとサイト計測。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 広告の旧接続窓と旧対応表を削除

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/ad-connection-dialog.tsx 44行|画面の読者0、直接の動作試験1件、共通Buttonの利用先|同じ接続API/疎通失敗の試験を現役の窓へ移して削除|
|inflow-links/ad-event-mappings.tsx 64行|画面の読者0、直接の動作試験2件、未保存の番兵と共通Buttonの利用先|手入力/Googleの成果ID/版/失敗/未保存の動きを共有の窓で現役の対応表へ移し、全ケースを保持して削除|

- 流入全体と共通の関連230件すべて成功、web型検査成功。試験削除0件（累計3件）、Googleの成果IDの保存と失敗時の入力保持/再試行を実物で検査する1件追加。
- 接続の保存後に疎通を確かめ、失敗を接続済みとして閉じない。対応表の取得失敗は再読み込みでき、閲覧のみには編集操作を出さない。手入力の名前と選択中アカウント/版を同じAPIへ渡す。処理中の連打/切替後の古い保存結果と未保存の離脱確認を保護。
- 通常のV8の表/文字/配置/CSSは維持。既存の名前から開く最小の編集窓の置き方を司令塔に確認表へ記録。次は流入の旧編集/注文/QRとサイト計測。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入の旧編集窓と旧注文明細を削除

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/_components/edit-route-modal.tsx 330行|画面の読者0、直接の監査4件/保存4件、流入の横断1件/ホバー1件、未保存の分類|現役の編集面へ全ケースを移し、旧写しと分類/利用先だけ削除|
|inflow-links/_components/ref-orders.tsx 216行|画面の読者0、直接の注文の契約6件|現役の同じ注文明細へ全ケースを移して旧写しだけ削除|

- 流入全体と共通の関連227件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- フォルダ任意/null・名前/REFの保存前検証・作成済みREFの変更禁止・所属・作成/更新両APIと例外の理由・処理中解除を保持。現役が入力欄ごとの誤りも共通の編集面へ渡すことを検査。
- 注文の帰属/未計測/二重に数えない説明・読込/失敗/空の区別と再取得・集計と詳細の同じ条件を保持。次はサイト計測。QRは停止中の扱いが旧と現役で相反し、司令塔への確認を待ちながら他を進める。アカウント/EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 サイト計測の旧本体と読まれない写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|components/inflow-links/site-script.tsx 688行|画面の読者0、開始台帳7ファイル60件。計測状態/停止理由/権限/受信の動作9件と計測鍵等の契約|全ケースを現役へつなぎ直し、テーマ分岐の本体と古い分類/利用先を削除|
|site-script-v8.tsx 744行・同名CSS|画面の読者0、開始台帳3ファイル28件（横断の文言/入力の分類だけ）|読まれない写し/CSSと古い分類だけ削除|

- 流入全体/サイト計測/横断の関連243件すべて成功、web型検査成功。試験削除0件（累計3件）。
- 今日の件数と種類/停止理由/受信日時全文を既存の同じ項目のtitleへ移す。現在の通常の見える文字/配置/CSSは維持。未受信/取得待ち/失敗/0を区別し、失敗後にも最後の受信時刻を残す。
- 計測鍵のアカウント指定と取得前/失敗時のコード禁止、ホストとパスの全文、貼り方の説明を保持。停止は理由なしで送らず、止めたサイトのコードを出さない。閲覧のみには変える操作を出さず、現役の停止/再開の押せる条件で同じ動作を検査。
- 広告の新しい編集窓の失敗文も共通の安全な日本語変換へ通し、内部の番号だけを表示しない横断の契約で検査。次は流入に残る小部品とアカウント。QRの停止中の扱いは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 流入フォルダの旧窓を削除

|対象|削除前の読者|対応|
|---|---|---|
|inflow-links/_components/create-genre-modal.tsx 98行|画面の読者0、直接のホバー契約1件と古い直値の記録|現役の共有窓の主操作へ同じホバーの契約を移し、旧窓と記録だけ削除|

- 関連28件すべて成功、直前のweb型検査成功。試験削除0件（累計3件）。現役の作成/名前変更/409/不足の入力の試験を保持。現在の内容/配置/CSSは変更なし。
- 次はアカウント。流入のQRだけ停止中の扱いが確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 LINEアカウント一覧をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|accounts/page.tsx 旧一覧本体とテーマ分岐|開始台帳7ファイル34件。検索/状態/行の操作/失敗の動作と骨格の契約|一覧をV8へ固定する10行の入口へ。UID移行のURLだけ移行の入口に渡す|

- 関連57件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 旧の3枚の数/省いた列/手書きの検索行/スマホカードの契約を、採用済みV8の4枚/表/共有の検索と各状態の数/各行の操作へ更新。純粋な状態/検索/親の判定は、現役が使う判定を読む。同じケース数を保持。
- 取得失敗中の未取得を0とせず、成功後の実数2アカウント/有効1/問題0/友だち10を保持。詳細への行き先とクリック後のメニュー閉鎖、権限者の引き継ぎ/アーカイブを保持。試験の土台に設定メニューの外枠/アカウント/役割を足す。
- 次はUID移行と登録/詳細/引き継ぎ。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 UID移行をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|accounts/migration.tsx の旧本体/履歴/対応表とテーマ分岐452行|開始台帳6ファイル75件。判断/二人承認/本実行/切り戻し/通信例外/履歴と骨格・共通の見張り|現役のUID画面と同じ状態の仕組みに固定。現役も使う確認窓/状態判定/CSVの公開口を維持し、読まれない本体/履歴/対応表だけ削除|

- 関連93件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 詳細を開く/閉じるだけでは書かない、承認で対象だけに1回書く、作成者と別ownerの実行、未判断/権限/版の条件、確認するまで実行/切り戻しなしを保持。通信断は結果不明、確定失敗とは言い分け、読み直しと二重送信防止/500後の一部反映と再取得失敗/遅い別履歴の応答を全件保持。
- 旧タブ/手書きの5段/スマホの展開/カードの文字列契約は、採用済みV8のデータ管理/同幅2欄/共通Steps/同じ状態で完了を示す帯/既存のCSSの16pxと12pxへ更新。空/待ち/失敗の区別と別画面のCSVへの移動は現役のメニューから検査。
- 旧だけのPagination利用先とカードの例外を除く。同じ見張りで残っていた未使用の旧テンプレート資産一覧のカード例外も、使う箇所が無いため除く（ファイルは共通の区切りで整理）。次はアカウント登録/詳細/引き継ぎ。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 LINEアカウント登録をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|accounts/new/page.tsx 482行の旧本体とテーマ分岐|開始台帳8ファイル53件。保存応答消失3件/ウィザード8件/所属等1件/骨格と横断の契約|現役を読む7行の入口へ。旧画面の二重の取得・状態・画面だけ削除|

- 関連187件すべて成功、web型検査成功。試験削除0件（累計3件）。
- 手順/入力/マニュアル/完了の旧ノードと手書きのスマホ展開は、採用済みの5枚/共有Stepsの幅に応じた省略/秘密値4項目/手動の応答メッセージ確認/結果の窓へ更新。同じケース数を保持。
- 接続失敗の理由・保存禁止、任意の表示名、タグ/親/担当/既存LIFFのAPI引き渡し、秘密値の非表示、案内を一度だけ出して閉じる、保存応答消失/重複を照合して詳細へ復帰/本当に未保存の失敗を保持。
- 旧だけのID取り込み中の詳細ボタン停止を現役の同じボタンへ最小で移す。読み込みの進捗とhydrating_profilesになってから詳細へ進める動作を同じ試験で検査。通常の内容/配置/CSSは維持。置き方を司令塔に確認表へ記録。
- 次は登録の読まれない写しと詳細/引き継ぎ。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 登録の読まれない旧写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|accounts/new/register-v8.tsx 963行・同名CSS 406行|画面の読者0。開始台帳は未保存の分類1ファイル10件。再検索でカード形状の例外1件/同じ例外のJSON/共通Buttonの利用先/CSSの直値基準|現役の動作・計算の試験はすでに現役を読むことを確認し、旧写しと古い分類・例外・利用先だけ削除|

- 関連60件すべて成功、直前のweb型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 接続の5行・止まった理由・秘密値のない下書き・戻る/保存/結果の窓の試験を保持。次は詳細/引き継ぎ。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 LINEアカウント詳細をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|accounts/detail/page.tsx 785行の旧本体とテーマ分岐|開始台帳3ファイル23件。編集/資格情報/権限/保存・親名の復旧と契約。再検索で対象未指定の横断1件/共通Buttonの利用先|Suspenseで現役を読む入口へ。編集窓を現役の同じ窓へつなぎ直す|
|accounts/detail/account-detail-view.ts 118行・accounts/account-list-view.ts 69行|現役の画面からの読者0。詳細の直接契約15件は旧判定を読んでいた|現役の判定/欄/窓へ同じケースを移し、旧の表示の判定だけ削除|

- 関連190件すべて成功、web型検査成功。試験削除0件（累計3件）。
- 親名だけの取得失敗を全体失敗にせず読み直して復旧、登録内容と資格情報の入力窓、閲覧のみの変更禁止、タイムゾーンの保存/詳細の再取得を保持。対象未指定と静的な?id=を保持。
- 旧タブ/URLの切替/手書きの脇カードは、採用済みV8の1画面に各段を出す形へ更新。旧の言い回しの値は現役の登録済み/未登録、親なし/消えた親の不明、Webhookの未確認/オフ、停止と再開/自動で送り直さない説明、アーカイブの状態と押せる条件へ同じ件数で更新。
- 旧だけの友だち数の上限/警告人数の補足を現在の同じ数のtitleへ移した。未設定を0にしない。通常の見える文/配置/CSSは維持。次は引き継ぎ。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 LINEアカウント引き継ぎをV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|accounts/handover/page.tsx 829行の旧本体とテーマ分岐|開始台帳3ファイル19件。補助取得の失敗と権限の動作、骨格の契約。再検索で本実行の契約5件/対象未指定の横断1件/共通Buttonの利用先|Suspenseで現役を読む入口へ。動作を現役へ同じケース数で移す|

- 関連188件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 補助の受け取り先取得失敗でも引き継ぎ本体は出す/一覧だけ再取得して復旧/本体取得の失敗は全体の失敗、staffの発行・コード入力・再確認・判断・本実行・取消の禁止、ownerの各操作を保持。
- 旧5段/4区分の言い回し/個々の人数の文字列は、採用済みV8の4段と現在の区分/合計が一致した人数の1行へ更新。数が合わなければ出さない、プロバイダー違いの説明、確認と本人確認を済ませて本実行/未判断の禁止/409の理由と成功の知らせを保持。
- 現役の申告人数の開閉から再確認を検査する。次は引き継ぎの読まれない写し。流入QRは確認待ち。EC・共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 引き継ぎの読まれない旧写しを削除

|対象|削除前の読者|対応|
|---|---|---|
|accounts/handover/handover-v8.tsx 829行・同名CSS 209行・旧handover-view.ts 55行|画面の読者0。直接の動作/設計試験3件、共通Buttonの利用先とCSSの直値基準。旧判定はこの写しだけが読む|現役の表/保存の帯/未判断の本実行禁止へ3件を移し、旧写し/判定/基準と利用先だけ削除|

- 関連55件すべて成功、web型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- 判断の名前つき選択欄で変更→未保存の知らせ→同じ保存APIを実物で検査。色の直値/独自の影/準備中の操作を増やさない契約は現役の設定の型・表・下の帯へ移す。次はEC。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 EC連携の本体をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|ec-commerce/page.tsx 600行の旧本体とテーマ分岐|開始台帳9ファイル72件。出来事の実物試験/部分取得失敗/再試行/検索/ページ/数/動線/横断の契約|現役の同じ4入口を出す19行へ。旧の本体・状態・表と二重の判定だけ削除|

- EC全体と横断の関連184件すべて成功、web型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- アカウント切替直後に前の情報を出さない/遅い再試行が次の取得を壊さない、一覧だけ失敗しても集計を残す、検索のサーバ指定/検索を外して再取得/先頭ページへの誤戻り防止を実物で保持。
- 一覧503/403/404で状態ごとの数を0にしない、再取得で実数3/4/5/1へ復旧、成功した空は0、旧形式の出来事配列はエラー、新形式の処理だけの行も表示する動作を保持。注文番号は現役の行のtitleに既にあり、試験もそこを確認する。
- 旧のh2専用部品/折り畳む数の契約は現役の設定の型/数の帯へ更新。旧の日時の補助関数は現役の共有formatDateへ更新し、日本時間を維持。条件の札は現在のaria-pressedと同じ数で検査。実物試験のURLの書きかけを毎回流し、ケース間に条件を残さない。
- 共通Buttonの古い登録入口の利用先、EC旧本体/定期便のPagination利用先も実際の到達先に合わせて除く。次は会員のつき合わせ/注文/つなぎ先/定期便の旧写し。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 会員のつき合わせをV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|ec-commerce/identity-candidates/page.tsx 381行の旧本体とテーマ分岐|開始台帳7ファイル50件。集計の部分失敗/権限/アカウント切替と骨格の契約|現役を読む7行の入口へ。旧の本体と二重の状態だけ削除|

- ECと横断の関連191件すべて成功、web型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- 集計だけ503/403で候補や判定操作を残す、候補の取得失敗は全体の失敗、集計だけ再取得して復旧、実際に候補のない7人を保持。アカウントをA→B/再びAへ変えたときに遅い成功と失敗を無視する動作を保持。
- 旧の数の帯/並び欄/読み込みの言い回しの契約は、現役の同じ数・欄・再取得へ更新。未知の数を0にせず、過去の送信を再送しない説明を保持。次は注文詳細の読まれない写し。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 注文詳細の読まれない旧本体と枠を削除

|対象|削除前の読者|対応|
|---|---|---|
|ec-commerce/order-detail-drawer.tsx 351行・order-drawer-v8.tsx 19行・同名CSS 17行|画面の読者0。直接の実物12件/配線6件。共通Buttonの利用先と設計負債の基準|現役の共有Drawerを使う注文の引き出しへ同じ18件を移し、旧本体/枠/基準だけ削除|

- ECと横断の関連141件すべて成功、web型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- 注文とアカウントを束ねた取得、止まった段階の7分類、安全な理由、再実行後の詳細再取得、未確定を確定額と混ぜない、紹介者/報酬/締め/支払い/取消/重複候補、403と通信失敗の区別・復旧を保持。
- 旧専用枠のノード固定は現役の共有Drawerと注文用の幅/外部リンク/Escapeへ更新。古い返事と別の注文へ移った後の再実行の上書き防止は現役の参照を検査。次はつなぎ先/定期便の旧写し。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 つなぎ先の読まれない旧本体と枠を削除

|対象|削除前の読者|対応|
|---|---|---|
|ec-commerce/connector-panel.tsx 297行・ec-connector-v8.tsx 46行・同名CSS 61行|画面の読者0。直接の実物5件の全外し/5件の未保存・入力/4件の権限と設計、12件のEC横断契約の一部・番兵と用語/共通ButtonとCSS基準|現役の同じ部品と設定の型へ同じケースを移し、旧本体/枠/基準だけ削除|

- ECと横断の関連138件すべて成功、web型検査成功。試験削除0件（累計3件）。通常の見える内容/配置/CSSは変更なし。
- 保存するまで停止しない、離れる時の確認/戻る/保存せず移動、全部外しても確認後に空のまま保存/取消、版をAPIに渡し、成功の知らせを共有Toastで実物検査。閲覧のみの保存口は現役の決まりに合わせて隠すことを確認。
- 未入力/32文字未満の鍵の旧無効ボタンは、採用済み現役の入力欄へ理由を出して焦点を移す形へ更新。保存APIを呼ばない同じケースを残し、既存の不正ドメイン/通信失敗で鍵を保持/競合比較で入力を保持する試験も成功。
- 旧だけのタグ/分析の影響件数・止まる設定と全体の区別・再試行の場所の補足は、現在のつながる先の同じ行のtitleへ最小で移す。未取得を0にしない。置き方を司令塔に確認表へ記録。次は定期便/ECの残り。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 定期便とECの残る旧部品を削除

|対象|削除前の読者|対応|
|---|---|---|
|ec-commerce/subscriptions-panel.tsx 209行・ec-tabs-view.tsx 71行|画面の読者0。直接のページ/総数/未集計/表示件数/条件解除6件、EC横断12件の一部/共通の表示範囲|現役の同じ定期便と4入口へ同じケースを移す|
|ec-commerce-v6.module.css 426行・ec-datetime.ts 35行・ec-failure.ts 102行|現役からの読者0。CSS直接契約3件/旧だけの日時の読み先とCSS基準。失敗分類12件は現役へ移済み|現役の箱/題/共有入力の高さ/折り返す選ぶ欄へ3件を移し、旧CSS/旧の表示補助/基準を削除|

- ECと横断の関連171件すべて成功、web型検査成功。試験削除0件（累計3件）。現在の内容/配置/CSSは変更なし。
- サーバの総数とoffset/9ページ目/10→50件の次ページ/読めない情報を数えない/条件0件でも解除できる動作を保持。4入口の数の取得はoverviewを使い、定期便一覧を二度取らない。現役の絵の入口に無い定期便の数の札は追加せず、取得する口と一覧の総数を検査。
- 旧の専用CSSの箱と入力の寸法を現役の共有CardとTextField/同じ選ぶ欄へ更新。今月の金額が未取得なら0円と作らない。ECの旧表示本体の整理は完了。次は共通部品。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 共通の並び替えと読み直しをV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/refresh-cover.tsx|開始台帳2ファイル19件|旧の薄めと線を外し、現役の更新中/行を残す/300ms以内は出さない形へ同じ試験を更新|
|shared/reorder-handle.tsx とfriend-fields/reorder-grip.tsxの別名|開始台帳4ファイル19件、検索等の実物9件|旧の薄いつまみを外し、未接続/動かせない時は隠す。同じ上下キーとAPIの動作を保持|
|shared/retry-label.tsx / ui/sort-select.tsx|開始台帳0件/1ファイル6件。再検索で表の失敗1件|旧題と箱の外のラベルを外し、現役の題/箱内ラベル/選択操作へ更新|

- 共通/shared・ui・並び替え・スタッフの関連1,563件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の通常の内容/配置/CSSは変更なし。
- マウスがつながるつまみの上下キー、ドラッグとメニューを同じAPIへ送る、禁止の理由、別名でも操作を隠す動作を保持。保存した検索の旧だけのつまみを読むケースは、現役の同じ上へ動かす操作をキーボードで選ぶ形へ移す。新しい並びを1回だけAPIへ渡すことを維持。
- 広い検査で残っていた登録メディア/共通情報の旧入口の件数契約も現役の同じ一覧へ移す。スタッフの再送中は操作名を変えず同じ理由/押せない条件へ移し、共通の処理中表示の見張りを保持。
- 次はコピー/フォルダ/色/LINEの見え方。流入QRは確認待ち。共通の残り/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 共通のコピー/フォルダ追加/色選択をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/copy-text-button.tsx|開始台帳直接0件。再検索でコピーの実物/呼び出し/クリップボード失敗|旧の幅と印の分岐を外し、現在の同じ幅/コピーした知らせを保持|
|shared/folder-add-dialog.tsx|開始台帳7ファイル39件|旧の手書きの窓だけ削除。現役のFolderEditorDialogと同じ保存/競合/名前/色を保持|
|shared/color-well.tsx|開始台帳1ファイル14件|旧の見本色と小文字表示/スポイトの有無の分岐だけ削除。現在の色・大文字表示・未対応のスポイトの理由を保持|

- 共通/shared・ui・フォルダ横断の関連1,573件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- コピー失敗時は全文を手動で選べる、連打/値の切替後の遅い返事を無視、追加/名前/色の保存/IME Enterの禁止/フォーカスの循環/未保存破棄/保存中に閉じない、透明度8桁/十六進の検証/矢印で色あい変更を保持。
- 読めない色はAPIへ返さず元の色へ戻す同じ試験を、現在の大文字表示へ更新。旧窓だけの共通Button利用先を外す。以前に保存したフォルダ色の値と呼び出し互換の書き出しはこの区切りで変更しない。
- 次はLINEの見え方/失敗・読込と共通の残り。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 LINEの見え方と失敗表示をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/line-preview.tsx / 同名CSSの旧パネル|開始台帳5ファイル34件|SSRだけ旧パネルを描く経路とテーマ監視/旧パネルを削除。スマホ枠・吹き出し等の書き出しは保持|
|shared/target-missing.tsx|開始台帳5ファイル21件|SSRだけ旧題を出す経路とテーマ監視を外し、現在の案内を出す|

- 共通/shared・ui・関連の1,577件すべて成功、web型検査成功。旧パネルの未使用CSSを13行除いた後の関連23件も成功。試験削除0件（累計3件）。通常のV8の内容/配置/CSSは維持。
- 届く日時/送り主/本文/空の案内/説明の開閉、リッチメニューをトークの下に1回だけ出す、入力の帯の文言と1本だけの表示、カードの実物操作を保持。静的な書き出しも最初から現役の枠だけにする。旧テーマ指定で現在の枠1枚を描く同じケースを保持。
- 開く対象の未指定/見つからない/失敗の区別、一覧へのリンク、403で権限変更後にも再取得/429で待つ案内/他の失敗で再試行、読み上げの文言を保持。古い表示できませんでしたの題の契約だけ現在の読み込めませんでしたへ更新。
- 次は残る共通の作成/入力/選ぶ欄/表/外枠と、読まれない古い部品。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 一覧と表の読み込みをV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/list-state.tsx|開始台帳22ファイル181件|旧の回る印を描く分岐を外し、現役の待ってから出す骨組みと読み上げを保持|
|shared/table.tsx|開始台帳19ファイル157件|旧の文字だけの読み込みを外し、現役の骨組みと読み上げを保持|

- 共通/shared・uiの1,552件と、台帳の直接読者40ファイル350件すべて成功。web型検査成功。試験削除0件（累計3件）。V8の内容/配置/CSSは変更なし。
- 4つの状態の区別、読み込み中のaria-busy/名称、待ってから骨組みを出す、権限の案内/失敗時の読み直し/二度押し禁止/429の待つ秒数を保持。表の旧見える文言の試験は現役の読み上げ名とbusyへ同じケースを更新。
- 次は選択欄と残る共通部品。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 共通の選択欄をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/select.tsx|開始台帳99ファイル817件|旧の38pxメニュー/描き分けを外し、現役の共通SelectMenuと34pxの行高へ固定|

- 共通/shared・uiの1,552件と、台帳の直接読者99ファイル851件すべて成功。web型検査成功。試験削除0件（累計3件）。V8の内容/配置/CSSは変更なし。
- 選択/禁止/矢印とEnter/Escape/IME/焦点、選んだ後の値/2,000候補の間引きとスクロール/全体数と位置の読み上げ、同じ窓で作成/遅い作成結果を無視を保持。旧テーマ指定でも現役の見出しと候補を出す同じケースへ更新。旧38pxの位置試験は現在の共有行高を使う。
- この区切りの画面横断で、問い合わせ受信箱の非表示タブの待機ケースが旧の文字表示を固定していたため、現役の読み上げ名/aria-busyへ更新。非表示中に取りに行かず、表示に戻るとすぐ取得する動作は同じ検査を保持。
- 次は残る共通の作成/入力/フォルダと外枠。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 タグの選択と処理中の幅・作る頭をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/entity-picker-sources.tsx|開始台帳直接0件。実物の開始条件などを追加検査|タグは現役のTagPickerFieldだけ。ほかの種類の窓/見本/値は維持|
|shared/button.tsx|開始台帳の直接読者と共通・画面横断|旧の幅計測の停止を外し、現在の待機/成功の一番長い文字の幅を初回に確保|
|shared/create-page.tsx|開始台帳5ファイル42件|旧テーマの本文パンくずを外す。見出し有無/キャンセル/保存/未保存の番兵を保持|
|shared/condition-builder.tsx|テーマの実際の分岐0|使われないテーマimportだけ外す|

- 共通/shared・ui/タグ/シナリオ/自動応答の1,874件と、直接読者136ファイル+スタッフ追加の964件すべて成功。web型検査成功。試験削除0件（累計3件）。通常のV8の内容/配置/CSSは変更なし。
- 選択は窓の確定まで下書き、開始条件のキャンセルではAPIを呼ばず、保存時だけ追加/削除して読み直すことを保持。旧試験のタグ取得モックを現役と同じ口へ補い、共通の選択補助は非同期の候補表示を待ってからチェック/ラジオを選ぶ。
- 保存の二重実行禁止/失敗後の復帰/成功の一時表示/幅の測り直しと再描画で計測を繰り返さないことを保持。作る頭の旧パンくず2ケースは現在の題/本文に重ねない/キャンセルの行き先へ更新。
- CreatePageの旧寸法variantは、残るスタッフ追加と未使用のwebhooks編集を整理した後に撤去する（この区切りでは現役の寸法を動かさない）。次は日時/差し込み/フォルダと外枠。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 日時と差し込みの入力をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/date-time-field.tsx / 同名CSSの旧時分欄|開始台帳と再検索の日時/時刻の実物・幅/クリック契約|旧の2プルダウンとTimeFieldV7本体/使わない16行のCSSを削除。現役の入力＋2列と値を保持|
|shared/insert-text-field.tsx|開始台帳と再検索の差し込みの実物|旧textareaの分岐だけ削除。現役の札/値/選択位置の受け口を保持|

- 日時・差し込み・クリック/幅の31件、共通/shared・uiと台帳の直接読者13ファイルを含む1,600件すべて成功。web型検査成功。試験削除0件（累計3件）。V8の内容/配置/CSSは変更なし（削除したCSSは現役から読まれない）。
- 日付/時/分変更・日本の日付の今日・秒付き値/不正値・defaultValue・Escapeで焦点復帰・消す操作・保存する文字列を維持。旧の5クリックケースは現役の同じ候補へ移し、押下後の値/上下キー確定/閉じて開き直しても保持を検査。分の確定で閉じる動きは採用済みYCOoRと現役の試験に合わせる。
- 差し込みの札1枚/未知の文字/HTMLを実行しない/貼り付け/文字数上限/カーソル/Backspace・Delete/IME/読み上げの名称を保持。旧テーマでtextareaに戻るケースは現在の札と保存値へ同じケースを更新。幅2ケースは旧の4Selectから現役の入力が親の幅を使い最小幅を外す形へ更新。
- 次はフォルダと外枠・読まれない旧部品。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 フォルダの列をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|shared/folder-panel.tsx|開始台帳14ファイル102件（うちscripts1件は最終scripts検査の対象）|旧のメニュー名/印/注釈/38個のTailwind指定/旧の丸とフォルダを削除。現役の同じ行とメニューへ固定|

- 共通/shared・uiと直接読者13ファイルを含む1,581件すべて成功。web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 分類の選択/色の丸/件数が不明なら出さない、名前と色の変更/隣との並べ替えを1回だけ送信/削除前の件数と未分類へ移る確認/失敗時の入力保持と再試行/閲覧時の操作非表示/追加操作と区切り/畳んだ列の操作を保持。
- 旧テーマ指定で旧の丸を出すケースは現役の共通の印を出すことへ更新。スマホの操作を出す契約は旧Tailwindから現役のhoverできない端末のCSSへ移し、メニューが件数と重ならない同じ検査を保持。メニュー内の旧注釈は確認の窓の同じ案内を検査。
- 次はメッセージの差し込み/見本と外枠、読まれない旧部品。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 メッセージの共通部品をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|broadcasts/broadcast-form.tsx / broadcast-text-bubble.tsx|開始台帳31ファイル171件 / 直接0件|旧の頭の戻る操作・段の帯・吹き出しの分岐を外す。現役のStepsとスマホの本文/札を保持|
|scenarios/insert-toolbar.tsx|開始台帳7ファイル35件|旧の差し込みボタン/旧高さの指定を外し、現役の共通の差し込みへ固定|
|auto-replies/inline-action-list.tsx / rich-menus/area-properties.tsx|開始台帳25ファイル141件 / 3ファイル15件|使われないテーマimportと変数だけ削除|

- 共通/shared・ui・配信/シナリオ/本部ひな形を含む2,344件すべて成功、web型検査成功。試験削除0件（累計3件）。V8の本文/配置/CSSは変更なし。
- 6つの配信の入力試験は旧textareaから現役の札を含む入力へ移し、同じ入力値/自動保存/下書き復帰/試送/版/バブルを検査。未保存の戻る操作は現在のキャンセルへ移す。本文の改行と参照の読み直し/権限/失敗の保持を同じケースで確認。
- 本部ひな形の5件は、最初の窓がbodyのportalへ移る前の外れた要素を操作し、未使用の一度だけのモックが次の試験へ残っていた。共通の選ぶ試験の土台で実際の窓が落ち着くまで待ち、ケースごとにモックを初期化。配布先/空の禁止/確認完了まで送信しない/成功先を再送しない/タグ色を保つ全29件が成功。動きは削らない。
- 現役の配信から読まれなくなった旧段の帯のカード例外1行だけ外す（試験ケースは保持）。段の帯の残るソース契約は未使用部品の整理で現役へ移す。
- 次は外枠と残る旧部品。流入QRは確認待ち。CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 外枠・左メニュー・上の帯をV8だけに固定

|対象|削除前の読者|対応|
|---|---|---|
|components/app-shell.tsx|開始台帳11ファイル64件|旧アカウント登録だけの外枠/黄色の版の帯/設定メニューのテーマ分岐を削除|
|layout/sidebar.tsx|開始台帳17ファイル118件|旧組の隠し方/旧統括の札とアカウント行/旧印の分岐を外す。現役の項目と順を維持|
|shell/app-top-bar.tsx / shared/top-bar.tsx|開始台帳13ファイル102件 / 7ファイル66件|旧テーマの通知取得禁止/名前と区切り/ブラウザの選択欄を削除。現在の切り替えのメニューと鈴を保持|

- 関連287件すべて成功、web型検査成功。試験削除0件（累計3件）。V8の見える配置/CSSは変更なし。
- 登録の認証と全gate、設定の中のメニュー、左メニューの開閉記録/キーボード1回につき1回の畳み/権限と機能の非表示、統括と店の住所の区別/戻る先/アカウント切り替え/通知の取得を保持。旧テーマ指定のケースも現在の動作へ移す。
- 統括をまだ使えない旗で隠す旧契約は、現在の4機能の入口と同じメニューへ更新。NENの古いスクロール用タブ名の契約は現在の共通Tabs/狭い幅の送り/キーボード焦点へ移す。旧の死んだ表示を試験だけのために残さない。
- 次は運営の外枠/代理ログインと残る旧部品。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 運営の外枠と代理ログインのテーマ分岐を削除

|対象|削除前の読者|対応|
|---|---|---|
|ops/ops-shell.tsx|開始台帳3ファイル13件|旧外枠/左メニュー/自分のメニューの本体と開閉stateを削除。認証/本人取得と現役外枠を維持|
|ops/impersonation-bar.tsx|開始台帳1ファイル1件|閲覧のみは現役の帯に固定。書き込み中と理由の窓/同じAPIは維持|
|v8/ops/shell.tsx / shared/top-bar.tsx|旧だけの動きの受け先|現役の引き出しへ共通の焦点管理を移し、現在の名前から同じ自分の操作を共通のメニューへ移す|

- 運営/外枠/共通/shared・uiを含む1,846件すべて成功、web型検査成功。試験削除0件（累計3件）。通常のV8の文字/並び/CSSは変更なし。
- 運営のスマホの開閉/Escape/背面スクロール停止を既存2ケースで現役へ移し、同じケースでプロフィール/メンバー/二段階認証の行き先・矢印移動・Escapeも実物で確認。旧の寸法/骨格8契約は現在の外枠/CSS/共通の焦点と操作メニューへ移す。
- 旧だけの自分のメニューと閉じ方は要件/個別の採用済み配置が確認できず、上の司令塔に確認表へ記録。既存の名前/文字/配置は維持し、押す口と共通の窓だけ最小で移す。
- 次は本部の画像と残る旧部品。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 現役の参照画像の窓をV8に固定

|対象|削除前の読者|対応|
|---|---|---|
|hq/banners/reference-picker-dialog.tsx|開始台帳3ファイル23件|旧の説明文の分岐とテーマを読むだけの変数を削除。現役の説明/複数選択/使い方を保持|

- 本部バナーの関連97件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 最大3枚/順番/1枚ずつの3方式/取り込み/検索0件と未登録0件/条件解除/詳細・配る・途中の失敗・再試行を維持。
- 再検索でLibrarySection・ImageDetailModal・ProjectsSectionとBannerSideNavは画面の入口から読まれず、試験だけが旧本体を読むと確認した。次の区切りで現役の同じ動作へ試験を移してから削除する。
- 流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 名前の下の旧版表示と未使用の運営ヘッダーを削除

|対象|削除前の読者|対応|
|---|---|---|
|layout/sidebar-identity.tsx|開始台帳3ファイル27件|旧版の取得と隠れたV7表示を削除。現役の製品名と最下部の版表示を保持|
|ops/readonly-header-v8.tsx / readonly-v8.css|現役0・直接の試験0|画面から読まれない写しと専用CSS64行を削除|

- 外枠・左メニューの関連124件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 次は旧画像詳細とライブラリの試験を現役へ移す。流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。

## 2026-10-11 旧画像詳細を削除して現役の窓へ試験を移す

|対象|削除前の読者|対応|
|---|---|---|
|hq/banners/image-detail-modal.tsx|直接3ファイル23件・現役から0|旧本体を削除。試験と残る未使用ライブラリの参照を現役BannerImageDetailV8へ移す|

- 本部バナーの関連97件すべて成功、web型検査成功。試験削除0件（累計3件）。現役の内容/配置/CSSは変更なし。
- 小画面3ケースは現在の共通Dialogの画面内の高さ/本文だけのスクロール/本文外の閉じる操作・ダウンロードへ移す。タグ名による配布先検索・配布済みは選べず再送しない動作1ケースを現役の選ぶ窓へ移す。旧固定幅/文言2契約も同じ現役へ更新。
- 旧ライブラリは次の区切りで削除するため、参照先だけ現役へ移した。成功/失敗の真偽を現在の窓へ渡し、失敗時に選択を片付けない。通常画面の入口からは読まれない。
- 流入QRは確認待ち。共通/CSS/CI・全体検査/画像比較は未完了。push/PR/DB/配備なし。
