// @vitest-environment happy-dom
/*
 * R13: 一覧の行（tr の詳細遷移）の中に置いた RowActions の押下は、
 * 行へ伝わらない。「…」を開く押下も、メニュー項目の押下も、
 * 行の onClick（詳細へ移動）を動かさない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RowActions } from './row-actions'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('RowActions R13: 行の中でも行へ伝えない', () => {
  it('「…」を開く押下は行の詳細遷移を動かさない', async () => {
    const onRow = vi.fn()
    await act(async () => {
      root.render(
        <table><tbody><tr onClick={onRow}><td>
          <RowActions
            subjectName="来店お礼"
            detail={{ href: '/templates/detail?id=t1' }}
            menuItems={[{ id: 'copy', label: '複製する', onSelect: vi.fn() }]}
          />
        </td></tr></tbody></table>,
      )
    })
    const more = host.querySelector('button[aria-label="来店お礼のその他操作"]') as HTMLButtonElement
    await act(async () => { more.click() })
    expect(host.querySelector('[role="menu"]'), 'メニューが開きません').toBeTruthy()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('メニュー項目の押下は実行だけして行へ届かない', async () => {
    const onRow = vi.fn()
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <table><tbody><tr onClick={onRow}><td>
          <RowActions
            subjectName="来店お礼"
            detail={{ href: '/templates/detail?id=t1' }}
            menuItems={[{ id: 'copy', label: '複製する', onSelect }]}
          />
        </td></tr></tbody></table>,
      )
    })
    const more = host.querySelector('button[aria-label="来店お礼のその他操作"]') as HTMLButtonElement
    await act(async () => { more.click() })
    const item = host.querySelector('[role="menuitem"]') as HTMLButtonElement
    await act(async () => { item.click() })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onRow).not.toHaveBeenCalled()
  })
})
