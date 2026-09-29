// @vitest-environment happy-dom
/*
 * D011: フォルダ一覧の取得に失敗しても、複製していない通常作成では
 * 複製元の失敗と混ぜず、「フォルダを読み込めませんでした」と再読み込みを出す。
 * 以前は一括の Promise.all の失敗で一律に複製元の文言が出ていた。
 *
 * D012: 「保存して続けて作る」の成功は URL に残し、再読み込みしても
 * 作ったタグ名が分かるようにする。以前は全画面リロードで知らせが消えていた。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockNet = vi.hoisted(() => ({
  foldersMode: 'ok' as 'ok' | 'fail',
  definitionMode: 'ok' as 'ok' | 'fail',
  pushed: [] as string[],
  query: '',
  created: [] as unknown[],
}))

vi.mock('@/lib/api', () => ({
  api: {
    tagGroups: {
      list: () => mockNet.foldersMode === 'ok'
        ? Promise.resolve({ success: true, data: [{ id: 'g1', name: '購入', accountId: 'a1' }] })
        : Promise.reject(new Error('network down')),
    },
    tags: {
      definition: () => mockNet.definitionMode === 'ok'
        ? Promise.resolve({
          success: true,
          data: {
            tag: { id: 't1', name: '元タグ', groupId: null, isStarred: false, linkedEnabled: false, mileageReward: 0, referralMileageReward: 0, mileageMultiplierBps: null, mileageMultiplierPriority: 0, reapplyPolicy: 'first_only' },
            automation: { actions: [] },
          },
        })
        : Promise.reject(new Error('network down')),
      createDefinition: (_accountId: string, data: { name: string }) => {
        mockNet.created.push(data)
        return Promise.resolve({ success: true, data: { tag: { id: 't-new' } } })
      },
      list: () => Promise.resolve({ success: true, data: [] }),
    },
    commonActions: {
      resources: () => Promise.resolve({ success: true, data: [] }),
    },
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => { mockNet.pushed.push(url) }, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(mockNet.query),
  usePathname: () => '/tags/new',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mockNet.foldersMode = 'ok'
  mockNet.definitionMode = 'ok'
  mockNet.pushed = []
  mockNet.query = ''
  mockNet.created = []
})

describe('D011 フォルダ一覧の取得失敗', () => {
  test('通常作成では複製元の文言を出さず、フォルダ欄に理由と読み直しを出す', async () => {
    mockNet.query = ''
    mockNet.foldersMode = 'fail'
    const { default: NewTagPageV4 } = await import('./new-tag-page-v4')
    render(<NewTagPageV4 />)

    await screen.findByText('フォルダを読み込めませんでした。未分類で作るか、読み直してください。')
    expect(screen.getByRole('button', { name: 'フォルダを読み直す' })).not.toBeNull()
    // 複製していないのに複製元の失敗は出さない。
    expect(screen.queryByText('複製元のタグを読み込めませんでした')).toBeNull()
    // 未分類のまま作る操作は残す。
    expect(screen.getByRole('button', { name: 'タグを作る' })).not.toBeNull()
  })

  test('読み直しで回復したら失敗表示が消える', async () => {
    mockNet.query = ''
    mockNet.foldersMode = 'fail'
    const { default: NewTagPageV4 } = await import('./new-tag-page-v4')
    render(<NewTagPageV4 />)
    const retry = await screen.findByRole('button', { name: 'フォルダを読み直す' })

    mockNet.foldersMode = 'ok'
    await act(async () => {
      fireEvent.click(retry)
    })
    await act(async () => {})
    expect(screen.queryByText('フォルダを読み込めませんでした。未分類で作るか、読み直してください。')).toBeNull()
  })

  test('複製元の取得失敗は複製元の文言で出し、入力欄は残す', async () => {
    mockNet.query = 'copy=t9'
    mockNet.definitionMode = 'fail'
    const { default: NewTagPageV4 } = await import('./new-tag-page-v4')
    render(<NewTagPageV4 />)

    await screen.findByText('複製元のタグを読み込めませんでした')
    expect(screen.getByRole('button', { name: 'タグを作る' })).not.toBeNull()
  })
})

describe('D012 保存して続けて作る', () => {
  test('成功後に作ったタグ名を残し、再読み込みしても分かる', async () => {
    mockNet.query = ''
    const { default: NewTagPageV4 } = await import('./new-tag-page-v4')
    const { rerender } = render(<NewTagPageV4 />)
    const nameInput = await screen.findByLabelText('タグ名', { exact: false })
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'リピーター' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
    })

    // 成功は全画面リロードせず、作った名前を URL に残して遷移する。
    expect(mockNet.created.length).toBe(1)
    expect(mockNet.pushed).toEqual(['/tags/new?created=%E3%83%AA%E3%83%94%E3%83%BC%E3%82%BF%E3%83%BC'])

    // URL に残った名前で開き直すと、成功の帯に作った名前が出る。
    mockNet.query = 'created=リピーター'
    rerender(<NewTagPageV4 />)
    await screen.findByText('「リピーター」を作成しました。続けて新しいタグを作れます。')
  })
})
