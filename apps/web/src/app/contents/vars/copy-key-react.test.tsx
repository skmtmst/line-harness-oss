// @vitest-environment happy-dom
/*
 * 共通情報の一覧（監査6 #665）を本物のReactで動かす試験。
 *
 * 差し込みキーは一覧で `{{var.audit_u…}` のように省略される。
 * 利用者はこのキーを配信文面へ貼るため、一覧から1操作で全文を
 * 取り出せることを、実際に行のコピーボタンを押して確かめる。
 */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CommonVar } from '@line-crm/shared'

const api = vi.hoisted(() => ({
  varsList: vi.fn(),
  listExports: vi.fn(),
  foldersList: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        list: api.varsList,
        listExports: api.listExports,
      },
      folders: { ...actual.api.folders, list: api.foldersList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
    back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))

vi.mock('@/components/feature-gate', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

import CommonVarsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item: CommonVar = {
  id: 'var-1',
  lineAccountId: 'account-1',
  folderId: null,
  name: '監査用の共通情報',
  varKey: 'audit_user_name_for_long_key',
  type: 'text',
  value: 'テスト値',
  validFrom: null,
  validUntil: null,
  fallbackValue: null,
  expiryBehavior: 'stop',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  usageCount: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.varsList.mockResolvedValue({ success: true, data: [item] })
  api.listExports.mockResolvedValue({ success: true, data: [] })
  api.foldersList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
})

describe('共通情報の一覧: 差し込みキーのコピー（#665）', () => {
  it('行のコピーボタンを押すと省略前のキー全文がクリップボードへ入り、「コピー済み」が出る', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<CommonVarsPage />)

    const button = await screen.findByRole('button', {
      name: '監査用の共通情報の差し込みキーをコピー',
    })
    await act(async () => { fireEvent.click(button) })

    // 表示は省略されるが、コピーされるのは差し込み用の全文。
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('{{var.audit_user_name_for_long_key}}')
    expect(button.textContent).toBe('コピー済み')
  })
})
