/** Route rendering and current V8 state/CSV/archive behavior. Visuals use v8-guard. */
import { test, expect } from '@playwright/test'
import { captureClockFor, QA_TIMEZONE } from './qa-clock.mjs'
import { ROUTES, TAG_STATES, WIDTHS } from './routes.mjs'
import { routeLocalApi } from './local-api.mjs'

test.beforeEach(routeLocalApi)


const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

const FAILURE_TEXTS = [
  '画面を表示できませんでした',
  '店舗が選ばれていません',
  'Application error',
]

const LOGIN_TEXT = 'LINEでログイン'

const DEFAULT_CAPTURE_HEIGHT = 1080

test.describe.configure({ mode: 'parallel' })
test.use({ timezoneId: QA_TIMEZONE })

async function signIn(page, clock) {
  if (clock) await page.clock.setFixedTime(new Date(clock))
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
      window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
    } catch {
    }
  })
}

async function expectLanded(page, path) {
  const landed = new URL(page.url()).pathname
  expect(landed, `${path} から ${landed} へ飛ばされた`).toBe(path)
  const body = await page.locator('body').innerText()
  expect(body, `${path} がログイン画面になっている`).not.toContain(LOGIN_TEXT)
  for (const bad of FAILURE_TEXTS) {
    expect(body, `${path} が「${bad}」で止まっている`).not.toContain(bad)
  }
}

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`${width}px ${route.name}（${route.path}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: DEFAULT_CAPTURE_HEIGHT })

      await signIn(page, captureClockFor(route.path ?? route.route, route.clock))
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
      await expectLanded(page, route.path)
      if (route.name === 'friends') {
        await expect(page.getByText('友だち一覧', { exact: true }).first()).toBeVisible()
      }
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${route.path} に横スクロールが出ている（${overflow}px）`).toBeLessThan(2)
      await expect(page.locator('main').first()).toBeVisible()
    })
  }
}

const TAGS_PATH = '/tags'
for (const width of [1152, 1440, 1920]) {
  for (const [tab, column] of [['fields', '項目名'], ['marks', 'マーク']]) {
    test(`hqtabs ${tab} ${width}px 横幅と操作`, async ({ page }) => {
      await page.setViewportSize({ width, height: DEFAULT_CAPTURE_HEIGHT })
      await signIn(page)
      await page.addInitScript(() => localStorage.setItem('lh-admin-theme', 'v8'))
      await page.goto(`${BASE}/hq/friend-attributes?tab=${tab}`, { waitUntil: 'networkidle' })
      await expectLanded(page, '/hq/friend-attributes')
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
      await expect(page.getByRole('tab', { name: tab === 'fields' ? '友だち情報欄' : '対応マーク', exact: true })).toHaveAttribute('aria-selected', 'true')
      const distribute = page.getByRole('button', { name: /を配る$/ }).first()
      await expect(distribute).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBe(0)
      const actionBounds = await page.getByRole('button', { name: /を配る$|の操作$/ }).evaluateAll((buttons) => buttons.map((button) => ({ right: button.getBoundingClientRect().right, limit: window.innerWidth })))
      expect(actionBounds.length).toBeGreaterThan(0)
      for (const action of actionBounds) expect(action.right).toBeLessThanOrEqual(action.limit)
      await page.screenshot({ path: `test-results/hqtabs/browser-${tab}-${width}.png`, fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' })
    })
  }
}

for (const width of WIDTHS) {
  for (const state of TAG_STATES) {
    test(`${width}px 友だち属性・${state.label}（${state.name}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: DEFAULT_CAPTURE_HEIGHT })
      await signIn(page)
      await page.route('**/api/list-stats*', (route) =>
        route.fulfill({
          status: state.status,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(state.statsBody ?? state.body),
        }),
      )
      for (const glob of ['**/api/tags*', '**/api/tag-groups*']) {
        await page.route(glob, (route) =>
          route.fulfill({
            status: state.status,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(state.body),
          }),
        )
      }

      await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'networkidle' })
      await expectLanded(page, TAGS_PATH)
      const kind = { 'tags-empty': 'empty', 'tags-error': 'error', 'tags-forbidden': 'error' }[state.name]
      await expect(page.locator(state.name === 'tags-empty' ? '[data-empty-list="first"]' : `[data-list-state="${kind}"]`)).toBeVisible()
      const title = { 'tags-empty': 'まだタグがありません', 'tags-error': 'タグを読み込めませんでした', 'tags-forbidden': 'タグを見る権限がありません' }[state.name]
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible()

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${state.name} に横スクロールが出ている（${overflow}px）`).toBeLessThan(2)

      await expect(page.locator('main').first()).toBeVisible()
    })
  }

  test(`${width}px 友だち属性・読み込んでいる途中（tags-loading）`, async ({ page }) => {
    await page.setViewportSize({ width, height: DEFAULT_CAPTURE_HEIGHT })
    await signIn(page)
    for (const glob of ['**/api/tags*', '**/api/tag-groups*', '**/api/list-stats*']) {
      await page.route(glob, () => {})
    }

    await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expectLanded(page, TAGS_PATH)

    await expect(page.locator('main').first()).toBeVisible()
  })
}
function importRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    line: index + 2,
    name: index === 0 ? '会員ランクA' : index === 1 ? '既存VIP' : `一括タグ${String(index + 1).padStart(3, '0')}`,
    folderName: index === 2 ? '存在しないフォルダ' : index % 2 === 0 ? '会員' : '販売',
  }))
}

function previewData(rows, ready, skipped, invalid, representative = false) {
  const previewRows = rows.map((row, index) => {
    if (index < ready) return {
      ...row,
      status: 'ready',
      ...(index === 2 ? { code: 'folder_not_found', message: 'フォルダが見つからないため、未分類として登録します' } : {}),
    }
    if (index < ready + skipped) return { ...row, status: 'skipped', code: 'already_exists', message: '同じ名前のタグがすでにあります' }
    const invalidOffset = index - ready - skipped
    return invalidOffset === 0
      ? { ...row, name: '会員↵ランク', status: 'invalid', code: 'invalid_character', message: '改行はタグ名に使えません（3文字目）' }
      : { ...row, name: '長すぎるタグ名'.repeat(11), status: 'invalid', code: 'name_too_long', message: 'タグ名は60文字以内にしてください' }
  })
  if (representative && skipped > 0 && invalid > 0) {
    const leadingIndexes = [0, ready, 2, ready + skipped, 1, ready + 1, ready + skipped + 1, 3]
    const leading = new Set(leadingIndexes)
    return {
      summary: { total: rows.length, ready, created: 0, skipped, invalid, failed: 0 },
      rows: [...leadingIndexes.map((index) => previewRows[index]), ...previewRows.filter((_, index) => !leading.has(index))],
    }
  }
  return {
    summary: { total: rows.length, ready, created: 0, skipped, invalid, failed: 0 },
    rows: previewRows,
  }
}

async function expectCsvDialogFitsViewport(page, label) {
  const fit = await page.getByRole('dialog', { name: label, exact: true }).evaluate((panel) => {
    const rect = panel.getBoundingClientRect()
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      left: rect.left,
      right: rect.right - window.innerWidth,
    }
  })
  expect(fit.documentOverflow, `${label}: ページ全体の横スクロール`).toBeLessThanOrEqual(1)
  expect(fit.left, `${label}: 左側の見切れ`).toBeGreaterThanOrEqual(0)
  expect(fit.right, `${label}: 右側の見切れ`).toBeLessThanOrEqual(0)
}

async function openCsvImport(page, width, rows) {
  await page.setViewportSize({ width, height: 1080 })
  await signIn(page)
  await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'networkidle' })
  await expectLanded(page, TAGS_PATH)
  await page.getByRole('button', { name: 'CSVで一括登録する', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'CSVでタグを一括登録', exact: true })).toBeVisible()
  if (rows) {
    const csv = ['タグ名,フォルダ', ...rows.map((row) => `"${row.name}","${row.folderName}"`)].join('\r\n')
    await page.locator('[role="dialog"] input[type="file"][accept*=".csv"]').setInputFiles({
      name: 'tags.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`\uFEFF${csv}`),
    })
    await expect(page.getByRole('button', { name: '取り込む内容を確認' })).toBeEnabled()
  }
}

test.describe('4-1 タグCSV一括登録', () => {
  test.describe.configure({ mode: 'serial' })

for (const width of WIDTHS) {
  test(`${width}px タグCSV一括登録・選択（tags-csv-select）`, async ({ page }) => {
    await openCsvImport(page, width)
    await expectCsvDialogFitsViewport(page, 'CSVでタグを一括登録')
    await expect(page.locator('main').first()).toBeVisible()
  })

  test(`${width}px タグCSV一括登録・確認（tags-csv-preview）`, async ({ page }) => {
    const rows = importRows(500)
    await page.route('**/api/tags/import/preview', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, data: previewData(rows, 412, 73, 15, true) }),
    }))
    await openCsvImport(page, width, rows)
    await page.getByRole('button', { name: '取り込む内容を確認' }).click()
    await expect(page.getByRole('dialog', { name: '取り込む内容の確認', exact: true })).toBeVisible()
    await expectCsvDialogFitsViewport(page, '取り込む内容の確認')
    await expect(page.locator('main').first()).toBeVisible()
  })

  test(`${width}px タグCSV一括登録・完了（tags-csv-success）`, async ({ page }) => {
    const rows = importRows(485)
    const preview = previewData(rows, 412, 73, 0)
    await page.route('**/api/tags/import/preview', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, data: preview }),
    }))
    await page.route('**/api/tags/import', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, data: {
        outcome: 'success',
        summary: { total: 485, ready: 0, created: 412, skipped: 73, invalid: 0, failed: 0 },
        rows: preview.rows.map((row, index) => index < 412
          ? { ...row, status: 'created', tagId: `created-${index}` }
          : row),
      } }),
    }))
    await openCsvImport(page, width, rows)
    await page.getByRole('button', { name: '取り込む内容を確認' }).click()
    await page.getByRole('button', { name: '412件を登録する' }).click()
    await expect(page.getByRole('dialog', { name: '412件を登録しました', exact: true })).toBeVisible()
    await expectCsvDialogFitsViewport(page, '412件を登録しました')
    await expect(page.locator('main').first()).toBeVisible()
  })

  test(`${width}px タグCSV一括登録・一部失敗（tags-csv-partial）`, async ({ page }) => {
    const rows = importRows(485)
    const preview = previewData(rows, 412, 73, 0)
    await page.route('**/api/tags/import/preview', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, data: preview }),
    }))
    await page.route('**/api/tags/import', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, data: {
        outcome: 'partial',
        summary: { total: 485, ready: 0, created: 402, skipped: 73, invalid: 0, failed: 10 },
        rows: preview.rows.map((row, index) => index < 402
          ? { ...row, status: 'created', tagId: `created-${index}` }
          : index < 412
            ? { ...row, status: 'failed', code: 'create_failed', message: 'タグを登録できませんでした' }
            : row),
      } }),
    }))
    await openCsvImport(page, width, rows)
    await page.getByRole('button', { name: '取り込む内容を確認' }).click()
    await page.getByRole('button', { name: '412件を登録する' }).click()
    await expect(page.getByRole('dialog', { name: '402件を登録し、10件は入りませんでした', exact: true })).toBeVisible()
    await expectCsvDialogFitsViewport(page, '402件を登録し、10件は入りませんでした')
    await expect(page.locator('main').first()).toBeVisible()
  })
}
})

const DELETE_CASES = [
  {
    name: 'tags-delete',
    label: '使用中で止まる',
    tag: 'EC顧客連携済み',
    canDelete: false,
  },
  {
    name: 'tags-delete-ok',
    label: '消せる',
    tag: 'VIPタグ 2',
    canDelete: true,
  },
]

for (const width of WIDTHS) {
  for (const item of DELETE_CASES) {
    test(`${width}px tag archive ${item.name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: DEFAULT_CAPTURE_HEIGHT })
      await signIn(page)
      const requests = []
      await page.route('**/api/tags/*/archive?*', route => {
        requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
        return route.fulfill({ status: item.canDelete ? 200 : 409, json: item.canDelete
          ? { success: true, data: { archived: true, replacedFriendCount: 0 } }
          : { success: false, code: 'references_changed', error: 'references changed' } })
      })
      await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'networkidle' })
      await expectLanded(page, TAGS_PATH)
      const row = page.getByRole('row').filter({ has: page.getByText(item.tag, { exact: true }) })
      await row.getByRole('button', { name: `タグ「${item.tag}」の操作`, exact: true }).click()
      const loadedImpact = page.waitForResponse(response => /^\/api\/tags\/[^/]+\/dependencies$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET' && response.status() === 200)
      await page.getByRole('menuitem', { name: '保管する', exact: true }).click()
      const impact = await (await loadedImpact).json()
      expect(impact.success).toBe(true)
      const dialog = page.getByRole('alertdialog', { name: `「${item.tag}」を保管しますか？`, exact: true })
      await expect(dialog.getByText(`${impact.data.friendCount}人`, { exact: true })).toBeVisible()
      for (const label of ['付与人数', '参照先', '参照先（自動）', '連動の停止', '積んだマイル']) await expect(dialog.getByText(label, { exact: true })).toBeVisible()
      const confirm = dialog.getByRole('button', { name: 'このタグを保管する', exact: true })
      const name = dialog.getByRole('textbox', { name: '確認のため、タグ名を入力してください', exact: true })
      await expect(confirm).toBeDisabled()
      await name.fill('incorrect'); await expect(confirm).toBeDisabled()
      expect(requests).toHaveLength(0)
      await name.fill(item.tag); await expect(confirm).toBeEnabled()
      await confirm.click()
      await expect.poll(() => requests.length).toBe(1)
      expect(requests[0].body).toEqual({ expectedVersion: impact.data.tag.version, impactRevision: impact.data.revision })
      expect(requests[0].key).toBeTruthy()
      if (item.canDelete) await expect(dialog).not.toBeVisible()
      else {
        await expect(dialog.getByText('保管できませんでした。影響を読み直して、もう一度お試しください。', { exact: true })).toBeVisible()
        await expect(name).toHaveValue(item.tag)
        await expect(row).toBeVisible()
      }
    })
  }
}
