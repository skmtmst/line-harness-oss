'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import FormEditV8 from '@/v8/form-edit/edit'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
export default function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><FormEditV8 /></Suspense>
}
