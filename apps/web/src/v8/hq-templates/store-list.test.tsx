// @vitest-environment happy-dom
/*
 * 統括のひな形の一覧（店と同じ形＋配る口・B-27〜B-29・B-36）の動き。
 * 6種類のタブで種類を替える・配布先の列・全種類の行の［配る］（「…」の左。オーナー 2026-10-08）・閲覧のみには配る／作る口を置かない・フォルダで絞る。
 */
import { waitFor } from '@testing-library/react'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))

import HqStoreList, { type HqStoreListProps } from './store-list'
import { folderDisplayColor } from '@/components/shared/folder-dot'
import type { HqTemplate } from '@/lib/hq-templates-api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, name: string, count: number, folder: string | null = null): HqTemplate => ({
  id, name, description: null, template_type: 'template', folder_id: folder, revision: 1, updated_at: '2026-09-30T01:00:00.000Z',
  kind: 'message', content_summary: '本文', distributed_account_count: count,
  distributed_account_names: count ? ['本店', '渋谷店'].slice(0, count) : [], distributed_account_more: 0,
})
const ROWS = [row('t-1', '秋の新商品', 2, 'f-1'), row('t-2', '定休日', 0)]

let host: HTMLDivElement
let root: Root
const handlers = () => ({
  onKindChange: vi.fn(), onFolderFilter: vi.fn(), onAddFolder: vi.fn(async () => {}), onRenameFolder: vi.fn(async () => {}),
  onDeleteFolder: vi.fn(async () => {}), onCreate: vi.fn(), onEdit: vi.fn(), onDistribute: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn(),
})
async function render(extra: Partial<HqStoreListProps> = {}) {
  const h = handlers()
  const props: HqStoreListProps = {
    type: 'template', rows: ROWS, ready: true, busy: false, canEdit: true, accountTotal: 4,
    kind: 'message', kindCounts: { message: 2, carousel: 1 }, folders: [{ id: 'f-1', name: 'お問い合わせ', revision: 1 }],
    folderLoadFailed: false, folderFilter: 'all', ...h, ...extra,
  }
  await act(async () => { root.render(<HqStoreList {...props} />) })
  return h
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

const buttons = () => [...document.querySelectorAll('button')]

describe('統括のひな形の一覧（店と同じ形）', () => {
  for (const canEdit of [true, false]) {
    it(`タグ一覧はタグ名から始まり、星・注目の操作と絞り込みを出さない（編集=${canEdit}）`, async () => {
      await render({ type: 'tag', kind: undefined, canEdit })
      const heads = [...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
      expect(heads).toEqual(canEdit ? ['タグ', '人数', '付け方', '配布先', '', ''] : ['タグ', '人数', '付け方', '配布先', ''])
      expect(host.querySelector('tbody tr td')?.textContent).toContain(ROWS[0].name)
      expect(host.querySelector('svg.lucide-star')).toBeNull()
      expect(host.querySelector('[aria-label*="友だち一覧に表示"]')).toBeNull()
      expect(host.textContent).not.toMatch(/☆|★|注目のみ|★のみ表示/)
      expect(buttons().some((button) => /注目|一覧に出す/.test(button.getAttribute('aria-label') ?? ''))).toBe(false)
    })
  }

  it('フォルダの保存色を左の列と名前の前に表示する', async () => {
    await render({ folders: [{ id: 'f-1', name: 'お問い合わせ', revision: 1, color: '#8b5cf6' }] })
    const dot = host.querySelector('[data-folder-dot="filed"]') as HTMLElement
    expect(dot.style.backgroundColor).toBe('#8b5cf6')
    expect(dot.getAttribute('aria-label')).toBe('フォルダ：お問い合わせ')
    expect(host.innerHTML).toContain('#8b5cf6')
  })

  it('タグ名はフォルダ色の丸と1行の名前で出し、押すと詳細を開く', async () => {
    const onOpen = vi.fn()
    await render({ type: 'tag', onOpen, folders: [{ id: 'f-1', name: 'お問い合わせ', revision: 1, color: '#8b5cf6' }] })
    const name = host.querySelector('[data-list-name]')!
    expect(name.textContent).toBe('秋の新商品')
    expect(name.querySelector('[data-folder-dot]')!.getAttribute('style')).toContain('#8b5cf6')
    await act(async () => { name.querySelector<HTMLButtonElement>('button')!.click() })
    expect(onOpen).toHaveBeenCalledWith(ROWS[0])
  })

  it('配布先の列に配ったアカウントの数、配っていない行は「まだ配っていない」', async () => {
    await render()
    expect(host.textContent).toContain('2 アカウント')
    expect(host.textContent).toContain('本店・渋谷店')
    expect(host.textContent).toContain('まだ配っていない')
  })

  /* 絵：テンプレート i0Ao0R・リッチメニュー noVq4・タグ DzdC3・回答フォーム wZPua。どの種類も行の「…」の左に［配る］。 */
  for (const type of ['template', 'tag', 'rich_menu', 'form', 'scenario'] as const) {
    it(`${type} の一覧は、どの行にも「…」の左に［配る］があり、押すとその行を配る`, async () => {
      const h = await render({ type, kind: type === 'template' ? 'message' : undefined })
      for (const r of ROWS) {
        const button = buttons().find((b) => b.getAttribute('aria-label') === `${r.name}を配る`)
        expect(button, r.name).toBeTruthy()
        expect(button!.textContent?.trim()).toBe('配る')
        /* 同じ行の「…」より前（左）に置く。 */
        const tr = button!.closest('tr')!
        const menu = tr.querySelector('[aria-haspopup="menu"]')!
        expect(button!.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      await act(async () => { buttons().find((b) => b.getAttribute('aria-label') === '定休日を配る')!.click() })
      expect(h.onDistribute).toHaveBeenCalledWith(ROWS[1])
      /* 見出しにも［配る］の列（空の見出し）がある。 */
      expect(document.querySelector('th[aria-label="配る"]')).not.toBeNull()
      expect(host.textContent).not.toContain('アカウントへ配る')
    })
  }

  it('テンプレートは行の［配る］と「…」の両方から配る。公開の札と今月送った数を出す（i0Ao0R・API-18）', async () => {
    const rows = [
      { ...ROWS[0], outdated_account_count: 1, this_month_sent_count: 1860 },
      { ...ROWS[1], this_month_sent_count: null },
      { ...row('t-3', '予約の受付', 1), outdated_account_count: 0, this_month_sent_count: 0 },
    ]
    const h = await render({ rows, stats: { thisMonthSentCount: 1860, outdatedTemplateCount: 1 } })
    const distribute = buttons().find((b) => b.getAttribute('aria-label') === '秋の新商品を配る')!
    await act(async () => { distribute.click() })
    expect(h.onDistribute).toHaveBeenCalledWith(rows[0])
    h.onDistribute.mockClear()
    expect(host.textContent).toContain('未公開の変更')
    expect(host.textContent).toContain('下書きだけ')
    expect(host.textContent).toContain('公開中')
    expect(host.textContent).toContain('1,860通')
    expect(host.textContent).toContain('0通')
    expect(host.textContent).toContain('新しい版を未配布')
    const menu = buttons().find((b) => b.getAttribute('aria-label') === 'テンプレート「秋の新商品」の操作')
    // 統括の一覧の行の「…」は絵（i0Ao0R・noVq4・DzdC3・wZPua）どおり 28角。
    expect(menu!.getAttribute('data-size')).toBe('row')
    await act(async () => { menu!.click() })
    const item = [...document.querySelectorAll('[role="menuitem"], button')].find((el) => el.getAttribute('role') === 'menuitem' && el.textContent?.trim() === '配る')
    await act(async () => { (item as HTMLElement).click() })
    expect(h.onDistribute).toHaveBeenCalledWith(rows[0])
  })

  it('タグは人数・付け方、リッチメニューは順・誰に出すか・今月押されたを出す（DzdC3・noVq4）', async () => {
    await render({ type: 'tag', kind: undefined, rows: [{ ...ROWS[0], template_type: 'tag', friend_count: 64, assignment_method: '手動・自動' }] })
    expect(host.textContent).toContain('64人')
    expect(host.textContent).toContain('手動・自動')
    await render({ type: 'rich_menu', kind: undefined, rows: [{ ...ROWS[0], template_type: 'rich_menu', display_order: 0, display_audience: '全員', tap_count: 3210 }] })
    expect(host.textContent).toContain('全員')
    expect(host.textContent).toContain('3,210回')
  })

  it('上のタブで種類を替える（店と同じ6種類）', async () => {
    const h = await render()
    const tabs = [...document.querySelectorAll('[role="tab"], a, button')].map((el) => el.textContent ?? '')
    for (const label of ['メッセージ', 'カルーセル', 'リッチメッセージ', 'リッチビデオ', '質問', 'クーポン', 'リサーチ']) expect(tabs.some((text) => text.startsWith(label))).toBe(true)
    const carousel = [...document.querySelectorAll('button, a')].find((el) => el.textContent?.startsWith('カルーセル'))
    await act(async () => { (carousel as HTMLElement).click() })
    expect(h.onKindChange).toHaveBeenCalledWith('carousel')
  })

  it('「未配布」の札で配っていない行だけにする', async () => {
    await render()
    const chip = buttons().find((b) => b.textContent?.includes('未配布'))
    await act(async () => { chip!.click() })
    expect(host.textContent).not.toContain('秋の新商品')
    expect(host.textContent).toContain('定休日')
  })

  for (const type of ['template', 'tag', 'rich_menu', 'form'] as const) {
    it(`閲覧のみには作る・配る口を置かない（${type}）`, async () => {
      await render({ type, kind: type === 'template' ? 'message' : undefined, canEdit: false })
      expect(buttons().some((b) => b.textContent?.includes('を作る'))).toBe(false)
      expect(buttons().some((b) => b.getAttribute('aria-label')?.endsWith('を配る'))).toBe(false)
      expect(buttons().some((b) => b.textContent?.trim() === '配る')).toBe(false)
      expect(document.querySelector('th[aria-label="配る"]')).toBeNull()
    })
  }
})

describe('フォルダの配布口を出す範囲（G-7）', () => {
  it('すべてと空フォルダには出さず、未分類と別種類だけ入ったフォルダにも出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    const onDistributeFolder = vi.fn()
    await render({ rows: [ROWS[1]], folderContents: [ROWS[0], ROWS[1]], onDistributeFolder,
      folders: [{ id: 'f-1', name: '別種類だけ', revision: 1 }, { id: 'f-empty', name: '空', revision: 1 }] })
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'フォルダ「すべて」の操作')).toBe(false)
    const unfiled = buttons().find((button) => button.getAttribute('aria-label') === 'フォルダ「未分類」の操作')!
    expect(unfiled).toBeTruthy()
    await act(async () => unfiled.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)))
    const entry = document.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(entry.textContent).toBe('このフォルダを配る')
    expect(entry.querySelector('strong')).not.toBeNull()
    await act(async () => entry.click())
    expect(onDistributeFolder).toHaveBeenCalledWith('none', '未分類')
    await act(async () => buttons().find((button) => button.getAttribute('aria-label') === 'フォルダ「空」の操作')!.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)))
    expect([...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent === 'このフォルダを配る')).toBe(false)
    delete document.documentElement.dataset.theme
  })
  it('閲覧のみにはフォルダの配布口を出さない', async () => {
    await render({ canEdit: false, folderContents: ROWS, onDistributeFolder: vi.fn() })
    expect(buttons().some((button) => button.getAttribute('aria-label')?.endsWith('の操作'))).toBe(false)
  })
})

it.each(['template', 'rich_menu', 'form', 'tag', 'scenario'] as const)('%s のひな形も色を変えて保存できる', async (type) => {
  const h = await render({ type })
  await act(async () => (host.querySelector('[aria-label="フォルダ「お問い合わせ」の操作"]') as HTMLButtonElement).click())
  await act(async () => ([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === '色を変える') as HTMLElement).click())
  await act(async () => (document.querySelector('[aria-label^="フォルダの色："]') as HTMLButtonElement).click())
  await act(async () => (document.querySelector('[role="radio"][aria-label="ピンク"]') as HTMLButtonElement).click())
  await act(async () => (buttons().find((el) => el.textContent === '保存する') as HTMLButtonElement).click())
  expect(h.onRenameFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-1', revision: 1 }), 'お問い合わせ', '#ec4899')
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

it('フォルダの保存が 409（ほかの人が先に直した）なら理由を出して一覧を読み直し、入力は残したまま2回目は新しい版で通る（2026-10-09）', async () => {
  const { HqTemplatesApiError } = await import('@/lib/hq-templates-api')
  const onRenameFolder = vi.fn()
    .mockRejectedValueOnce(new HqTemplatesApiError('内容が更新されました。', 409, true, true, 'VERSION_CONFLICT'))
    .mockResolvedValueOnce(undefined)
  const onReloadFolders = vi.fn(async () => { reload() })
  let reload: () => void = () => {}
  const base = handlers()
  function Harness() {
    const [folders, setFolders] = React.useState([{ id: 'f-1', name: 'お問い合わせ', revision: 1 }])
    reload = () => setFolders([{ id: 'f-1', name: 'お問い合わせ', revision: 2 }])
    return <HqStoreList type="tag" rows={ROWS} ready busy={false} canEdit accountTotal={4} folders={folders} folderLoadFailed={false} folderFilter="all"
      {...base} onRenameFolder={onRenameFolder} onReloadFolders={onReloadFolders} />
  }
  await act(async () => { root.render(<Harness />) })
  await act(async () => (host.querySelector('[aria-label="フォルダ「お問い合わせ」の操作"]') as HTMLButtonElement).click())
  await act(async () => ([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === '名前を変える') as HTMLElement).click())
  const input = document.querySelector('[role="dialog"] input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'テスト')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => (buttons().find((el) => el.textContent === '保存する') as HTMLButtonElement).click())
  expect(onRenameFolder).toHaveBeenNthCalledWith(1, expect.objectContaining({ revision: 1 }), 'テスト', folderDisplayColor({ name: 'お問い合わせ' }))
  expect(onReloadFolders).toHaveBeenCalledTimes(1)
  const alert = document.querySelector('[role="dialog"] [data-folder-dialog-error]') as HTMLElement
  expect(alert.textContent).toContain('ほかの人が先に直しました。最新の内容を読み込みました。もう一度保存してください。')
  expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe('テスト')
  await act(async () => (buttons().find((el) => el.textContent === '保存する') as HTMLButtonElement).click())
  expect(onRenameFolder).toHaveBeenNthCalledWith(2, expect.objectContaining({ revision: 2 }), 'テスト', folderDisplayColor({ name: 'お問い合わせ' }))
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

it('同じ名前（409 FOLDER_NAME_CONFLICT）は名前の欄に、読めない理由は状態番号と符号を添えて出す', async () => {
  const { HqTemplatesApiError } = await import('@/lib/hq-templates-api')
  const onAddFolder = vi.fn()
    .mockRejectedValueOnce(new HqTemplatesApiError('x', 409, true, true, 'FOLDER_NAME_CONFLICT'))
    .mockRejectedValueOnce(new HqTemplatesApiError('x', 500, true, false, 'UNAVAILABLE'))
  await render({ onAddFolder })
  await waitFor(() => expect(buttons().find((el) => el.textContent?.includes('フォルダを追加'))).toBeTruthy())
  await act(async () => (buttons().find((el) => el.textContent?.includes('フォルダを追加')) as HTMLButtonElement).click())
  const input = document.querySelector('[role="dialog"] input') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '季節')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => (buttons().find((el) => el.textContent === '追加する') as HTMLButtonElement).click())
  expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('同じ名前のフォルダがあります。')
  await act(async () => (buttons().find((el) => el.textContent === '追加する') as HTMLButtonElement).click())
  expect(document.querySelector('[data-folder-dialog-error]')?.textContent).toBe('フォルダを保存できませんでした。（状態 500・UNAVAILABLE）')
})
