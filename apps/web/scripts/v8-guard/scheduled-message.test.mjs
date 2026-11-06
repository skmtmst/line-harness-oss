import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { trackPendingApiRequests, waitForNavigationContent } from './navigation-content-ready.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'

function scanSchedule(reason) {
  const dialog = document.querySelector('[role="dialog"]')
  const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(button => /に予約$|この日時で予約する|日時を選んで予約/.test(button.textContent.trim()))
  if (!confirm) return ['予約の操作が無い']
  const reasons = [...dialog.querySelectorAll('[role="status"]')].filter(node => node.textContent.trim() === reason)
  if (reason) return !confirm.disabled || reasons.length !== 1 ? ['入力不足の予約は押せず、理由は1行必要'] : []
  return confirm.disabled ? ['入力済みの予約が押せない'] : []
}

for (const width of [1152, 1440]) for (const kind of ['inbox', 'friends']) test(`scheduled message ${kind} ${width}`, async () => {
  const browser = await connectGuardBrowser(), context = await browser.newContext({ viewport: { width, height: 1080 }, locale: 'ja-JP' }), page = await context.newPage()
  const output = join(process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard', 'scheduled-message', `${kind}-${width}`)
  mkdirSync(output, { recursive: true })
  const rows = [], errors = [], pending = trackPendingApiRequests(page)
  let failure = null
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await stubApi(page, mockFetch)
  const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
  try {
    const open = async content => {
      await page.goto(base + (kind === 'inbox' ? '/chats?friend=friend-0' : '/friends'), { waitUntil: 'domcontentloaded' })
      await waitForNavigationContent(page, pending, 15000)
      if (kind === 'inbox') {
        await page.getByRole('textbox', { name: 'メッセージを入力', exact: true }).fill(content)
        await page.getByRole('main').getByRole('button', { name: /^(?:送信予約|予約)(?:\(|$)/ }).click()
      } else {
        await page.getByRole('button', { name: /のその他操作$/ }).first().click()
        await page.getByRole('menuitem', { name: '予約して送る', exact: true }).click()
      }
      const dialog = page.getByRole('dialog', { name: kind === 'inbox' ? '予約して送る' : /に予約して送る$/ })
      await dialog.waitFor()
      if (kind === 'friends') await dialog.getByRole('textbox', { name: '送るもの', exact: true }).fill(content)
      return dialog
    }
    let dialog = await open('')
    const normal = await page.evaluate(scanSchedule, '送るものを入力してください')
    assert.deepEqual(normal, [])
    await page.screenshot({ animations: 'disabled', path: join(output, 'empty.png') })
    let confirm = dialog.getByRole('button', { name: /に予約$|この日時で予約する|日時を選んで予約/ })
    const disabledColor = await confirm.evaluate(node => ({ color: getComputedStyle(node).backgroundColor, opacity: getComputedStyle(node).opacity }))
    await confirm.evaluate(node => { node.disabled = false })
    const broken = await page.evaluate(scanSchedule, '送るものを入力してください')
    assert.ok(broken.length > 0)
    await confirm.evaluate(node => { node.disabled = true })
    const restored = await page.evaluate(scanSchedule, '送るものを入力してください')
    assert.deepEqual(restored, [])
    dialog = await open('次回のお知らせです')
    if (kind === 'friends') await dialog.getByRole('button', { name: '日時を決める', exact: true }).click()
    assert.deepEqual(await page.evaluate(scanSchedule, '送る日時を選んでください'), [])
    await page.screenshot({ animations: 'disabled', path: join(output, 'missing-date.png') })
    await dialog.getByRole('button', { name: '明日 9:00', exact: true }).click()
    assert.deepEqual(await page.evaluate(scanSchedule, ''), [])
    confirm = dialog.getByRole('button', { name: /に予約$/ })
    await confirm.evaluate(async node => { await new Promise(requestAnimationFrame); await Promise.allSettled(node.getAnimations().map(animation => animation.finished)) })
    const enabledColor = await confirm.evaluate(node => ({ color: getComputedStyle(node).backgroundColor, opacity: getComputedStyle(node).opacity }))
    assert.notDeepEqual(disabledColor, enabledColor, '入力不足は通常の緑とは違う見た目')
    await page.screenshot({ animations: 'disabled', path: join(output, 'ready.png') })
    rows.push({ normal, broken, restored, disabledColor, enabledColor })
    assert.deepEqual(errors, [])
  } catch (error) { failure = error.stack ?? String(error); writeFileSync(join(output, 'dialog.json'), JSON.stringify(await page.locator('[role="dialog"]').evaluate(node => ({ html: node.outerHTML, buttons: [...node.querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled, ariaDisabled: button.getAttribute('aria-disabled'), opacity: getComputedStyle(button).opacity, matchesDisabled: button.matches(':disabled') })) })).catch(() => null))); await page.screenshot({ animations: 'disabled', path: join(output, 'failure.png') }); throw error }
  finally { writeFileSync(join(output, 'summary.json'), JSON.stringify({ rows, errors, failure }, null, 2)); await context.close(); await browser.close() }
})
