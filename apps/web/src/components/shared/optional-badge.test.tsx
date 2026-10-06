// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { OptionalBadge, RequiredBadge } from './form-controls'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'form-controls.module.css'), 'utf8')

afterEach(() => {
  cleanup()
})

/**
 * 「任意」の札（Td4TN・RaMf3：括弧なし・11px/17・左に6・文と同じ行）。
 * 必須の丸い地は付けない。
 */
describe('任意の札', () => {
  it('「任意」と出す', () => {
    render(<OptionalBadge />)
    expect(screen.getByText('任意')).toBeTruthy()
  })

  it('必須の札は今までどおり', () => {
    render(<RequiredBadge />)
    expect(screen.getByText('必須')).toBeTruthy()
  })

  it('11px・行は変数・左に6・丸い地なし（v7 は変えない）', () => {
    expect(css).toMatch(/\.optional\s*\{[^}]*margin-left:\s*6px/s)
    expect(css).toMatch(/\.optional\s*\{[^}]*font-size:\s*var\(--text-micro\)/s)
    expect(css).toMatch(/\.optional\s*\{[^}]*line-height:\s*var\(--text-micro--line-height\)/s)
    expect(css).not.toMatch(/\.optional\s*\{[^}]*background/s)
    expect(css).not.toMatch(/\.optional\s*\{[^}]*border-radius/s)
  })
})
