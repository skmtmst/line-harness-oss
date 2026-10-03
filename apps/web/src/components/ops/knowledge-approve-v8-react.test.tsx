// @vitest-environment happy-dom
/*
 * ナレッジ記事の保存と承認 V8（R5ckwJ／eSXxA）。
 * 主ボタンは「保存して承認」。2つの読み合わせ（内容・解決）が
 * 揃うまで押せない。失敗したら入力を残して理由を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsKnowledgeArticle } from '@/lib/api'
import KnowledgeEditor from './knowledge-editor'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ update: vi.fn(), review: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: { ops: { knowledge: mocks } },
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const article: OpsKnowledgeArticle = {
  id: 'article', version: 1, sourceRequestId: 'ticket', ticketNo: 1045, sourceCurrent: true,
  articleKind: 'verified',
  title: 'バナー生成で日本語が崩れる', question: '文字が崩れる', answer: '短くして生成する',
  kind: 'bug', keywords: ['バナー'], reviewState: 'pending', status: 'disabled', reviewReason: '',
  evidence: [
    { messageId: 'a', authorKind: 'ops', createdAt: '2026-09-19T09:40:00+09:00', role: 'action', quote: '直ったと返信' },
    { messageId: 'b', authorKind: 'tenant', createdAt: '2026-09-19T09:52:00+09:00', role: 'result', quote: '直った' },
  ], usedCount: 0, helpfulCount: 0, unhelpfulCount: 0, updatedAt: '2026-09-19T09:52:00+09:00',
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  mocks.update.mockResolvedValue({ success: true, data: { ...article, version: 2 } })
  mocks.review.mockResolvedValue({ success: true, data: { ...article, version: 3 } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme })

async function render() {
  await act(async () => { root.render(<KnowledgeEditor article={article} onClose={() => {}} onSaved={() => {}} />) })
}

const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label)
const checks = () =>
  Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]

describe('記事の保存と承認V8（eSXxA）', () => {
  it('2つの読み合わせが揃うまで保存して承認を押せない', async () => {
    await render()
    expect(document.querySelector('[data-design-node="eSXxA"]')).not.toBeNull()
    const save = button('保存して承認')!
    expect(save.disabled).toBe(true)
    // 内容だけでは足りない
    await act(async () => { checks()[0].click() })
    expect(button('保存して承認')!.disabled).toBe(true)
    // 解決の読み合わせで押せるようになる
    await act(async () => { checks()[1].click() })
    expect(document.body.textContent).toContain('#MB-1045')
    expect(button('保存して承認')!.disabled).toBe(false)
    await act(async () => { button('保存して承認')!.click() })
    expect(mocks.update).toHaveBeenCalledWith('article', 1, expect.objectContaining({ answer: article.answer }))
    expect(mocks.review).toHaveBeenCalledWith('article', { version: 2, action: 'approve', confirmed: true })
  })

  it('承認が通らないときは入力を残して理由を出す', async () => {
    mocks.review.mockResolvedValueOnce({ success: false, error: '元のやり取りが更新されています' })
    await render()
    await act(async () => { checks()[0].click() })
    await act(async () => { checks()[1].click() })
    await act(async () => { button('保存して承認')!.click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('元のやり取りが更新されています')
    // 入力は残る（題名が消えない）
    expect((document.querySelector('input[value="バナー生成で日本語が崩れる"]') as HTMLInputElement | null)?.value)
      .toBe('バナー生成で日本語が崩れる')
    // 読み合わせをし直せば、もう一度押せる（失敗で外れた分だけ）
    await act(async () => { checks()[0].click() })
    expect(button('保存して承認')!.disabled).toBe(false)
  })
})
