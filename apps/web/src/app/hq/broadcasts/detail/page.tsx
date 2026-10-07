'use client'

import { Suspense } from 'react'
import HqBroadcastDetail from '@/v8/hq-broadcasts/detail'

/* ★V8 統括 一括配信の詳細（提案 E-9 `xOXuY` ⑤ 送った結果）。?id=<一括配信> で開く。 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HqBroadcastDetail />
    </Suspense>
  )
}
