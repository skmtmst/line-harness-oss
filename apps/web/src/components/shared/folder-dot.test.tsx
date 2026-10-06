import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FolderDot, FolderDotName } from './folder-dot'

/*
 * 一覧の行の名前の前の「フォルダの色の丸」（2026-10-07 オーナー決定）。
 * 色だけに頼らず「フォルダ：〇〇」を読み上げと title で伝える。未分類は色の無い輪。
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'folder-dot.module.css'), 'utf8')
const globals = readFileSync(join(here, '../../app/globals.css'), 'utf8')

describe('フォルダの色の丸', () => {
  it('フォルダの色で塗り、名前を読み上げと title で伝える', () => {
    const html = renderToStaticMarkup(<FolderDot folder={{ name: 'VIP', color: '#2f6fde' }} />)
    expect(html).toContain('background-color:#2f6fde')
    expect(html).toContain('aria-label="フォルダ：VIP"')
    expect(html).toContain('title="フォルダ：VIP"')
    expect(html).toContain('data-folder-dot="filed"')
  })

  it('未分類は色の無い輪で、「フォルダ：未分類」と伝える', () => {
    const html = renderToStaticMarkup(<FolderDot folder={null} />)
    expect(html).toContain('aria-label="フォルダ：未分類"')
    expect(html).toContain('data-folder-dot="unfiled"')
    expect(html).not.toContain('background-color')
    expect(css).toMatch(/\.unfiled \{\s*background: transparent;\s*border: 1px solid var\(--color-ink-faint\);/)
  })

  it('丸＋名前は1行で、名前の前に丸が来る', () => {
    const html = renderToStaticMarkup(<FolderDotName folder={{ name: '会員', color: '#e07b24' }}>NEN会員</FolderDotName>)
    expect(html.indexOf('data-folder-dot')).toBeLessThan(html.indexOf('NEN会員'))
  })

  it('大きさ 8・名前との間 8・説明の行の字下げ 16 は変数で持つ', () => {
    expect(globals).toMatch(/--tpl-folder-dot-size: 8px; --tpl-folder-dot-gap: 8px; --tpl-folder-dot-indent: 16px;/)
    expect(css).toContain('width: var(--tpl-folder-dot-size)')
    expect(css).toContain('gap: var(--tpl-folder-dot-gap)')
  })
})
