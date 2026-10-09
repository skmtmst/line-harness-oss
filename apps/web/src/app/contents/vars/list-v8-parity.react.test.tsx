// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ApiResult = { success: boolean; data?: unknown; meta?: unknown }

const fixture = vi.hoisted(() => ({
  items: [] as unknown[],
  folders: [] as unknown[],
}))

const varItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  lineAccountId: 'account-a',
  folderId: null,
  name,
  varKey: `key_${id}`,
  type: 'text',
  value: '中身',
  validFrom: null,
  validUntil: null,
  fallbackValue: null,
  expiryBehavior: 'stop',
  state: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  usageCount: 0,
  ...extra,
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/staff-capability', () => ({
  isOwnerOrAdmin: () => true,
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageCrumbs: () => undefined,
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  api: {
    commonVars: {
      list: (): Promise<ApiResult> => Promise.resolve({ success: true, data: fixture.items }),
    },
    folders: {
      list: (): Promise<ApiResult> => Promise.resolve({ success: true, data: fixture.folders }),
    },
  },
}))

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

async function renderList() {
  const { default: CommonVarsListV8 } = await import('./list-v8')
  return render(<CommonVarsListV8 />)
}

describe('共通情報V8一覧の戻した表示', () => {
  test('期限切れの札で絞り込める（v7と同じ7枚）', async () => {
    fixture.items = [
      varItem('v1', 'ふつう'),
      varItem('v2', '切れた', { state: 'expired' }),
    ]
    const rendered = await renderList()
    await rendered.findByText('ふつう')
    const chip = rendered.getAllByText('期限切れ').find((el) => el.tagName === 'BUTTON')
    if (!chip) throw new Error('expired chip is missing')
    fireEvent.click(chip)
    expect(rendered.queryByText('ふつう')).toBeNull()
    expect(rendered.getByText('切れた')).toBeTruthy()
  })

  test('更新・次回の列に更新日と予定を出す（1行・全文はtitle）', async () => {
    fixture.items = [varItem('v1', 'ふつう')]
    const rendered = await renderList()
    await rendered.findByText('ふつう')
    const cell = rendered.getByTitle(/最終更新/)
    expect(cell.textContent).toContain('予定なし')
  })

  test('件数は範囲で出す（v7と同じListRange）', async () => {
    fixture.items = [varItem('v1', 'ひとつ'), varItem('v2', 'ふたつ')]
    const rendered = await renderList()
    await rendered.findByText('ひとつ')
    expect(rendered.getByText(/2件中 1〜2件を表示/)).toBeTruthy()
  })
})
