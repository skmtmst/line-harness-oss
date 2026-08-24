import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Button from './button'
import SummaryCard from './summary-card'
import { TableHeadRow, Th } from './table'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('共通Button', () => {
  it('通常ボタンのpropsとhidden属性を実要素へ渡す', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" hidden aria-label="保存">
        保存
      </Button>,
    )
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('aria-label="保存"')
  })

  it('リンクのpropsを捨てずにa要素へ渡す', () => {
    const html = renderToStaticMarkup(
      <Button href="/settings" target="_blank" rel="noreferrer" hidden>
        設定
      </Button>,
    )
    expect(html).toContain('<a')
    expect(html).toContain('href="/settings"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
    expect(html).toContain('hidden=""')
  })

  it('リンクとdisabledを同時に指定できない', () => {
    const invalid = () => (
      // @ts-expect-error 無効なリンクを作らず、button要素を使う
      <Button href="/settings" disabled>
        設定
      </Button>
    )
    expect(invalid).toBeTypeOf('function')
  })
})

describe('共通SummaryCard', () => {
  it('数値を日本語表記し、hiddenとaria属性を実要素へ渡す', () => {
    const html = renderToStaticMarkup(
      <SummaryCard
        title="有効友だち"
        value={1234}
        unit="人"
        detail="総友だち 1,300人"
        hidden
        aria-label="友だち集計"
      />,
    )
    expect(html).toContain('1,234人')
    expect(html).toContain('hidden=""')
    expect(html).toContain('aria-label="友だち集計"')
  })

  it('読み込み中はaria-busyを付ける', () => {
    const html = renderToStaticMarkup(
      <SummaryCard title="配信数" value={null} unit="件" detail="集計中" loading />,
    )
    expect(html).toContain('aria-busy="true"')
  })
})

describe('共通表見出し', () => {
  it('Thはscope=colを既定にし、必要な場合だけ意味を変更できる', () => {
    const html = renderToStaticMarkup(
      <table>
        <thead>
          <TableHeadRow>
            <Th>名前</Th>
            <Th scope="row">項目</Th>
          </TableHeadRow>
        </thead>
      </table>,
    )
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
  })
})

describe('部品のCSS境界', () => {
  it('表示制御はhidden属性で効き、フォーカスの既定輪郭を消さない', () => {
    expect(read('button.module.css')).toMatch(/\.button\[hidden\]\s*\{[^}]*display:\s*none;/s)
    expect(read('summary-card.module.css')).toMatch(/\.card\[hidden\]\s*\{[^}]*display:\s*none;/s)
    expect(read('table.module.css')).toMatch(/\.cell\[hidden\][^{]*\{[^}]*display:\s*none;/s)
    expect(read('button.module.css')).toMatch(/\.button:focus-visible\s*\{[^}]*outline:\s*revert;/s)
    expect(read('summary-card.module.css')).toMatch(/\.link:focus-visible\s*\{[^}]*outline:\s*revert;/s)
  })

  it('生の色・ローカル変数・Pencilに無い大文字化や字間を持たない', () => {
    for (const name of ['button.module.css', 'summary-card.module.css', 'table.module.css']) {
      const css = withoutComments(read(name))
      expect(css, `${name} に生の色がある`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css, `${name} がローカル変数を定義している`).not.toMatch(/^\s*--(?!tw-)[a-z-]+:/m)
      expect(css, `${name} がフォーカス輪郭を消している`).not.toMatch(/outline:\s*(?:0|none)/)
    }
    expect(withoutComments(read('table.module.css'))).not.toMatch(/text-transform|letter-spacing/)
  })
})
