/* ログイン情報付き通信の CORS を実ブラウザで検査する。
 * Chromium を用意した環境でだけ直接実行する（通常の scripts 試験にはブラウザを要求しない）。
 *   node scripts/visual-qa/speed-cors.browser.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { installStressApi, assertStressResponse } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'

const servers = []
const listen = async (server) => {
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('空きポートを取得できませんでした')
  return `http://127.0.0.1:${address.port}`
}
const browser = await chromium.launch()
try {
  const webUrl = await listen(createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<main>速度測定の試験</main>')
  }))
  const apiUrl = await listen(createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': webUrl,
      'Access-Control-Allow-Credentials': 'true',
    }).end(JSON.stringify({ success: true, data: { items: [{ id: 'f1' }], total: 1 } }))
  }))
  const page = await browser.newPage()
  const state = await installStressApi(page, { stub: false })
  await page.goto(webUrl)
  const rows = await page.evaluate(async (url) => {
    const response = await fetch(`${url}/api/friends`, { credentials: 'include' })
    const body = await response.json()
    return body.data.items.length
  }, apiUrl)
  assert.equal(rows, 2000)
  assert.equal(assertStressResponse(state), 2000)
} finally {
  await browser.close()
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
}
console.log("ログイン情報付き通信で2,000行を取得：合格")
