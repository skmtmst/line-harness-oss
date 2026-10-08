// @vitest-environment happy-dom
/*
 * 統括のひな形の一覧（店と同じ形＋配る口・B-27〜B-29・B-36）の動き。
 * 6種類のタブで種類を替える・配布先の列・［アカウントへ配る］・閲覧のみには配る／作る口を置かない・フォルダで絞る。
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

  it('行の［アカウントへ配る］でその行を配る', async () => {
    const h = await render()
    const button = buttons().find((b) => b.getAttribute('aria-label') === '秋の新商品をアカウントへ配る')
    await act(async () => { button!.click() })
    expect(h.onDistribute).toHaveBeenCalledWith(ROWS[0])
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

  it('閲覧のみには作る・配る口を置かない', async () => {
    await render({ canEdit: false })
    expect(buttons().some((b) => b.textContent?.includes('テンプレートを作る'))).toBe(false)
    expect(buttons().some((b) => b.getAttribute('aria-label')?.endsWith('をアカウントへ配る'))).toBe(false)
  })
})
