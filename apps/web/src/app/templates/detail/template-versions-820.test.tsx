// @vitest-environment happy-dom
/*
 * #820: 詳細の「使っている所」と「版の履歴」。
 * 空・読み込み中・失敗・正常を描画で確かめる。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const templateGet = vi.hoisted(() => vi.fn())
const templateVersions = vi.hoisted(() => vi.fn())
const templateUpdate = vi.hoisted(() => vi.fn())
const templateCreate = vi.hoisted(() => vi.fn())
const templateRevert = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

const USED_BY = {
  autoReplies: [
    { id: 'ar-1', keyword: '予約', matchType: 'exact', lineAccountId: 'account-a', templateVersion: 3 },
  ],
  automations: [],
  scenarioSteps: [
    { scenarioId: 'sc-1', scenarioName: '初回来店のお礼', stepId: 'ss-1', stepOrder: 1, templateVersion: 3 },
  ],
  reminderSteps: [],
  richMenuAreas: [],
  trackedLinks: [],
  broadcasts: [
    { broadcastId: 'bc-1', title: '秋の会員向け案内', status: 'scheduled', scheduledAt: null, templateVersionNumber: 3 },
    { broadcastId: 'bc-2', title: '8月の案内', status: 'sent', scheduledAt: null, templateVersionNumber: 2 },
  ],
}

const VERSIONS = [
  { versionNumber: 3, status: 'in_use', messageType: 'text', messageContent: 'いまの本文', effectiveFrom: null, createdAt: '2026-09-10T11:02:00+09:00' },
  { versionNumber: 2, status: 'past', messageType: 'text', messageContent: '前の本文', effectiveFrom: null, createdAt: '2026-08-01T10:00:00+09:00' },
]

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { folders: { list: async () => ({ success: true, data: [] }) }, staff: { me: () => Promise.resolve({ success: true, data: { role: globalThis.localStorage?.getItem?.('lh_staff_role') ?? 'owner' } }) },
    templates: {
      list: async () => ({ success: true, data: [] }),
      get: templateGet, create: templateCreate, update: templateUpdate,
      delete: vi.fn(() => Promise.resolve({ success: true, data: null })),
      versions: templateVersions,
      revert: templateRevert,
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/templates',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import TemplateDetailPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubAll(usedBy = USED_BY, versions = VERSIONS) {
  templateGet.mockImplementation(() => Promise.resolve({
    success: true,
    data: {
      id: 'tpl-1', name: '案内', category: 'general', messageType: 'text',
      messageContent: 'いまの本文', folderId: null, question: null,
      questionStatus: 'draft', usedBy, createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z', hasDraft: false,
      publishedVersion: 3, publishedAt: '2026-09-10T00:00:00.000Z', draftRevision: 0,
    },
  }))
  templateVersions.mockImplementation(() => Promise.resolve({ success: true, data: versions }))
  templateRevert.mockImplementation(() => Promise.resolve({
    success: true, data: { id: 'tpl-1', publishedVersion: 4, hasDraft: false },
  }))
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  searchParams.value = new URLSearchParams('id=tpl-1')
  templateGet.mockReset()
  templateVersions.mockReset()
  templateRevert.mockReset()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'owner' : null),
    setItem: () => {},
    removeItem: () => {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderDetail() {
  render(<TemplateDetailPage />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await screen.findByText('使っている所')
}

describe('使っている所', () => {
  test('一斉配信の行に版と状態が出る', async () => {
    stubAll()
    await renderDetail()
    expect(screen.getByText('秋の会員向け案内')).toBeTruthy()
    expect(screen.getByText('予約中')).toBeTruthy()
    expect(screen.getByText('8月の案内')).toBeTruthy()
    expect(screen.getByText('送信済み')).toBeTruthy()
    expect(screen.getAllByText('版3').length).toBeGreaterThan(0)
    expect(screen.getByText('版2')).toBeTruthy()
    // 補足は見出し横の？に入れる（2-1b）。本文に注の文を置かない。
    expect(screen.getByText(/公開するまで使っている所は変わりません/)).toBeTruthy()
  })

  test('予約済みの配信があると削除の理由が出る', async () => {
    stubAll()
    await renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'そのほかの操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
    expect(screen.getByText(/はまだ消せません/)).toBeTruthy()
  })

  test('使っている版が無い行は「—」', async () => {
    stubAll({
      ...USED_BY,
      autoReplies: [
        { id: 'ar-9', keyword: '営業時間', matchType: 'exact', lineAccountId: 'account-a', templateVersion: null },
      ],
      scenarioSteps: [],
      broadcasts: [],
    })
    await renderDetail()
    expect(screen.getByText('営業時間')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('版の履歴', () => {
  test('欄を開くと版が並び、選んで比べられる', async () => {
    stubAll()
    await renderDetail()
    await screen.findByText('いま使っている版')
    expect(screen.getByText('いま使っている版')).toBeTruthy()
    expect(screen.getByText('前の版')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '比べる' }))
    expect(screen.getByText(/比べる（版2/)).toBeTruthy()
    // 消えた行に－、足した行に＋
    expect(screen.getByText(/前の本文/)).toBeTruthy()
    expect(screen.getAllByText(/いまの本文/).length).toBeGreaterThan(0)
  })

  test('版が無いときは無い旨だけ出す', async () => {
    stubAll(USED_BY, [])
    await renderDetail()
    await screen.findByText('版はまだありません。')
  })

  test('読み込めなかったときは赤を使わず、もう一度読める', async () => {
    stubAll()
    templateVersions.mockImplementationOnce(() => Promise.resolve({ success: false, error: 'ng' }))
    await renderDetail()
    await screen.findByText('版の履歴を読み込めませんでした。もう一度お試しください。')
    fireEvent.click(screen.getByText('もう一度読み込む'))
    await screen.findByText('いま使っている版')
  })

  test('この版に戻すの確認から口を叩く', async () => {
    stubAll()
    await renderDetail()
    await screen.findByText('いま使っている版')
    fireEvent.click(screen.getByRole('button', { name: 'この版に戻す' }))
    await screen.findByText('版2の内容で下書きを作り直しますか？')
    fireEvent.click(screen.getByRole('dialog').querySelector('button[data-confirm-primary]') ?? screen.getAllByRole('button', { name: 'この版に戻す' }).at(-1)!)
    await act(async () => { await Promise.resolve() })
    expect(templateRevert).toHaveBeenCalledWith('tpl-1', { versionNumber: 2, expectedVersion: 3 })
  })
})

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))

test('WEB-101: 同じ部品のままBを開き、遅れたAの詳細・履歴を捨てる', async () => {
 let finish!: (v: unknown) => void; stubAll()
 templateGet.mockImplementation((id: string) => id === 'a' ? new Promise(r => { finish = r }) : Promise.resolve({ success: true, data: { id, name: 'Bの本文', messageType: 'text', messageContent: 'B', usedBy: USED_BY } }))
 searchParams.value = new URLSearchParams('id=a')
 const view = render(<TemplateDetailPage />)
 searchParams.value = new URLSearchParams('id=b'); view.rerender(<TemplateDetailPage />)
 await act(async () => { await Promise.resolve(); await Promise.resolve() })
 await act(async () => finish({ success: true, data: { id: 'a', name: 'Aの本文', messageType: 'text', messageContent: 'A', usedBy: USED_BY } }))
 expect(screen.queryByText('Aの本文')).toBeNull()
})
test('WEB-100: 公開済み質問を複製しても選択肢と動きを保つ', async () => {
 const question = { text: '続けますか', choices: [{ key: 'yes', label: 'はい', behavior: 'none', addTagIds: ['tag'] }] }
 stubAll(USED_BY, [{ ...VERSIONS[0], question }] as typeof VERSIONS)
 templateCreate.mockResolvedValue({ success: true, data: { id: 'copy' } })
 render(<TemplateDetailPage />)
 await act(async () => { await Promise.resolve(); await Promise.resolve() })
 fireEvent.click(screen.getByRole('button', { name: '複製する' }))
 await act(async () => { await Promise.resolve() })
 expect(templateCreate).toHaveBeenCalledWith(expect.objectContaining({ question, questionStatus: 'draft' }))
})

test('WEB-107: 複製後の後処理が失敗しても同じ下書きにボタンを結び直す', async () => {
 const content = JSON.stringify([{ text: '案内', actions: [{ type: 'postback', label: '押す', data: 'ctpl=tpl-1&c=0&a=0' }, { type: 'postback', label: '別', data: 'question=other' }] }])
 stubAll(USED_BY, [{ ...VERSIONS[0], messageType: 'carousel', messageContent: content }])
 templateCreate.mockReset().mockResolvedValue({ success: true, data: { id: 'copy' } })
 templateUpdate.mockRejectedValueOnce(new Error('通信失敗')).mockResolvedValue({ success: true, data: { id: 'copy' } })
 render(<TemplateDetailPage />)
 await act(async () => { await Promise.resolve(); await Promise.resolve() })
 fireEvent.click(screen.getByRole('button', { name: '複製する' }))
 await act(async () => { await Promise.resolve(); await Promise.resolve() })
 expect(templateUpdate).toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '複製する' }))
 await act(async () => { await Promise.resolve(); await Promise.resolve() })
 expect(templateCreate).toHaveBeenCalledTimes(1)
 const updated = JSON.parse(templateUpdate.mock.calls[0][1].messageContent)
 expect(updated[0].actions.map((a: { data: string }) => a.data)).toEqual(['ctpl=copy&c=0&a=0', 'question=other'])
})
