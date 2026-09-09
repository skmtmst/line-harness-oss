/*
 * #678 LINE通知画面の実ブラウザ検査。再実行できる形で残す。
 *
 *   pnpm --filter web build            # apps/web/out を作る
 *   node apps/web/src/app/line-notifications/line-notifications-browser-behavior.mjs
 *
 * 実物のChromeで、実物のCSSと実物のReactを動かして次を確かめる。
 *   1. 375px級で、編集画面の主要操作が画面の外へ出ないこと（寸法検査）
 *   2. 保存中に足した入力が、古い応答で端末の控えごと消えないこと（競合1）
 *   3. A保存中→B→A→再編集のあとに古いAの応答が返っても消えないこと（競合2）
 *
 * apps/web/src/app/automations/automation-browser-behavior.mjs と同じ作りにしている。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'

const outDir = join(process.cwd(), 'apps/web/out')
if (!existsSync(outDir)) {
  throw new Error('apps/web/out がありません。先に pnpm --filter web build を実行してください。')
}

function contentType(path) {
  return ({
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
  })[extname(path)] ?? 'application/octet-stream'
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\//, '')
  const plain = join(outDir, relative || 'index.html')
  const candidates = extname(plain) ? [plain] : [`${plain}.html`, join(plain, 'index.html')]
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (!file) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  response.writeHead(200, { 'content-type': contentType(file) })
  createReadStream(file).pipe(response)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('テスト用サーバのポートを取得できません')
const baseUrl = `http://127.0.0.1:${address.port}`

const accounts = [
  { id: 'account-a', channelId: 'channel-a', name: 'A店', displayName: 'A店', isActive: true, country: 'JP', role: null, displayOrder: 0 },
  { id: 'account-b', channelId: 'channel-b', name: 'B店', displayName: 'B店', isActive: true, country: 'JP', role: null, displayOrder: 1 },
]

const EVENT_TYPE = 'ec_order.confirmed'

function notificationSetting(accountId) {
  return {
    eventType: EVENT_TYPE,
    label: '注文受付',
    isEnabled: true,
    title: `${accountId === 'account-b' ? 'B店' : 'A店'}の注文受付`,
    introText: `${accountId === 'account-b' ? 'B店' : 'A店'}の本文`,
    outroText: '結びの文章',
    category: 'order',
    buttonLabel: '注文を見る',
    buttonUrl: '',
    imageUrl: '',
    displayOrder: 0,
    fixedFields: ['注文番号', '商品名'],
    fixedPreview: '',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function customerDefinition(accountId) {
  return {
    id: `definition-${accountId}`,
    lineAccountId: accountId,
    name: '注文受付',
    category: 'order',
    sourceEventType: EVENT_TYPE,
    status: 'published',
    version: 4,
    currentVersionNumber: 3,
    draft: {
      title: `${accountId === 'account-b' ? 'B店' : 'A店'}の注文受付`,
      introText: `${accountId === 'account-b' ? 'B店' : 'A店'}の本文`,
      outroText: '結びの文章',
      buttonLabel: '注文を見る',
      buttonUrl: '',
      imageUrl: '',
      fixedFields: ['注文番号', '商品名'],
    },
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

async function openHarness(browser) {
  const state = { draftSaves: [], saveDelayMs: 0, holdSave: null }
  const context = await browser.newContext()
  await context.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'account-a')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('browser page error:', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('browser console:', message.text())
  })
  await page.route('**/admin/version', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: '0.24.0', worker_hash: 'test', admin_hash: 'test', liff_hash: 'test' }),
  }))
  await page.route('**/admin/manifest', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ latest: '0.24.0', releases: [] }),
  }))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const accountId = url.searchParams.get('lineAccountId') ?? 'account-a'
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    })

    if (path === '/api/auth/session') {
      return json({ success: true, data: { name: 'owner利用者', role: 'owner', permissionKeys: [] }, csrfToken: 'test-csrf' })
    }
    if (path === '/api/line-accounts') return json({ success: true, data: accounts })
    if (path === '/api/settings/features') {
      return json({ success: true, data: { features: {}, sidebarOrder: null, sidebarItemOrder: null, parentChildMode: false, specializedFeatureKeys: [], version: 1 } })
    }
    if (path === '/api/notifications/operator-rules') {
      return json({ success: true, data: { items: [], summary: { total: 7, published: 7, stopped: 0, missingRecipients: 0, recipients: 3, acceptedToday: 0, excludedToday: 0 } } })
    }
    if (path === '/api/ec-commerce/settings') return json({ success: true, data: [notificationSetting(accountId)] })
    if (path === '/api/ec-commerce/overview') {
      return json({ success: true, data: { last24h: 3, failed: 0, byType: [{ eventType: EVENT_TYPE, label: '注文受付', count: 3 }] } })
    }
    if (path === '/api/line-notifications/customer-definitions') {
      return json({ success: true, data: [customerDefinition(accountId)] })
    }
    if (path === '/api/line-notifications/metrics') return json({ success: true, data: { items: [] } })
    if (/\/customer-definitions\/[^/]+\/draft$/.test(path) && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      state.draftSaves.push(body?.draft?.introText ?? null)
      // 保存を握る。試験の側で「返す時刻」を決められるようにする。
      if (state.holdSave) await state.holdSave
      if (state.saveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.saveDelayMs))
      return json({ success: true, data: { ...customerDefinition(body?.lineAccountId ?? 'account-a'), version: 5, draft: body?.draft ?? {} } })
    }
    return json({ success: true, data: [] })
  })
  return { context, page, state }
}

async function openEditor(page) {
  await page.goto(`${baseUrl}/line-notifications`)
  const editRow = page.getByRole('button', { name: '内容を編集' })
  await editRow.first().waitFor({ timeout: 15_000 })
  await editRow.first().click()
  await page.getByRole('button', { name: '下書きを保存' }).waitFor({ timeout: 15_000 })
}

const introBox = (page) => page.locator('label', { hasText: 'ご案内文' }).locator('textarea')
const draftKey = (accountId) => `line-notifications:draft:v1:${accountId}:${EVENT_TYPE}`

const browser = await chromium.launch({ headless: true })
try {
  {
    /*
     * 1. 375px級の寸法検査。
     * 主要操作のボタンが1つでも画面の右端を越えたら、その幅では押せない。
     */
    const { context, page } = await openHarness(browser)
    await openEditor(page)
    const widths = [375, 390, 768, 1440, 1920]
    for (const width of widths) {
      await page.setViewportSize({ width, height: 812 })
      await page.waitForTimeout(150)
      const measured = await page.evaluate(() => {
        const actions = document.querySelector('[data-design="editor-footer-actions"]')
        const footer = document.querySelector('[data-design="editor-footer"]')
        const main = document.querySelector('[data-design-node="Q55bb"]')
        const buttons = [...actions.querySelectorAll('button')].map((button) => {
          const rect = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          const probe = document.createElement('span')
          probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;'
          probe.style.font = style.font
          probe.style.letterSpacing = style.letterSpacing
          probe.textContent = button.textContent
          document.body.appendChild(probe)
          const needs = probe.getBoundingClientRect().width
            + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
          probe.remove()
          return { text: button.textContent.trim(), right: rect.right, width: rect.width, needs }
        })
        return {
          viewport: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          actionsWidth: actions.getBoundingClientRect().width,
          footerHeight: footer.getBoundingClientRect().height,
          mainPaddingBottom: parseFloat(getComputedStyle(main).paddingBottom),
          rows: new Set(buttons.map((button) => Math.round(button.right - button.width))).size,
          rightmost: Math.max(...buttons.map((button) => button.right)),
          squeezed: buttons.filter((button) => button.needs > button.width + 1).map((button) => button.text),
        }
      })
      console.log(`  ${width}px 操作列 ${Math.round(measured.actionsWidth)}px / 右端 ${Math.round(measured.rightmost)}px / フッタ ${Math.round(measured.footerHeight)}px / 下余白 ${measured.mainPaddingBottom}px`)
      assert.ok(measured.rightmost <= width + 1, `${width}px で主要操作が画面の外へ出ている（右端 ${Math.round(measured.rightmost)}px）`)
      assert.deepEqual(measured.squeezed, [], `${width}px でボタンの文字が枠に収まっていない`)
      assert.ok(measured.documentScrollWidth <= width + 1, `${width}px でページが横スクロールする`)
      assert.ok(
        measured.mainPaddingBottom >= measured.footerHeight,
        `${width}px で固定フッター（${Math.round(measured.footerHeight)}px）が本文の下余白（${measured.mainPaddingBottom}px）を越えている`,
      )
    }
    await context.close()
    console.log('375px 寸法検査: PASS')
  }

  {
    /*
     * 2. 競合1: 保存中の追加入力。
     * 保存を押したあとに書き足し、その後で古い保存応答を返す。
     * 端末の控えが消えず、再読込でも書き足した分が残ることを見る。
     */
    const { context, page, state } = await openHarness(browser)
    await openEditor(page)
    const intro = introBox(page)
    await intro.fill('保存を押した時点の本文')
    await page.waitForTimeout(100)

    let releaseSave = () => {}
    state.holdSave = new Promise((resolve) => { releaseSave = resolve })
    await page.getByRole('button', { name: '下書きを保存' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('未保存の変更があります'))

    // 保存の応答を止めたまま書き足す。
    await intro.fill('保存を押した時点の本文＋あとから足した一文')
    await page.waitForTimeout(100)
    releaseSave()
    await page.waitForTimeout(800)

    assert.deepEqual(state.draftSaves, ['保存を押した時点の本文'], '保存APIへ送ったのは押した時点の文面')
    const stored = await page.evaluate((key) => localStorage.getItem(key), draftKey('account-a'))
    assert.ok(stored, '保存中に足した入力の控えが端末から消えている')
    assert.ok(JSON.parse(stored).introText.includes('あとから足した一文'), '控えが古い文面へ戻っている')
    assert.ok(
      await page.getByText('未保存の変更があります').count() > 0,
      '書き足した分が未保存のままなのに、保存済みと表示している',
    )

    // 再読込しても書き足した分が残る。
    await page.reload()
    await page.getByRole('button', { name: '内容を編集' }).first().waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: '内容を編集' }).first().click()
    await introBox(page).waitFor()
    assert.equal(
      await introBox(page).inputValue(),
      '保存を押した時点の本文＋あとから足した一文',
      '再読込で、保存中に足した入力が消えている',
    )
    await context.close()
    console.log('競合1（保存中の追加入力）: PASS')
  }

  {
    /*
     * 3. 競合2: A保存中 → B → A → 再編集 → 古いAの応答。
     * 戻ってから書き直した文面を、古い応答が消さないことを見る。
     */
    const { context, page, state } = await openHarness(browser)
    await openEditor(page)
    await introBox(page).fill('Aで保存を押した時点の本文')
    await page.waitForTimeout(100)

    let releaseSave = () => {}
    state.holdSave = new Promise((resolve) => { releaseSave = resolve })
    await page.getByRole('button', { name: '下書きを保存' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('未保存の変更があります'))

    // 編集画面は開いたまま、見ているアカウントだけが替わる。
    const accountSelect = page.getByLabel('LINEアカウント')
    const introValue = () => page.evaluate(() => {
      const box = document.querySelector('main[data-design-node="Q55bb"] textarea')
      return box ? box.value : null
    })
    const waitForIntro = async (expected) => {
      await page.waitForFunction((want) => {
        const box = document.querySelector('main[data-design-node="Q55bb"] textarea')
        return Boolean(box) && box.value === want
      }, expected, { timeout: 15_000 })
    }

    await accountSelect.selectOption('account-b')          // A → B
    await waitForIntro('B店の本文')
    await accountSelect.selectOption('account-a')          // B → A
    // Aへ戻ると、端末に残した控えが復元される。
    await waitForIntro('Aで保存を押した時点の本文')
    assert.equal(await introValue(), 'Aで保存を押した時点の本文')
    await introBox(page).fill('Aへ戻って書き直した本文')
    await page.waitForTimeout(100)

    releaseSave()                                          // ここで古いAの応答が返る
    await page.waitForTimeout(800)

    const stored = await page.evaluate((key) => localStorage.getItem(key), draftKey('account-a'))
    assert.ok(stored, '戻ってから書き直した控えが、古い応答で消えている')
    assert.equal(JSON.parse(stored).introText, 'Aへ戻って書き直した本文', '控えが古い文面へ戻っている')
    assert.equal(await introBox(page).inputValue(), 'Aへ戻って書き直した本文', '画面の文面が古い応答で戻っている')
    assert.ok(
      await page.getByText('未保存の変更があります').count() > 0,
      '書き直した分が未保存のままなのに、保存済みと表示している',
    )
    await context.close()
    console.log('競合2（A保存中→B→A→再編集）: PASS')
  }

  console.log('line notifications browser behavior: PASS')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
