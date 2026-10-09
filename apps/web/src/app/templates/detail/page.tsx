'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import TemplateDetailV8 from '@/v8/template-detail/detail'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><TemplateDetailV8 /></Suspense>
}
