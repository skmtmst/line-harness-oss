// @vitest-environment happy-dom
/*
 * N-136: 個別トークのテンプレート選択は選択中アカウントで絞る。
 *
 * 実物の TemplatePicker をマウントして操作する。
 *   - 一覧APIへ選択中のアカウントIDを必ず渡すこと
 *   - 別アカウントの候補を画面に出さないこと
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'acc-1' as string | null,
  templatesCalls: [] as unknown[],
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.selectedAccountId }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      // 実APIの契約どおり account_id が来たらその口座だけ返す。
      list: (...args: unknown[]) => {
        fixture.templatesCalls.push(args)
        const all = [
          { id: 'tp-1', accountId: 'acc-1', name: '本店の挨拶', messageType: 'text', messageContent: 'こんにちは', folderId: null },
          { id: 'tp-2', accountId: 'acc-2', name: '支店の挨拶', messageType: 'text', messageContent: 'こんにちは', folderId: null },
        ]
        const accountId = args[1] as string | undefined
        return Promise.resolve({
          success: true,
          data: accountId ? all.filter((t) => t.accountId === accountId) : all,
        })
      },
    },
    folders: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

afterEach(() => {
  cleanup()
  fixture.templatesCalls = []
})

describe('テンプレート選択の口座絞り(N-136)', () => {
  test('一覧APIへ選択中のアカウントIDを渡す', async () => {
    await act(async () => {
      render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    })
    await waitFor(() => {
      expect(fixture.templatesCalls.length).toBeGreaterThan(0)
    })
    const last = fixture.templatesCalls[fixture.templatesCalls.length - 1] as unknown[]
    expect(last[1]).toBe('acc-1')
  })

  test('別アカウントの候補を画面に出さない', async () => {
    await act(async () => {
      render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    })
    await waitFor(() => {
      expect(screen.getAllByText('本店の挨拶').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('支店の挨拶')).toBeNull()
  })
})
