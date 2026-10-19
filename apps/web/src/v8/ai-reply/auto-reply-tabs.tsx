'use client'

import { Tabs } from '@/components/shared/tabs'
import { conversationAiUiEnabled } from '@/lib/environment-features'

export type AutoReplyTab = 'keyword' | 'qa' | 'ai-log'

/** 自動応答のタブ（板 y4nixm・LPkKH：キーワード・Q&A・AI が答えた記録）。行き先は ?tab=。 */
/* 会話の AI を出さない間はタブが 1 つだけになるので、帯ごと出さない。 */
export function AutoReplyTabs({ active }: { active: AutoReplyTab }) {
  if (!conversationAiUiEnabled()) return null
  const items: Array<{ key: AutoReplyTab; label: string; href: string }> = [
    { key: 'keyword', label: 'キーワード', href: '/auto-replies' },
    { key: 'qa', label: 'Q&A', href: '/auto-replies?tab=qa' },
    { key: 'ai-log', label: 'AI が答えた記録', href: '/auto-replies?tab=ai-log' },
  ]
  return <Tabs size="short" label="自動応答の種類" items={items.map((item) => ({ label: item.label, href: item.href, current: item.key === active }))} />
}
