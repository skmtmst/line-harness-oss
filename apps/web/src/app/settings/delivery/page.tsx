'use client'

import { redirect } from 'next/navigation'
import DeliverySettingsPage from '@/v8/settings/delivery/delivery'
import { restaurantTestUiEnabled } from '@/lib/environment-features'

/* ★V8-B デリバリー連携（承認案 DL-1 `dF4Ov`／DL-2 `OIY4Z`／DL-3 `kJLks`／DL-4 `X5d8UF`、2026-10-12 利用者承認）。
   新しい画面なので V8 だけで出す。画面は src/v8/settings/delivery。
   飲食店向け（テスト）が使えない環境では、ほかの飲食店の画面と同じく統括へ戻す。 */
export default function Page() {
  if (!restaurantTestUiEnabled()) redirect('/hq')
  return <DeliverySettingsPage />
}
