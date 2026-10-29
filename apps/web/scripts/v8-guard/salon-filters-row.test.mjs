import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectGuardBrowser } from './browser-session.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

/*
 * サロンの盤の日付の段（B27/B28 を本物の静的出力で見る）。
 *
 * 1152 では白い板が 1100 未満になり折り返しが有効化されるが、日付の段は
 * 1段に保つ（読み直すを2段目へ落とさない）。担当の欄は4字名が入る幅。
 * 書体の差でぶれないよう、同じ行・表示/非表示・欄幅・はみ出しだけを見る。
 * 文言の切れ（数の帯の補足）は unit 試験と前後写真で守る。
 */
const root = resolve(fileURLToPath(new URL('../../out/', import.meta.url)))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

/* 盤の業種だけサロンへ寄せ、他は本物の応答器に任せる。 */
async function salonFetch(method, path) {
  const answered = await mockFetch(method, path)
  if (method === 'GET' && path.startsWith('/api/dashboard/style') && answered.status === 200) {
    try {
      const body = JSON.parse(answered.body)
      if (body?.data) {
        body.data.style = 'salon'
        body.data.styleSelected = true
        return { ...answered, body: JSON.stringify(body) }
      }
    } catch { /* 壊れた応答はそのまま運ぶ */ }
  }
  return answered
}

function measure() {
  const reload = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '読み直す')
  const staff = document.querySelector('[aria-label="担当"]')
  const updated = [...document.querySelectorAll('span')].find((el) => /^更新 \d/.test(el.textContent.trim()))
  const staffField = (() => {
    let node = staff?.closest('[data-entity-picker-field]')?.parentElement?.closest('[data-entity-picker-field]')
    return node ?? null
  })()
  const box = (el) => {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { y: rect.y, width: rect.width, hidden: rect.width === 0 && rect.height === 0 }
  }
  return {
    reload: box(reload),
    staff: box(staff),
    staffFieldWidth: staffField ? staffField.getBoundingClientRect().width : null,
    updatedHidden: !updated || updated.getBoundingClientRect().width === 0,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
}

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

async function open(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await stubApi(page, salonFetch)
  await page.addInitScript((init) => {
    for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value)
  }, PARITY_INIT)
  const response = await page.goto(`${base}/`)
  assert.ok(response?.ok())
  await page.getByRole('button', { name: '読み直す', exact: true }).waitFor()
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  return page
}

test('1152 で日付の段は1段・担当欄は143px以上・横はみ出しなし（B27/B28）', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await open(browser, 1152)
    try {
      const row = await page.evaluate(measure)
      assert.ok(row.reload && row.staff, `日付の段が描かれない ${JSON.stringify(row)}`)
      assert.ok(Math.abs(row.reload.y - row.staff.y) <= 2, `読み直すが段落ちした ${JSON.stringify(row)}`)
      assert.ok(row.updatedHidden, `狭い板で更新時刻を隠さない ${JSON.stringify(row)}`)
      assert.ok(row.staffFieldWidth !== null && row.staffFieldWidth >= 143, `担当欄が狭い ${JSON.stringify(row)}`)
      assert.ok(row.pageOverflow <= 0, `横にはみ出す ${JSON.stringify(row)}`)
      // 故障の検出：更新時刻を戻すと読み直すが落ち、担当欄を戻すと幅が足りない。
      await page.evaluate(() => {
        const updated = [...document.querySelectorAll('span')].find((el) => /^更新 \d/.test(el.textContent.trim()))
        if (updated) updated.style.setProperty('display', 'inline', 'important')
      })
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      const broken = await page.evaluate(measure)
      assert.ok(Math.abs(broken.reload.y - broken.staff.y) > 2, '更新時刻を戻した故障を検出する')
      await page.evaluate(() => {
        const updated = [...document.querySelectorAll('span')].find((el) => /^更新 \d/.test(el.textContent.trim()))
        if (updated) updated.style.removeProperty('display')
      })
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      const fixed = await page.evaluate(measure)
      assert.ok(Math.abs(fixed.reload.y - fixed.staff.y) <= 2, '更新時刻を隠すと段が戻る')
    } finally { await page.close() }
  } finally { await browser.close() }
})

test('1440 では更新時刻を出したまま日付の段は1段', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await open(browser, 1440)
    try {
      const row = await page.evaluate(measure)
      assert.ok(row.reload && row.staff, `日付の段が描かれない ${JSON.stringify(row)}`)
      assert.ok(Math.abs(row.reload.y - row.staff.y) <= 2, `読み直すが段落ちした ${JSON.stringify(row)}`)
      assert.ok(!row.updatedHidden, `広い板で更新時刻が消えた ${JSON.stringify(row)}`)
      assert.ok(row.pageOverflow <= 0, `横にはみ出す ${JSON.stringify(row)}`)
    } finally { await page.close() }
  } finally { await browser.close() }
})
