// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from './context-menu'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const items = (onSelect: (id: string) => void) => [
  { id: 'open', label: '開く', onSelect },
  { id: 'copy', label: '複製する', onSelect },
  { id: 'delete', label: '消す', danger: true, onSelect },
]

describe('ContextMenu（右クリックメニュー・C③）', () => {
  it('右クリックした位置にメニューが出る', () => {
    const onSelect = vi.fn()
    render(
      <ContextMenu label="配信の操作" items={items(onSelect)}>
        <p>行の中身</p>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('行の中身'), { clientX: 300, clientY: 200 })
    const menu = screen.getByRole('menu', { name: '配信の操作' })
    expect(menu).not.toBeNull()
    const layer = document.querySelector('[data-context-menu]')
    expect(layer?.getAttribute('style')).toContain('left: 300px')
    expect(layer?.getAttribute('style')).toContain('top: 200px')
  })

  it('項目を選ぶと id が渡り、閉じる', () => {
    const onSelect = vi.fn()
    render(
      <ContextMenu label="配信の操作" items={items(onSelect)}>
        <p>行の中身</p>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('行の中身'), { clientX: 300, clientY: 200 })
    fireEvent.click(screen.getByRole('menuitem', { name: '複製する' }))
    expect(onSelect).toHaveBeenCalledWith('copy')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Esc で閉じる', () => {
    const onSelect = vi.fn()
    render(
      <ContextMenu label="配信の操作" items={items(onSelect)}>
        <p>行の中身</p>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('行の中身'), { clientX: 300, clientY: 200 })
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('右端・下端では画面の中に収まる', () => {
    const onSelect = vi.fn()
    render(
      <ContextMenu label="配信の操作" items={items(onSelect)}>
        <p>行の中身</p>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('行の中身'), { clientX: 5000, clientY: 5000 })
    const layer = document.querySelector('[data-context-menu]')
    const style = layer?.getAttribute('style') ?? ''
    const left = Number(/left: (\d+)px/.exec(style)?.[1])
    const top = Number(/top: (\d+)px/.exec(style)?.[1])
    expect(left).toBeLessThan(5000)
    expect(top).toBeLessThan(5000)
    expect(left).toBeGreaterThanOrEqual(8)
  })

  it('itemsFor を渡すと、items が空でも押した所から作った項目で1回目から開く', () => {
    const onSelect = vi.fn()
    render(
      <ContextMenu
        label="行の操作"
        items={[]}
        itemsFor={(event) => {
          const name = (event.target as HTMLElement).textContent ?? ''
          return [{ id: name, label: `${name}を開く`, onSelect }]
        }}
      >
        <p>行A</p>
        <p>行B</p>
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('行B'), { clientX: 100, clientY: 100 })
    expect(screen.getByRole('menuitem', { name: '行Bを開く' })).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '行Bを開く' }))
    expect(onSelect).toHaveBeenCalledWith('行B')
  })
})
