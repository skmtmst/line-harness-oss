// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationAiUiEnabled } from '@/lib/environment-features'
import { AutoReplyTabs } from './auto-reply-tabs'
import { InboxAiDraft, InboxAiSummary, type InboxAi } from './inbox-ai'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

/** 会話の AI が止まっている状態（要約の場所に「AI が使えません」の帯が出る形）。 */
const suspended = { ai: { mode: 'suspended', permissions: { seeSummary: true, useDraft: true } }, active: false, summary: { kind: 'idle' }, draft: { kind: 'idle' }, isDismissed: false } as unknown as InboxAi

describe('会話の AI の入口の旗', () => {
  it('明示的な true の時だけオン。未設定・false・空はオフ', () => {
    expect(conversationAiUiEnabled(undefined)).toBe(false)
    expect(conversationAiUiEnabled('')).toBe(false)
    expect(conversationAiUiEnabled('false')).toBe(false)
    expect(conversationAiUiEnabled('1')).toBe(false)
    expect(conversationAiUiEnabled('true')).toBe(true)
    expect(conversationAiUiEnabled(' TRUE ')).toBe(true)
  })

  it('旗がオフ（既定）：自動応答のタブの帯と、受信箱の要約・返信案の入口が出ない', () => {
    const tabs = render(<AutoReplyTabs active="keyword" />)
    expect(tabs.container.textContent).toBe('')
    const summary = render(<InboxAiSummary inboxAi={suspended} />)
    expect(summary.container.textContent).toBe('')
    const draft = render(<InboxAiDraft inboxAi={suspended} onInsert={() => {}} />)
    expect(draft.container.textContent).toBe('')
  })

  it('旗をオンにすると入口が出る（コードは残してある）', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVERSATION_AI_ENABLED', 'true')
    const tabs = render(<AutoReplyTabs active="keyword" />)
    expect(tabs.container.textContent).toContain('Q&A')
    expect(tabs.container.textContent).toContain('AI が答えた記録')
    const summary = render(<InboxAiSummary inboxAi={suspended} />)
    expect(summary.container.textContent).toContain('AI が使えません')
  })
})
