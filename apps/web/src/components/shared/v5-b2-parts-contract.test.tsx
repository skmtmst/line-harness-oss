import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Card, { CardHeader } from './card'
import IconButton from './icon-button'
import StatusBadge from './status-badge'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const WEB = join(SRC, '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')
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

  it('状態バッジは状態名とサイズをpropsで固定する', () => {
    const html = renderToStaticMarkup(
      <div>
        <StatusBadge tone="warning">確認待ち</StatusBadge>
        <StatusBadge tone="success" size="compact">未確認</StatusBadge>
      </div>,
    )

    expect(html.match(/data-design-node="xRvDB"/g)).toHaveLength(2)
    expect(html).toContain('確認待ち')
    expect(html).toContain('未確認')
  })

  it('アイコン操作には読み上げ名が必須で、button属性を渡す', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="その他の操作" disabled><span aria-hidden="true">…</span></IconButton>,
    )

    expect(html).toContain('aria-label="その他の操作"')
    expect(html).toContain('data-design-node="H0V8EK"')
    expect(html).toContain('disabled=""')
  })

  it('ダッシュボードのカード実装元が共通部品を使い、旧18pxカードを残さない', () => {
    for (const file of [
      'app/page.tsx',
      'components/dashboard/shipment-panel.tsx',
      'components/dashboard/side-cards.tsx',
      'components/support/pending-inbox-card.tsx',
    ]) {
      const source = readSource(file)
      expect(source, `${file} がCardを使っていない`).toMatch(/import Card/)
      expect(source, `${file} に旧カードの角丸が残っている`).not.toContain('rounded-[18px]')
      expect(source, `${file} に旧カードの影が残っている`).not.toContain('shadow-[1px_1px_2px')
    }
  })

  it('CSSモジュールはPencil外の生の色を持たず、フォーカスを消さない', () => {
    for (const name of ['card.module.css', 'status-badge.module.css', 'icon-button.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
    }
    expect(read('card.module.css')).toMatch(/:focus-visible\s*\{[^}]*outline:\s*revert;/s)
    expect(read('icon-button.module.css')).toMatch(/:focus-visible\s*\{[^}]*outline:\s*revert;/s)
  })

  it('契約はB2の実ノード・部品・トークン数を下限として持つ', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))

    // 2026-09-03: 色と角丸を1系統にまとめ、同値の別名3つ
    // （--radius-tile / --color-status-warning / --color-status-warning-soft）
    // を消したので 24 → 21。承認は docs/v6-directives.md §4。
    expect(contract.required.tokens).toBe(21)
    expect(contract.required.parts).toBe(20)
    expect(contract.required.partDeclarations).toBe(301)
    expect(contract.parts.card.status).toBe('active')
    expect(contract.parts['card-header'].pencilNodes).toContain('t0jk8p')
    expect(contract.parts['status-badge'].pencilNodes).toContain('xRvDB')
    expect(contract.parts['icon-button'].status).toBe('implemented')
  })
})
