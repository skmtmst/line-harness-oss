
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FolderDot, FolderDotName, folderDisplayColor } from './folder-dot'
import TruncatedText from './truncated-text'
import Checkbox from './checkbox'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'

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

  it('色の無いフォルダは名前から9色の1つを決まった形で選ぶ（灰色の丸にしない・B-136）', () => {
    const palette: string[] = FOLDER_SELECT_COLORS.map((c) => c.value)
    const a = folderDisplayColor({ name: '会員', color: null })
    expect(palette).toContain(a)
    expect(folderDisplayColor({ name: '会員' })).toBe(a)
    expect(folderDisplayColor({ name: '会員', color: '#123456' })).toBe('#123456')
    const names = ['購入', '紹介', '配信の反応', 'VIP', '季節', '店頭', '01_キャンペーン', 'セール', '新商品', '定期便']
    expect(new Set(names.map((name) => folderDisplayColor({ name }))).size).toBeGreaterThan(3)
    const html = renderToStaticMarkup(<FolderDot folder={{ name: '会員', color: null }} />)
    expect(html).toContain(`background-color:${a}`)
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
    expect(html.indexOf('data-folder-dot')).toBeLessThan(html.indexOf('>NEN会員'))
  })

  it('B-194: dot={false} の古い指定でも丸と名前の1行を出す', () => {
    const html = renderToStaticMarkup(<FolderDotName folder={{ name: '会員', color: '#e07b24' }} dot={false}>NEN会員</FolderDotName>)
    expect(html).toContain('data-folder-dot')
    expect(html).toContain('title="NEN会員"')
  })

  it('リンク内の省略部品にも、名前の全文を残す', () => {
    const name = 'Google広告から来た夏キャンペーンのお客さま'
    const html = renderToStaticMarkup(<FolderDotName><a href="/inflow-links/detail?id=one"><TruncatedText value={name} /></a></FolderDotName>)
    expect(html).toContain(`data-list-name="" title="${name}"`)
    expect(html).toContain('href="/inflow-links/detail?id=one"')
  })

  it('行を選ぶチェックは省略する名前の外に出し、操作と全文を保つ', () => {
    const html = renderToStaticMarkup(<FolderDotName><Checkbox aria-label="資料を選ぶ" checked={false} onCheckedChange={() => {}} /><button>資料をダウンロードした</button></FolderDotName>)
    expect(html).toContain('aria-label="資料を選ぶ"')
    expect(html.indexOf('aria-label="資料を選ぶ"')).toBeLessThan(html.indexOf('data-folder-dot'))
    expect(html).toContain('title="資料をダウンロードした"')
    expect(html).toContain('<button>資料をダウンロードした</button>')
  })

  it('大きさ 8・名前との間 8・説明の行の字下げ 16 は変数で持つ', () => {
    expect(globals).toMatch(/--tpl-folder-dot-size: 8px; --tpl-folder-dot-gap: 8px; --tpl-folder-dot-indent: 16px;/)
    expect(css).toContain('width: var(--tpl-folder-dot-size)')
    expect(css).toContain('gap: var(--tpl-folder-dot-gap)')
  })

  it('色が空のフォルダも9色のどれかで塗る。同じ名前なら左の列と表で同じ色（2026-10-09 オーナー）', () => {
    const palette = FOLDER_SELECT_COLORS.map((color) => color.value as string)
    const auto = folderDisplayColor({ name: 'テスト', color: null })
    expect(palette).toContain(auto)
    expect(folderDisplayColor({ name: 'テスト' })).toBe(auto)
    expect(folderDisplayColor({ name: 'テスト', color: '#ef4444' })).toBe('#ef4444')
    expect(renderToStaticMarkup(<FolderDot folder={{ name: 'テスト', color: null }} />)).toContain(`background-color:${auto}`)
    const names = ['テスト', 'テスト1', '会員', 'VIP', '購入', '休眠']
    expect(new Set(names.map((name) => folderDisplayColor({ name }))).size).toBeGreaterThan(1)
  })
})
