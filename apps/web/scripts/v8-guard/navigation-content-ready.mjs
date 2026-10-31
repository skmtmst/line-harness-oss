export function trackPendingApiRequests(page) {
  const pending = new Set()
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) pending.add(request)
  })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  return pending
}

export async function waitForNavigationContent(page, pending, timeout = 5000) {
  const start = Date.now()
  let readySince = null, state
  while (Date.now() - start < timeout) {
    state = await page.evaluate(() => {
      const main = document.querySelector('main')
      return {
        text: Boolean(main?.innerText.trim()),
        busy: Boolean(main && [...main.querySelectorAll('[aria-busy="true"]')]
          .some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')),
      }
    })
    if (state.text && !state.busy && pending.size === 0) {
      readySince ??= Date.now()
      // 親の応答後に子が問い合わせを始める時間も見張る。
      if (Date.now() - readySince >= 200) return
    } else readySince = null
    await page.waitForTimeout(50)
  }
  const paths = [...pending].slice(0, 3).map(request => new URL(request.url()).pathname)
  throw new Error(`本文の準備が終わりません: text=${state?.text} busy=${state?.busy} pendingApi=${pending.size} paths=${JSON.stringify(paths)}`)
}
