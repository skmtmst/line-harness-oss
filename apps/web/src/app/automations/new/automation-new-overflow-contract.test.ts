import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { ActionRow } from '@/components/shared/action-list'
import styles from '@/components/shared/action-list.module.css'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '../../../components/shared/action-list.module.css'), 'utf8')
  .replace(/\.([a-zA-Z][\w-]*)/g, (selector, name: string) => styles[name] ? `.${styles[name]}` : selector)
const globals = readFileSync(join(HERE, '../../globals.css'), 'utf8')
const row = renderToStaticMarkup(createElement(ActionRow, {
  title: '本人にLINEで知らせる', kind: 'LINE', number: 1, open: true, onToggle: () => {}, extra: '成果1件ごとに',
}, createElement('input', { 'aria-label': 'すること', defaultValue: 'LINEで知らせる' }), createElement('input', { 'aria-label': '対象', defaultValue: '付けるタグ' })))
const html = `<style>${globals}${css}body{margin:0}</style><div data-theme="v8"><main style="width:calc(100% - 48px);margin:24px">${row}</main></div>`

/*
 * #973 U023: 自動化の新規作成（/automations/new）で
 * 「すること」と「付けるタグ」などの対象設定が2列のまま潰れていた。
 * 旧クラス文字の固定でなく、実ActionRowの390pxの並びを守る。
 */
describe('自動化作成のはみ出し（#973 U023）', () => {
  it('狭い幅では名前と値を2段目に折り返し、右端を越えない（故障対照付き）', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
      await page.setContent(html)
      const positions = () => page.evaluate(() => {
        const name = document.querySelector('[data-action-name]')!.getBoundingClientRect()
        const icon = document.querySelector('[data-action-row] svg')!.getBoundingClientRect()
        const value = document.querySelector('[data-action-value]')!.getBoundingClientRect()
        return { nameTop: name.top, iconBottom: icon.bottom, valueTop: value.top, nameBottom: name.bottom, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      const good = await positions()
      expect(good.nameTop).toBeGreaterThan(good.iconBottom)
      expect(good.valueTop).toBeGreaterThanOrEqual(good.nameBottom)
      expect(good.overflow).toBe(0)
      await page.addStyleTag({ content: `.${styles.details}{flex-basis:auto!important;flex-wrap:nowrap!important;order:0!important}` })
      const broken = await positions()
      expect(broken.nameTop <= broken.iconBottom || broken.valueTop < broken.nameBottom || broken.overflow > 0).toBe(true)
    } finally { await browser.close() }
  })

  it('設定欄は縦に並び、190px+260pxの2列へ戻す故障を検出する', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
      await page.setContent(html)
      const positions = () => page.locator('input').evaluateAll(inputs => inputs.map(input => {
        const r = input.getBoundingClientRect(); return { x: r.left, top: r.top, bottom: r.bottom, right: r.right }
      }))
      const good = await positions()
      expect(good).toHaveLength(2)
      expect(good[1].top).toBeGreaterThan(good[0].bottom)
      expect(good[1].x).toBe(good[0].x)
      expect(good.every(r => r.right <= 390)).toBe(true)
      await page.addStyleTag({ content: `.${styles.editor}{display:grid!important;grid-template-columns:190px 260px!important}` })
      const broken = await positions()
      expect(broken[1].top < broken[0].bottom || broken.some(r => r.right > 390)).toBe(true)
    } finally { await browser.close() }
  })
})
