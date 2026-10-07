import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Card, { CardHeader } from './card'
import IconButton from './icon-button'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('V5 B2 共通部品', () => {
  it('カードと見出しがHTML属性・見出し階層・Pencil Node IDを保つ', () => {
    const html = renderToStaticMarkup(
      <Card layout="vertical" padding="roomy" hidden aria-label="対応状況">
        <CardHeader
          title="対応状況"
          meta="3件"
          action={<a href="/chats">受信箱へ</a>}
          headingLevel={3}
        />
      </Card>,
    )

    expect(html).toContain('data-design-part="card"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('aria-label="対応状況"')
    expect(html).toContain('data-design-node="t0jk8p"')
    expect(html).toContain('<h3')
    expect(html).toContain('href="/chats"')
  })

  it('アイコン操作には読み上げ名が必須で、button属性を渡す', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="その他の操作" disabled><span aria-hidden="true">…</span></IconButton>,
    )

    expect(html).toContain('aria-label="その他の操作"')
    expect(html).toContain('data-design-node="H0V8EK"')
    expect(html).toContain('disabled=""')
  })

  it('CSSモジュールはPencil外の生の色を持たず、フォーカスを消さない', () => {
    for (const name of ['card.module.css', 'status-badge.module.css', 'icon-button.module.css']) {
      const css = withoutComments(read(name))
      // V8正本の状態の札（ekmYd・ii85L）は、この2色を実測照合済み。
      const legacyCss = name === 'status-badge.module.css' ? css.replace(/#(?:0b63ce|94600a)\b/gi, '') : css
      expect(legacyCss, `${name} に正本外の生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
    }
    expect(read('card.module.css')).toMatch(/:focus-visible\s*\{[^}]*outline:\s*revert;/s)
    expect(read('icon-button.module.css')).toMatch(/:focus-visible\s*\{[^}]*outline:\s*revert;/s)
  })
})
