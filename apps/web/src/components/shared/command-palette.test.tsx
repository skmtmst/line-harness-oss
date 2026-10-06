// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch: vi.fn() }),
}))

import CommandPalette from './command-palette'

const items = [
  { href: '/broadcasts', label: '一斉配信', section: '配信' },
  { href: '/templates', label: 'テンプレート', section: '配信' },
  { href: '/friends', label: '友だち', section: '友だち' },
]

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

beforeEach(() => {
  push.mockClear()
  document.documentElement.dataset.theme = 'v8'
})

function openPalette() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true })
}

describe('CommandPalette（探す窓・F②）', () => {
  it('⌘K で開き、Esc で閉じる', () => {
    render(<CommandPalette items={items} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    openPalette()
    expect(screen.getByRole('dialog', { name: '機能と友だちを探す' })).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Ctrl+K でも開く（Windows）', () => {
    render(<CommandPalette items={items} />)
    fireEvent.keyDown(document, { key: 'K', ctrlKey: true })
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('v7 では開かない', () => {
    document.documentElement.dataset.theme = 'v7'
    render(<CommandPalette items={items} />)
    openPalette()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('名前で絞り、Enter で行く', () => {
    render(<CommandPalette items={items} />)
    openPalette()
    fireEvent.change(screen.getByRole('textbox', { name: '機能と友だちを探す' }), {
      target: { value: 'テンプレ' },
    })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/templates')
  })

  it('文字を入れると友だちを探す行が出て、友だち一覧の受け口へ送る', () => {
    render(<CommandPalette items={items} />)
    openPalette()
    fireEvent.change(screen.getByRole('textbox', { name: '機能と友だちを探す' }), {
      target: { value: '山田' },
    })
    fireEvent.click(screen.getByRole('option', { name: '友だちを探す「山田」' }))
    expect(push).toHaveBeenCalledWith('/friends?q=%E5%B1%B1%E7%94%B0')
  })
})
