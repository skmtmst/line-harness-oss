'use client'

import EnvironmentFeatureGate from '@/components/shared/environment-feature-gate'
import BookingMediaPage from '@/v8/settings/booking-media/screen'

/* ★V8 予約サイト・グルメ媒体（提案 E-4 `aSmph`）。新しい画面なので V8 だけで出す。画面は src/v8/settings/booking-media。
   飲食店向け（テスト）が使えない環境では、共通の案内を出す。 */
export default function Page() {
  return <EnvironmentFeatureGate feature="予約サイト・グルメ媒体"><BookingMediaPage /></EnvironmentFeatureGate>
}
