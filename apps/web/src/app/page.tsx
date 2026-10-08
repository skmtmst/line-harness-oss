'use client'

import { Suspense } from 'react'
import Screen from '@/v8/dashboard/dashboard'

/** V8 の入口。URL・読み書き・権限は画面側で保つ。 */
export default function DashboardPage() {
  return <Suspense fallback={null}><Screen /></Suspense>
}
