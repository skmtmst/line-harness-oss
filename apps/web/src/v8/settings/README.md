> 文書：settings のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# settings：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/accounts` → [app/accounts/page.tsx](../../app/accounts/page.tsx)
- `/ec-commerce/identity-candidates` → [app/ec-commerce/identity-candidates/page.tsx](../../app/ec-commerce/identity-candidates/page.tsx)
- `/ec-commerce` → [app/ec-commerce/page.tsx](../../app/ec-commerce/page.tsx)
- `/emergency` → [app/emergency/page.tsx](../../app/emergency/page.tsx)
- `/getting-started` → [app/getting-started/page.tsx](../../app/getting-started/page.tsx)
- `/line-notifications` → [app/line-notifications/page.tsx](../../app/line-notifications/page.tsx)
- `/pools/new` → [app/pools/new/page.tsx](../../app/pools/new/page.tsx)
- `/pools` → [app/pools/page.tsx](../../app/pools/page.tsx)
- `/settings/booking-media` → [app/settings/booking-media/page.tsx](../../app/settings/booking-media/page.tsx)
- `/settings/customer-look` → [app/settings/customer-look/page.tsx](../../app/settings/customer-look/page.tsx)
- `/settings/delivery` → [app/settings/delivery/page.tsx](../../app/settings/delivery/page.tsx)
- `/settings/file-scan` → [app/settings/file-scan/page.tsx](../../app/settings/file-scan/page.tsx)
- `/settings/manual-links` → [app/settings/manual-links/page.tsx](../../app/settings/manual-links/page.tsx)
- `/settings` → [app/settings/page.tsx](../../app/settings/page.tsx)
- `/settings/sns` → [app/settings/sns/page.tsx](../../app/settings/sns/page.tsx)
- `/staff/edit` → [app/staff/edit/page.tsx](../../app/staff/edit/page.tsx)
- `/staff/new` → [app/staff/new/page.tsx](../../app/staff/new/page.tsx)
- `/staff` → [app/staff/page.tsx](../../app/staff/page.tsx)

本体：[accounts/accounts.tsx](accounts/accounts.tsx)、[booking-media/screen.tsx](booking-media/screen.tsx)、[customer-look/screen.tsx](customer-look/screen.tsx)、[delivery/delivery.tsx](delivery/delivery.tsx)、[ec-commerce/identity.tsx](ec-commerce/identity.tsx)、[ec-commerce/screen.tsx](ec-commerce/screen.tsx)、[emergency/screen.tsx](emergency/screen.tsx)、[features/screen.tsx](features/screen.tsx)、[file-scan/screen.tsx](file-scan/screen.tsx)、[getting-started/getting-started.tsx](getting-started/getting-started.tsx)、[line-notifications/screen.tsx](line-notifications/screen.tsx)、[manual-links/screen.tsx](manual-links/screen.tsx)、[pools/create.tsx](pools/create.tsx)、[pools/pools.tsx](pools/pools.tsx)、[sns/sns.tsx](sns/sns.tsx)、[staff/create.tsx](staff/create.tsx)、[staff/staff.tsx](staff/staff.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`AccountsV8`・`EcIdentityCandidatesScreen`・`EcCommerceScreen`・`EmergencyScreen`・`GettingStartedV8`・`PoolCreateV8`・`PoolsV8`・`BookingMediaPage`・`CustomerLookScreen`・`DeliverySettingsPage`・`FileScanScreen`・`ManualLinksScreen`・`FeatureSettingsScreen`・`SnsSettingsPage`・`StaffEditV8`・`StaffV8`・`doneCount`・`buildStepsFromApi`・`featureSetEntry`・`insertFeatureSet`・`StepResult`・`SelfMfa`・`MfaPolicy`
- [public/getting-started-steps/index.ts](public/getting-started-steps/index.ts)：`StepResult`・`doneCount`
- [public/staff-mfa-policy/index.ts](public/staff-mfa-policy/index.ts)：`MfaPolicy`
- [public/staff-self-mfa/index.ts](public/staff-self-mfa/index.ts)：`SelfMfa`
- [public/staff-staff/index.ts](public/staff-staff/index.ts)：`StaffEditV8`・`StaffV8`
- [public/steps/index.ts](public/steps/index.ts)：`buildStepsFromApi`・`featureSetEntry`・`insertFeatureSet`・`StepResult`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/field-errors.ts](../../lib/api/helpers/field-errors.ts)
- [lib/restaurant-delivery-api.ts](../../lib/restaurant-delivery-api.ts)
- [lib/restaurant-google-api.ts](../../lib/restaurant-google-api.ts)
- [lib/restaurant-test-api.ts](../../lib/restaurant-test-api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [accounts/BEHAVIOR.md](accounts/BEHAVIOR.md)
- [booking-media/BEHAVIOR.md](booking-media/BEHAVIOR.md)
- [delivery/BEHAVIOR.md](delivery/BEHAVIOR.md)
- [ec-commerce/BEHAVIOR.md](ec-commerce/BEHAVIOR.md)
- [emergency/BEHAVIOR.md](emergency/BEHAVIOR.md)
- [features/BEHAVIOR.md](features/BEHAVIOR.md)
- [file-scan/BEHAVIOR.md](file-scan/BEHAVIOR.md)
- [getting-started/BEHAVIOR.md](getting-started/BEHAVIOR.md)
- [line-notifications/BEHAVIOR.md](line-notifications/BEHAVIOR.md)
- [manual-links/BEHAVIOR.md](manual-links/BEHAVIOR.md)
- [pools/BEHAVIOR.md](pools/BEHAVIOR.md)
- [sns/BEHAVIOR.md](sns/BEHAVIOR.md)
- [staff/BEHAVIOR.md](staff/BEHAVIOR.md)
- [accounts/registration-access.test.tsx](accounts/registration-access.test.tsx)
- [accounts/view.test.ts](accounts/view.test.ts)
- [booking-media/read-failure.test.tsx](booking-media/read-failure.test.tsx)
- [booking-media/screen.test.ts](booking-media/screen.test.ts)
- [customer-look/screen.test.tsx](customer-look/screen.test.tsx)
- [delivery/delivery.test.tsx](delivery/delivery.test.tsx)
- [ec-commerce/connector-account-race.test.tsx](ec-commerce/connector-account-race.test.tsx)
- [ec-commerce/connector-validation.test.tsx](ec-commerce/connector-validation.test.tsx)
- [ec-commerce/identity.test.tsx](ec-commerce/identity.test.tsx)
- [ec-commerce/order-drawer.test.tsx](ec-commerce/order-drawer.test.tsx)
- [ec-commerce/subscriptions.test.tsx](ec-commerce/subscriptions.test.tsx)
- [emergency/history-deployments.test.ts](emergency/history-deployments.test.ts)
- [emergency/history-icons.test.tsx](emergency/history-icons.test.tsx)
- [emergency/line-receipts.test.tsx](emergency/line-receipts.test.tsx)
- [features/impact.test.tsx](features/impact.test.tsx)
- [features/reorder-dialog.test.tsx](features/reorder-dialog.test.tsx)
- [features/save-race.test.tsx](features/save-race.test.tsx)
- [features/screen.test.tsx](features/screen.test.tsx)
- [getting-started/getting-started.test.tsx](getting-started/getting-started.test.tsx)
- [line-notifications/audit-web198-199.test.ts](line-notifications/audit-web198-199.test.ts)
- [line-notifications/runs-tab-kpis.test.tsx](line-notifications/runs-tab-kpis.test.tsx)
- [line-notifications/toggle-account-switch.test.tsx](line-notifications/toggle-account-switch.test.tsx)
- [manual-links/screen.test.tsx](manual-links/screen.test.tsx)
- [pools/create.test.tsx](pools/create.test.tsx)
- [pools/edit.test.tsx](pools/edit.test.tsx)
- [pools/order.test.ts](pools/order.test.ts)
- [sns/sns.test.tsx](sns/sns.test.tsx)
- [staff/mfa-policy.test.tsx](staff/mfa-policy.test.tsx)
- [staff/self-mfa.test.tsx](staff/self-mfa.test.tsx)
- [staff/staff-field-errors.test.tsx](staff/staff-field-errors.test.tsx)
- [staff/staff-more-users.test.tsx](staff/staff-more-users.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/settings`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
