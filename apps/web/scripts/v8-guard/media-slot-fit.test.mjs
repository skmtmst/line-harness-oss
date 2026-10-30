import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

/*
 * 画像を置く欄（MediaSlot）の空の箱に、中身が余裕を持って収まる。
 *
 * リッチメニューを作る（形と画像の段）の画像欄は、箱 180×140 に対して
 * 中身（印・題・説明2行・制限・登録メディアのリンク）が収まらず、印が
 * 上の線で切れていた。中身が箱をはみ出す・上下の余白が無いと赤。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../out')
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

/** 箱の中身の上下の余白の最低（px）。詰まりを見逃さない程度。 */
const MIN_PAD = 8

let server, base
before(async () => {
  assert.ok(existsSync(join(root, 'version.json')), '本物の静的出力を先に組み立てる')
  server = createServer((req, res) => {
    const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`)
    const file = [path, `${path}.html`, join(path, 'index.html')].find(file => file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile())
    if (!file) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise(done => server.close(done)))

async function openPage(browser, route, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await stubApi(page, mockFetch)
  await page.addInitScript((init) => {
    for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value)
  }, PARITY_INIT)
  const response = await page.goto(`${base}${route}`)
  assert.ok(response?.ok(), `${route} が開けない`)
  await page.waitForLoadState('networkidle')
  return page
}

/** 空の箱ごとに、中身のはみ出しと上下の余白を測る。 */
async function measureSlots(page) {
  return page.evaluate(() => {
    const out = []
    for (const frame of document.querySelectorAll('[data-media-slot][data-state="empty"]')) {
      const fr = frame.getBoundingClientRect()
      if (fr.width === 0 || fr.height === 0) continue
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity
      for (const el of frame.querySelectorAll('*')) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (style.position === 'absolute' || style.position === 'fixed') continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
        left = Math.min(left, r.left); right = Math.max(right, r.right)
      }
      if (top === Infinity) continue
      out.push({
        label: frame.getAttribute('aria-label') ?? '',
        frame: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right },
        content: { top, bottom, left, right },
      })
    }
    return out
  })
}

for (const width of [1152, 1440]) {
  test(`空の画像欄の中身は箱に収まり上下に余白がある（${width}）`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await openPage(browser, '/rich-menus/new', width)
      try {
        const slots = await measureSlots(page)
        assert.ok(slots.length > 0, '空の画像欄が無い（偽APIの応答を確認）')
        const failures = []
        for (const slot of slots) {
          const { frame, content, label } = slot
          if (content.top < frame.top - 0.5 || content.bottom > frame.bottom + 0.5 || content.left < frame.left - 0.5 || content.right > frame.right + 0.5) {
            failures.push(`「${label}」の中身が箱をはみ出す（箱 ${Math.round(frame.top)}-${Math.round(frame.bottom)}・中身 ${Math.round(content.top)}-${Math.round(content.bottom)}）`)
            continue
          }
          if (content.top - frame.top < MIN_PAD || frame.bottom - content.bottom < MIN_PAD) {
            failures.push(`「${label}」の上下の余白が足りない（上 ${Math.round(content.top - frame.top)}・下 ${Math.round(frame.bottom - content.bottom)}）`)
          }
        }
        assert.deepEqual(failures, [])
      } finally { await page.close() }
    } finally { await browser.close() }
  })
}
