import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'

const read = name => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8')
const globals = read('app/globals.css').replace(/@theme\s*\{/g, ':root {')
const shell = content => `<style>${globals}*{box-sizing:border-box}</style>${content}`

test('状態の札は5色・点6px・丸・文字の幅を保ち、縦の親でも帯へ伸びない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      const tones = ['neutral', 'success', 'warning', 'danger', 'info']
      await page.setContent(shell(`<style>${read('components/shared/status-badge.module.css')}</style><main style="display:flex;flex-direction:column;width:600px">${tones.map(tone => `<span class="badge ${tone}" data-tone="${tone}">確認済み</span>`).join('')}<span class="badge noDot" data-tone="neutral">変わる</span></main>`))
      const rows = await page.locator('.badge').evaluateAll(elements => elements.map(el => {
        const css = getComputedStyle(el), dot = getComputedStyle(el, '::before')
        return { width: el.getBoundingClientRect().width, ink: css.color, radius: css.borderRadius, dot: dot.backgroundColor, dotSize: dot.width, content: dot.content }
      }))
      const inks = ['rgb(71, 85, 105)', 'rgb(8, 122, 62)', 'rgb(194, 65, 12)', 'rgb(185, 28, 28)', 'rgb(29, 78, 216)']
      const dots = ['rgb(148, 163, 184)', 'rgb(22, 163, 74)', 'rgb(249, 115, 22)', 'rgb(239, 68, 68)', 'rgb(37, 99, 235)']
      rows.slice(0, 5).forEach((row, index) => {
        assert.ok(row.width < 150, `状態の札が親へ伸びた: ${row.width}`)
        assert.equal(row.ink, inks[index])
        assert.equal(row.dot, dots[index])
        assert.equal(row.dotSize, '6px')
        assert.ok(parseFloat(row.radius) >= 999)
      })
      assert.equal(rows[5].content, 'none', '明示した点なしの例外は残す')
      await page.addStyleTag({ content: '.badge{width:100%!important}' })
      assert.equal(await page.locator('.badge').first().evaluate(el => el.getBoundingClientRect().width), 600)
    }
  } finally { await browser.close() }
})

test('5つの段階名を省略付き1行で残し、丸・接続線・全文の入口を保つ', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      const labels = ['利用規約への同意', '店舗の基本情報', 'LINE公式アカウントを作る', 'Messaging APIで接続', '接続を確認']
      const steps = labels.map((label, index) => `<li class="item">${index ? '<span class="line"></span>' : ''}<span class="step" title="${label}"><span class="dot" data-step-dot="${index === 1 ? 'current' : 'todo'}">${index + 1}</span><span class="name" data-step-name="${index === 1 ? 'current' : 'todo'}">${label}</span></span></li>`).join('')
      // 以前のResizeObserverが付けていたcompact状態でも、他の段階名を消さない。
      await page.setContent(shell(`<style>${read('components/templates/steps.module.css')}</style><main style="width:calc(100vw - 300px)"><nav class="root" data-compact><ol class="list">${steps}</ol></nav></main>`))
      const measure = () => page.locator('nav').evaluate(nav => {
        const rect = nav.getBoundingClientRect()
        return [...nav.querySelectorAll('.name')].map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right, limit: rect.right, title: el.parentElement.title, text: el.textContent, overflow: getComputedStyle(el).textOverflow, whiteSpace: getComputedStyle(el).whiteSpace }))
      })
      const rows = await measure()
      rows.forEach(row => {
        assert.ok(row.width > 12, `${row.text}の名前が消えた`)
        assert.ok(row.right <= row.limit + 1, `${row.text}が右端を越えた`)
        assert.equal(row.title, row.text)
        assert.equal(row.whiteSpace, 'nowrap')
        assert.equal(row.overflow, 'ellipsis')
      })
      assert.equal(new Set(rows.map(row => row.height)).size, 1)
      await page.addStyleTag({ content: '.name:not([data-step-name="current"]){position:absolute;width:1px;height:1px;overflow:hidden}' })
      assert.ok((await measure()).filter(row => row.width <= 1).length > 0, '段階名を隠す故障を検出できる')
    }
  } finally { await browser.close() }
})
