import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

/*
 * 統括のアカウントのトークンの知らせ（hq-token-notice）。
 * カードは共通の知らせ1つ（素の期限の文字なし）、表は状態の札＋期限の札、
 * 数の帯の補足＋行き先は1行。同じ意味の知らせの重複と素の期限切れを見張る。
 */
const EXPIRED_LABEL = 'トークンの期限が切れています'
const EXPIRING_LABEL = 'トークンの期限が近づいています'

async function hqTokenFetch(method, path) {
  const answered = await mockFetch(method, path)
  const rewrite = (mutate) => {
    try {
      const json = JSON.parse(answered.body)
      if (json?.data) mutate(json.data)
      return { ...answered, body: JSON.stringify(json) }
    } catch { return answered }
  }
  if (method === 'GET' && path === '/api/line-accounts') {
    return rewrite((data) => {
      if (!Array.isArray(data) || data.length < 5) return
      data[0].tokenExpiry = { status: 'expired', label: EXPIRED_LABEL, daysLeft: null }
      data[1].tokenExpiry = { status: 'expiring', label: EXPIRING_LABEL, daysLeft: 7 }
      delete data[2].tokenExpiry
      data[4].connection = undefined
    })
  }
  if (method === 'GET' && path.startsWith('/api/staff/me')) {
    return rewrite((data) => { data.accountScope = 'all' })
  }
  return answered
}

function bandDetailState() {
  const cards = [...document.querySelectorAll('[data-kpi-strip][data-kpi-presentation="band"] > [data-design-version]')]
  const target = cards.find((card) => card.textContent.includes('接続に問題'))
  if (!target) return null
  const detail = target.querySelector('[data-kpi-detail]')
  const note = detail?.querySelector('[role="note"]')
  const valueRow = target.querySelector('[data-kpi-fit]')
  const number = valueRow?.querySelector('p')
  const action = target.querySelector('[data-kpi-delta-slot] a[href*="/hq/attention"]')
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height } }
  return {
    detail: detail ? r(detail) : null,
    clipped: note ? note.scrollWidth > note.clientWidth + 1 : null,
    number: number ? r(number) : null,
    action: action ? { ...r(action), href: action.getAttribute('href') } : null,
  }
}

function cardNoticeState([expired, expiring]) {
  return [...document.querySelectorAll('article')].map((card) => ({
    notices: card.querySelectorAll('[data-design-part="notice"]').length,
    bare: [expired, expiring].filter((label) => card.querySelector(`[title="${label}"]`)),
  }))
}

function tableTokenState() {
  return [...document.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '')
}

/* 表の期限の札（全文の title を持つ札）の切れ。 */
function tableBadgeClip([expired, expiring]) {
  return [expired, expiring].map((label) => {
    const badge = document.querySelector(`tbody tr [title="${label}"]`)
    const text = badge?.querySelector('[data-truncated-text]')
    if (!badge || !text) return { label, found: false, clipped: false }
    return { label, found: true, clipped: text.scrollWidth > text.clientWidth + 1 }
  })
}

for (const width of [1152, 1440]) test(`統括のアカウントは知らせの重複と素の期限切れを出さない ${width}`, async () => {
  const browser = await connectGuardBrowser()
  let page
  try {
    const adapter = { newPage: async options => { const page = await browser.newPage(options); await stubApi(page, hqTokenFetch); return page } }
    page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route: '/hq', width, stable: true, requireSuccess: true })
    await page.locator('[data-kpi-strip][data-kpi-presentation="band"]').first().waitFor()
    await page.locator('article').first().waitFor()

    /* 数の帯：補足は1行（切らない）、行き先は値の行の右。 */
    const band = await page.evaluate(bandDetailState)
    assert.ok(band?.detail, '接続に問題のカードの補足行がある')
    assert.ok(band.detail.height <= 20, `補足は1行に収まる（行の高さ ${band.detail.height}）`)
    assert.equal(band.clipped, false, '補足は切らない')
    assert.ok(band.action, '行き先が値の行にある')
    assert.equal(band.action.href, '/hq/attention?kind=connections', '行き先は対応が要るものの接続の絞り込み')
    assert.ok(band.action.top >= band.number.top - 1 && band.action.top < band.number.bottom,
      `行き先は数字の行の中にある（行き先の上 ${band.action.top}、数字行 ${band.number.top}〜${band.number.bottom}）`)
    /* わざと行き先を数字の行から落とすと赤になる */
    const bandFault = await page.evaluate(() => {
      const slot = [...document.querySelectorAll('[data-kpi-strip][data-kpi-presentation="band"] > [data-design-version]')]
        .find((card) => card.textContent.includes('接続に問題'))?.querySelector('[data-kpi-delta-slot]')
      const row = slot?.closest('[data-kpi-fit]')
      const number = row?.querySelector('p')
      if (!slot || !number) return false
      slot.style.setProperty('position', 'relative')
      slot.style.setProperty('top', '100px')
      const box = slot.getBoundingClientRect()
      const num = number.getBoundingClientRect()
      const dropped = !(box.top >= num.top - 1 && box.top < num.bottom)
      slot.style.removeProperty('position')
      slot.style.removeProperty('top')
      return dropped
    })
    assert.equal(bandFault, true, '行き先が数字の行から落ちると検知する')

    /* カード：知らせは1つまで、素の期限の文字は無い。 */
    const checkCards = (cards) => {
      assert.ok(cards.length > 0, 'カードがある')
      for (const [i, card] of cards.entries()) {
        assert.ok(card.notices <= 1, `カード${i}の知らせは1つまで（${card.notices}）`)
        assert.deepEqual(card.bare, [], `カード${i}に素の期限の文字は無い`)
      }
    }
    checkCards(await page.evaluate(cardNoticeState, [EXPIRED_LABEL, EXPIRING_LABEL]))
    /* わざと知らせを重ね・素の文字を置くと赤になる */
    const cardFault = await page.evaluate(([expired, expiring]) => {
      const first = document.querySelector('article')
      const notice = first?.querySelector('[data-design-part="notice"]')
      if (!first || !notice) return null
      const clone = notice.cloneNode(true)
      first.appendChild(clone)
      const bare = document.createElement('span')
      bare.setAttribute('title', expired)
      bare.textContent = expiring
      first.appendChild(bare)
      const found = {
        notices: first.querySelectorAll('[data-design-part="notice"]').length,
        bare: [expired, expiring].filter((label) => first.querySelector(`[title="${label}"]`)),
      }
      clone.remove()
      bare.remove()
      return found.notices > 1 && found.bare.length > 0
    }, [EXPIRED_LABEL, EXPIRING_LABEL])
    assert.equal(cardFault, true, '知らせの重複と素の期限切れを検知する')

    /* 表：素の期限の文字は出さず、期限の札で添える。 */
    await page.locator('button[aria-label="表"]').click()
    await page.locator('tbody tr').first().waitFor()
    const rows = await page.evaluate(tableTokenState)
    assert.ok(rows.length > 0, '表の行がある')
    for (const [i, text] of rows.entries()) {
      assert.ok(!text.includes(EXPIRED_LABEL) && !text.includes(EXPIRING_LABEL), `表の行${i}に素の期限の文字は無い`)
    }
    assert.ok(rows.some((text) => text.includes('期限切れ')), '期限切れの札がある')
    assert.ok(rows.some((text) => text.includes('期限が近い')), '期限が近い札がある')
    const clips = await page.evaluate(tableBadgeClip, [EXPIRED_LABEL, EXPIRING_LABEL])
    for (const clip of clips) {
      assert.equal(clip.found, true, `全文を持つ札がある（${clip.label}）`)
      assert.equal(clip.clipped, false, `札は切らない（${clip.label}）`)
    }
    /* わざと札を狭めると赤になる */
    const clipFault = await page.evaluate(([expired, expiring]) => {
      const badge = document.querySelector(`tbody tr [title="${expired}"], tbody tr [title="${expiring}"]`)
      const text = badge?.querySelector('[data-truncated-text]')
      if (!badge || !text) return false
      badge.style.setProperty('max-width', '20px')
      badge.style.setProperty('overflow', 'hidden')
      const clipped = text.scrollWidth > text.clientWidth + 1
      badge.style.removeProperty('max-width')
      badge.style.removeProperty('overflow')
      return clipped
    }, [EXPIRED_LABEL, EXPIRING_LABEL])
    assert.equal(clipFault, true, '札が切れると検知する')
    /* わざと素の文字を置くと赤になる */
    const tableFault = await page.evaluate((expired) => {
      const row = document.querySelector('tbody tr')
      if (!row) return false
      const bare = document.createElement('span')
      bare.textContent = expired
      row.appendChild(bare)
      const found = (row.textContent ?? '').includes(expired)
      bare.remove()
      return found
    }, EXPIRED_LABEL)
    assert.equal(tableFault, true, '表の素の期限切れを検知する')
  } finally { await page?.close(); await browser.close() }
})
