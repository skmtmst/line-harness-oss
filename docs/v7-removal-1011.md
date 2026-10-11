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
|自動処理一覧の削減時間|旧一覧だけに実行回数から求める削減時間があり、現役の帯には対応する置き場がない|現在の「？」へ同じ1回30秒の概算を移す。未取得は0にせず理由を示す|補足への置き方は司令塔へ報告。閉じた通常の配置/CSSは維持|
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
