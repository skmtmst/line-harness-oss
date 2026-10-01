/*
 * V8 の画面の見張り（layout-overflow・shots）で共通に使う、ブラウザの準備。
 *
 * - 画面確認用のモックAPI（scripts/visual-qa/mock-api.mjs）に向けて書き出した
 *   `out` を開く前提。ログインと選択中アカウントは localStorage で与える
 * - `lh-admin-theme` で v7 / v8 を切り替える（app/layout.tsx の THEME_BOOT）
 * - 撮影を毎回同じ絵にするため、時計を固定し、動きを止め、カーソルの点滅を消す。
 *   同じ版を2回撮って差が出たのを確かめてから入れた（2026-10-01、時刻表示と動きの途中）
 */
export const ROUTES = {
  dashboard: '/',
  friends: '/friends',
  'friend-detail': '/friends/detail?id=f-1',
  inbox: '/chats',
  'broadcast-new': '/broadcasts/new',
  'broadcast-audience': '/broadcasts/new?step=audience',
  'broadcast-message': '/broadcasts/new?step=message',
  'broadcast-schedule': '/broadcasts/new?step=schedule',
  'broadcast-confirm': '/broadcasts/new?step=confirm',
  booking: '/booking/bookings',
  login: '/login',
}

export const WIDTHS = [1152, 1440, 1920]

const SESSION = {
  lh_csrf: 'visual-qa-csrf',
  lh_staff_role: 'owner',
  lh_staff_name: 'K',
  lh_staff_permissions: '[]',
  lh_staff_view_permissions: '[]',
  lh_selected_account: 'visual-qa-account',
}

export async function openPage(browser, { baseUrl, route, width, theme, stable = false }) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    ...(stable ? { reducedMotion: 'reduce' } : {}),
  })
  if (stable) await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'))
  await page.addInitScript(([session, t]) => {
    for (const [k, v] of Object.entries(session)) localStorage.setItem(k, v)
    localStorage.setItem('lh_auth_selection_cleared', '1')
    localStorage.setItem('lh-admin-theme', t)
  }, [SESSION, theme])
  await page.goto(new URL(route, baseUrl).toString())
  if (stable) {
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
    })
  }
  await page.waitForTimeout(2500)
  return page
}
