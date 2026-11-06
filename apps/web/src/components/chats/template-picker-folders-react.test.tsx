// @vitest-environment happy-dom
/*
 * 受信箱の「テンプレートを選ぶ」のフォルダの列を、本物の部品で押して確かめる。
 *
 * 見る筋書き:
 *   1. 未分類は件数つきで選べ、選ぶと未分類だけをサーバーへ頼む。件数が取れていないときは 0 と書かない。
 *   2. 一覧が読めないときは 0 件と言わず、読み直しを案内する。フォルダの列が読めないときもそう書く。
 *   3. LINE アカウントを切り替えたら、前のアカウントの内容を消してから読み直す。
 *   4. 選んだフォルダは folder_id のまま一覧の口へ渡す（直下の子を含める判断はサーバー側）。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  account: 'acc-1',
  calls: [] as Array<Record<string, unknown>>,
  listPage: null as null | ((params: Record<string, unknown>) => Promise<unknown>),
  folders: null as null | ((kind: string, accountId?: string) => Promise<unknown>),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.account }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      listPage: (params: Record<string, unknown>) => {
        fixture.calls.push(params)
        return fixture.listPage!(params)
      },
    },
    folders: { list: (kind: string, accountId?: string) => fixture.folders!(kind, accountId) },
    chats: { renderPreview: async () => ({ success: false, error: 'no' }) },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

function page(names: string[], folderCounts: Record<string, number> | null = { 'f-1': 2, '': 1 }) {
  const items = names.map((name, n) => ({ id: `tp-${n}`, accountId: fixture.account, name, messageType: 'text', messageContent: `${name}の本文`, folderId: null }))
  return { success: true, data: { items, total: items.length, limit: 100, ...(folderCounts ? { folderCounts } : {}) } }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fixture.account = 'acc-1'
  fixture.calls = []
  fixture.listPage = async () => page(['本店の挨拶'])
  fixture.folders = async () => ({ success: true, data: [{ id: 'f-1', kind: 'template', name: 'お問い合わせ', parentId: null, displayOrder: 0, color: '#0b63ce' }] })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function picker() {
  return <TemplatePicker open onClose={() => {}} onPick={() => {}} chatId="fr-1" />
}

async function mount() {
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(picker()) })
  return view
}

function sideButton(name: string): HTMLButtonElement {
  const found = screen.getAllByRole('button').find((item) => item.textContent?.replace(/\d+$/, '').trim() === name)
  if (!found) throw new Error(`Missing folder row: ${name}`)
  return found as HTMLButtonElement
}

describe('未分類と件数', () => {
  test('未分類は件数つきで選べ、選ぶと未分類だけを頼む', async () => {
    await mount()
    await waitFor(() => expect(screen.getAllByText('本店の挨拶').length).toBeGreaterThan(0))
    await waitFor(() => expect(sideButton('未分類').textContent).toBe('未分類1'))
    await act(async () => { fireEvent.click(sideButton('未分類')) })
    await waitFor(() => expect(fixture.calls.at(-1)).toMatchObject({ folderId: '__none__', page: 1 }))
    expect(sideButton('未分類').getAttribute('aria-pressed')).toBe('true')
  })

  test('件数が取れていないときは 0 と書かずに件数を出さない', async () => {
    fixture.listPage = async () => page(['本店の挨拶'], null)
    await mount()
    await waitFor(() => expect(screen.getAllByText('本店の挨拶').length).toBeGreaterThan(0))
    expect(sideButton('未分類').textContent).toBe('未分類')
  })

  test('フォルダを選ぶと、その folder_id をそのまま渡す', async () => {
    await mount()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /お問い合わせ/ })) })
    await waitFor(() => expect(fixture.calls.at(-1)).toMatchObject({ folderId: 'f-1', accountId: 'acc-1' }))
  })
})

describe('読めないときは 0 件と混同しない', () => {
  test('一覧が読めないときは読み直しを案内し、「まだありません」と言わない', async () => {
    fixture.listPage = async () => ({ success: false, error: '500' })
    await mount()
    await waitFor(() => expect(document.body.textContent).toContain('テンプレートを読み込めませんでした。もう一度開き直してください。'))
    expect(document.body.textContent).not.toContain('文字のテンプレートがまだありません。')
  })

  test('本当の0件は「まだありません」と出す', async () => {
    fixture.listPage = async () => page([], { '': 0 })
    await mount()
    await waitFor(() => expect(document.body.textContent).toContain('文字のテンプレートがまだありません。'))
  })

  test('フォルダの列が読めないときはそう書き、フォルダを並べない', async () => {
    fixture.folders = async () => ({ success: false, error: '500' })
    await mount()
    await waitFor(() => expect(document.body.textContent).toContain('フォルダを読み込めませんでした'))
    expect(screen.queryByRole('button', { name: /お問い合わせ/ })).toBeNull()
  })
})

describe('LINE アカウントを切り替えたとき', () => {
  test('開き直すと前のアカウントの内容を消してから、新しいアカウントで読み直す', async () => {
    const view = await mount()
    await waitFor(() => expect(screen.getAllByText('本店の挨拶').length).toBeGreaterThan(0))
    await act(async () => { view.rerender(<TemplatePicker open={false} onClose={() => {}} onPick={() => {}} chatId="fr-1" />) })

    let finish!: (value: unknown) => void
    fixture.listPage = () => new Promise((resolve) => { finish = resolve })
    const folderAccounts: Array<string | undefined> = []
    fixture.folders = async (_kind, accountId) => { folderAccounts.push(accountId); return { success: true, data: [] } }
    // 窓を閉じている間にアカウントを切り替え、もう一度開く。
    fixture.account = 'acc-2'
    await act(async () => { view.rerender(<TemplatePicker open={false} onClose={() => {}} onPick={() => {}} chatId="fr-1" />) })
    await act(async () => { view.rerender(picker()) })

    // 新しいアカウントの応答が来るまで、前のアカウントの候補もフォルダも出さない。
    expect(screen.queryByText('本店の挨拶')).toBeNull()
    expect(screen.queryByRole('button', { name: /お問い合わせ/ })).toBeNull()
    expect(fixture.calls.at(-1)).toMatchObject({ accountId: 'acc-2', page: 1 })
    expect(folderAccounts).toContain('acc-2')

    fixture.listPage = async () => page(['支店の挨拶'])
    await act(async () => { finish(page(['支店の挨拶'])) })
    await waitFor(() => expect(screen.getAllByText('支店の挨拶').length).toBeGreaterThan(0))
    expect(screen.queryByText('本店の挨拶')).toBeNull()
  })
})
