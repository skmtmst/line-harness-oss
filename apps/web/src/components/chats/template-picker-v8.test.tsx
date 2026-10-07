// @vitest-environment happy-dom
/*
 * ★V8「テンプレートを選ぶ」の窓（M0393 段2「4.」幅640・2つの形）。
 *   - 左はテンプレートの画面と同じフォルダの列。押すとそのフォルダで取り直す
 *   - ふつう：1つ選んで「入力欄に入れる」で本文が入力欄へ
 *   - 「2通以上を続けて送る」をオン：選んだ順に番号、帯に送る順、「n通を続けて送る」で選んだ順の本文
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      listPage: async (params: Record<string, unknown>) => {
        fixture.calls.push(params)
        const items = [1, 2, 3].map((n) => ({
          id: `tp-${n}`, accountId: 'acc-1', name: `テンプレ${n}`, messageType: 'text', messageContent: `本文${n}`, folderId: null,
        }))
        return { success: true, data: { items, total: items.length, limit: 100, folderCounts: { 'f-1': 2, '': 1 } } }
      },
    },
    folders: {
      list: async () => ({ success: true, data: [{ id: 'f-1', kind: 'template', name: 'お問い合わせ', parentId: null, displayOrder: 0, color: '#0b63ce' }] }),
    },
    chats: { renderPreview: async () => ({ success: false, error: 'no' }) },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
  fixture.calls = []
})

async function mount(props: { onPick?: (t: string) => void; onPickPack?: (t: string[]) => void } = {}) {
  const onClose = vi.fn()
  await act(async () => {
    render(<TemplatePicker open onClose={onClose} onPick={props.onPick ?? (() => {})} onPickPack={props.onPickPack} chatId="fr-1" />)
  })
  await waitFor(() => expect(screen.getByText('テンプレ1')).toBeTruthy())
  return { onClose }
}

describe('★V8 テンプレートを選ぶ', () => {
  test('左のフォルダの列を押すと、そのフォルダで取り直す。大きな2列（プレビュー）は出さない', async () => {
    await mount()
    expect(screen.getByRole('heading', { name: 'テンプレートを選ぶ' })).toBeTruthy()
    expect(screen.queryByLabelText('テンプレートのプレビュー')).toBeNull()
    const folder = await screen.findByRole('button', { name: /お問い合わせ/ })
    fireEvent.click(folder)
    await waitFor(() => expect(fixture.calls.some((c) => c.folderId === 'f-1')).toBe(true))
    expect(folder.getAttribute('aria-pressed')).toBe('true')
  })

  test('ふつう：選んで「入力欄に入れる」で本文が入る', async () => {
    const onPick = vi.fn()
    const { onClose } = await mount({ onPick })
    fireEvent.click(screen.getByRole('button', { name: /テンプレ2/ }))
    fireEvent.click(screen.getByRole('button', { name: '入力欄に入れる' }))
    expect(onPick).toHaveBeenCalledWith('本文2')
    expect(onClose).toHaveBeenCalled()
  })

  test('続けて送る：選んだ順に番号と帯、「2通を続けて送る」で選んだ順の本文', async () => {
    const onPickPack = vi.fn()
    await mount({ onPickPack })
    fireEvent.click(screen.getByRole('switch', { name: '2通以上を続けて送る' }))
    fireEvent.click(screen.getByRole('button', { name: /テンプレ3/ }))
    fireEvent.click(screen.getByRole('button', { name: /テンプレ1/ }))
    expect(screen.getByText('① テンプレ3 → ② テンプレ1')).toBeTruthy()
    expect(screen.getByText('2 / 5通')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2通を続けて送る' }))
    expect(onPickPack).toHaveBeenCalledWith(['本文3', '本文1'])
  })
})
