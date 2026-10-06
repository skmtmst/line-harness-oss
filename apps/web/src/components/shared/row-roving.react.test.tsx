// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RovingTbody } from './row-roving'

/* 動きの点検（2026-10-07）20 番：1行に Tab は1回（行の名前）だけ止まる。 */
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function List({ onMove = () => {}, onOpen = () => {} }: { onMove?: (id: string) => void; onOpen?: (id: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const rows = ['a', 'b', 'c']
  return (
    <table>
      <RovingTbody>
        {rows.map((id) => (
          <tr key={id} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === ' ') onOpen(id) }}>
            <td>
              <input
                type="checkbox"
                aria-label={`${id}を選択`}
                checked={selected.has(id)}
                onChange={() => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              />
            </td>
            <td>
              <button type="button" data-roving-own="vertical" aria-label={`${id}を並び替え`} onKeyDown={(e) => { if (e.key === 'ArrowDown') onMove(id) }}>⠿</button>
            </td>
            <td><a href={`/x?id=${id}`}>{`名前${id}`}</a></td>
            <td><button type="button" aria-label={`${id}の操作`}>…</button></td>
            <td><button type="button" tabIndex={-1} aria-label={`${id}の飾り`}>x</button></td>
          </tr>
        ))}
      </RovingTbody>
    </table>
  )
}

const stops = () => Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, tr[tabindex]')).filter((el) => el.tabIndex >= 0)

describe('一覧の行の Tab と矢印キー', () => {
  it('Tab の止まりは1行に1つ（名前）だけ', () => {
    render(<List />)
    expect(stops().map((el) => el.textContent)).toEqual(['名前a', '名前b', '名前c'])
  })

  it('←→ で行の中、Home・End で端へ。元から止まらない物は飛ばす', () => {
    render(<List />)
    const name = screen.getByText('名前a')
    name.focus()
    fireEvent.keyDown(name, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByLabelText('aの操作'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByLabelText('aの操作'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement?.tagName).toBe('TR')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByLabelText('aを選択'))
  })

  it('↑↓ で隣の行の同じ列へ。並び替えのつまみの ↑↓ は奪わない', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} />)
    const menu = screen.getByLabelText('aの操作')
    menu.focus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByLabelText('bの操作'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(menu)
    const grip = screen.getByLabelText('aを並び替え')
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(grip)
    expect(onMove).toHaveBeenCalledWith('a')
  })

  it('名前の上の Space でその行を選び、行の Space（開く）より先にする', () => {
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} />)
    const name = screen.getByText('名前b')
    name.focus()
    fireEvent.keyDown(name, { key: ' ' })
    expect((screen.getByLabelText('bを選択') as HTMLInputElement).checked).toBe(true)
    const row = name.closest('tr')!
    row.focus()
    fireEvent.keyDown(row, { key: ' ' })
    expect((screen.getByLabelText('bを選択') as HTMLInputElement).checked).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('後から足した行も止まりを付け直す', async () => {
    const { rerender } = render(<table><RovingTbody><tr><td><a href="/1">一</a></td><td><button type="button">…</button></td></tr></RovingTbody></table>)
    rerender(<table><RovingTbody><tr><td><a href="/1">一</a></td><td><button type="button">…</button></td></tr><tr><td><a href="/2">二</a></td><td><button type="button">…</button></td></tr></RovingTbody></table>)
    await act(async () => { await Promise.resolve() })
    expect(stops().map((el) => el.textContent)).toEqual(['一', '二'])
  })
})
