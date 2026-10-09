'use client'

import { Suspense } from 'react'
import Screen from '@/v8/tags/mark-editor'
import FeatureGate from '@/components/feature-gate'

/** V8 の入口。URL・読み書き・権限は画面側で保つ。 */
export default function NewSupportMarkPage() {
  return <FeatureGate feature="support_marks"><Suspense fallback={null}><Screen /></Suspense></FeatureGate>
}
