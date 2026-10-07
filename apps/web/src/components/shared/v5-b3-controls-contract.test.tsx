// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextArea, TextInput } from './form-controls'
import SearchField from './search-field'
import Select from './select'

afterEach(() => cleanup())

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('V5 B3 入力・検索・選択部品', () => {
  it('入力欄はHTML属性とPencil Node IDをそのまま渡す', () => {
    const html = renderToStaticMarkup(
      <div>
        <TextInput name="staffName" required disabled invalid defaultValue="山田" />
        <TextArea name="description" rows={4} readOnly defaultValue="説明" />
      </div>,
    )
    expect(html).toContain('data-design-node="ytG7l"')
    expect(html).toContain('name="staffName"')
    expect(html).toContain('required=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('data-design-node="keKe3"')
    expect(html).toContain('readOnly=""')
  })

  it('検索欄は検索属性・読込中・Pencil Node IDを持つ', () => {
    const html = renderToStaticMarkup(
      <SearchField aria-label="友だちを検索" value="山田" hidden loading onChange={vi.fn()} onClear={vi.fn()} />,
    )
    expect(html).toContain('data-design-node="phlR1"')
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="友だちを検索"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('検索中')
  })

  it('選択欄は閉・ページ件数・開状態を同じ部品で表す', () => {
    const options = [
      { value: 'all', label: 'すべて' },
      { value: 'active', label: '有効' },
    ]
    const { container } = render(
      <div>
        <Select aria-label="状態" value="all" options={options} onChange={vi.fn()} />
        <Select aria-label="表示件数" value="all" options={options} onChange={vi.fn()} size="page-size" />
        <Select aria-label="開いた状態" label="状態" value="active" options={options} onChange={vi.fn()} defaultOpen name="status" />
      </div>,
    )
    const html = container.innerHTML
    expect(html).toContain('data-design-node="rpot9"')
    expect(html).toContain('data-design-node="niGPF"')
    expect(html).toContain('data-design-node="Gfsb4"')
    // 開いた中身は最上層（MenuPortal→document.body）に出る。静的書き出しには載らない。
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: '開いた状態' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('状態：有効')).toBeTruthy()
    expect(document.body.innerHTML).toContain('aria-selected="true"')
    const hidden = container.querySelector('input[type="hidden"][name="status"]')
    expect(hidden?.getAttribute('value')).toBe('active')
  })

  it('CSSモジュールは生の色とローカル変数を持たず、フォーカス輪郭を消さない', () => {
    // 2026-09-25・使いやすさ点検 §8: 入力欄の輪郭は `2px・action 色・offset 2px`
    // にそろえた（緑は「正常」の意味）。`outline: revert`（ブラウザ既定）と
    // 同等以上に見える輪郭なので、ここでは両方を保証として認める。
    // 複合部品のうち外枠の `:focus-within` を正本にするものは、中の input の
    // `outline: none` をその場合だけ許す（二重の輪郭を避けるため）。
    // SearchField は外枠ではなく中の input 自身に輪郭を出す（2026-09-25）。
    for (const name of ['form-controls.module.css', 'search-field.module.css', 'select.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      const hasOuterRing = /:focus-within\s*\{[^}]*outline:\s*2px solid var\(--color-action\)/.test(css)
      if (!hasOuterRing) {
        expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
      }
      expect(css, `${name} がfocus-visibleを保証していない`).toMatch(
        /:focus-visible[^{]*\{[^}]*outline:\s*(?:revert|2px solid var\(--color-action\))/s,
      )
    }
  })
})
