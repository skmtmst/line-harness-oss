'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'
import { conversationAiUiEnabled } from '@/lib/environment-features'
import AutoRepliesListV8 from '@/v8/auto-replies/list'
import AnswerLogV8 from '@/v8/ai-reply/answer-log'
import QaListV8 from '@/v8/ai-reply/qa-list'

// V8 を直接描く。?tab=qa は Q&A、?tab=ai-log は AI が答えた記録、ほかはキーワード。検索パラメータは Suspense の中で読む。
function AutoRepliesTabs() {
  const tab = useSearchParams().get('tab')
  /* 会話の AI（Q&A・AI が答えた記録）は旗がオンの時だけ。オフの時の ?tab= はキーワードの一覧へ。 */
  if (!conversationAiUiEnabled()) return <AutoRepliesListV8 />
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
