'use client'

import { useSearchParams } from 'next/navigation'
import AutoRepliesListV8 from '@/v8/auto-replies/list'
import AnswerLogV8 from './answer-log'
import QaListV8 from './qa-list'

/** 自動応答の入口（?tab=qa は Q&A、?tab=ai-log は AI が答えた記録、ほかはキーワード）。 */
export default function AutoRepliesEntry() {
  const tab = useSearchParams().get('tab')
  if (tab === 'qa') return <QaListV8 />
  if (tab === 'ai-log') return <AnswerLogV8 />
  return <AutoRepliesListV8 />
}
