// @vitest-environment happy-dom
/*
 * 統括のひな形の一覧（店と同じ形＋配る口・B-27〜B-29・B-36）の動き。
 * 6種類のタブで種類を替える・配布先の列・全種類の行の［配る］（「…」の左。オーナー 2026-10-08）・閲覧のみには配る／作る口を置かない・フォルダで絞る。
 */
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
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const buttons = () => [...document.querySelectorAll('button')]

describe('統括のひな形の一覧（店と同じ形）', () => {
  it('配布先の列に配ったアカウントの数、配っていない行は「まだ配っていない」', async () => {
    await render()
    expect(host.textContent).toContain('2 アカウント')
    expect(host.textContent).toContain('本店・渋谷店')
    expect(host.textContent).toContain('まだ配っていない')
  })

  /* 絵：テンプレート i0Ao0R・リッチメニュー noVq4・友だち属性 DzdC3・回答フォーム wZPua。どの種類も行の「…」の左に［配る］。 */
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

  it('テンプレートは行の「…」の中からも配れる（文字は「配る」）。公開の札と今月送った数を出す（i0Ao0R・API-18）', async () => {
    const rows = [
      { ...ROWS[0], outdated_account_count: 1, this_month_sent_count: 1860 },
      { ...ROWS[1], this_month_sent_count: null },
      { ...row('t-3', '予約の受付', 1), outdated_account_count: 0, this_month_sent_count: 0 },
    ]
    const h = await render({ rows, stats: { thisMonthSentCount: 1860, outdatedTemplateCount: 1 } })
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

  it('友だち属性は人数・付け方、リッチメニューは順・誰に出すか・今月押されたを出す（DzdC3・noVq4）', async () => {
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
    for (const label of ['メッセージ', 'カルーセル', 'リッチメッセージ', '質問', 'クーポン', 'リサーチ']) expect(tabs.some((text) => text.startsWith(label))).toBe(true)
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
