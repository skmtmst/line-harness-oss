'use client'

import { Suspense } from 'react'
import Screen from '@/v8/style-dashboard/home'

/** V8 の入口。使い方のスタイル（B-294）で業種ダッシュボードと標準のダッシュボードを出し分ける。 */
export default function DashboardPage() {
  return <Suspense fallback={null}><Screen /></Suspense>
}
