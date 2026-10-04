// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsKnowledgeArticle } from '@/lib/api'
import OpsKnowledgePage from './page'
import KnowledgeEditor from '@/components/ops/knowledge-editor'
import { KnowledgeReferences, TicketKnowledge } from '@/components/ops/knowledge-ticket'
import type { OpsSupportDetail } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ list: vi.fn(), article: vi.fn(), update: vi.fn(), review: vi.fn(), feedback: vi.fn(), retry: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: { ops: { knowledge: mocks } } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/ops/knowledge' }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const article: OpsKnowledgeArticle = {
  id: 'article', version: 1, sourceRequestId: 'ticket', ticketNo: 312, sourceCurrent: true,
  articleKind: 'verified',
  title: 'フォームのタグが付かないとき', question: 'タグが付かない', answer: '回答後の設定を確認した',
  kind: 'bug', keywords: ['タグ'], reviewState: 'pending', status: 'disabled', reviewReason: '',
  evidence: [
    { messageId: 'a', authorKind: 'ops', createdAt: '2026-09-19T09:40:00+09:00', role: 'action', quote: '設定してテストで確認しました' },
    { messageId: 'b', authorKind: 'tenant', createdAt: '2026-09-19T09:52:00+09:00', role: 'result', quote: 'タグが付くことを確認できました' },
  ], usedCount: 0, helpfulCount: 0, unhelpfulCount: 0, updatedAt: '2026-09-19T09:52:00+09:00',
}
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.list.mockResolvedValue({ success: true, data: [article], total: 1 })
  mocks.article.mockResolvedValue({ success: true, data: article })
  mocks.update.mockResolvedValue({ success: true, data: { ...article, version: 2 } })
  mocks.review.mockResolvedValue({ success: true, data: { ...article, version: 3 } })
  mocks.feedback.mockResolvedValue({ success: true, data: null })
  mocks.retry.mockResolvedValue({ success: true, data: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(200) }) }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label)!

describe('V6 knowledge UI', () => {
  it('shows the actual source subject, JST evidence time and only quoted conditions', async () => {
    await act(async () => root.render(<KnowledgeEditor article={{ ...article, sourceSubject: '実際の問い合わせ件名', evidence: [
      { ...article.evidence[0], createdAt: '2026-09-19T00:40:00Z' }, article.evidence[1],
      { ...article.evidence[0], role: 'condition', quote: '対象フォームの回答後アクション' },
    ] }} onClose={() => {}} onSaved={() => {}} />))
    expect(document.body.textContent).toContain('#MB-0312 実際の問い合わせ件名')
    expect(document.querySelector('time')?.textContent).toBe('9:40')
    expect(document.body.textContent).toContain('適用条件：対象フォームの回答後アクション')
  })
  it('does not invent an applicability condition when the source has none', async () => {
    await act(async () => root.render(<KnowledgeEditor article={article} onClose={() => {}} onSaved={() => {}} />))
    expect(document.body.textContent).toContain('適用条件：原文に明示なし')
  })
  it('displays actual draft references and sends feedback or exclusion for that article', async () => {
    const exclude = vi.fn()
    await act(async () => root.render(<KnowledgeReferences requestId="ticket" references={[{ id: article.id, title: article.title, version: 3, articleKind: 'verified' }]} busy={false} onExclude={exclude} />))
    expect(host.querySelector('[data-design-node="LT8m5"]')).not.toBeNull()
    expect(host.textContent).toContain('解決確認済み')
    expect(host.textContent).toContain('回答の参考')
    await act(async () => button('今回の回答に合う').click())
    expect(mocks.feedback).toHaveBeenCalledWith('article', 'ticket', 'helpful')
    expect(button('今回の回答に合う').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('今回には合わない').click())
    expect(mocks.feedback).toHaveBeenLastCalledWith('article', 'ticket', 'unhelpful')
    expect(exclude).not.toHaveBeenCalled()
    expect(mocks.review).not.toHaveBeenCalled()
    await act(async () => button('除外して回答を作り直す').click())
    expect(exclude).toHaveBeenCalledWith('article')
  })
  it('an unsuccessful fit vote can be retried without changing or disabling the knowledge', async () => {
    mocks.feedback.mockRejectedValueOnce(new TypeError('offline'))
    await act(async () => root.render(<KnowledgeReferences requestId="ticket" references={[{ id: article.id, title: article.title, version: 3, articleKind: 'verified' }]} busy={false} onExclude={() => {}} />))
    await act(async () => button('今回には合わない').click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('通信できませんでした')
    expect(button('今回には合わない').disabled).toBe(false)
    expect(button('今回には合わない').getAttribute('aria-pressed')).toBe('false')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('shows resolution review without approving automatically, and surfaces retry failures', async () => {
    const detail = { ticket: { id: 'ticket', stage: 'resolved' }, knowledge: { article, job: { status: 'failed', source_current: 1 } } } as OpsSupportDetail
    mocks.retry.mockRejectedValueOnce(new TypeError('offline'))
    await act(async () => root.render(<TicketKnowledge detail={detail} onRefresh={() => {}} />))
    expect(host.textContent).toContain('承認するまで')
    expect(mocks.review).not.toHaveBeenCalled()
    await act(async () => button('もう一度試す').click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('通信できませんでした')
    expect(button('もう一度試す').disabled).toBe(false)
  })
  it('shows ops-only columns and review actions without FAQ publishing controls', async () => {
    await act(async () => root.render(<OpsKnowledgePage />)); await flush()
    expect(host.querySelector('[data-design-node="h114s"]')).not.toBeNull()
    expect(host.textContent).toContain('承認待ち')
    expect(host.textContent).toContain('開く')
    expect(host.textContent).not.toContain('FAQ')
    expect(host.textContent).not.toContain('公開範囲')
    expect(host.querySelector('button[aria-label$="記事の種類"]')).not.toBeNull()
    await act(async () => host.querySelector('summary')!.click())
    expect(host.querySelector('[data-design-node="aeKindFilter"]')).not.toBeNull()
    expect(host.querySelectorAll('th')).toHaveLength(7)
  })
  it('requires evidence confirmation and saves the edited version before approval', async () => {
    // 板 `eSXxA`「記事を承認する前に」：2つ確かめてから保存して承認する。
    const closed = vi.fn()
    await act(async () => root.render(<KnowledgeEditor article={article} onClose={closed} onSaved={() => {}} />))
    await act(async () => button('承認して有効にする').click())
    const confirm = document.body.querySelector('[data-design-node="eSXxA"]')
    expect(confirm, '承認前の確認の窓が出ない').not.toBeNull()
    for (const row of ['記事を承認する前に', '本文と手順を読み', '下書きで保存', '保存して承認']) {
      expect(confirm?.textContent ?? '', `「${row}」がない`).toContain(row)
    }
    const approveInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '保存して承認') as HTMLButtonElement
    expect(approveInDialog.disabled, '読む前に承認できてしまう').toBe(true)
    await act(async () => ((confirm as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(approveInDialog.disabled).toBe(false)
    await act(async () => approveInDialog.click())
    expect(mocks.update).toHaveBeenCalledWith('article', 1, expect.objectContaining({ answer: article.answer }))
    expect(mocks.review).toHaveBeenCalledWith('article', { version: 2, action: 'approve', confirmed: true })
    expect(closed).toHaveBeenCalledOnce()
  })
  it('does not enable approval for stale or uncertain evidence', async () => {
    await act(async () => root.render(<KnowledgeEditor article={{ ...article, sourceCurrent: false }} onClose={() => {}} onSaved={() => {}} />))
    expect(button('承認して有効にする').disabled).toBe(true)
    expect(document.body.textContent).toContain('元のやり取りが更新されています')
  })
  it('labels an answer example and allows approval after the operator confirms its nonempty answer', async () => {
    const example = { ...article, articleKind: 'answer_example' as const, evidence: [
      { ...article.evidence[0], role: 'question' as const, authorKind: 'tenant' as const, quote: '質問です' },
      { ...article.evidence[1], role: 'answer' as const, authorKind: 'ops' as const, quote: '回答です' },
    ], reviewReason: 'お客様の成功確認はありません。回答内容を確認して承認してください。' }
    await act(async () => root.render(<KnowledgeEditor article={example} onClose={() => {}} onSaved={() => {}} />))
    expect(document.body.textContent).toContain('回答例（お客様の確認なし）')
    expect(document.body.textContent).toContain('成功確認を示すものではありません')
    await act(async () => button('承認して有効にする').click())
    const confirm = document.body.querySelector('[data-design-node="eSXxA"]')
    expect(confirm, '承認前の確認の窓が出ない').not.toBeNull()
    expect(confirm?.textContent ?? '').toContain('本文と手順を読み')
    await act(async () => ((confirm as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    const approveInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '保存して承認') as HTMLButtonElement
    expect(approveInDialog.disabled).toBe(false)
  })
  it('blocks approval while the source ticket is still open (board eSXxA)', async () => {
    await act(async () => root.render(<KnowledgeEditor
      article={article}
      ticket={{ label: '#1045', resolved: false, stageLabel: '対応中' }}
      onClose={() => {}}
      onSaved={() => {}}
    />))
    await act(async () => button('承認して有効にする').click())
    const confirm = document.body.querySelector('[data-design-node="eSXxA"]')
    expect(confirm, '承認前の確認の窓が出ない').not.toBeNull()
    expect(confirm?.textContent ?? '').toContain('元の問い合わせ #1045 が「解決」になっている')
    expect(confirm?.textContent ?? '').toContain('まだ「対応中」です。解決にしてから承認できます')
    await act(async () => ((confirm as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    const approveInDialog = Array.from(confirm?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === '保存して承認') as HTMLButtonElement
    expect(approveInDialog.disabled, '対応中のまま承認できてしまう').toBe(true)
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('keeps a question-only example blocked until an answer is written', async () => {
    await act(async () => root.render(<KnowledgeEditor article={{ ...article, articleKind: 'answer_example', answer: '', evidence: [], reviewState: 'needs_review' }} onClose={() => {}} onSaved={() => {}} />))
    expect(document.body.textContent).toContain('運営の回答がありません。答えを書いて承認できます')
    expect(button('承認して有効にする').disabled).toBe(true)
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('recovers from a rejected save without issuing approval or trapping the dialog', async () => {
    mocks.update.mockRejectedValue(new TypeError('offline'))
    await act(async () => root.render(<KnowledgeEditor article={article} onClose={() => {}} onSaved={() => {}} />))
    await act(async () => button('下書きを保存する').click())
    expect(mocks.review).not.toHaveBeenCalled()
    expect(button('下書きを保存する').disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('通信できませんでした')
  })
  it('warns that editing an approved article invalidates approval', async () => {
    await act(async () => root.render(<KnowledgeEditor article={{ ...article, reviewState: 'approved', status: 'active' }} onClose={() => {}} onSaved={() => {}} />))
    expect(document.querySelector('[data-design-node="ZAOc7"]')).not.toBeNull()
    expect(document.body.textContent).toContain('再承認するまで')
    expect(button('承認待ちで保存する')).toBeDefined()
    expect(button('承認して有効にする')).toBeUndefined()
  })
  it('shows fetch failures rather than a misleading empty list, and can retry', async () => {
    mocks.list.mockRejectedValueOnce(new TypeError('offline'))
    await act(async () => root.render(<OpsKnowledgePage />)); await flush()
    expect(host.textContent).toContain('通信できませんでした')
    expect(host.textContent).not.toContain('記事はありません')
    const retry = Array.from(host.querySelectorAll('button')).find(b => /再|もう一度/.test(b.textContent ?? ''))!
    await act(async () => retry.click()); await flush()
    expect(host.textContent).toContain(article.title)
  })
})


describe('V8 ナレッジの集計範囲', () => {
  it('全件の総数とこのページの数を区別し、開いただけでは承認しない', async () => {
    document.documentElement.dataset.theme = 'v8'
    try {
      mocks.list.mockResolvedValue({ success: true, data: [{ ...article, usedCount: 7 }], total: 104 })
      await act(async () => root.render(<OpsKnowledgePage />)); await flush()
      expect(host.querySelector('[data-design-node="h114s"]')).not.toBeNull()
      expect(host.textContent).toContain('104件中')
      expect(host.textContent).toContain('承認待ち?1')
      expect(host.textContent).toContain('使われた回数?7')
      expect(host.textContent).toContain('104件中 1〜1件')
      expect(mocks.review).not.toHaveBeenCalled()
    } finally { delete document.documentElement.dataset.theme }
  })
})
