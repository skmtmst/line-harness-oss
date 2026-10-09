// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TagPill, { TagToggle } from './tag-pill'

afterEach(cleanup)

describe('V8 のタグ札', () => {
  it('名前を読み上げ、フォルダ色の点を添える。長い名前も全文を確認できる', () => {
    const name = '長いタグの名前を途中で改行せずに表示する'
    render(<TagPill name={name} color="#228855" />)
    const pill = screen.getByRole('group', { name: `タグ「${name}」` })
    expect(pill.getAttribute('data-size')).toBe('md')
    expect(screen.getByTitle(name).textContent).toBe(name)
    expect(pill.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundColor).toBe('#228855')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('未分類にも点があり、表では小さい札になる', () => {
    render(<TagPill name="未分類" size="sm" />)
    const pill = screen.getByRole('group', { name: 'タグ「未分類」' })
    expect(pill.getAttribute('data-size')).toBe('sm')
    expect(pill.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundColor).toBe('')
  })

  it('編集へのリンクと外すボタンは別々に操作でき、表のクリックへ伝わらない', () => {
    const onRemove = vi.fn()
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}><TagPill name="VIP" href="/tags/edit?id=vip" onRemove={onRemove} /></div>)
    const link = screen.getByRole('link', { name: 'タグ「VIP」を編集' })
    expect(link.getAttribute('href')).toBe('/tags/edit?id=vip')
    const remove = screen.getByRole('button', { name: 'VIPを外す' })
    expect(link.contains(remove)).toBe(false)
    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('白地・細い枠・丸い角と、2サイズの指定を共通のCSSで保つ', () => {
    const css = readFileSync('src/components/shared/tag-pill.module.css', 'utf8')
    expect(css).toContain('border: 1px solid var(--color-hairline)')
    expect(css).toContain('border-radius: var(--radius-pill)')
    expect(css).toContain('background: var(--color-canvas)')
    for (const value of ['14px', '13px', '10px', '8px', '6px 12px', '4px 10px']) expect(css).toContain(value)
    expect(css).toContain('font-weight: 600')
    expect(css).toContain('white-space: nowrap')
    expect(css).toContain(':focus-visible')
  })

  it('条件づくりの札は選択状態を読み上げ、押すと切り替える', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<TagToggle name="VIP" selected={false} onToggle={onToggle} />)
    const toggle = screen.getByRole('button', { name: 'VIP', pressed: false })
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()
    rerender(<TagToggle name="VIP" selected onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'VIP', pressed: true })).toBeTruthy()
  })
})
