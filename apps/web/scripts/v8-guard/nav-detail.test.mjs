import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

/*
 * 左のメニューとページ送りの細部（本物の静的出力で見る）。
 *
 * 左のメニューを流した時、会社名の下に空の帯を作らない。
 * 流した時、会社名の塊の下の端と最初に見える項目の上の端の間は 0〜8px。
 * 流した時だけ境目の線を出し、上にいる時は出さない。
 * 開いている組の「⌄」は乗せた時と焦点の時だけ、畳んだ組の「›」は出したまま。
 * ページ送りの今のページは薄い灰の地＋太字、ほかの番号は枠なし、端の矢印だけ薄い。
 * SIDEBAR_SHOTS にフォルダを渡すと、上・途中・一番下の絵を残す。
 */
const root = resolve(new URL('../../out/', import.meta.url).pathname)
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

function measure() {
  const aside = [...document.querySelectorAll('aside[data-design-node="J33xq"]')].find(el => el.getBoundingClientRect().width > 0)
  const nav = aside.querySelector('nav[data-sidebar-scroll]')
  const identity = aside.querySelector('[data-design-node="J33xq/V2WbXF"]')
  const box = nav.getBoundingClientRect()
  const style = getComputedStyle(nav)
  const contentTop = box.top + parseFloat(style.borderTopWidth)
  const first = [...nav.querySelectorAll('a, button')]
    .filter(el => !el.closest('[inert]'))
    .map(el => el.getBoundingClientRect())
    .find(rect => rect.height > 0 && rect.bottom > contentTop + 1)
  return {
    scrollable: nav.scrollHeight > nav.clientHeight + 1,
    scrollTop: nav.scrollTop,
    partial: first.top < contentTop - 0.5,
    gap: Math.max(first.top, contentTop) - identity.getBoundingClientRect().bottom,
    regionGap: contentTop - identity.getBoundingClientRect().bottom,
    paddingTop: style.paddingTop,
    scrolled: nav.hasAttribute('data-scrolled'),
    line: style.borderTopColor,
    lineWidth: parseFloat(style.borderTopWidth),
    mask: style.maskImage || style.webkitMaskImage || 'none',
  }
}

const transparent = color => color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color)

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

async function open(browser, width, collapsed = '0', touch = false) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, reducedMotion: 'reduce', hasTouch: touch, isMobile: touch })
  await stubApi(page, mockFetch)
  await page.addInitScript(([init, folded]) => {
    for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value)
    if (folded !== null) localStorage.setItem('lh-sidebar-collapsed', folded)
  }, [PARITY_INIT, collapsed])
  const response = await page.goto(`${base}/friends`)
  assert.ok(response?.ok())
  await page.waitForLoadState('networkidle')
  return page
}

test('左のメニューを流しても会社名の下に空の帯を作らず、流した時だけ境目の線を出す', async () => {
  const shots = process.env.SIDEBAR_SHOTS
  if (shots) mkdirSync(shots, { recursive: true })
  const browser = await connectGuardBrowser()
  try {
    const cases = [
      { name: 'open-1152', width: 1152, collapsed: '0' },
      { name: 'open-1440', width: 1440, collapsed: '0' },
      { name: 'collapsed-1440', width: 1440, collapsed: '1' },
      { name: 'auto-1024', width: 1024, collapsed: null },
    ]
    for (const { name, width, collapsed } of cases) {
      const page = await open(browser, width, collapsed)
      try {
        const nav = page.locator('aside[data-design-node="J33xq"]:visible nav[data-sidebar-scroll]')
        await nav.waitFor()
        if (collapsed !== '0') await page.locator('aside[data-design-node="J33xq"][data-collapsed]:visible').waitFor()
        const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
        for (const position of ['top', 'middle', 'middle-late', 'bottom']) {
          await nav.evaluate((el, at) => {
            const max = el.scrollHeight - el.clientHeight
            el.scrollTop = at === 'top' ? 0 : at === 'middle' ? max * 0.43 : at === 'middle-late' ? max * 0.71 : max
            el.dispatchEvent(new Event('scroll'))
          }, position)
          await settle(); await settle()
          const row = await page.evaluate(measure)
          const label = `${name} ${position} ${JSON.stringify(row)}`
          assert.ok(row.scrollable, `${label}: 試験の高さでは流れる長さが要る`)
          assert.ok(!/^linear-gradient\([^,]*,\s*(transparent|rgba\(0, 0, 0, 0\))/.test(row.mask), `${label}: 上の端で項目を隠さない`)
          if (position === 'top') {
            assert.equal(row.scrolled, false, label)
            assert.ok(row.lineWidth === 0 || transparent(row.line), `${label}: 上にいる時は境目の線を出さない`)
            assert.ok(row.gap >= 0 && row.gap <= 16, `${label}: 上にいる時は絵の余白（16px まで）だけ`)
          } else {
            assert.ok(row.scrollTop > 1, label)
            assert.equal(row.scrolled, true, label)
            assert.ok(row.lineWidth >= 1 && !transparent(row.line), `${label}: 流した時は境目の線を出す`)
            assert.ok(row.regionGap >= 0 && row.regionGap <= 8, `${label}: 流した時、会社名の下端と流れる領域の上端の間は 0〜8px`)
          }
          await nav.evaluate(el => { el.style.marginTop = '24px' })
          await settle()
          const broken = await page.evaluate(measure)
          assert.ok(broken.regionGap > 8, '会社名の下に空きが戻った故障を検出する')
          await nav.evaluate((el, top) => { el.style.removeProperty('margin-top'); el.scrollTop = top }, row.scrollTop)
          await settle()
          assert.equal((await page.evaluate(measure)).regionGap, row.regionGap, '空きを戻すと測定も復元する')
          if (shots) {
            writeFileSync(join(shots, `${name}-${position}.json`), JSON.stringify(row, null, 2) + '\n')
            await page.screenshot({ path: join(shots, `${name}-${position}.png`) })
          }
        }
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})

test('左のメニューの「⌄」は乗せた時と焦点の時だけ、畳んだ組の「›」は出したまま', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await open(browser, 1440)
    const toggles = page.locator('aside[data-design-node="J33xq"]:visible nav[data-sidebar-scroll] button[aria-expanded]')
    const chevronOpacity = toggle => toggle.evaluate(el => Number(getComputedStyle(el.querySelector('svg')).opacity))
    const first = toggles.first(), second = toggles.nth(1)
    await page.mouse.move(1000, 400)
    assert.equal(await first.getAttribute('aria-expanded'), 'true')
    assert.equal(await chevronOpacity(first), 0, '開いている組の印は普段は出さない')
    await first.hover()
    assert.equal(await chevronOpacity(first), 1, '乗せた時は出す')
    await page.mouse.move(1000, 400)
    await second.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    assert.equal(await chevronOpacity(second), 1, 'キーボードの焦点の時は出す')
    await second.click()
    assert.equal(await second.getAttribute('aria-expanded'), 'false')
    await page.mouse.move(1000, 400)
    await page.locator('main').first().focus().catch(() => {})
    await page.evaluate(() => document.activeElement?.blur())
    assert.equal(await chevronOpacity(second), 1, '畳んだ組の「›」は出したまま')
    await page.close()
  } finally { await browser.close() }
})

test('ページ送りの今のページは薄い灰の地＋太字、ほかの番号は枠なし、端の矢印だけ薄い', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await open(browser, 1440)
    const pager = page.locator('nav[data-pagination]:visible').first()
    await pager.waitFor()
    const read = () => pager.evaluate(nav => {
      const look = el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, outline: s.outlineColor, outlineStyle: s.outlineStyle, shadow: s.boxShadow, opacity: Number(s.opacity) } }
      const current = nav.querySelector('[aria-current="page"]')
      const other = [...nav.querySelectorAll('button')].find(el => /^\d+$/.test(el.textContent.trim()) && el !== current)
      const [previous, next] = [nav.querySelector('button[aria-label*="前"]'), nav.querySelector('button[aria-label*="次"]')]
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim()
      const probe = document.createElement('span'); probe.style.color = ink; probe.style.backgroundColor = 'var(--color-canvas-sunken)'; document.body.append(probe)
      const inkRgb = getComputedStyle(probe).color, selectedBgRgb = getComputedStyle(probe).backgroundColor; probe.remove()
      return { current: look(current), other: look(other), previous: { ...look(previous), disabled: previous.disabled }, next: { ...look(next), disabled: next.disabled }, inkRgb, selectedBgRgb }
    })
    const row = await read()
    const label = JSON.stringify(row)
    assert.equal(row.current.bg, row.selectedBgRgb, `今のページは薄い灰の地 ${label}`)
    assert.equal(row.current.color, row.inkRgb, `今のページの数字は黒 ${label}`)
    assert.equal(row.current.weight, '700', label)
    assert.equal(row.current.shadow, 'none', label)
    assert.ok(row.other.outlineStyle === 'none' || /rgba\([^)]*,\s*0\)$/.test(row.other.outline), `ほかの番号は枠なし ${label}`)
    assert.equal(row.other.shadow, 'none', label)
    assert.equal(row.previous.disabled, true, label)
    assert.ok(row.previous.opacity < 1, `端の矢印は薄い ${label}`)
    assert.equal(row.next.disabled, false, label)
    assert.equal(row.next.opacity, 1, `押せる矢印は薄くしない ${label}`)
    await page.close()
  } finally { await browser.close() }
})

test('タッチ端末では開いているメニューの開け閉めの印を常時出す', async () => {
  const browser = await connectGuardBrowser()
  const page = await open(browser, 1152, '0', true)
  try {
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true)
    const arrow = page.locator('aside[data-design-node="J33xq"]:visible nav[data-sidebar-scroll] button[aria-expanded="true"] svg').first()
    const opacity = () => arrow.evaluate(el => Number(getComputedStyle(el).opacity))
    assert.equal(await opacity(), 1)
    await arrow.evaluate(el => { el.style.opacity = '0' })
    await assert.rejects(async () => assert.equal(await opacity(), 1), { name: 'AssertionError' })
    await arrow.evaluate(el => el.style.removeProperty('opacity'))
    assert.equal(await opacity(), 1)
  } finally { await page.close(); await browser.close() }
})
