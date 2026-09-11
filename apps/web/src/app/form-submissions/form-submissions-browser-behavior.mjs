/**
 * 回答フォーム一覧（#676 N-172 / N-173 / N-180 / N-181）の実ブラウザ検査。
 *
 * `next build` の書き出し（`apps/web/out`）をそのまま配って動かす。
 * **`networkidle` は待たない。** 管理画面は版の確認や通知の問い合わせを
 * 続けるので、通信が止まる瞬間が来ないことがある（開発サーバではHMRの
 * 接続も残る）。`domcontentloaded` で読み込みを終え、そのあとは
 * **画面が自分で出す印**（一覧の状態と行）を見て待つ。
 *
 * 走らせ方: `pnpm --filter web build` のあとに
 * `node apps/web/src/app/form-submissions/form-submissions-browser-behavior.mjs`
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'

const outDir = join(process.cwd(), 'apps/web/out')

if (!existsSync(outDir)) {
  throw new Error(`${outDir} がありません。先に pnpm --filter web build を実行してください。`)
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

const ACCOUNTS = [
  { id: 'account-a', channelId: 'channel-a', name: 'テスト店', isActive: true, country: 'JP', role: null, displayOrder: 0 },
  { id: 'account-b', channelId: 'channel-b', name: '本店', isActive: true, country: 'JP', role: null, displayOrder: 1 },
]

const LAYOUT = {
  version: 2,
  header: [],
  sections: [{ id: 'section-1', name: '質問', blocks: [] }],
  options: {
    thanksUrl: null,
    thanksText: 'ありがとうございました。',
    restorePrevious: false,
    pageTitle: null,
    submitLabel: '送信',
    prevLabel: '前へ',
    nextLabel: '次へ',
    sectionHeader: 'pageNumber',
    confirmDialog: { enabled: false },
    deadline: { enabled: false },
    oncePerFriend: { enabled: false },
    totalLimit: { enabled: false },
    afterActions: [],
  },
}

/**
 * 一覧が読む形は Worker の `serializeForm` に合わせる。
 *
 * **`folderId` は入れない。** forms 表に列が無く、API も返さないため、
 * ここで足すと画面が実在しない値で絞り込めているように見えてしまう。
 * フォルダへの所属は #688（migration 372）が入ってから試す。
 */
function form(index, overrides = {}) {
  const day = String(Math.min(index, 28)).padStart(2, '0')
  return {
    id: `form-${index}`,
    name: `フォーム${String(index).padStart(2, '0')}`,
    description: `${index}番目のフォーム`,
    fields: [],
    layout: LAYOUT,
    onSubmitTagId: null,
    isActive: index % 2 === 0,
    status: 'active',
    revision: 1,
    submitCount: index,
    weeklySubmitCount: 0,
    destinationSummary: { friendFieldCount: 0, tagCount: 0 },
    createdAt: `2025-01-${day}T00:00:00.000Z`,
    updatedAt: `2026-09-${day}T00:00:00.000Z`,
    lastSubmittedAt: `2026-08-${day}T00:00:00.000Z`,
    usedByAccounts: [],
    ...overrides,
  }
}

async function openHarness(browser, {
  role = 'admin', formsByAccount = {}, fail = false, listDelayMs = {},
  detail = null, putResults = [],
} = {}) {
  const state = { listCalls: [], folderWrites: 0, putBodies: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
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
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/api/auth/session') {
      return json({ success: true, data: { id: 'staff-1', name: `${role}利用者`, role, permissionKeys: [] }, csrfToken: 'test-csrf' })
    }
    if (path === '/api/line-accounts') return json({ success: true, data: ACCOUNTS })
    // 左メニューは表示設定を読む。形が違うと画面全体が落ちるので、既定の形で返す。
    if (path === '/api/settings/features') {
      return json({
        success: true,
        data: { features: {}, sidebarOrder: null, sidebarItemOrder: null, parentChildMode: false, specializedFeatureKeys: [], version: 1 },
      })
    }
    /*
     * #723: 編集画面の版競合を見るための口。
     *
     * 詳細は `contentRevision` を返し、保存（PUT）は `putResults` の順に
     * 結果を返す。409 は実物と同じ形（`error` / `message` / `data`）で返す。
     */
    if (detail && path === `/api/forms/${detail.id}/delete-impact`) {
      return json({ success: true, data: {
        form: { id: detail.id, name: detail.name, isActive: true, status: 'active' },
        submissionCount: 3, openCount: 5, references: [], referenceCount: 0,
        answerUrl: null, revision: 9, contentRevision: detail.contentRevision,
        checkedAt: '2026-09-11T10:00:00.000+09:00',
        canDelete: false, canArchive: true, recommendedAction: 'archive',
        blockers: ['has_submissions'],
      } })
    }
    if (detail && path === `/api/forms/${detail.id}`) {
      if (request.method() === 'PUT') {
        state.putBodies.push(JSON.parse(request.postData() ?? '{}'))
        const next = putResults.shift() ?? 'ok'
        if (next === 'conflict') {
          return json({
            success: false,
            error: 'form_content_changed',
            message: 'ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。',
            data: { contentRevision: detail.contentRevision + 1, updatedAt: '2026-09-11T14:32:00.000+09:00' },
          }, 409)
        }
        return json({ success: true, data: { ...detail, contentRevision: detail.contentRevision + 1 } })
      }
      return json({ success: true, data: detail })
    }
    if (path === '/api/forms') {
      if (fail) return json({ success: false, error: 'failed' }, 500)
      const accountId = url.searchParams.get('account_id')
      state.listCalls.push(accountId)
      const delay = listDelayMs[accountId ?? ''] ?? 0
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      const items = formsByAccount[accountId] ?? []
      return json({ success: true, data: { items, total: items.length, page: 1, limit: Math.max(items.length, 1) } })
    }
    /*
     * 編集画面は差し込み先の一覧も読む。`/api/scenarios` は
     * `{ items, total, limit, sort }` の封筒で返る口なので、素の配列で返すと
     * 画面側の読み替え（`data.items.map`）が落ちて読み込みごと失敗する。
     */
    if (path === '/api/scenarios') {
      return json({ success: true, data: { items: [], total: 0, limit: 0, sort: [] } })
    }
    if (path === '/api/folders') {
      if (request.method() !== 'GET') {
        state.folderWrites += 1
        return json({ success: false, error: 'Forbidden' }, 403)
      }
      // `GET /api/folders?kind=form` は実際に空で返る。forms 表に
      // `folder_id` が無く、どのフォームも分類へ入れられないため。
      return json({ success: true, data: [] })
    }
    return json({ success: true, data: [] })
  })

  return { context, page, state }
}

/**
 * この画面が「出し終えた」と言える条件。
 *
 * 認証の確認が済んで本体（`EMBIK`）が現れ、一覧が読み込み中でなくなり、
 * 表の行か「1件も無い／読み込めなかった」のどれかが立っている状態。
 * `ListState` が出す `data-list-state` をそのまま使う。
 */
async function waitForFormList(page) {
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-design-node="EMBIK"]')
      if (!root) return false
      if (root.querySelector('[data-list-state="loading"]')) return false
      return Boolean(
        root.querySelector('tbody tr')
        || root.querySelector('[data-list-state="empty"]')
        || root.querySelector('[data-list-state="error"]'),
      )
    }, undefined, { timeout: 15_000 })
  } catch (error) {
    console.error('browser current URL:', page.url())
    console.error('browser body:', (await page.locator('body').innerText()).slice(0, 2_000))
    throw error
  }
}

async function openList(page, search = '') {
  await page.goto(`${baseUrl}/form-submissions${search}`, { waitUntil: 'domcontentloaded' })
  await waitForFormList(page)
}

async function reloadList(page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForFormList(page)
}

const rows = (page) => page.locator('tbody tr')

/**
 * URLの検索文字が指した値になるまで待つ。
 *
 * `router.replace` は描画のあとに効くので、行数だけ見て次の行で
 * URLを読むと、まだ前の値のことがある。**待つ条件をURL自身にする。**
 */
function waitForQuery(page, key, value) {
  return page.waitForFunction(
    ([name, expected]) => new URL(location.href).searchParams.get(name) === expected,
    [key, value],
    { timeout: 10_000 },
  )
}

function waitForRowCount(page, count) {
  return page.waitForFunction(
    (expected) => document.querySelectorAll('tbody tr').length === expected,
    count,
    { timeout: 10_000 },
  )
}

const browser = await chromium.launch({ headless: true })
try {
  // 1. 並び順・表示件数・ページ送りが実際の一覧へ効き、URLと再読み込みへ残る（N-172）
  {
    const forms = Array.from({ length: 23 }, (_, index) => form(index + 1))
    const { context, page } = await openHarness(browser, { formsByAccount: { 'account-a': forms } })
    await openList(page)

    assert.equal(await rows(page).count(), 20, '既定は20件表示')

    await page.getByRole('button', { name: '並び順' }).click()
    await page.getByRole('button', { name: '回答が多い順', exact: true }).click()
    await waitForQuery(page, 'sort', 'answers')
    assert.equal((await rows(page).first().innerText()).includes('フォーム23'), true, '回答が多い順が先頭へ来る')

    await page.getByRole('button', { name: '次のページ' }).click()
    await waitForQuery(page, 'page', '2')
    await waitForRowCount(page, 3)
    await reloadList(page)
    assert.equal(await rows(page).count(), 3, '再読み込みしても2ページ目のまま')
    assert.equal((await rows(page).first().innerText()).includes('フォーム03'), true, '2ページ目の先頭が変わらない')

    await page.getByRole('button', { name: '表示件数' }).click()
    await page.getByRole('button', { name: '50件表示', exact: true }).click()
    await waitForQuery(page, 'limit', '50')
    await waitForRowCount(page, 23)
    assert.equal(/page=2/.test(page.url()), false, '件数を増やしたら1ページ目へ戻る')
    await reloadList(page)
    assert.equal(await rows(page).count(), 23, '再読み込みしても50件表示のまま')
    assert.equal((await page.getByRole('button', { name: '表示件数' }).innerText()).includes('50件表示'), true)
    await context.close()
  }

  // 2. 回答の導線と更新日時が、その行のフォームの実データを指す（N-173 / N-180）
  {
    const forms = [
      form(1, { id: 'sales-new', name: '営業フォーム', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }),
      form(2, { id: 'sales-old', name: '古い営業フォーム', updatedAt: null }),
    ]
    const { context, page } = await openHarness(browser, { formsByAccount: { 'account-a': forms } })
    await openList(page)

    const newLink = page.getByRole('link', { name: '営業フォームの集まった回答を見る', exact: true })
    const oldLink = page.getByRole('link', { name: '古い営業フォームの集まった回答を見る', exact: true })
    assert.equal(await newLink.getAttribute('href'), '/form-submissions/responses?id=sales-new')
    assert.equal(await oldLink.getAttribute('href'), '/form-submissions/responses?id=sales-old')

    const newRow = rows(page).filter({ has: newLink })
    const newRowText = await newRow.innerText()
    assert.equal(newRowText.includes('09/08'), true, '更新列に updated_at が出る')
    assert.equal(newRowText.includes('01/01'), false, '更新列に created_at を出さない')
    assert.equal(
      await rows(page).filter({ hasText: '古い営業フォーム' }).getByTitle('更新日時を取得できません').innerText(),
      '—',
      '更新日時が無い状態を0や作成日にすり替えない',
    )
    await context.close()
  }

  // 3. 権限：staff には実行できないフォルダ追加を出さない。owner / admin には理由付きで止めて置く
  {
    const { context, page, state } = await openHarness(browser, { role: 'staff', formsByAccount: { 'account-a': [form(1)] } })
    await openList(page)
    await page.getByRole('button', { name: 'すべて' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'フォルダを追加' }).count(), 0, 'staff にフォルダ追加を出さない')
    assert.equal(await page.getByTitle('フォームのフォルダ保存先は未接続です').count(), 0, '押せない灰色の口も残さない')
    assert.equal(state.folderWrites, 0, 'フォルダ作成の要求を出さない')
    await context.close()
  }
  for (const role of ['owner', 'admin']) {
    const { context, page, state } = await openHarness(browser, { role, formsByAccount: { 'account-a': [form(1)] } })
    await openList(page)
    const addFolder = page.getByRole('button', { name: 'フォルダを追加' })
    await addFolder.waitFor()
    assert.equal(await addFolder.isDisabled(), true, `${role} でも保存先が無いので押せない`)
    assert.equal(await addFolder.getAttribute('title'), 'フォームのフォルダ保存先は未接続です', '押せない理由を添える')
    await addFolder.click({ force: true })
    await page.waitForTimeout(300)
    assert.equal(await page.getByRole('textbox', { name: 'フォルダ名' }).count(), 0, '押しても入力欄は開かない')
    assert.equal(state.folderWrites, 0, '押してもフォルダ作成の要求は出ない')
    await context.close()
  }

  // 4. 初回空表示（N-181）と account 境界
  {
    const { context, page, state } = await openHarness(browser, {
      formsByAccount: { 'account-a': [], 'account-b': [form(7, { id: 'prod-form', name: '本店フォーム' })] },
    })
    await openList(page)
    await page.getByText('まだフォームがありません', { exact: true }).waitFor()
    await page.getByText('最初の1つを作ると、集まった回答もここから見られます。').waitFor()
    assert.equal(await page.getByText(/見え方です/).count(), 0, '実装事情の文を出さない')

    await page.getByLabel('LINEアカウント').selectOption('account-b')
    await page.getByText('本店フォーム', { exact: true }).waitFor()
    assert.equal(await page.getByText('まだフォームがありません', { exact: true }).count(), 0)
    assert.deepEqual([...new Set(state.listCalls)].sort(), ['account-a', 'account-b'], '選んだアカウント以外を読まない')
    await context.close()
  }

  // 5. 逆順応答：切替前の遅い応答が、あとから一覧を書き換えない
  {
    const { context, page } = await openHarness(browser, {
      formsByAccount: {
        'account-a': [form(1, { id: 'slow-form', name: '前のアカウントのフォーム' })],
        'account-b': [form(2, { id: 'fast-form', name: '本店フォーム' })],
      },
      listDelayMs: { 'account-a': 2_000 },
    })
    const lateListA = page.waitForResponse((response) =>
      response.url().includes('/api/forms') && response.url().includes('account_id=account-a'))
    await page.goto(`${baseUrl}/form-submissions`, { waitUntil: 'domcontentloaded' })
    const accountSelect = page.getByLabel('LINEアカウント')
    await accountSelect.waitFor()
    await accountSelect.selectOption('account-b')
    await page.getByText('本店フォーム', { exact: true }).waitFor()
    await lateListA
    await page.waitForTimeout(500)
    assert.equal(await page.getByText('前のアカウントのフォーム', { exact: true }).count(), 0, '切替前の遅い応答を混ぜない')
    assert.equal(await page.getByText('本店フォーム', { exact: true }).count(), 1, '切替後の一覧が残っている')
    await context.close()
  }

  // 6. 取得失敗を0件扱いにしない
  {
    const { context, page } = await openHarness(browser, { fail: true })
    await openList(page)
    await page.getByText('表示できませんでした', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '再読み込み' }).count(), 1)
    assert.equal(await page.getByText('まだフォームがありません', { exact: true }).count(), 0, '失敗を0件と言わない')
    await context.close()
  }

  /*
   * 7. 編集保存の版競合（#723）。
   *
   * ほかの人が先に保存していたとき（409）、**入力を捨てないこと**。
   * 読み直すかどうかは運用者が決める——押すまで読み直さない。
   */
  {
    const detail = {
      ...form(1, { id: 'form-1', name: 'サーバ側の名前' }),
      contentRevision: 4,
    }
    const { context, page, state } = await openHarness(browser, {
      formsByAccount: { 'account-a': [detail] },
      detail,
      putResults: ['conflict'],
    })
    /*
     * 編集画面へは**一覧の名前を押して**入る。直接 URL を開くと、静的書き出し
     * された頁では `useSearchParams` が `?id=` を拾えず、読み込みが始まらない。
     * 運用者の通り道と同じ経路で確かめる。
     */
    await openList(page)
    await page.getByRole('link', { name: 'サーバ側の名前', exact: true }).click()
    const nameInput = page.locator('#fm-name')
    await nameInput.waitFor({ timeout: 15_000 })
    await page.waitForFunction(
      () => document.querySelector('#fm-name')?.value === 'サーバ側の名前',
      undefined, { timeout: 15_000 },
    )

    await nameInput.fill('わたしが直した名前')
    await page.getByRole('button', { name: 'フォームを保存' }).click()

    const conflictButton = page.getByRole('button', { name: '最新の内容を読み込む（入力中の内容は消えます）' })
    await conflictButton.waitFor({ timeout: 15_000 })
    // 確認した版を送っている（送らなければサーバが 400 にする）。
    assert.equal(state.putBodies.length, 1, '保存を1回だけ出す')
    assert.equal(state.putBodies[0].expectedContentRevision, 4, '読み込んだ版をそのまま送る')
    // 相手がいつ保存したかを添える。
    await page.getByText(/ほかの人が.*に先に保存しました/).waitFor()
    // **ここが要点。入力は残っている。**
    assert.equal(await nameInput.inputValue(), 'わたしが直した名前', '409 で入力を捨てない')

    // 押すまで読み直さない。押したら相手の内容に入れ替わる。
    await conflictButton.click()
    await page.waitForFunction(() => document.querySelector('#fm-name')?.value === 'サーバ側の名前', undefined, { timeout: 15_000 })
    assert.equal(await page.getByRole('button', { name: '最新の内容を読み込む（入力中の内容は消えます）' }).count(), 0,
      '読み直したら競合の出口は消える')
    await context.close()
  }

  /*
   * 8. 受付停止も編集の版を送る（#723）。
   *
   * 免除すると、止めたはずのフォームが編集画面の保存で公開中に戻り、回答が
   * 入り続ける。**影響の版（`revision`=9）ではなく編集の版を送る**ことも見る。
   */
  {
    const detail = {
      ...form(1, { id: 'form-1', name: '停止するフォーム' }),
      contentRevision: 4,
    }
    const { context, page, state } = await openHarness(browser, {
      formsByAccount: { 'account-a': [detail] },
      detail,
    })
    await openList(page)
    await page.getByRole('button', { name: '停止するフォームを削除' }).click()
    const stop = page.getByRole('button', { name: '受付だけ止める' })
    await stop.waitFor({ timeout: 15_000 })
    await stop.click()
    await page.waitForFunction(() => true)
    await page.waitForTimeout(800)

    assert.equal(state.putBodies.length, 1, '受付停止で保存を1回出す')
    assert.equal(state.putBodies[0].isActive, false, '止める指示を送る')
    assert.equal(state.putBodies[0].expectedContentRevision, 4,
      '編集の版（contentRevision）を送る。影響の版 revision=9 を送らない')
    await context.close()
  }

  console.log('form submissions browser behavior: PASS')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
