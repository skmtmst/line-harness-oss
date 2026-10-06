import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Card from './card'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/*
 * Card の内側の余白の変わり形。
 * 画面の絵での段の箱（d9xoI「段 基本」・T9gblG「箱 CSVで書き出す」・
 * JB8V1「推薦カード」）は内側 20px。既定（なし・16・18）の合格は変えない。
 */
describe('Card の内側の余白（変わり形）', () => {
  it('spacious は内側 20px（絵の段の箱）', () => {
    const css = read('card.module.css')
    const rule = css.match(/\.paddingSpacious\s*{[^}]*}/s)
    expect(rule, 'spacious の指定がありません').toBeTruthy()
    expect(rule![0]).toMatch(/padding:\s*20px/)
    // 既定の余白は変えない。
    expect(css).toMatch(/\.paddingDefault\s*{[^}]*padding:\s*16px/s)
    expect(css).toMatch(/\.paddingRoomy\s*{[^}]*padding:\s*18px/s)
  })

  it('padding="spacious" で余白のクラスが付く', () => {
    const html = renderToStaticMarkup(<Card padding="spacious">中身</Card>)
    expect(html).toContain('paddingSpacious')
    // 既定（padding なし）は余白クラスを付けない。
    const plain = renderToStaticMarkup(<Card>中身</Card>)
    expect(plain).not.toContain('paddingSpacious')
    expect(plain).not.toContain('paddingDefault')
  })
})
