// @vitest-environment happy-dom
/*
 * 友だちの顔（★V7 `KXDhj`）。画像が読み込めない時も空白にしない。
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Avatar, { avatarInitials, avatarToneIndex } from './avatar'

afterEach(() => cleanup())

describe('友だちの顔（★V7）', () => {
  it('画像の読み込みに失敗したら頭文字に替わる', () => {
    const { container } = render(<Avatar name="Kyohei Yamamoto" src="https://example.invalid/a.jpg" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.dataset.avatar).toBe('image')
    fireEvent.error(container.querySelector('img')!)
    expect(root.dataset.avatar).toBe('initials')
    expect(root.textContent).toBe('KY')
  })

  it('頭文字：英字は単語の頭2つ、日本語は最初の1字', () => {
    expect(avatarInitials('Kyohei Yamamoto')).toBe('KY')
    expect(avatarInitials('Masato.S')).toBe('M')
    expect(avatarInitials('菅野 亮')).toBe('菅')
  })

  it('名前も無い時は人の印', () => {
    const { container } = render(<Avatar name="  " />)
    expect((container.firstElementChild as HTMLElement).dataset.avatar).toBe('icon')
  })

  it('同じ名前はいつも同じ色', () => {
    expect(avatarToneIndex('菅野 亮')).toBe(avatarToneIndex('菅野 亮'))
    expect(avatarToneIndex('')).toBeGreaterThanOrEqual(0)
  })

  it('頭文字の6組はどれも 4.5:1 以上', () => {
    const css = readFileSync(join(__dirname, 'avatar.module.css'), 'utf8')
    const globals = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')
    const token = (name: string) => globals.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`))![1]
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const pairs = [...css.matchAll(/\.t\d \{ background: var\(--color-([\w-]+)\); color: var\(--color-([\w-]+)\); \}/g)]
    expect(pairs).toHaveLength(6)
    for (const [, bg, fg] of pairs) {
      const [hi, lo] = [lum(token(bg)), lum(token(fg))].sort((x, y) => y - x)
      expect((hi + 0.05) / (lo + 0.05), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
