import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TextArea, TextInput } from './form-controls'
import SearchField from './search-field'
import Select from './select'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const WEB = join(SRC, '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')
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
    const html = renderToStaticMarkup(
      <div>
        <Select aria-label="状態" value="all" options={options} onChange={vi.fn()} />
        <Select aria-label="表示件数" value="all" options={options} onChange={vi.fn()} size="page-size" />
        <Select aria-label="開いた状態" label="状態" value="active" options={options} onChange={vi.fn()} defaultOpen name="status" />
      </div>,
    )
    expect(html).toContain('data-design-node="rpot9"')
    expect(html).toContain('data-design-node="niGPF"')
    expect(html).toContain('data-design-node="Gfsb4"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('状態：有効')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('type="hidden" name="status" value="active"')
  })

  it('代表画面は直書きではなく共通入力・検索・選択を使う', () => {
    expect(readSource('app/staff/new/page.tsx')).toMatch(/import Select/)
    expect(readSource('app/staff/new/page.tsx')).toMatch(/TextInput/)
    expect(readSource('app/reminders/new/page.tsx')).toMatch(/TextArea/)
    expect(readSource('components/shared/list-toolbar.tsx')).toMatch(/SearchField/)
    expect(readSource('components/shared/list-toolbar.tsx')).toMatch(/Select/)
  })

  it('CSSモジュールは生の色とローカル変数を持たず、フォーカス輪郭を消さない', () => {
    for (const name of ['form-controls.module.css', 'search-field.module.css', 'select.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
      expect(css, `${name} がfocus-visibleを保証していない`).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*revert;/s)
    }
  })

  it('契約はB3の実ノード・部品・宣言数を下限として持つ', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const inventory = JSON.parse(readFileSync(join(WEB, 'design', 'pencil-component-inventory.json'), 'utf8'))
    expect(contract.required.parts).toBe(20)
    expect(contract.required.partDeclarations).toBe(301)
    expect(contract.parts['form-control'].pencilNodes).toEqual(['ytG7l', 'keKe3'])
    expect(contract.parts['search-field'].pencilNodes).toEqual(['phlR1'])
    expect(contract.parts.select.pencilNodes).toEqual(['rpot9', 'Gfsb4', 'niGPF', 'QB99A'])
    for (const nodeId of ['ytG7l', 'keKe3', 'phlR1', 'rpot9', 'Gfsb4', 'niGPF', 'QB99A']) {
      expect(inventory.components[nodeId].status, `${nodeId} がactiveではない`).toBe('active')
    }
    expect(contract.investigations['checkbox-switch-canonical']).toBeDefined()
  })
})
