'use client'

import { Suspense } from 'react'
import RestaurantDashboard from '@/v8/restaurant/dashboard/entry'

/* ★V8 飲食の業種ダッシュボード（ で前の「今日のお店」hKRRF を置き換え。絵 NqAvL）。全店の一覧（板 `CHz31`）は ?view=stores。画面は src/v8/style-dashboard。 */
export default function Page() {
  return <Suspense fallback={null}><RestaurantDashboard /></Suspense>
}
