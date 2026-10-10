'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import AutoReplyWizardV8 from './wizard-v8'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function AutoReplyEditPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoReplyWizardV8 />
    </Suspense>
  )
}
