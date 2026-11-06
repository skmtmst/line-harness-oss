import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'

const read = name => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8')
const globals = read('app/globals.css').replace(/@theme\s*\{/g, ':root {')
const css = read('components/shared/verification-list.module.css')
const badge = read('components/shared/status-badge.module.css')

test('接続のチェック行は詰まった自然高を保ち、固定56の故障を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${globals}${badge}${css}*{box-sizing:border-box}</style>
        <ol class="list" style="width:600px">
          <li class="row" data-verification-state="passed"><svg class="icon" width="16" height="16"></svg><strong class="title">チャネル</strong><span class="detail">認証済み</span><span class="badge success">通った</span></li>
          <li class="row" data-verification-state="todo"><svg class="icon" width="16" height="16"></svg><strong class="title">追加URL</strong><span class="detail">接続してから確かめます</span><span class="badge warning">まだ</span></li>
        </ol>`)
      const highRows = () => page.locator('.row').evaluateAll(rows => rows.filter(row => row.getBoundingClientRect().height > 48).length)
      assert.equal(await highRows(), 0)
      const fault = await page.addStyleTag({ content: '.row{height:56px!important}' })
      assert.equal(await highRows(), 2)
      await fault.evaluate(element => element.remove())
      assert.equal(await highRows(), 0)
      const edge = await page.locator('.row').evaluateAll(rows => rows.map(row => {
        const title = row.querySelector('.title').getBoundingClientRect(), detail = row.querySelector('.detail').getBoundingClientRect(), badge = row.querySelector('.badge').getBoundingClientRect()
        return { titleEnd: title.right, detailStart: detail.left, detailEnd: detail.right, badgeStart: badge.left }
      }))
      for (const row of edge) assert.ok(row.detailStart > row.titleEnd && row.badgeStart > row.detailEnd)
    }
  } finally { await browser.close() }
})

test('失敗の長い説明は行を伸ばして全文を残す', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${globals}${badge}${css}*{box-sizing:border-box}</style>
      <ol class="list" style="width:420px"><li class="row" data-verification-state="failed"><svg class="icon" width="16" height="16"></svg><strong class="title">Webhook</strong><span class="detail">${'LINE Developersで設定を確認してください。'.repeat(5)}</span><span class="badge neutral">止まった</span></li></ol>`)
    const detail = await page.locator('.detail').evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight, wrap: getComputedStyle(element).whiteSpace }))
    assert.equal(detail.wrap, 'normal')
    assert.equal(detail.scroll, detail.client)
    assert.ok(await page.locator('.row').evaluate(element => element.getBoundingClientRect().height) > 48)
  } finally { await browser.close() }
})
