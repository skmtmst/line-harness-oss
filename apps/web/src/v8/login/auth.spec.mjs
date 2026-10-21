import { test, expect } from '@playwright/test'
import { waitForOverlayLayout } from '../../../../../scripts/browser/overlay-ready.mjs'
const mockPort = Number(process.env.TRAIN30_MOCK_PORT ?? 8788)
// Drain prefetches before removing interception; the build can use an HTTPS API.
test.afterEach(async ({ page }) => {
  await page.waitForLoadState('networkidle')
  await page.unrouteAll({ behavior: 'wait' })
})
async function openPrimaryAuthenticatedChallenge(page, path, token, method) {
  const nonce = crypto.randomUUID()
  await page.evaluate(({ nonce, path }) => sessionStorage.setItem('lh_login_handoff', JSON.stringify({ nonce, expires: Date.now() + 600000, kind: 'challenge', path })), { nonce, path })
  const fragment = new URLSearchParams({ lh_2fa: token, lh_method: method, lh_nonce: nonce })
  await page.goto(`${path}#${fragment}`)
}
const codes = ['7K2Q-9FXM','B4TN-6WJP','H8RD-3CVY','M5ZL-2QKA','P9XE-7NHU','T3GW-8BSC','Y6JA-4DRV','C2FN-5MXT']
for (const width of [1152,1440,1920]) test(`shared list tools and support actions stay usable at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  })
  for (const path of ['/auto-replies/runs?id=ar-2', '/friend-add-settings/runs', '/mileage/friends/detail?id=friend-1', '/ops/tenants', '/ops/support']) {
    await page.goto(path)
    await expect(page.locator('[data-list-toolbar]').first()).toBeVisible()
    if (path === '/ops/support') await expect(page.getByRole('button', { name: '返信する', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const main = document.querySelector('main'), bounds = main.getBoundingClientRect()
      const controls = [...main.querySelectorAll('[data-list-toolbar] button, [data-list-toolbar] input, [data-dialog-actions] button')]
        .map(el => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0)
      const clipped = controls.filter(({ rect }) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1).length
      let overlaps = 0
      for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
        const one = controls[a], two = controls[b]
        if (one.el.contains(two.el) || two.el.contains(one.el)) continue
        if (Math.min(one.rect.right, two.rect.right) - Math.max(one.rect.left, two.rect.left) > 1
          && Math.min(one.rect.bottom, two.rect.bottom) - Math.max(one.rect.top, two.rect.top) > 1) overlaps++
      }
      return { controls: controls.length > 0, clipped, overlaps, horizontalScroll: main.scrollWidth - main.clientWidth }
    })).toEqual({ controls: true, clipped: 0, overlaps: 0, horizontalScroll: 0 })
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`shared-tools-${path.replace(/\W/g, '-')}-${width}.png`) })
  }
})
async function centered(button) {
  await expect(button).toBeVisible()
  const position = await button.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const text = range.getBoundingClientRect(), box = el.getBoundingClientRect()
    return { align: getComputedStyle(el).justifyContent, delta: Math.abs(text.x + text.width/2 - box.x - box.width/2), width: box.width }
  })
  expect(position.align).toBe('center'); expect(position.delta).toBeLessThanOrEqual(1)
}
async function detailTypography(page, label) {
  const heading = page.getByRole('heading', { name: label, exact: true })
  const value = heading.locator('..').locator('strong')
  const typography = el => { const style = getComputedStyle(el); return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) } }
  const headingStyle = await heading.evaluate(typography)
  const valueStyle = await value.evaluate(typography)
  expect(headingStyle.size).toBeLessThanOrEqual(12)
  expect(valueStyle).toEqual({ size: 13, weight: 600 })
  expect(headingStyle.weight).toBeLessThan(valueStyle.weight)
}
for (const width of [1152,1440,1920]) test(`MFA input, one-time display and centered auth buttons at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  let submitted = null
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname
    let data
    if (path === '/api/auth/password/reset/check') data = { email: 'fixture@example.com' }
    if (path === '/api/auth/two-factor/setup') data = { provisioningUri: 'otpauth://totp/musubo:fixture?secret=JBSWY3DPEHPK3PXP&issuer=musubo', manualKey: 'JBSW Y3DP EHPK 3PXP' }
    if (path === '/api/auth/two-factor/setup/confirm') data = { recoveryCodes: codes }
    if (path === '/api/auth/two-factor/verify') { submitted = route.request().postDataJSON(); return route.fulfill({ status: 400, json: { success: false, error: 'コードが違います' } }) }
    if (data) return route.fulfill({ status: 200, json: { success: true, data } })
    // Every remaining API request is redirected to the local fixture server.
    return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  })
  await page.goto('/login'); await centered(page.getByRole('button', { name: 'ログイン', exact: true }))
  const brandStyle = await page.locator('[aria-hidden="true"]').filter({ hasText: 'm' }).first().evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color } })
  await page.goto('/password/reset?token=fixture-reset')
  await centered(page.getByRole('button', { name: 'パスワードを設定してログインへ' }))
  await openPrimaryAuthenticatedChallenge(page, '/login/two-factor', 'fixture-challenge', 'password')
  await expect(page.getByRole('textbox')).toHaveCount(6)
  const authLayout = await page.getByRole('group', { name: '認証コード（6桁）' }).evaluate(input => {
    const card = input.closest('section[data-auth-layout="admin"]')
    const heading = card.querySelector('h1').getBoundingClientRect()
    const box = card.getBoundingClientRect()
    const brand = card.previousElementSibling.getBoundingClientRect()
    const slots = input.getBoundingClientRect()
    return { titleInset: heading.x - slots.x, titleGap: slots.top - heading.bottom, brandGap: box.top - brand.bottom, inputRight: slots.right, cardRight: box.right }
  })
  expect(Math.abs(authLayout.titleInset)).toBeLessThanOrEqual(1)
  expect(authLayout.titleGap).toBeGreaterThan(0)
  expect(authLayout.titleGap).toBeLessThanOrEqual(48)
  expect(authLayout.brandGap).toBeGreaterThanOrEqual(16)
  expect(authLayout.inputRight).toBeLessThan(authLayout.cardRight)
  expect(await page.getByRole('group', { name: '認証コード（6桁）' }).evaluate(el => getComputedStyle(el.closest('[data-field-content-gap]')).gap)).toBe('12px')
  await centered(page.getByRole('button', { name: '確認してログイン', exact: true }))
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`verify-${width}.png`) })
  await page.getByRole('button', { name: '回復コードを使う' }).click()
  await expect(page.getByRole('textbox')).toHaveCount(8)
  const hint = page.getByText('控えた8個のうち、まだ使っていない1つを入れます。貼り付けもできます。', { exact: true })
  expect(await hint.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12)
  const back = page.getByRole('link', { name: 'ログインに戻る', exact: true })
  const method = page.getByRole('button', { name: '6桁のコードで入る', exact: true })
  const textStyle = el => { const style = getComputedStyle(el); return { size: style.fontSize, weight: style.fontWeight, color: style.color, background: style.backgroundColor } }
  expect(await back.evaluate(textStyle)).toEqual(await method.evaluate(textStyle))
  const mark = page.locator('main[data-auth-layout="admin"] > div:first-child > span[aria-hidden="true"]')
  expect(await mark.evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color } })).toEqual(brandStyle)
  expect(await page.getByRole('group', { name: '回復コード（8文字）' }).evaluate(el => getComputedStyle(el.closest('[data-field-content-gap]')).gap)).toBe('12px')
  await page.getByRole('textbox', { name: '1文字目' }).evaluate(el => {
    const event = new Event('paste', { bubbles: true }); Object.defineProperty(event, 'clipboardData', { value: { getData: () => '7k2q-9fxm' } }); el.dispatchEvent(event)
  })
  await expect(page.getByRole('textbox', { name: '8文字目' })).toHaveValue('M')
  await centered(page.getByRole('button', { name: '確認してログイン', exact: true }))
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`recovery-input-${width}.png`) })
  await page.getByRole('button', { name: '確認してログイン', exact: true }).click()
  await expect.poll(() => submitted?.code).toBe('7K2Q-9FXM')
  await openPrimaryAuthenticatedChallenge(page, '/login/two-factor/setup', 'fixture-setup', 'line')
  await expect(page.getByAltText('認証アプリ登録用のQRコード')).toBeVisible()
  await centered(page.getByRole('button', { name: '登録してログイン' }))
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`setup-${width}.png`) })
  await page.getByRole('textbox', { name: '1桁目' }).fill('123456')
  await expect(page.getByRole('list', { name: '8個の回復コード' }).getByRole('listitem')).toHaveCount(8)
  expect(await page.getByRole('button', { name: '回復コードをコピー' }).evaluate(textStyle)).toEqual(await page.getByRole('button', { name: 'ファイルに保存する' }).evaluate(textStyle))
  await centered(page.getByRole('button', { name: '控えました。ログインする' }))
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'ファイルに保存する' }).click(); expect((await download).suggestedFilename()).toBe('musubo-recovery-codes.txt')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('7K2Q-9FXM')))).toBe(false)
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`recovery-${width}.png`) })
  expect(errors).toEqual([])
})
for (const width of [1152,1440,1920]) test(`low recovery-code banner is not covered by page content at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  let remaining = 0
  // Prepare fixture responses before navigation. A navigation can cancel an
  // in-flight prefetch; fulfilling it after route.fetch() races that cancellation.
  const session = await (await page.request.get(`http://127.0.0.1:${mockPort}/api/auth/session`)).json()
  const style = await (await page.request.get(`http://127.0.0.1:${mockPort}/api/dashboard/style`)).json()
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/session') {
      return route.fulfill({ json: { ...session, data: { ...session.data, recoveryCodesRemaining: remaining } } })
    }
    if (url.pathname === '/api/dashboard/style') {
      return route.fulfill({ json: { ...style, data: { ...style.data, styleSelected: true } } })
    }
    return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  })
  for (const path of ['/', '/friends', '/broadcasts', '/form-submissions', '/templates/edit', '/templates/detail?id=template-1', '/chats', '/hq', '/settings']) {
    await page.goto(path)
    const notice = page.getByRole('note').filter({ hasText: '回復コードの残りが0個です' })
    await expect(notice).toBeVisible()
    const frame = page.locator('[data-design-shell] [data-page-template]').first()
    await expect(frame).toBeVisible()
    // Account/style loading can replace the first frame. Resolve both nodes in
    // the same DOM read, so a detached loading frame cannot produce a zero box.
    await expect.poll(() => page.evaluate(() => {
      const el = [...document.querySelectorAll('#main-content > [data-design-part="notice"]')].find(node => node.textContent.includes('回復コードの残りが0個です'))
      if (!el) throw new Error('The low-code notice is missing from the main board')
      const next = [...document.querySelectorAll('#main-content [data-page-template]')].find(node => node.getBoundingClientRect().width > 0)
      if (!next) return null
      const rect = el.getBoundingClientRect()
      const text = el.querySelector('span:last-child').getBoundingClientRect()
      const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 2)
      return { separated: next.getBoundingClientRect().top >= rect.bottom, textInside: text.bottom < rect.bottom, uncovered: el.contains(painted), overflow: document.documentElement.scrollWidth - innerWidth }
    })).toEqual({ separated: true, textInside: true, uncovered: true, overflow: 0 })
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`notice-${path.replace(/\W/g, '-') || 'home'}-${width}.png`) })
    if (path === '/form-submissions') {
      const create = page.getByRole('button', { name: 'フォームを作る', exact: true })
      await expect(create).toBeVisible()
      await expect.poll(() => create.evaluate(el => {
        const text = document.createRange()
        text.selectNodeContents(el)
        const label = text.getBoundingClientRect(), button = el.getBoundingClientRect()
        return label.left >= button.left && label.right <= button.right
      })).toBe(true)
    }
  }
  remaining = 8
  await page.reload()
  await expect(page.getByRole('note').filter({ hasText: '回復コードの残り' })).toHaveCount(0)
})
for (const width of [1152,1440,1920]) test(`policy confirmation and personal recovery counts at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  let required = true, remaining = 2, writes = 0
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    let data
    if (path === '/api/auth/two-factor/policy') {
      if (method === 'PUT') { required = route.request().postDataJSON().required; writes++ }
      data = { required, canEdit: true, configured: true, notice: null, registered: 4, total: 6, relogin: false }
    }
    if (path === '/api/auth/two-factor/self') data = { staffId: 'visual-qa-owner', enabledAt: '2026-10-12T03:00:00Z', remaining, total: 8, canEdit: true, configured: true, notice: null }
    if (path === '/api/auth/step-up') data = { token: 'fixture-step-up-grant' }
    if (path === '/api/auth/two-factor/recovery') { remaining = 8; data = { recoveryCodes: codes } }
    if (data) return route.fulfill({ status: 200, json: { success: true, data } })
    return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  })
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: '自分の二段階認証' })).toBeVisible()
  await detailTypography(page, '認証アプリ')
  await detailTypography(page, '回復コード')
  await detailTypography(page, '登録済み')
  await expect(page.getByText(/回復コードの残りが2個です/)).toBeVisible()
  await page.getByRole('heading', { name: '自分の二段階認証' }).scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`personal-${width}.png`), fullPage: true })
  await page.getByRole('switch', { name: 'ログインで二段階認証を必須にする' }).click()
  const dialog = page.getByRole('dialog', { name: '二段階認証の必須をオフにしますか' })
  await expect(dialog).toBeVisible()
  await waitForOverlayLayout(dialog)
  await dialog.getByRole('textbox', { name: '1桁目' }).fill('123456')
  expect(await dialog.getByRole('textbox').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(['1', '2', '3', '4', '5', '6'])
  expect(writes).toBe(0)
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`off-confirm-${width}.png`) })
  await dialog.getByRole('button', { name: 'オフにする', exact: true }).click()
  await expect.poll(() => writes).toBe(1)
  await expect(page.getByRole('switch', { name: 'ログインで二段階認証を必須にする' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '回復コードを作り直す' }).click()
  const recoveryDialog = page.getByRole('dialog')
  await waitForOverlayLayout(recoveryDialog)
  await recoveryDialog.getByRole('textbox', { name: '1桁目' }).fill('234567')
  await expect(page.getByRole('list', { name: '8個の回復コード' }).getByRole('listitem')).toHaveCount(8)
  await page.getByRole('button', { name: '控えました', exact: true }).click()
  await expect(page.getByText('残り 8 / 8 個', { exact: true })).toBeVisible()
  await expect(page.getByText(/回復コードの残りが2個です/)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})


test('new style selection opens once, explicit later and legacy later stay deferred', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  const fixture = await (await page.request.get(`http://127.0.0.1:${mockPort}/api/dashboard/style`)).json()
  let pending = true, mode = 'later', selected = false, version = 1, writes = 0
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/dashboard/style') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON()
        expect(body).toMatchObject({ expectedVersion: version, styleMode: 'later' })
        pending = false; version++; writes++
      }
      return route.fulfill({ json: { success: true, data: { ...fixture.data, style: 'standard', styleSelected: selected, styleMode: mode, shouldPromptStyleSelection: pending, version, inserted: [], changedAnswers: {}, bookingSettingsChanges: [], answers: { style: { mode } } } } })
    }
    return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  })
  const dialog = page.getByRole('dialog', { name: 'はじめに、使い方を教えてください' })
  await page.goto('/')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[name="setup-style"]')).toHaveCount(8)
  await dialog.getByRole('radio', { name: /あとで設定する/ }).check()
  await dialog.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes).toBe(1)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(dialog).toHaveCount(0)
  // A separate visit with the explicit entry still permits resuming.
  await page.goto('/?setup=0')
  await expect(dialog).toBeVisible()
  await page.goto('/')
  for (const state of [
    { mode: 'later', pending: undefined, selected: false },
    { mode: 'manual', pending: false, selected: false },
    { mode: 'configured', pending: false, selected: true },
  ]) {
    mode = state.mode; pending = state.pending; selected = state.selected
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(dialog).toHaveCount(0)
  }
  expect(writes).toBe(1)
})

async function useIndustryFixture(page, style = 'salon', legacyMeet = false) {
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` })
    if (url.pathname === '/api/dashboard/style') {
      expect(route.request().method()).toBe('GET')
      const fixture = await response.json()
      return route.fulfill({ json: { ...fixture, data: { ...fixture.data, style, styleSelected: true, styleMode: 'configured', shouldPromptStyleSelection: false } } })
    }
    if (legacyMeet && url.pathname === '/api/dashboard/style/schedule') {
      const fixture = await response.json()
      const entry = fixture.data.entries[0]
      entry.id = 'meet:legacy-meet'
      entry.kind = 'meet'
      entry.booking = { ...entry.booking, id: 'legacy-meet', kind: 'meet', friendId: 'friend-1' }
      return route.fulfill({ json: fixture })
    }
    return route.fulfill({ response })
  })
}

for (const [style, heading] of [['standard', 'ダッシュボード'], ['ec', 'ダッシュボード'], ['restaurant', 'お店'], ['salon', 'サロン'], ['consult', '面談'], ['lesson', '教室']]) test(`${style} resumes shared setup and summary, then returns without changing the style`, async ({ page }) => {
  await useIndustryFixture(page, style)
  for (const [step, title] of [['0', 'はじめに、使い方を教えてください'], ['summary', '準備ができました']]) {
    await page.goto(`/?setup=${step}`)
    const dialog = page.getByRole('dialog', { name: title })
    await expect(dialog).toBeVisible()
    if (step === '0') await expect(dialog.locator('input[name="setup-style"]')).toHaveCount(8)
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 2 })).toBeVisible()
  }
})

test('salon keeps existing KPI slots and forwards real staff, time and booking identity', async ({ page }) => {
  await useIndustryFixture(page)
  await page.goto('/')
  const band = page.locator('[data-style-dashboard="salon"]')
  await expect.poll(() => band.locator('[data-kpi-label]').evaluateAll(items => items.map(item => item.title))).toEqual(['今日の予約', '対応待ち', '次回予約率', '呼び戻し待ち', '無断キャンセル率'])
  await expect(band).toContainText('8人')
  for (const width of [1152, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`salon-${width}.png`) })
  }
  const board = page.getByRole('region', { name: '台帳の盤' })
  await board.getByRole('button', { name: /入れる.*15:00/ }).first().click()
  await expect(page).toHaveURL(/\/booking\/bookings\/new\?/)
  let url = new URL(page.url())
  expect(url.searchParams.get('staffId')).toBe('s1')
  expect(url.searchParams.get('time')).toBe('15:00')
  expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await page.goto('/')
  await board.getByRole('button', { name: /青木 真理さん/ }).click()
  await page.getByRole('menuitem', { name: '詳細を開く' }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/booking/bookings' && url.searchParams.getAll('booking').length === 1 && url.searchParams.get('booking') === 'e1')

  await page.goto('/?view=calendar&range=week')
  const week = page.getByRole('region', { name: '1週間のカレンダー' })
  await week.getByRole('button', { name: '予約を入れる', exact: true }).first().click()
  await expect(page).toHaveURL(/\/booking\/bookings\/new\?/)
  url = new URL(page.url())
  expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(url.searchParams.get('time')).toMatch(/^\d{2}:\d{2}$/)
  expect(url.searchParams.has('staffId')).toBe(false)
  await page.goto('/?view=calendar&range=week')
  await week.getByRole('button', { name: 'カット 山田 花子', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/booking/bookings' && url.searchParams.getAll('booking').length === 1 && url.searchParams.get('booking') === 'w1')
})


test('consult forwards board and weekly booking identity, date, time and staff', async ({ page }) => {
  await useIndustryFixture(page, 'consult')
  await page.goto('/?view=board')
  const board = page.getByRole('region', { name: '台帳の盤' })
  await board.getByRole('button', { name: /入れる.*13:30/ }).first().click()
  await expect(page).toHaveURL(/\/booking\/bookings\/new\?/)
  let url = new URL(page.url())
  expect(url.searchParams.get('staffId')).toBe('yamaguchi')
  expect(url.searchParams.get('time')).toBe('13:30')
  expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await page.goto('/?view=board')
  await board.getByRole('button', { name: /原田 修さん/ }).click()
  await page.getByRole('menuitem', { name: '詳細を開く' }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/booking/bookings' && url.searchParams.getAll('booking').length === 1 && url.searchParams.get('booking') === 'm1')
  await page.goto('/?view=calendar&range=week')
  const week = page.getByRole('region', { name: '1週間のカレンダー' })
  await week.getByRole('button', { name: '予約を入れる', exact: true }).first().click()
  await expect(page).toHaveURL(/\/booking\/bookings\/new\?/)
  url = new URL(page.url())
  expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(url.searchParams.get('time')).toMatch(/^\d{2}:\d{2}$/)
  expect(url.searchParams.has('staffId')).toBe(false)
  await page.goto('/?view=calendar&range=week')
  await week.getByRole('button', { name: '転職の初回面談 原田 修', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/booking/bookings' && url.searchParams.getAll('booking').length === 1 && url.searchParams.get('booking') === 'm1')
})

test('legacy Meet consult opens the related friend without treating its ID as a booking', async ({ page }) => {
  await useIndustryFixture(page, 'consult', true)
  await page.goto('/?view=board')
  await page.getByRole('region', { name: '台帳の盤' }).getByRole('button', { name: /原田 修さん/ }).click()
  await page.getByRole('menuitem', { name: '詳細を開く' }).click()
  await expect(page).toHaveURL(/\/friends\/detail\?id=friend-1$/)
})

test('pass summary separates simulation failures and cancellation from unavailable real billing', async ({ page }) => {
  await useIndustryFixture(page, 'lesson')
  await page.goto('/booking/menus?tab=passes')
  const card = page.locator('[data-kpi-presentation="band"][data-kpi-density]').filter({ has: page.locator('[data-kpi-label][title="引き落としの失敗"]') })
  await expect(card).toContainText('実課金は未接続')
  await expect(card).toContainText('試験：失敗1・正常解約2')
  await expect(card.locator('[data-kpi-number]')).toHaveText('—')
  for (const width of [1152, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await expect.poll(() => card.locator('[data-kpi-detail]').evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, height: el.clientHeight > 0 }))).toEqual({ overflow: 0, height: true })
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`passes-${width}.png`) })
  }
})
