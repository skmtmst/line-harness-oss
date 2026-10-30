// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginAudit from './login-audit'

const fixture = vi.hoisted(() => ({
  events: vi.fn(),
  selectedAccountId: 'account-a' as string | null,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.selectedAccountId, loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      audit: { events: fixture.events },
    },
  }
})

const summary = {
  periodDays: 30 as const,
  total: 3,
  deleted: 0,
  sent: 0,
  changed: 0,
  logins: 3,
  suspiciousLogins: 2,
  attention: 2,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fixture.selectedAccountId = 'account-a'
  fixture.events.mockReset()
  fixture.events.mockResolvedValueOnce({
    success: true,
    data: { items: [], summary, pagination: { total: 3, limit: 20, offset: 0 } },
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('login audit attention filter', () => {
  it('does not request tenant-wide history when no LINE account is selected', async () => {
    fixture.selectedAccountId = null
    await act(async () => { root.render(<LoginAudit />) })
    await settle()
    expect(fixture.events).not.toHaveBeenCalled()
    expect(host.textContent).toContain('LINEアカウントを選択してください。')
  })

  it('clears the previous account history when the selected account changes', async () => {
    fixture.events.mockReset()
    fixture.events.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{
          id: 'account-a-event', category: 'business', lineAccountId: 'account-a',
          actor: { id: 'staff-a', name: 'A専用の担当者', role: 'admin' },
          action: 'broadcast.send', target: null, result: 'success', before: null, after: null,
          reason: null, requestTraceId: null, ipPrefix: null, deviceFamily: null,
          riskLevel: 'normal', retentionClass: 'general', createdAt: '2026-10-01T00:00:00.000Z',
        }],
        summary: { ...summary, total: 1 }, pagination: { total: 1, limit: 20, offset: 0 },
      },
    })
    await act(async () => { root.render(<LoginAudit />) })
    await settle()
    expect(host.textContent).toContain('A専用の担当者')

    fixture.events.mockResolvedValueOnce({
      success: true,
      data: { items: [], summary: { ...summary, total: 0, logins: 0, suspiciousLogins: 0, attention: 0 }, pagination: { total: 0, limit: 20, offset: 0 } },
    })
    fixture.selectedAccountId = 'account-b'
    await act(async () => { root.render(<LoginAudit />) })
    await settle()
    expect(fixture.events).toHaveBeenLastCalledWith(expect.objectContaining({ lineAccountId: 'account-b' }))
    expect(host.textContent).not.toContain('A専用の担当者')
  })

  it('requests the server-side union and keeps retrieval failures visible', async () => {
    fixture.events.mockRejectedValueOnce(new Error('database unavailable'))
    await act(async () => { root.render(<LoginAudit />) })
    await settle()

    const attention = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('気になるもの'))
    expect(attention).toBeDefined()
    await act(async () => { attention?.click() })
    await settle()

    // 監査 R69: 「気になるもの」は集計と同じ分類 group=attention で絞る。
    expect(fixture.events).toHaveBeenLastCalledWith(expect.objectContaining({
      lineAccountId: 'account-a',
      group: 'attention',
      limit: 20,
      offset: 0,
    }))
    expect(fixture.events.mock.calls.at(-1)?.[0]).not.toHaveProperty('result')
    expect(host.textContent).toContain('入った記録を読み込めませんでした')
    expect(host.textContent).toContain('もう一度読み込む')
  })
})
