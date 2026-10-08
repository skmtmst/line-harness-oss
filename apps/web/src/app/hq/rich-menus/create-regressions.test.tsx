// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichMenuCreateV8 from '../../rich-menus/new/create-v8'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import { hqRichMenuDefinitionFromSeed, type HqRichMenuSeed } from '@/lib/hq-rich-menu-create'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: null, loading: false }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/rich-menus', useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

let host: RichMenuCreateHost
beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'v8')
  window.history.replaceState(null, '', '/hq/rich-menus')
  host = {
    backHref: '/hq/rich-menus', onCancel: vi.fn(), canOperate: true, folders: [],
    references: { tags: [], templates: [], forms: [{ id: 'f-1', name: '申込フォーム' }] },
    uploadImage: vi.fn(async (file: File) => ({ r2Key: `hq-templates/tenant/${file.name}` })),
    imageUrl: (key) => `http://images.test/${key}`,
    distribute: <div>配るアカウント</div>, distributeSummary: [], selectedCount: 1, busy: false, onSave: vi.fn(),
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('統括から店舗のAPIを呼んではいけません') }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme') })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const start = async (count = 'なし') => {
  render(<RichMenuCreateV8 host={host} />)
  fireEvent.change(screen.getByLabelText('メニュー名（友だちには見えません）'), { target: { value: '統括メニュー' } })
  fireEvent.click(within(screen.getByRole('group', { name: '切替タブの数' })).getByRole('button', { name: count }))
  click('次へ：ボタンの動き')
  await screen.findByText('画像の上で面を選ぶ')
}
const saved = (): HqRichMenuSeed => vi.mocked(host.onSave).mock.calls.at(-1)![0]
const save = async () => { click('下書きを保存'); await waitFor(() => expect(host.onSave).toHaveBeenCalled()) }
const selectArea = (letter: string) => fireEvent.focus(screen.getByRole('button', { name: new RegExp(`^面 ${letter}、`) }))
const pickIntent = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: '押したときの動き' }))
  fireEvent.click(within(screen.getByRole('option', { name, exact: true })).getByRole('button'))
}

describe('統括リッチメニューのオーナー指摘の回帰', () => {
  it('LINEのメニューはトーク本文の外で下の帯の直前に1つだけ置く', async () => {
    const { container } = render(<RichMenuCreateV8 host={host} />)
    const preview = screen.getByRole('region', { name: 'LINEでの見え方' })
    const menu = preview.querySelector('[data-line-preview-part="rich-menu"]')!
    expect(menu).not.toBeNull()
    expect(menu.previousElementSibling?.textContent).toBe('今日')
    expect(menu.nextElementSibling?.textContent).toBe('メニュー')
    expect(menu.nextElementSibling?.nextElementSibling).not.toBeNull()
    expect(menu.textContent).not.toContain('メニュー')
    expect(preview.querySelectorAll('[data-line-preview-part="rich-menu"]')).toHaveLength(1)
    expect(container.textContent).toContain('6面')
  })
  it('作る前は大小を選べ、小さい寸法と面を保存できる', async () => {
    render(<RichMenuCreateV8 host={host} />)
    const compact = screen.getByRole('radio', { name: /小さい 2500×843/ }) as HTMLInputElement
    const large = screen.getByRole('radio', { name: /大きい 2500×1686/ }) as HTMLInputElement
    expect(compact.disabled).toBe(false); expect(large.disabled).toBe(false)
    fireEvent.click(compact)
    expect(compact.checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '横3面' }))
    fireEvent.change(screen.getByLabelText('メニュー名（友だちには見えません）'), { target: { value: '小さいメニュー' } })
    click('次へ：ボタンの動き')
    await screen.findByText('画像の上で面を選ぶ')
    await save()
    expect(saved().size).toBe('compact')
    expect(saved().pages[0].areas).toHaveLength(3)
    expect(saved().pages[0].areas.every((area) => area.boundsHeight === 843)).toBe(true)
    click('形と画像へ戻る')
    expect((screen.getByRole('radio', { name: /小さい 2500×843/ }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText(/形は下書きを作ったあとは変えられません/)).toHaveLength(1)
  })
  it('保存済みの小さいメニューは小さい形のまま読み込み、再保存する', async () => {
    host.initial = { id: 'm-1', name: '保存済み', chatBarText: 'ご案内', folderId: null, size: 'compact', displayAudience: 'all', displayOrder: 0, defaultPageId: 'p-1', pages: [{ id: 'p-1', name: 'トップ', imageR2Key: null, areas: [] }] }
    render(<RichMenuCreateV8 host={host} />)
    await waitFor(() => expect((screen.getByRole('radio', { name: /小さい 2500×843/ }) as HTMLInputElement).checked).toBe(true))
    await save()
    expect(saved().size).toBe('compact')
    expect(saved().chatBarText).toBe('ご案内')
  })
  it('画像なしでも①の6面を選び、面Aと面Bに別々の動きを保存する', async () => {
    await start()
    expect(screen.getAllByRole('button', { name: /^面 [A-F]、動きは/ })).toHaveLength(6)
    selectArea('A'); pickIntent('URLを開く')
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://example.com/booking' } })
    selectArea('B'); pickIntent('メッセージを送る')
    fireEvent.change(screen.getByLabelText(/^送るテキスト/), { target: { value: '予約を確認する' } })
    await save()
    expect(saved().pages[0].imageR2Key).toBeNull()
    expect(saved().pages[0].areas[0]).toMatchObject({ intent: 'url', actionData: { uri: 'https://example.com/booking' } })
    expect(saved().pages[0].areas[1]).toMatchObject({ intent: 'text', actionData: { text: '予約を確認する' } })
  })
  it('切替タブなしは1ページとして作り、保存する', async () => {
    await start(); await save()
    expect(saved().pages).toHaveLength(1)
    expect(saved().defaultPageId).toBe(saved().pages[0].id)
  })
  it('3つのタブはA・B・Cになり、画像と動きをタブ別に持つ', async () => {
    await start('3つ')
    for (const letter of ['A', 'B', 'C']) {
      click(`タブ ${letter}`)
      expect((screen.getByLabelText('このページの名前') as HTMLInputElement).value).toBe(`タブ ${letter}`)
      const file = new File(['png'], `${letter}.png`, { type: 'image/png' })
      fireEvent.change(document.querySelectorAll('input[type="file"]')[0], { target: { files: [file] } })
      await waitFor(() => expect(host.uploadImage).toHaveBeenCalledWith(file, 'large'))
      selectArea('A'); pickIntent('メッセージを送る')
      fireEvent.change(screen.getByLabelText(/^送るテキスト/), { target: { value: `内容${letter}` } })
    }
    await save()
    expect(saved().pages.map((page) => page.name)).toEqual(['タブ A', 'タブ B', 'タブ C'])
    expect(saved().pages.map((page) => page.imageR2Key)).toEqual(['hq-templates/tenant/A.png', 'hq-templates/tenant/B.png', 'hq-templates/tenant/C.png'])
    expect(saved().pages.map((page) => page.areas[0].actionData.text)).toEqual(['内容A', '内容B', '内容C'])
    for (const page of saved().pages) {
      for (const area of page.areas.slice(1)) { area.intent = 'text'; area.actionType = 'message'; area.actionData = { text: 'ご案内' } }
    }
    const definition = hqRichMenuDefinitionFromSeed(saved())
    expect(definition.richMenu.pages.map((page) => page.imageR2Key)).toEqual(saved().pages.map((page) => page.imageR2Key))
    expect(definition.richMenu.pages.map((page) => page.areas[0].actionData.text)).toEqual(['内容A', '内容B', '内容C'])
    click('タブ A')
    expect((screen.getByLabelText(/^送るテキスト/) as HTMLInputElement).value).toBe('内容A')
  })
  it('面がない編集状態では、右上に空の回数の箱を置かない', async () => {
    host.initial = { id: 'm-1', name: '未設定', chatBarText: 'メニュー', folderId: null, size: 'large', displayAudience: 'all', displayOrder: 0, defaultPageId: 'p-1', pages: [{ id: 'p-1', name: 'トップ', imageR2Key: null, areas: [] }] }
    window.history.replaceState(null, '', '/hq/rich-menus?step=buttons')
    render(<RichMenuCreateV8 host={host} />)
    await screen.findByText('画像の上で面を選ぶ')
    expect(screen.queryByRole('heading', { name: '押された回数（今月）' })).toBeNull()
  })
  it('追加したタブにも選んだ面を出し、店のid指定が残っていても店の下書きを読まない', async () => {
    window.history.replaceState(null, '', '/hq/rich-menus?id=store-draft')
    await start()
    click('ページを足す')
    expect(screen.getAllByRole('button', { name: /^面 [A-F]、動きは/ })).toHaveLength(6)
    await save()
    expect(saved().pages).toHaveLength(2)
    expect(fetch).not.toHaveBeenCalled()
  })
})
