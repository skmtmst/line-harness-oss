// @vitest-environment happy-dom
/* 帯（Notice）。★V7 共通部品その2 §1 の4種類を1本で出す。 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Notice from './notice'

afterEach(() => cleanup())

describe('帯（Notice）の4種類', () => {
  it('案内・うまくいった・注意・危険を同じ API で出す', () => {
    for (const tone of ['info', 'success', 'warn', 'danger'] as const) {
      const { container, unmount } = render(<Notice tone={tone} message={`${tone}の帯`} />)
      const root = container.firstElementChild!
      expect(root.getAttribute('data-design-part')).toBe('notice')
      expect(root.textContent).toContain(`${tone}の帯`)
      // 左に線のアイコン（読み上げない）
      expect(root.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      unmount()
    }
  })

  it('危険だけ role=alert、ほかは role=note', () => {
    const { container: danger } = render(<Notice tone="danger" message="止まっています" />)
    expect(danger.firstElementChild!.getAttribute('role')).toBe('alert')
    for (const tone of ['info', 'success', 'warn'] as const) {
      const { container, unmount } = render(<Notice tone={tone} message="お知らせ" />)
      expect(container.firstElementChild!.getAttribute('role')).toBe('note')
      unmount()
    }
  })

  it('V5 の呼び名（validation・error）は注意・危険として出す', () => {
    const { container: v } = render(<Notice tone="validation" message="確かめてください" />)
    const { container: w } = render(<Notice tone="warn" message="確かめてください" />)
    expect(v.firstElementChild!.getAttribute('class')).toBe(w.firstElementChild!.getAttribute('class'))
    const { container: e } = render(<Notice tone="error" message="失敗しました" />)
    const { container: d } = render(<Notice tone="danger" message="失敗しました" />)
    expect(e.firstElementChild!.getAttribute('class')).toBe(d.firstElementChild!.getAttribute('class'))
    expect(e.firstElementChild!.getAttribute('role')).toBe('alert')
  })

  it('右に操作を1つ置ける', () => {
    const { container } = render(
      <Notice tone="warn" message="入力が要ります" action={<a href="/settings">設定を見る</a>} />,
    )
    expect(container.querySelector('a')!.textContent).toBe('設定を見る')
  })

  it('閉じる印は押すと onClose を呼ぶ', () => {
    const onClose = vi.fn()
    const { container } = render(<Notice tone="success" message="保存しました" onClose={onClose} />)
    const button = container.querySelector('button[aria-label="通知を閉じる"]')!
    ;(button as HTMLButtonElement).click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('補足の「？」は見出しの横に入り、本文は1〜2文のまま', () => {
    const { container } = render(
      <Notice tone="info" message="この画面の数は日本時間で数えます。" help="0時締めです" helpLabel="数の数え方" />,
    )
    expect(container.firstElementChild!.textContent).toContain('この画面の数は日本時間で数えます。')
    expect(container.querySelector('button[aria-label="数の数え方の説明"]')).not.toBeNull()
  })
})
