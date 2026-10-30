import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

/* 実行結果の頭：題の中央と右上のボタンの束の中央の差は 1px 以内（B14）。 */
for (const width of [1440, 1152]) test(`自動応答の実行結果は題と右上のボタンの中央がそろう ${width}`, async () => {
  const browser = await connectGuardBrowser()
  let page
  try {
    const adapter = { newPage: async options => { const page = await browser.newPage(options); await stubApi(page, mockFetch); return page } }
    page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route: '/auto-replies/runs?id=auto-reply-booking-change', width, stable: true, requireSuccess: true })
    await page.getByRole('heading', { name: /実行結果/ }).waitFor()
    const gap = await page.evaluate(() => {
      const head = document.querySelector('header[data-template-region="heading"]')
      const title = head?.querySelector('h1')
      const buttons = [...(head?.querySelectorAll('[data-page-heading-actions] button') ?? [])].filter((b) => b.getBoundingClientRect().height > 0)
      if (!title || buttons.length === 0) throw new Error('題か右上のボタンが無い')
      const tops = buttons.map((b) => b.getBoundingClientRect().top)
      const bottoms = buttons.map((b) => b.getBoundingClientRect().bottom)
      const t = title.getBoundingClientRect()
      return Math.abs((t.top + t.bottom) / 2 - (Math.min(...tops) + Math.max(...bottoms)) / 2)
    })
    assert.ok(gap <= 1, `題とボタンの中央の差は1px以内（実測 ${gap}px）`)
  } finally { await page?.close(); await browser.close() }
})
