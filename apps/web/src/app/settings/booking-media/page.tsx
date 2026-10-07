'use client'

import { redirect } from 'next/navigation'
import BookingMediaPage from '@/v8/settings/booking-media/screen'
import { restaurantTestUiEnabled } from '@/lib/environment-features'

/* ★V8 予約サイト・グルメ媒体（提案 E-4 `aSmph`）。新しい画面なので V8 だけで出す。画面は src/v8/settings/booking-media。
   飲食店向け（テスト）が使えない環境では、ほかの飲食店の画面と同じく統括へ戻す。 */
export default function Page() {
  if (!restaurantTestUiEnabled()) redirect('/hq')
  return <BookingMediaPage />
}
