'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'
import AutoRepliesListV8 from '@/v8/auto-replies/list'
import AnswerLogV8 from '@/v8/ai-reply/answer-log'
import QaListV8 from '@/v8/ai-reply/qa-list'

// V8 を直接描く。?tab=qa は Q&A、?tab=ai-log は AI が答えた記録、ほかはキーワード。検索パラメータは Suspense の中で読む。
function AutoRepliesTabs() {
  const tab = useSearchParams().get('tab')
  if (tab === 'qa') return <QaListV8 />
  if (tab === 'ai-log') return <AnswerLogV8 />
  return <AutoRepliesListV8 />
}

export default function AutoRepliesPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoRepliesTabs />
    </Suspense>
  )
}
