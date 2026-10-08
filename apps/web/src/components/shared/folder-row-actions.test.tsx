// @vitest-environment happy-dom
/*
 * フォルダの列の「…」（V8.pen 共通部品4 の H・B-35）の動き。
 * V8 の言葉（名前を変える・色を変える・並べ替える・消す）、消す前の確認の窓、
 * 消すと共通のフォルダの口へ DELETE を送って読み直す。閲覧のみには「…」を出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Folder } from '@line-crm/shared'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const remove = vi.hoisted(() => vi.fn(async () => ({ success: true, data: null })))
const swap = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { swapped: ['a', 'b'] } })))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, folders: { ...actual.api.folders, delete: remove, swapOrder: swap } } }
})

import FolderPanel from './folder-panel'
import { useFolderRowActions } from './folder-row-actions'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const folder = (id: string, name: string, order: number): Folder => ({
  id, kind: 'rich_menu', name, parentId: null, displayOrder: order, color: '#2f6fdf', createdAt: '', updatedAt: '',
})
const FOLDERS = [folder('f-1', 'キャンペーン', 0), folder('f-2', 'EC・フォロー', 1)]

function Screen({ enabled, onChanged, onDeleted }: { enabled: boolean; onChanged: () => void; onDeleted: (id: string) => void }) {
  const actions = useFolderRowActions({
    kind: 'rich_menu', folders: FOLDERS, accountId: 'acc-1', enabled, itemLabel: 'リッチメニュー',
    countOf: (id) => (id === 'f-1' ? 2 : 0), onChanged, onDeleted,
  })
  return (
    <>
      <FolderPanel
        activeId=""
        onSelect={() => {}}
        rows={[{ id: '', label: 'すべて', count: 3 }, ...FOLDERS.map((f, i) => ({ ...actions.rowActions(f, i), id: f.id, label: f.name, count: 1 }))]}
      />
      {actions.dialogs}
    </>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  remove.mockClear()
  swap.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

const menuButton = (name: string) => document.querySelector(`button[aria-label="フォルダ「${name}」の操作"]`) as HTMLButtonElement | null
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click() }) }

describe('フォルダの「…」（共通）', () => {
  it('V8 の言葉で出す。端の行には押せない並べ替えを置かない', async () => {
    await act(async () => { root.render(<Screen enabled onChanged={() => {}} onDeleted={() => {}} />) })
    await click(menuButton('キャンペーン'))
    expect(menuItems()).toEqual(['名前を変える', '色を変える', '並べ替える（下へ）', '消す'])
  })

  it('消す前に確認の窓で件数と行き先を読ませ、確かめたら DELETE して読み直す', async () => {
    const onChanged = vi.fn()
    const onDeleted = vi.fn()
    await act(async () => { root.render(<Screen enabled onChanged={onChanged} onDeleted={onDeleted} />) })
    await click(menuButton('キャンペーン'))
    await click([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === '消す'))
    expect(document.body.textContent).toContain('フォルダ「キャンペーン」を消しますか？')
    expect(document.body.textContent).toContain('中のリッチメニュー 2 件は消えずに「未分類」へ移ります。')
    expect(remove).not.toHaveBeenCalled()
    await click([...document.querySelectorAll('button')].find((el) => el.textContent === 'フォルダを消す'))
    expect(remove).toHaveBeenCalledWith('f-1', 'acc-1')
    expect(onDeleted).toHaveBeenCalledWith('f-1')
    expect(onChanged).toHaveBeenCalled()
  })

  it('並べ替えは隣と入れ替える口を1回だけ送る', async () => {
    await act(async () => { root.render(<Screen enabled onChanged={() => {}} onDeleted={() => {}} />) })
    await click(menuButton('EC・フォロー'))
    await click([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === '並べ替える（上へ）'))
    expect(swap).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledWith('f-2', 'f-1', 'acc-1')
  })

  it('変えられない人には「…」を出さない', async () => {
    await act(async () => { root.render(<Screen enabled={false} onChanged={() => {}} onDeleted={() => {}} />) })
    expect(menuButton('キャンペーン')).toBeNull()
  })
})
