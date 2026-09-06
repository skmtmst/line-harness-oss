import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  new URL('../../app/line-notifications/page.tsx', import.meta.url),
  'utf8',
)
const LIST = readFileSync(new URL('./notification-run-list.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 LINE notification history contract', () => {
  it('keeps the page title in the shared top bar and places history in the tab row', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).toContain('<MergedTabs')
    expect(PAGE).toContain("{ key: 'failures', label: '送れなかったもの' }")
    expect(PAGE).toContain("{ key: 'history', label: '記録' }")
  })

  it('requests records only after a LINE account is explicitly selected', () => {
    expect(PAGE).toContain('lineAccountId={selectedAccountId}')
    expect(LIST).toContain('if (!lineAccountId)')
    expect(API).toContain("new URLSearchParams({ lineAccountId: params.lineAccountId })")
    expect(LIST.indexOf('++requestRef.current')).toBeLessThan(LIST.indexOf('if (!lineAccountId)'))
  })

  it('distinguishes loading, empty, failure, and a real zero', () => {
    expect(LIST).toContain('kind="loading"')
    expect(LIST).toContain('kind="empty"')
    expect(LIST).toContain('kind="error"')
    expect(LIST).toContain("value={summary?.failed ?? null}")
    expect(LIST).toContain("items.length === 0")
    expect(LIST).toContain('data-list-state={listState}')
  })

  it('does not claim delivery or individual reads from a LINE API acceptance', () => {
    expect(LIST).toContain('LINE API受付済み')
    expect(LIST).not.toContain('届きました')
    expect(LIST).not.toContain('開きました')
    expect(LIST).toContain('個人の既読は取得できません')
  })

  it('shows retry only when the ledger marks the row retryable and sends its record version', () => {
    expect(LIST).toContain("item.retryAvailable ?")
    expect(LIST).toContain('expectedVersion: item.recordVersion')
    expect(LIST).toContain('送信を再試行')
    expect(API).toContain('retryAvailable: boolean')
    expect(API).toContain('/api/line-notifications/deliveries/${encodeURIComponent(id)}/retry')
    expect(LIST).toContain('受信箱で連絡')
  })

  it('uses ledger attempts while keeping click and definition version nullable', () => {
    expect(API).toContain('attemptCount: number')
    expect(API).toContain('clickedAt: string | null')
    expect(API).toContain('version: number | null')
    expect(API).toContain('recordVersion: number')
  })
})
