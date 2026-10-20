> 文書：restaurant のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# restaurant：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/restaurant-test/approvals` → [app/restaurant-test/approvals/page.tsx](../../app/restaurant-test/approvals/page.tsx)
- `/restaurant-test/close-tasks` → [app/restaurant-test/close-tasks/page.tsx](../../app/restaurant-test/close-tasks/page.tsx)
- `/restaurant-test/dashboard` → [app/restaurant-test/dashboard/page.tsx](../../app/restaurant-test/dashboard/page.tsx)
- `/restaurant-test/delivery` → [app/restaurant-test/delivery/page.tsx](../../app/restaurant-test/delivery/page.tsx)
- `/restaurant-test/google` → [app/restaurant-test/google/page.tsx](../../app/restaurant-test/google/page.tsx)
- `/restaurant-test/inventory` → [app/restaurant-test/inventory/page.tsx](../../app/restaurant-test/inventory/page.tsx)
- `/restaurant-test/line-followup` → [app/restaurant-test/line-followup/page.tsx](../../app/restaurant-test/line-followup/page.tsx)
- `/restaurant-test/menu/edit` → [app/restaurant-test/menu/edit/page.tsx](../../app/restaurant-test/menu/edit/page.tsx)
- `/restaurant-test/menu` → [app/restaurant-test/menu/page.tsx](../../app/restaurant-test/menu/page.tsx)
- `/restaurant-test/organization` → [app/restaurant-test/organization/page.tsx](../../app/restaurant-test/organization/page.tsx)
- `/restaurant-test/reservations` → [app/restaurant-test/reservations/page.tsx](../../app/restaurant-test/reservations/page.tsx)
- `/restaurant-test/stores/new` → [app/restaurant-test/stores/new/page.tsx](../../app/restaurant-test/stores/new/page.tsx)
- `/restaurant-test/tables` → [app/restaurant-test/tables/page.tsx](../../app/restaurant-test/tables/page.tsx)
- `/restaurant-test/terms` → [app/restaurant-test/terms/page.tsx](../../app/restaurant-test/terms/page.tsx)

本体：[approvals/approvals.tsx](approvals/approvals.tsx)、[close-tasks/close-tasks.tsx](close-tasks/close-tasks.tsx)、[dashboard/entry.tsx](dashboard/entry.tsx)、[delivery/delivery.tsx](delivery/delivery.tsx)、[google/google.tsx](google/google.tsx)、[inventory/inventory.tsx](inventory/inventory.tsx)、[line-followup/line-followup.tsx](line-followup/line-followup.tsx)、[menu/edit.tsx](menu/edit.tsx)、[menu/menu.tsx](menu/menu.tsx)、[organization/organization.tsx](organization/organization.tsx)、[reservations/reservations.tsx](reservations/reservations.tsx)、[store-new/store-new.tsx](store-new/store-new.tsx)、[tables/tables.tsx](tables/tables.tsx)、[terms/terms.tsx](terms/terms.tsx)

## 外に見せる名前（index.ts）

- [approvals/index.ts](approvals/index.ts)：`ApprovalsV8`
- [booking-kit/index.ts](booking-kit/index.ts)：`RsDialog`・`RowMore`・`DialogField`・`DialogNote`・`Status`・`RestaurantShell`・`QuietError`・`Panel`・`StatRow`・`RestaurantV8Context`
- [booking-kit/public/parts/index.ts](booking-kit/public/parts/index.ts)：`DialogField`・`DialogNote`・`RowMore`・`RsDialog`
- [booking-kit/public/shell/index.ts](booking-kit/public/shell/index.ts)：`RestaurantV8Context`・`Panel`・`QuietError`・`StatRow`・`Status`・`RestaurantShell`
- [close-tasks/index.ts](close-tasks/index.ts)：`CloseTasksPage`
- [closures/index.ts](closures/index.ts)：`ClosuresBoard`・`ClosureDialogTarget`・`todayIn`・`KIND_LABEL`・`dayTitle`・`scopeText`
- [closures/public/closure-dialog/index.ts](closures/public/closure-dialog/index.ts)：`ClosureDialogTarget`
- [closures/public/closures/index.ts](closures/public/closures/index.ts)：`ClosuresBoard`
- [closures/public/format/index.ts](closures/public/format/index.ts)：`KIND_LABEL`・`dayTitle`・`scopeText`・`todayIn`
- [common-a/index.ts](common-a/index.ts)：`RestaurantFrame`・`BoundaryBanner`・`RestaurantPage`・`RestaurantContext`・`formatStamp`・`StatRow`・`Status`・`HalfGrid`・`Panel`・`PanelAside`
- [common-a/public/frame/index.ts](common-a/public/frame/index.ts)：`RestaurantContext`・`BoundaryBanner`・`RestaurantPage`・`RestaurantFrame`
- [common-a/public/parts/index.ts](common-a/public/parts/index.ts)：`HalfGrid`・`Panel`・`PanelAside`・`StatRow`・`Status`・`formatStamp`
- [dashboard/index.ts](dashboard/index.ts)：`RestaurantDashboard`・`canWriteRole`・`groupCloseTasks`・`openItems`・`reasonText`・`slotTitle`・`canMarkVisited`・`summarizeToday`・`visitState`・`CloseGroup`・`loadStoreMedia`・`useStoreToday`・`StoreMedium`・`StoreToday`
- [dashboard/public/summarize/index.ts](dashboard/public/summarize/index.ts)：`CloseGroup`・`canMarkVisited`・`canWriteRole`・`groupCloseTasks`・`openItems`・`reasonText`・`slotTitle`・`summarizeToday`・`visitState`
- [dashboard/public/use-store-today/index.ts](dashboard/public/use-store-today/index.ts)：`StoreMedium`・`StoreToday`・`loadStoreMedia`・`useStoreToday`
- [delivery/index.ts](delivery/index.ts)：`DeliveryPage`
- [front-desk/index.ts](front-desk/index.ts)：`isWalkIn`・`pad2`・`tableBusy`・`toYmd`・`PhoneReservationDrawer`・`WalkInDialog`
- [front-desk/public/phone-drawer/index.ts](front-desk/public/phone-drawer/index.ts)：`PhoneReservationDrawer`
- [front-desk/public/slots/index.ts](front-desk/public/slots/index.ts)：`pad2`・`tableBusy`・`toYmd`
- [front-desk/public/walk-in/index.ts](front-desk/public/walk-in/index.ts)：`isWalkIn`
- [front-desk/public/walk-in-dialog/index.ts](front-desk/public/walk-in-dialog/index.ts)：`WalkInDialog`
- [google/index.ts](google/index.ts)：`GoogleV8`・`MediaUploadHelpers`
- [inventory/index.ts](inventory/index.ts)：`InventoryPage`・`joinTableCodes`
- [inventory/public/format/index.ts](inventory/public/format/index.ts)：`joinTableCodes`
- [line-followup/index.ts](line-followup/index.ts)：`LineFollowupV8`
- [menu/index.ts](menu/index.ts)：`RestaurantMenuEditPage`・`MenuPage`
- [organization/index.ts](organization/index.ts)：`OrganizationV8`
- [reservations/index.ts](reservations/index.ts)：`ReservationsPage`・`INACTIVE_STATUSES`・`hm`・`mdWeek`・`sourceName`・`maskPhone`
- [reservations/public/format/index.ts](reservations/public/format/index.ts)：`INACTIVE_STATUSES`・`hm`・`maskPhone`・`mdWeek`・`sourceName`
- [store-new/index.ts](store-new/index.ts)：`StoreNewV8`・`TermsBody`・`termsSectionId`
- [store-new/public/terms-body/index.ts](store-new/public/terms-body/index.ts)：`TermsBody`・`termsSectionId`
- [store-tabs/index.ts](store-tabs/index.ts)：`StoreTabs`・`StoreTabKey`
- [tables/index.ts](tables/index.ts)：`TablesPage`
- [terms/index.ts](terms/index.ts)：`TermsV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/reservation-board.ts](../../lib/api/helpers/reservation-board.ts)
- [lib/restaurant-delivery-api.ts](../../lib/restaurant-delivery-api.ts)
- [lib/restaurant-google-api.ts](../../lib/restaurant-google-api.ts)
- [lib/restaurant-test-api.ts](../../lib/restaurant-test-api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [approvals/BEHAVIOR.md](approvals/BEHAVIOR.md)
- [close-tasks/BEHAVIOR.md](close-tasks/BEHAVIOR.md)
- [closures/BEHAVIOR.md](closures/BEHAVIOR.md)
- [common-a/BEHAVIOR.md](common-a/BEHAVIOR.md)
- [dashboard/BEHAVIOR.md](dashboard/BEHAVIOR.md)
- [delivery/BEHAVIOR.md](delivery/BEHAVIOR.md)
- [front-desk/BEHAVIOR.md](front-desk/BEHAVIOR.md)
- [google/BEHAVIOR.md](google/BEHAVIOR.md)
- [inventory/BEHAVIOR.md](inventory/BEHAVIOR.md)
- [line-followup/BEHAVIOR.md](line-followup/BEHAVIOR.md)
- [menu/BEHAVIOR.md](menu/BEHAVIOR.md)
- [organization/BEHAVIOR.md](organization/BEHAVIOR.md)
- [reservations/BEHAVIOR.md](reservations/BEHAVIOR.md)
- [store-new/BEHAVIOR.md](store-new/BEHAVIOR.md)
- [tables/BEHAVIOR.md](tables/BEHAVIOR.md)
- [terms/BEHAVIOR.md](terms/BEHAVIOR.md)
- [approvals/approvals.test.tsx](approvals/approvals.test.tsx)
- [booking-kit/refresh-failure.test.tsx](booking-kit/refresh-failure.test.tsx)
- [close-tasks/read-retry.test.tsx](close-tasks/read-retry.test.tsx)
- [closures/closures.test.tsx](closures/closures.test.tsx)
- [dashboard/summarize.test.ts](dashboard/summarize.test.ts)
- [delivery/delivery.test.tsx](delivery/delivery.test.tsx)
- [front-desk/front-desk.test.tsx](front-desk/front-desk.test.tsx)
- [google/google-parts.test.tsx](google/google-parts.test.tsx)
- [google/instagram-post.test.tsx](google/instagram-post.test.tsx)
- [google/profile-busy.test.tsx](google/profile-busy.test.tsx)
- [google/profile-confirm.test.tsx](google/profile-confirm.test.tsx)
- [google/profile-edit.test.tsx](google/profile-edit.test.tsx)
- [google/profile-history.test.tsx](google/profile-history.test.tsx)
- [google/profile-hours.test.tsx](google/profile-hours.test.tsx)
- [inventory/channels-jst.test.tsx](inventory/channels-jst.test.tsx)
- [inventory/format.test.ts](inventory/format.test.ts)
- [inventory/inventory.test.tsx](inventory/inventory.test.tsx)
- [line-followup/line-followup.test.tsx](line-followup/line-followup.test.tsx)
- [menu/menu.test.tsx](menu/menu.test.tsx)
- [organization/organization.test.tsx](organization/organization.test.tsx)
- [organization/store-groups.test.tsx](organization/store-groups.test.tsx)
- [reservations/dialogs-jst.test.tsx](reservations/dialogs-jst.test.tsx)
- [reservations/format.test.ts](reservations/format.test.ts)
- [reservations/list-print.test.tsx](reservations/list-print.test.tsx)
- [reservations/reservations.test.tsx](reservations/reservations.test.tsx)
- [reservations/waitlist-independent.test.tsx](reservations/waitlist-independent.test.tsx)
- [store-new/terms-state.test.ts](store-new/terms-state.test.ts)
- [tables/tables.test.tsx](tables/tables.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/restaurant`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
