// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginAudit from './login-audit'

const fixture = vi.hoisted(() => ({
  events: vi.fn(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
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
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
  it('requests the server-side union and keeps retrieval failures visible', async () => {
    fixture.events.mockRejectedValueOnce(new Error('database unavailable'))
    await act(async () => { root.render(<LoginAudit />) })
    await settle()

    const attention = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('気になるもの'))
    expect(attention).toBeDefined()
    await act(async () => { attention?.click() })
    await settle()

    expect(fixture.events).toHaveBeenLastCalledWith(expect.objectContaining({
      lineAccountId: 'account-a',
      attention: true,
      limit: 20,
      offset: 0,
    }))
    expect(fixture.events.mock.calls.at(-1)?.[0]).not.toHaveProperty('result')
    expect(host.textContent).toContain('入った記録を読み込めませんでした')
    expect(host.textContent).toContain('もう一度読み込む')
  })
})
