// @vitest-environment happy-dom
/* 見出し・ラベル横の「？」（共通ルール 2-1b）。押して開き、Esc・外・他の？で閉じる。 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import HelpTip from './help-tip'

afterEach(() => cleanup())

describe('補足の「？」', () => {
  it('閉じている時は吹き出しを出さない', () => {
    const { container, queryByText } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    expect(queryByText('送る相手の数。')).toBeNull()
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('人数の説明')
  })

  it('押すと開き、吹き出しと aria-describedby でつながる', () => {
    const { container, getByText } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    const button = container.querySelector('button')!
    fireEvent.click(button)
    const tip = getByText('送る相手の数。')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-describedby')).toBe(tip.getAttribute('id'))
  })

  it('Esc で閉じる', () => {
    const { container, queryByText } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    fireEvent.click(container.querySelector('button')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryByText('送る相手の数。')).toBeNull()
  })

  it('1つ開くと他は閉じる', () => {
    const first = render(<HelpTip label="1つ目の説明">1つ目。</HelpTip>)
    const second = render(<HelpTip label="2つ目の説明">2つ目。</HelpTip>)
    fireEvent.click(first.container.querySelector('button')!)
    fireEvent.click(second.container.querySelector('button')!)
    expect(first.queryByText('1つ目。')).toBeNull()
    expect(second.queryByText('2つ目。')).not.toBeNull()
  })

  it('閉じている時は aria-describedby を付けない', () => {
    const { container } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    expect(container.querySelector('button')!.hasAttribute('aria-describedby')).toBe(false)
  })

  it('Esc で閉じると押した？へ戻る', () => {
    const { container, queryByText } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    const button = container.querySelector('button')!
    fireEvent.click(button)
    expect(queryByText('送る相手の数。')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryByText('送る相手の数。')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('くわしくは渡した時だけ出す', () => {
    const without = render(<HelpTip label="用語の説明">ひとことです。</HelpTip>)
    fireEvent.click(without.container.querySelector('button')!)
    expect(without.container.querySelector('a')).toBeNull()

    const { container, getByText } = render(
      <HelpTip label="用語の説明" moreHref="/manual#word">
        ひとことです。
      </HelpTip>,
    )
    fireEvent.click(container.querySelector('button')!)
    const more = getByText('くわしく')
    expect(more.getAttribute('href')).toBe('/manual#word')
  })
})
