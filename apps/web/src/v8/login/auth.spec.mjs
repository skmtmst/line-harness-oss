import { test, expect } from '@playwright/test'
import { waitForOverlayLayout } from '../../../../../scripts/browser/overlay-ready.mjs'
const mockPort = Number(process.env.TRAIN30_MOCK_PORT ?? 8788)
async function openPrimaryAuthenticatedChallenge(page, path, token, method) {
  const nonce = crypto.randomUUID()
  await page.evaluate(({ nonce, path }) => sessionStorage.setItem('lh_login_handoff', JSON.stringify({ nonce, expires: Date.now() + 600000, kind: 'challenge', path })), { nonce, path })
  const fragment = new URLSearchParams({ lh_2fa: token, lh_method: method, lh_nonce: nonce })
  await page.goto(`${path}#${fragment}`)
}
const codes = ['7K2Q-9FXM','B4TN-6WJP','H8RD-3CVY','M5ZL-2QKA','P9XE-7NHU','T3GW-8BSC','Y6JA-4DRV','C2FN-5MXT']
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
  const mark = page.locator('[data-auth-layout="admin"] > div:first-child > span[aria-hidden="true"]')
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
