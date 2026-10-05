// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import SearchField from './search-field'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

afterEach(() => {
  cleanup()
})

/**
 * 探す欄の近道の印（x6QsVz・v19Ivv・I1E7Bt の絵の ⌘K）。
 * 選ぶ形（shortcut）で足し、渡さない限り見た目は変わらない。
 */
describe('探す欄の近道の印', () => {
  it('渡さないと印は出ない', () => {
    render(<SearchField aria-label="友だちを探す" value="" onChange={() => {}} />)
    expect(screen.queryByText('⌘K')).toBeNull()
  })

  it('渡すと箱の右端に印が出る', () => {
    render(<SearchField aria-label="友だちを探す" value="" onChange={() => {}} shortcut="⌘K" />)
    expect(screen.getByText('⌘K').tagName).toBe('KBD')
  })

  it('⌘K を押すとこの欄へ飛ぶ', () => {
    render(<SearchField aria-label="友だちを探す" value="" onChange={() => {}} shortcut="⌘K" />)
    const input = screen.getByLabelText('友だちを探す')
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(document.activeElement).toBe(input)
  })

  it('文字を書いている最中の ⌘K は奪わない', () => {
    render(
      <>
        <SearchField aria-label="友だちを探す" value="a" onChange={() => {}} shortcut="⌘K" />
        <input aria-label="別の欄" defaultValue="" />
      </>,
    )
    const other = screen.getByLabelText('別の欄')
    other.focus()
    fireEvent.keyDown(other, { key: 'k', metaKey: true })
    expect(document.activeElement).toBe(other)
  })

  it('印は v8 だけで見せる（v7 の見た目は変えない）', () => {
    const css = read('search-field.module.css')
    expect(css).toMatch(/\.shortcut\s*\{\s*display:\s*none;/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.shortcut\s*\{[^}]*display:\s*inline-block/s)
  })
})
