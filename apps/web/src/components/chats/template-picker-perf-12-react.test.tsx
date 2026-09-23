// @vitest-environment happy-dom
/*
 * PERF-12: テンプレート選択は全件を読まない。
 *
 * - 一覧は listPage で区画を取り、検索・フォルダ・分類をサーバーへ渡す
 * - 続きがあるときだけ「さらに表示」を出し、次の区画を下へ足す
 * - 遅れて届いた古い応答は新しい絞り込みを上書きしない
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  responder: (params: Record<string, unknown>) => ({
    success: true,
    data: { items: [] as Array<{ id: string; name: string }>, total: 0, limit: 100 },
  }) as { success: boolean; data: { items: unknown[]; total: number; limit: number } },
  deferred: [] as Array<{ params: Record<string, unknown>; resolve: (v: unknown) => void }>,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      listPage: (params: Record<string, unknown>) => {
        fixture.calls.push(params)
        return Promise.resolve(fixture.responder(params))
      },
    },
    folders: {
      list: async () => ({
        success: true,
        data: [
          { id: 'f1', kind: 'template', name: '案内', parentId: null, displayOrder: 0 },
        ],
      }),
    },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

function tpl(id: string, name = id) {
  return {
    id, accountId: 'acc-1', name, messageType: 'text', messageContent: `${name}の本文`,
    folderId: null, usageCount: 0, tapCount: 0, monthlySendCount: null, totalSendCount: null,
    hasDraft: false, publishedVersion: 1, publishedAt: null, draftRevision: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  fixture.calls = []
  fixture.deferred = []
  fixture.responder = () => ({ success: true, data: { items: [], total: 0, limit: 100 } })
})

afterEach(() => {
  cleanup()
})

// 検索のデバウンス(250ms)を越えるための実時間待ち。
const debounce = () => act(async () => { await new Promise((r) => setTimeout(r, 350)) })

describe('PERF-12 テンプレート選択の区画取得', () => {
  test('初回は1ページ目を取り、検索語はサーバーへ渡す', async () => {
    fixture.responder = (params) => ({
      success: true,
      data: {
        items: params.q ? [tpl('tp-hit', 'あいさつ')] : [tpl('tp-1'), tpl('tp-2')],
        total: params.q ? 1 : 2,
        limit: 100,
        folderCounts: { '': params.q ? 1 : 2 },
      },
    })
    render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(fixture.calls.length).toBeGreaterThan(0))
    expect(fixture.calls[0].page).toBe(1)
    expect(fixture.calls[0].accountId).toBe('acc-1')
    expect(fixture.calls[0].messageType).toBe('text')
    expect(fixture.calls[0].folderCounts).toBe(true)
    await waitFor(() => expect(screen.getAllByText('tp-1').length).toBeGreaterThan(0))

    await act(async () => {
      const input = screen.getByLabelText('テンプレート名・本文で検索')
      // React が管理する input の値は setter 経由で入れる。
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'あいさつ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await debounce()
    await waitFor(() => {
      expect(fixture.calls.some((c) => c.q === 'あいさつ')).toBe(true)
    })
    await waitFor(() => expect(screen.queryByText('tp-2')).toBeNull())
    expect(screen.getAllByText('あいさつ').length).toBeGreaterThan(0)
  })

  test('続きがあるときだけ「さらに表示」を出し、2ページ目を下へ足す', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => tpl(`tp-${i}`))
    const page2 = [tpl('tp-3'), tpl('tp-4')]
    fixture.responder = (params) => ({
      success: true,
      data: {
        items: params.page === 2 ? page2 : page1,
        total: 5,
        limit: 3,
        folderCounts: { '': 5 },
      },
    })
    render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('tp-0').length).toBeGreaterThan(0))
    const more = screen.getByText(/さらに表示/)
    await act(async () => { more.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await waitFor(() => {
      expect(fixture.calls.some((c) => c.page === 2)).toBe(true)
      expect(screen.getAllByText('tp-4').length).toBeGreaterThan(0)
    })
    // 全部届いたのでボタンは消える。
    expect(screen.queryByText(/さらに表示/)).toBeNull()
  })

  test('フォルダを選ぶと folder_id を渡して1ページ目から取り直す', async () => {
    fixture.responder = (params) => ({
      success: true,
      data: {
        items: params.folderId ? [tpl('tp-in', 'フォルダ内')] : [tpl('tp-1')],
        total: 1,
        limit: 100,
        folderCounts: { f1: 1 },
      },
    })
    render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(fixture.calls.length).toBeGreaterThan(0))
    fixture.calls = []
    // フォルダ欄を開いて「案内」を選ぶ。
    const selectButton = document.body.querySelector('[aria-haspopup="listbox"]')!
    await act(async () => { selectButton.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const option = await screen.findByRole('option', { name: /案内/ })
    await act(async () => { option.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await waitFor(() => {
      expect(fixture.calls.some((c) => c.folderId === 'f1' && c.page === 1)).toBe(true)
    })
    await waitFor(() => expect(screen.getAllByText('フォルダ内').length).toBeGreaterThan(0))
    expect(screen.queryByText('tp-1')).toBeNull()
  })

  test('遅れて届いた古い絞り込みの応答は新しい結果を上書きしない', async () => {
    // 1回目(無条件)は遅れて届く、2回目(検索後)は先に届く。
    fixture.responder = (params) => {
      if (params.q === 'あいさつ') {
        return { success: true, data: { items: [tpl('tp-hit', 'あいさつ')], total: 1, limit: 100 } }
      }
      // 初回は保留しておく。
      return new Promise<{ success: boolean; data: { items: unknown[]; total: number; limit: number } }>((resolve) => {
        fixture.deferred.push({
          params,
          resolve: () => resolve({ success: true, data: { items: [tpl('tp-old', '古い結果')], total: 1, limit: 100 } }),
        })
      }) as never
    }
    render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    await act(async () => {
      const input = screen.getByLabelText('テンプレート名・本文で検索')
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'あいさつ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await debounce()
    await waitFor(() => expect(screen.getAllByText('あいさつ').length).toBeGreaterThan(0))
    // あとから届いた初回分を適用しても、検索結果は消えない。
    await act(async () => { fixture.deferred.forEach((d) => d.resolve()) })
    expect(screen.queryByText('古い結果')).toBeNull()
    expect(screen.getAllByText('あいさつ').length).toBeGreaterThan(0)
  })
})
