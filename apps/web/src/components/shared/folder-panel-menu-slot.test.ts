import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(new URL('./folder-panel.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('./folder-panel.module.css', import.meta.url), 'utf8')

describe('フォルダ行の「…」の場所（I3L41O）', () => {
  it('選んだ行は操作がなくても「…」の場所を取る（絵では選んだ行に「…」）', () => {
    expect(PANEL).toContain('isActive && !hasActions')
    expect(PANEL).toContain('styles.menuSlot')
    expect(PANEL).toContain('aria-hidden="true"')
  })

  it('場所取りは v8 だけで出す（v7 の見た目は変えない）', () => {
    expect(CSS).toContain('.menuSlot { display: none; }')
    expect(CSS).toContain("[data-theme='v8'] .menuSlot")
  })

  it('選んでいない行の「…」は場所を取らない（重ねて出す）', () => {
    expect(CSS).toContain(".row:not([data-active]) .menu")
    expect(CSS).toContain('position: absolute')
  })

  it('触る・キーボード・開いている間は「…」が出る', () => {
    expect(CSS).toContain('.row:not([data-active]):hover .menu')
    expect(CSS).toContain('.row:not([data-active]):focus-within .menu')
    expect(CSS).toContain('.row:not([data-active])[data-menu-open] .menu')
    expect(PANEL).toContain('data-menu-open')
  })

  it('触れない端末では「…」を常に出す（スマホでも名前変更・削除に届く）', () => {
    expect(CSS).toContain('@media (hover: none)')
  })
})
