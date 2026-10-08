// @vitest-environment happy-dom
/*
 * 行の右端の「…」（RowMenu）。全部の V8 の画面がこの1つを使う（2026-10-08 共通部品の1本化）。
 * 部品の中で決めること：押した「…」から開く・Esc／外を押すと閉じて「…」へ戻る・
 * 矢印で項目を移る・危ない操作は赤字で区切りの下・行の押下へ伝えない。
 */
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowActions, RowMenu, orderRowMenuItems } from './row-actions'
import type { ActionMenuItem } from './action-menu'

afterEach(() => cleanup())

const items = (onDelete = vi.fn(), onCopy = vi.fn()): ActionMenuItem[] => [
  { id: 'delete', label: '削除する', tone: 'danger', onSelect: onDelete },
  { id: 'copy', label: '複製する', onSelect: onCopy },
  { id: 'stop', label: '止める', onSelect: vi.fn() },
]

const trigger = () => screen.getByRole('button', { name: '春のセールの操作' })
const menuItems = () => screen.getAllByRole('menuitem')
const openMenu = async () => {
  fireEvent.click(trigger())
  await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]))
}

describe('RowMenu：行の右端の「…」', () => {
  it('size="row" は 28角の印（印14）、省略時は 36角のまま（板ごとに絵の大きさ）', () => {
    const { unmount } = render(<RowMenu label="春のセールの操作" items={items()} size="row" />)
    expect(trigger().getAttribute('data-size')).toBe('row')
    expect(trigger().querySelector('svg')?.getAttribute('width')).toBe('14')
    unmount()
    render(<RowMenu label="春のセールの操作" items={items()} />)
    expect(trigger().getAttribute('data-size')).toBeNull()
    expect(trigger().querySelector('svg')?.getAttribute('width')).toBe('16')
  })

  it('28角の CSS は v8 だけで効き、押せる所は 36 まで広げる', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/components/shared/icon-button.module.css'), 'utf8')
    const globals = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/\[data-theme='v8'\] \.button\[data-size='row'\] \{[^}]*width: var\(--tpl-icon-btn-row\)/)
    expect(css).toMatch(/\[data-size='row'\]::before \{[^}]*--tpl-icon-btn-row-hit/)
    expect(globals).toContain('--tpl-icon-btn-row: 28px;')
    expect(globals).toContain('--tpl-icon-btn-row-hit: 36px;')
  })

  it('「…」はメニューを開くボタンとして読み上げ、押すと開いて最初の項目へ移る', async () => {
    render(<RowMenu label="春のセールの操作" items={items()} />)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    await openMenu()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu', { name: '春のセールの操作' })).toBeTruthy()
  })

  it('押した「…」の位置から開く', async () => {
    render(<RowMenu label="春のセールの操作" items={items()} />)
    trigger().getBoundingClientRect = () =>
      ({ top: 300, bottom: 336, left: 900, right: 936, width: 36, height: 36, x: 900, y: 300, toJSON: () => ({}) }) as DOMRect
    await openMenu()
    const portal = document.querySelector<HTMLElement>('[data-menu-portal]')
    expect(portal).toBeTruthy()
    // 「…」の下端（336）のすぐ下に出る。画面の左上（0,0）などには出さない。
    expect(parseFloat(portal!.style.top)).toBeGreaterThanOrEqual(336)
    expect(parseFloat(portal!.style.top)).toBeLessThan(350)
  })

  it('危ない操作は赤字で、区切りの下・最後に回す', async () => {
    render(<RowMenu label="春のセールの操作" items={items()} />)
    await openMenu()
    expect(menuItems().map((item) => item.textContent)).toEqual(['複製する', '止める', '削除する'])
    const last = menuItems()[2]
    expect(last.className).toMatch(/danger/)
    expect(last.parentElement?.querySelector('hr')).toBeTruthy()
    expect(menuItems()[0].parentElement?.querySelector('hr')).toBeNull()
  })

  it('危ない操作だけなら区切りを出さない', () => {
    expect(orderRowMenuItems([{ id: 'd', label: '削除する', tone: 'danger', onSelect: vi.fn() }])[0].dividerBefore).toBe(false)
  })

  it('矢印・Home・End で項目を移る', async () => {
    render(<RowMenu label="春のセールの操作" items={items()} />)
    await openMenu()
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(menuItems()[1])
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(menuItems()[2])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(menuItems()[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(menuItems()[2])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(menuItems()[0])
  })

  it('Esc で閉じて「…」へ戻る', async () => {
    render(<RowMenu label="春のセールの操作" items={items()} />)
    await openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('外を押すと閉じる', async () => {
    render(
      <>
        <p>外</p>
        <RowMenu label="春のセールの操作" items={items()} />
      </>,
    )
    await openMenu()
    fireEvent.pointerDown(screen.getByText('外'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('「…」と項目の押下は行へ伝えず、選んだ操作だけを動かして閉じる', async () => {
    const onRow = vi.fn()
    const onCopy = vi.fn()
    render(
      <table><tbody><tr onClick={onRow}><td>
        <RowMenu label="春のセールの操作" items={items(vi.fn(), onCopy)} />
      </td></tr></tbody></table>,
    )
    await openMenu()
    fireEvent.click(menuItems()[0])
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onRow).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('画面が開閉を持つときも同じ動き（右クリックのメニューと状態を分け合う）', async () => {
    const changes: boolean[] = []
    function Screen() {
      const [open, setOpen] = useState(false)
      return (
        <RowMenu
          label="春のセールの操作"
          items={items()}
          open={open}
          onOpenChange={(next) => { changes.push(next); setOpen(next) }}
        />
      )
    }
    render(<Screen />)
    await openMenu()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(changes).toEqual([true, false])
  })

  it('項目が無ければ「…」を出さない', () => {
    render(<RowMenu label="春のセールの操作" items={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('RowActions の「…」も同じ部品（危ない操作は区切りの下・最後）', async () => {
    render(
      <RowActions
        subjectName="春のセール"
        menuItems={[{ id: 'copy', label: '複製する', onSelect: vi.fn() }]}
        destructiveItem={{ id: 'delete', label: '削除する', onSelect: vi.fn() }}
      />,
    )
    const more = screen.getByRole('button', { name: '春のセールのその他操作' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(more)
    await waitFor(() => expect(document.activeElement).toBe(menuItems()[0]))
    expect(menuItems().map((item) => item.textContent)).toEqual(['複製する', '削除する'])
    expect(menuItems()[1].parentElement?.querySelector('hr')).toBeTruthy()
  })
})
