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
 * 「任意」の札（・：括弧なし・11px/17・左に6・文と同じ行）。
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

  it('今の共通の札の地と文字の段を持つ', () => {
    expect(css).toMatch(/:root \.optional\s*\{[^}]*background:\s*var\(--color-canvas-sunken\)/s)
    expect(css).toMatch(/:root \.optional\s*\{[^}]*font-size:\s*var\(--text-caption\)/s)
    expect(css).toMatch(/:root \.optional\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s)
  })
})
