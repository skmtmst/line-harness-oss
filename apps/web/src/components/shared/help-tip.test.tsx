// @vitest-environment happy-dom
/* 見出し・ラベル横の「？」（共通ルール 2-1b）。押して開き、Esc・外・他の？で閉じる。 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import HelpTip from './help-tip'

const DIR = dirname(fileURLToPath(import.meta.url))

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

  it('「くわしく」は本文（children）と一緒に渡す', () => {
    const { container, getByText, queryByText } = render(
      <HelpTip label="用語の説明">
        ひとことです。<a href="/manual#word">くわしく</a>
      </HelpTip>,
    )
    // 閉じている間は本文もリンクも出さない。
    expect(queryByText('ひとことです。')).toBeNull()
    fireEvent.click(container.querySelector('button')!)
    expect(getByText('ひとことです。')).not.toBeNull()
    const more = getByText('くわしく')
    expect(more.getAttribute('href')).toBe('/manual#word')
  })

  it('印は「?」の文字で、丸いアイコンは出さない', () => {
    const { container } = render(<HelpTip label="人数の説明">送る相手の数。</HelpTip>)
    expect(container.querySelector('button')!.textContent).toBe('?')
    expect(container.querySelector('svg')).toBeNull()
  })
})

/*
 * G3 はみ出し直し（parity 1004-0513：？印 181 件）。
 * 28px の当たりを透明の ::before ではみ出させると、見えないはみ出しが
 * 判定に載る（枠16＞中21）。V8 では正円を中の箱が持ち、札自体を透明な
 * 28px の当たりにする（#1367 のチェックと同じ構図）。見た目・当たり・
 * 読み上げは変えない。v7 の 18px 円＋::before は触らない。
 */
describe('？印の当たりは透明のはみ出しを持たない（G3・V8）', () => {
  it('V8 の札は透明な 28px、円は中の箱、::before は出さない', () => {
    const css = readFileSync(join(DIR, 'help-tip.module.css'), 'utf8')
    expect(css).toMatch(/\[data-theme='v8'\] \.button \{[^}]*width:\s*28px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.button \{[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.mark \{[^}]*width:\s*16px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.mark \{[^}]*border-radius:\s*var\(--radius-pill\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.button::before \{\s*content:\s*none;/s)
  })

  it('v7 の札は 18px 円＋::before のまま', () => {
    const css = readFileSync(join(DIR, 'help-tip.module.css'), 'utf8')
    const base = css.match(/\.button \{[^}]*\}/s)?.[0] ?? ''
    expect(base).toMatch(/width:\s*18px/)
  })
})
