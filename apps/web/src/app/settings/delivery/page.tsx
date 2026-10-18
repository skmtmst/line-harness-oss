'use client'

import EnvironmentFeatureGate from '@/components/shared/environment-feature-gate'
import DeliverySettingsPage from '@/v8/settings/delivery/delivery'

/* ★V8-B デリバリー連携（承認案 DL-1 `dF4Ov`／DL-2 `OIY4Z`／DL-3 `kJLks`／DL-4 `X5d8UF`、2026-10-12 利用者承認）。
   新しい画面なので V8 だけで出す。画面は src/v8/settings/delivery。
   飲食店向け（テスト）が使えない環境では、共通の案内を出す。 */
export default function Page() {
  return <EnvironmentFeatureGate feature="デリバリー連携"><DeliverySettingsPage /></EnvironmentFeatureGate>
}
