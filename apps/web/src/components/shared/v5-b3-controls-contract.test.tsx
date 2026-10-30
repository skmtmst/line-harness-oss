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

describe('入力・検索・選択部品の操作と安全性', () => {
  it('入力欄はHTML属性をそのまま渡す', () => {
    const html = renderToStaticMarkup(
      <div>
        <TextInput name="staffName" required disabled invalid defaultValue="山田" />
        <TextArea name="description" rows={4} readOnly defaultValue="説明" />
      </div>,
    )
    expect(html).toContain('name="staffName"')
    expect(html).toContain('required=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('readOnly=""')
  })

  it('検索欄は検索属性・読込中を持つ', () => {
    const html = renderToStaticMarkup(
      <SearchField aria-label="友だちを検索" value="山田" hidden loading onChange={vi.fn()} onClear={vi.fn()} />,
    )
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
    // 開いた中身は最上層（MenuPortal→document.body）に出る。静的書き出しには載らない。
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: '開いた状態' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: '開いた状態' }).textContent).toBe('状態：有効')
    expect(document.body.innerHTML).toContain('aria-selected="true"')
    const hidden = container.querySelector('input[type="hidden"][name="status"]')
    expect(hidden?.getAttribute('value')).toBe('active')
  })

  it('CSSモジュールは生の色とローカル変数を持たない', () => {
    // 焦点の色・本数・消失は invalid-focus-ring / double-focus-ring の実ブラウザ検査で確かめる。
    for (const name of ['text-field.module.css', 'search-field.module.css', 'select.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
    }
  })
})
