import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(here, name), 'utf8')
const tokens = readFileSync(join(here, '..', '..', 'app', 'globals.css'), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const modules = [
  'tabs.module.css',
  'breadcrumb.module.css',
  'chip.module.css',
  'toggle.module.css',
  'select-field.module.css',
  'text-field.module.css',
  'row-actions.module.css',
  'data-table.module.css',
  'page-header.module.css',
  'note-bar.module.css',
  'side-cards.module.css',
  'sticky-bar.module.css',
]

describe('V6共通部品のトークン', () => {
  it('Pencil V6の状態色・角丸・文字サイズを持つ', () => {
    const expected = [
      '--color-status-info: #175cd3;',
      '--color-status-info-soft: #e9f1ff;',
      '--color-status-warn: #f5c56b;',
      '--color-status-warn-soft: #fff7e6;',
      '--color-status-warn-deep: #a15c00;',
      '--color-status-danger: #e5484d;',
      '--color-status-danger-soft: #fef0f0;',
      // 2026-09-04: #068a3c は **4.46:1 で AA の 4.5:1 に届かない**。
      // 要件索引 §5-2 の決定どおり、既存トークン $accent-deep(#087a3e、5.44:1)
      // へ戻した。新しい色トークンは作らない。
      // #087a3e（5.44:1）から少し明るくなるが、決定どおり。
      '--color-accent-deep: #087a3e;',
      '--color-step-idle: #eef0f3;',
      '--color-surface-chrome: #ebedf1;',
      '--radius-icon: 3px;',
      '--text-body: 14px;',
      '--text-display: 30px;',
    ]
    for (const declaration of expected) expect(tokens).toContain(declaration)
  })
})

describe('V6共通部品の主要寸法', () => {
  it('タブは高さ44px・下線2px', () => {
    const css = read('tabs.module.css')
    expect(css).toContain('height: 44px;')
    expect(css).toContain('border-bottom: 2px solid transparent;')
    expect(css).toContain('border-bottom-color: var(--color-accent);')
  })

  it('標準プルダウンは高さ42px、標準176px・件数128px', () => {
    const css = read('select-field.module.css')
    expect(css).toContain('height: 42px;')
    expect(css).toContain('width: 176px;')
    expect(css).toContain('width: 128px;')
  })

  it('入力欄は1行40px、複数行120px', () => {
    const css = read('text-field.module.css')
    expect(css).toContain('height: 40px;')
    expect(css).toContain('min-height: 120px;')
  })

  it('行操作は32px、一覧行は58px、追従バーは72px', () => {
    expect(read('row-actions.module.css')).toContain('width: 32px;')
    expect(read('data-table.module.css')).toContain('height: 58px;')
    expect(read('sticky-bar.module.css')).toContain('height: 72px;')
  })
})

describe('V6共通部品の実装境界', () => {
  it('CSSに生の色やローカル変数を増やさない', () => {
    for (const name of modules) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
    }
  })

  it('押せる部品はキーボードフォーカスを表示する', () => {
    for (const name of [
      'tabs.module.css',
      'breadcrumb.module.css',
      'toggle.module.css',
      'select-field.module.css',
      'text-field.module.css',
      'row-actions.module.css',
      'side-cards.module.css',
    ]) {
      expect(read(name), `${name} に :focus-visible がない`).toContain(':focus-visible')
    }
  })

  it('部品のTSXにTailwind任意値を持たない', () => {
    for (const name of [
      'tabs.tsx',
      'breadcrumb.tsx',
      'chip.tsx',
      'toggle.tsx',
      'select-field.tsx',
      'text-field.tsx',
      'row-actions.tsx',
      'page-header.tsx',
      'note-bar.tsx',
      'side-cards.tsx',
      'sticky-bar.tsx',
    ]) {
      expect(read(name), `${name} に任意値記法がある`).not.toMatch(/className="[^"]*\[/)
    }
  })
})
