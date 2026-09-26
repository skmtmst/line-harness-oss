// @vitest-environment happy-dom
/*
 * G-4: テンプレートのパック呼出し（まとめて選ぶ）。
 *
 * 実物の TemplatePicker をマウントして確かめる。
 *   - onPickPack を渡した画面だけ「まとめて選ぶ」が出る
 *   - 選んだ順が送る順になる（番号が付く）
 *   - 外すボタンで除外できる
 *   - 5通を超えては選べない
 *   - 「まとめて送る」で選んだ順の本文配列が渡る
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  picked: null as string[] | null,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      listPage: async () => {
        const items = [1, 2, 3, 4, 5, 6].map((n) => ({
          id: `tp-${n}`,
          accountId: 'acc-1',
          name: `テンプレ${n}`,
          messageType: 'text',
          messageContent: `本文${n}`,
          folderId: null,
        }))
        return { success: true, data: { items, total: items.length, limit: 100 } }
      },
    },
    folders: {
      list: async () => ({ success: true, data: [] }),
    },
    chats: {
      renderPreview: async () => ({ success: false, error: 'no' }),
    },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

async function mountPicker(withPack = true) {
  await act(async () => {
    render(
      <TemplatePicker
        open
        onClose={() => {}}
        onPick={() => {}}
        {...(withPack ? { onPickPack: (texts: string[]) => { fixture.picked = texts } } : {})}
        chatId="fr-1"
      />,
    )
  })
  await waitFor(() => expect(screen.getAllByText('テンプレ1').length).toBeGreaterThan(0))
}

/** 一覧側の候補ボタン。プレビューの見出し・「外す」ボタンと区別するため末尾の本文まで見る。 */
function listItem(n: number) {
  return screen.getByRole('button', { name: new RegExp(`テンプレ${n}.*本文${n}`) })
}

afterEach(() => {
  cleanup()
  fixture.picked = null
})

describe('テンプレートのパック呼出し(G-4)', () => {
  test('onPickPack が無い画面では「まとめて選ぶ」が出ない', async () => {
    await mountPicker(false)
    expect(screen.queryByText('まとめて選ぶ')).toBeNull()
  })

  test('選んだ順に番号が付き、まとめて送るで順序どおりの本文配列が渡る', async () => {
    await mountPicker()
    await act(async () => { screen.getByText('まとめて選ぶ').click() })
    // あえて逆順に選んで、クリック順が送る順になることを確かめる
    await act(async () => { listItem(3).click() })
    await act(async () => { listItem(1).click() })
    const list = await screen.findByText(/まとめて送る順番/)
    expect(list).toBeTruthy()
    await act(async () => {
      screen.getByRole('button', { name: /まとめて送る（2通）/ }).click()
    })
    expect(fixture.picked).toEqual(['本文3', '本文1'])
  })

  test('「外す」で除外できる', async () => {
    await mountPicker()
    await act(async () => { screen.getByText('まとめて選ぶ').click() })
    await act(async () => { listItem(1).click() })
    await act(async () => { listItem(2).click() })
    await act(async () => {
      screen.getByRole('button', { name: 'テンプレ1をまとめ送りから外す' }).click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /まとめて送る（1通）/ }).click()
    })
    expect(fixture.picked).toEqual(['本文2'])
  })

  test('5通を超えては選べない', async () => {
    await mountPicker()
    await act(async () => { screen.getByText('まとめて選ぶ').click() })
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await act(async () => { listItem(n).click() })
    }
    await act(async () => {
      screen.getByRole('button', { name: /まとめて送る（5通）/ }).click()
    })
    expect(fixture.picked).toEqual(['本文1', '本文2', '本文3', '本文4', '本文5'])
  })

  test('パックモードでも未選択なら送れない', async () => {
    await mountPicker()
    await act(async () => { screen.getByText('まとめて選ぶ').click() })
    const button = screen.getByRole('button', { name: /まとめて送る（0通）/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
