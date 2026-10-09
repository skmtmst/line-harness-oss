'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import NewCommonVarV8 from '@/v8/common-vars-edit/new'
import FeatureGate from '@/components/feature-gate'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><FeatureGate feature="common_vars"><NewCommonVarV8 /></FeatureGate></Suspense>
}
