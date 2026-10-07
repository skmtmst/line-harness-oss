/*
 * V8 の速さ予算を測る道具（2026-10-04 オーナー採用「1」）。
 *
 * 主要10画面を **V8 でだけ**開き、表示までの時間・押してからの反応・
 * 長い作業・最初に読む JS の量を測る。v7 は開かない・変えない。
 * 偽の API（画面確認用のモック）を使い、一覧に 2,000 行を返す場面も測る。
 *
 *   node apps/web/scripts/v8-guard/speed-budget.mjs <baseUrl> [結果json]
 *   node apps/web/scripts/v8-guard/speed-budget.mjs <baseUrl> --update-baseline
 *
 * 手元の砂場では待ち受けが禁止なので、ファイル直開き＋通信差し替えで測る：
 *   node apps/web/scripts/v8-guard/speed-budget.mjs --local-stub apps/web/out --update-baseline
 * 中身（JS・偽APIのデータ・描画）は本物そのまま。運び方だけ違う。
 *
 * 予算（speed-budget.json と同じ値を使う）:
 *   表示 showMs・LCP lcpMs … 1,000ms 以内
 *   反応 pressMs          … 100ms 以内（押してから次の描画まで）
 *   長い作業 longTaskMs   … 50ms 以内（longtask が出たら超過）
 *   JS jsBytes            … ラチェット（基準より1バイトでも増えたら超過）
 * 判定は「悪くなったら落とす」だけ（2026-10-04 司令塔決定）。
 *   時間（表示・LCP・反応・長い作業）… 1画面3回測って真ん中の値で比べ、
 *     基準より 20% を超えて悪くなったら落ちる
 *     反応 pressMs だけは「20% と 1フレーム 17ms の大きい方」を超えたら落ちる
 *     （描画1回ぶんのぶれで落ちないため）
 *   JS jsBytes … 基準より 1KB を超えて増えたら落ちる。
 *     ただし同じ PR で speed-budget.json の基準を更新していれば通す
 *     （機能を足すと JS は増えるため。理由は PR に書くこと）
 * 良くなったら --update-baseline で基準を更新する（人が意図して回す）。
 *
 * 目標（表示1秒・反応100ms・長い作業50ms）は別の表 `targets` に残す。
 * 届いていない画面は結果に出すだけで、落とさない。
 *
 * 対照（わざと遅くすると落ちること）: SLOW_MS=800 を付けると各画面の
 * 表示後に 800ms 待ってから測る。showMs が約800ms 増えて予算で落ちる。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BUDGET_PATH = join(HERE, 'speed-budget.json')

/* 測る10画面。ゴール文の順番のまま（ダッシュボード・受信箱・友だち・
   一斉配信の一覧と作成・テンプレート・予約・回答・タグ・設定）。 */
export const SPEED_ROUTES = {
  dashboard: '/',
  inbox: '/chats',
  friends: '/friends',
  broadcasts: '/broadcasts',
  'broadcast-new': '/broadcasts/new',
  templates: '/templates',
  booking: '/booking/bookings',
  answers: '/form-submissions',
  tags: '/tags',
  settings: '/settings',
}

/* 悪くなったら落とす幅（2026-10-04 司令塔決定①）。時間は20%、JS は1KB。 */
export const REGRESSION_FACTOR = 1.2
export const JS_SLACK_BYTES = 1024
/* 反応 pressMs は描画1回（約16.7ms）単位でしか動かない。基準 67ms の20%は
   13ms で1フレームより狭く、関係ない PR が 67↔83 で交互に落ちた（2026-10-04）。
   反応だけは「20% と 1フレーム（17ms）の大きい方」まで許す。ほかの時間は20%のまま。 */
export const PRESS_FRAME_SLACK_MS = 17

/* その項目で「ここまでは通す」上限。超えたら落ちる。 */
export function allowedMax(key, baseline) {
  const byFactor = baseline * REGRESSION_FACTOR
  if (key === 'pressMs') return Math.max(byFactor, baseline + PRESS_FRAME_SLACK_MS)
  return byFactor
}

/* 3回測って真ん中。1回のぶれ（CIで表示が15〜24%揺れた）に引っ張られないため。 */
export function median(values) {
  const nums = values.filter((v) => typeof v === 'number').sort((a, b) => a - b)
  if (!nums.length) return null
  return nums[Math.floor(nums.length / 2)]
}

const SESSION = {
  lh_csrf: 'visual-qa-csrf',
  lh_staff_role: 'owner',
  lh_staff_name: 'K',
  lh_staff_permissions: '[]',
  lh_staff_view_permissions: '[]',
  lh_selected_account: 'visual-qa-account',
}

const SLOW_MS = Number(process.env.SLOW_MS ?? 0)

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(([session]) => {
    try {
      for (const [k, v] of Object.entries(session)) localStorage.setItem(k, v)
      localStorage.setItem('lh_auth_selection_cleared', '1')
      /* V8 だけで測る（layout.tsx の THEME_BOOT がこれを読む）。 */
      localStorage.setItem('lh-admin-theme', 'v8')
    } catch {
      /* ファイル直開きで置き場が無いときは何もしない */
    }
    window.__lt = []
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push(e.duration)
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      /* longtask が無いブラウザでは 0 のまま */
    }
  }, [SESSION])
  return page
}

async function readPageMetrics(page) {
  return page.evaluate(() => {
    /* 運び方（http・file）で変わらない、圧縮前の JS の大きさで比べる。 */
    const jsBytes = performance
      .getEntriesByType('resource')
      .filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name))
      .reduce((sum, r) => sum + (r.decodedBodySize || r.encodedBodySize || r.transferSize || 0), 0)
    const longTasks = Array.isArray(window.__lt) ? window.__lt : []
    return {
      jsBytes: Math.round(jsBytes),
      longTaskMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
    }
  })
}

/* LCP は溜めた記録から読む。直接読むと空のことがある（CI初回で全画面 null になった）。 */
async function readLcpMs(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const pick = (list) => {
      const last = list[list.length - 1]
      return last ? Math.round(last.renderTime || last.startTime) : null
    }
    let value = null
    try {
      value = pick(performance.getEntriesByType('largest-contentful-paint'))
      const po = new PerformanceObserver((entries) => {
        const next = pick(entries.getEntries())
        if (next != null) value = next
      })
      po.observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => {
        try {
          po.disconnect()
        } catch {
          /* 止められなくても答えは返す */
        }
        resolve(value)
      }, 800)
    } catch {
      resolve(value)
    }
  }))
}

/* 最初の押せるボタンを押して、次の描画までの時間を測る（INP の代わり）。 */
async function measurePress(page) {
  const button = page.locator('main button:enabled').first()
  if ((await button.count()) === 0) return null
  await button.scrollIntoViewIfNeeded().catch(() => {})
  const start = Date.now()
  /* 押せなかったとき（CI初回は作成画面で5秒待った）は測らず null。 */
  let clicked = false
  await button.click({ timeout: 5000 }).then(() => {
    clicked = true
  }).catch(() => {})
  if (!clicked) return null
  await page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(done))
  })).catch(() => {})
  return Date.now() - start
}

/* 偽APIの答えをそのまま運ぶ（待ち受けなし方式の差し替え）。 */
async function stubApi(page, mockFetch) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url)
    const path = `${url.pathname}${url.search}`
    const answered = await mockFetch(route.request().method(), path)
    await route.fulfill({
      status: answered.status,
      contentType: 'application/json; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: answered.body,
    })
  })
}

async function gotoTarget(page, target) {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 20000 })
    .catch(() => page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }))
}

async function measureScreen(browser, target, name, route) {
  const page = await newPage(browser)
  if (target.stub) await stubApi(page, target.mockFetch)
  const start = Date.now()
  await gotoTarget(page, target.url(route))
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 })
  if (SLOW_MS) await page.waitForTimeout(SLOW_MS)
  const showMs = Date.now() - start
  /* 押す前の落ち着いた状態で LCP と JS を読む。長い作業は押した後も足す。 */
  const lcpMs = await readLcpMs(page)
  const before = await readPageMetrics(page)
  const pressMs = await measurePress(page)
  const after = await readPageMetrics(page)
  await page.close()
  return {
    name,
    route,
    showMs,
    pressMs,
    lcpMs,
    jsBytes: before.jsBytes,
    longTaskMs: Math.max(before.longTaskMs, after.longTaskMs),
  }
}

/* 2,000 行に膨らませる（運び方で取り方だけ変える。中身は本物の1行目）。 */
function expandFriends(bodyText) {
  let json = null
  try {
    json = JSON.parse(bodyText)
  } catch {
    return null
  }
  const wrap = json?.data && Array.isArray(json.data.items) ? json.data : json
  if (!json || !Array.isArray(wrap?.items) || wrap.items.length === 0) return null
  const first = wrap.items[0]
  const items = Array.from({ length: 2000 }, (_, i) => ({ ...first, id: `stress-${i}` }))
  return json?.data && Array.isArray(json.data.items)
    ? JSON.stringify({ ...json, data: { ...json.data, items, total: 2000 } })
    : JSON.stringify({ ...json, items, total: 2000 })
}

/* 友だち一覧に 2,000 行を返して、スクロール中の長い作業を測る。 */
async function measureStress(browser, target) {
  const page = await newPage(browser)
  if (target.stub) {
    await page.route('**/api/friends*', async (route) => {
      const url = new URL(route.request().url)
      const answered = await target.mockFetch(route.request().method(), `${url.pathname}${url.search}`)
      const big = expandFriends(answered.body)
      if (!big) {
        await route.fulfill({ status: answered.status, contentType: 'application/json; charset=utf-8', body: answered.body })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: big,
      })
    })
    await stubApi(page, target.mockFetch)
  } else {
    await page.route('**/api/friends*', async (route) => {
      const res = await route.fetch()
      const big = expandFriends(await res.text())
      if (!big) {
        await route.continue()
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: big })
    })
  }
  const start = Date.now()
  await gotoTarget(page, target.url('/friends'))
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 })
  const showMs = Date.now() - start
  /* 一気に下まで 20 回に分けて送る。途中の長い作業が記録される。 */
  await page.evaluate(async () => {
    const scroller = document.querySelector('main') ?? document.scrollingElement
    for (let i = 1; i <= 20; i += 1) {
      if (scroller === document.scrollingElement) window.scrollTo(0, (document.body.scrollHeight * i) / 20)
      else scroller.scrollTop = (scroller.scrollHeight * i) / 20
      await new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(done)) })
    }
    window.scrollTo(0, 0)
    if (scroller !== document.scrollingElement) scroller.scrollTop = 0
  })
  const lcpMs = await readLcpMs(page)
  const rest = await readPageMetrics(page)
  await page.close()
  return { name: 'friends-2000', route: '/friends', showMs, pressMs: null, lcpMs, ...rest, rows: 2000 }
}

/* 落とすのは悪化だけ。時間は20%、JS は1KB（2026-10-04 司令塔決定①）。 */
function judge(measured, baselines) {
  const failures = []
  for (const m of measured) {
    const base = baselines[m.name]
    if (!base) continue
    for (const key of ['showMs', 'lcpMs', 'pressMs', 'longTaskMs']) {
      const value = m[key]
      const b = base[key]
      if (typeof value !== 'number' || typeof b !== 'number') continue
      if (value > allowedMax(key, b)) {
        const margin = key === 'pressMs' ? `20%と1フレーム（${PRESS_FRAME_SLACK_MS}ms）の大きい方` : '20%'
        failures.push(`${m.name} ${key}=${value} が基準 ${b} より${margin}を超えて悪い`)
      }
    }
    if (typeof m.jsBytes === 'number' && typeof base.jsBytes === 'number'
      && m.jsBytes > base.jsBytes + JS_SLACK_BYTES) {
      failures.push(`${m.name} jsBytes=${m.jsBytes} が基準 ${base.jsBytes} より1KBを超えて増えた（機能追加で増える場合は同じPRで基準を更新し理由をPRに書く）`)
    }
  }
  return failures
}

/* 同じ PR で基準を更新済みなら JS 超過は通す（理由は PR に書くこと）。
   時間の悪化は通さない。判定の数値（20%・1KB）は変えない。 */
export function applyJsBaselineAllowance(failures, allowed) {
  if (!allowed) return { failures, notices: [] }
  return {
    failures: failures.filter((f) => !f.includes('jsBytes=')),
    notices: failures.filter((f) => f.includes('jsBytes=')),
  }
}

/* 目標に届いていない画面。結果に出すだけで、落とさない（司令塔決定②）。 */
function targetMisses(measured, targets) {
  const misses = []
  const pairs = [['showMs', '表示'], ['lcpMs', 'LCP'], ['pressMs', '反応'], ['longTaskMs', '長い作業']]
  for (const m of measured) {
    for (const [key, label] of pairs) {
      const value = m[key]
      const t = targets[key]
      if (typeof value === 'number' && typeof t === 'number' && value > t) {
        misses.push(`${m.name} ${label}=${value}（目標 ${t} に届いていない）`)
      }
    }
  }
  return misses
}

/* 直接実行されたときだけ測る。読み込まれたときは道具だけ貸す（試験用）。 */
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

function parseArgs(args) {
  const updateBaseline = args.includes('--update-baseline')
  const stubIndex = args.indexOf('--local-stub')
  const stubDir = stubIndex >= 0 ? args[stubIndex + 1] : null
  const out = args.find((a) => a && a !== '--update-baseline' && a !== '--local-stub' && args[args.indexOf(a) - 1] !== '--local-stub' && !a.startsWith('http'))
  const baseUrl = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4310'
  return { updateBaseline, stubDir, out, baseUrl }
}

/* 行き先。ふつうは配った out を開く。--local-stub では書き出し済みを直開きする。 */
async function buildTarget({ stubDir, baseUrl }) {
  if (stubDir) {
    const { pathToFileURL } = await import('node:url')
    const { resolve } = await import('node:path')
    const root = resolve(stubDir)
    const { mockFetch } = await import('./mock-local.mjs')
    return {
      stub: true,
      mockFetch,
      url: (route) => pathToFileURL(join(root, route === '/' ? 'index.html' : `${route.slice(1)}.html`)).href,
    }
  }
  return { stub: false, url: (route) => new URL(route, baseUrl).toString() }
}

/* 1画面3回測って真ん中を残す（司令塔決定①）。 */
async function measureMedian(run) {
  const tries = [await run(), await run(), await run()]
  const at = (key) => median(tries.map((t) => t[key]))
  return {
    ...tries[0],
    showMs: at('showMs'),
    lcpMs: at('lcpMs'),
    pressMs: at('pressMs'),
    longTaskMs: at('longTaskMs'),
    jsBytes: at('jsBytes'),
  }
}

async function main() {
  const { updateBaseline, stubDir, out, baseUrl } = parseArgs(process.argv.slice(2))
  const target = await buildTarget({ stubDir, baseUrl })
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'))
  const browser = await chromium.launch()
  const measured = []
  for (const [name, route] of Object.entries(SPEED_ROUTES)) {
    measured.push(await measureMedian(() => measureScreen(browser, target, name, route)))
  }
  measured.push(await measureMedian(() => measureStress(browser, target)))
  await browser.close()
  return { budget, updateBaseline, out, measured }
}

export { expandFriends, judge, parseArgs, targetMisses }

if (isMain) {
  const { budget, updateBaseline, out, measured } = await main()

  if (updateBaseline) {
    const next = {
      ...budget,
      updated: new Date().toISOString(),
      baselines: Object.fromEntries(measured.map((m) => [m.name, {
        route: m.route,
        showMs: m.showMs,
        lcpMs: m.lcpMs,
        pressMs: m.pressMs,
        longTaskMs: m.longTaskMs,
        jsBytes: m.jsBytes,
        ...(m.rows ? { rows: m.rows } : {}),
      }])),
    }
    writeFileSync(BUDGET_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`基準を更新した → ${BUDGET_PATH}`)
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify({ measured }, null, 2)}\n`)
  }

  console.log('name showMs lcpMs pressMs longTaskMs jsBytes')
  for (const m of measured) {
    console.log(`${m.name} ${m.showMs} ${m.lcpMs ?? '-'} ${m.pressMs ?? '-'} ${m.longTaskMs} ${m.jsBytes}`)
  }

  /* 同じ PR で基準を更新済みなら JS 超過は通す。CI が環境変数で教える。 */
  const allowJs = process.env.ALLOW_JS_BASELINE_UPDATE === '1'
  const judged = updateBaseline ? { failures: [], notices: [] } : applyJsBaselineAllowance(judge(measured, budget.baselines), allowJs)
  const failures = judged.failures
  /* 目標に届いていない画面は出すだけ。落とさない（司令塔決定②）。 */
  for (const miss of targetMisses(measured, budget.targets ?? {})) {
    console.log(`目標未達: ${miss}`)
  }
  for (const notice of judged.notices) {
    console.log(`基準更新あり: ${notice}`)
  }
  if (failures.length) {
    for (const f of failures) console.log(`予算超過: ${f}`)
    process.exit(1)
  }
  console.log(`速さ予算: 合格（${measured.length}画面）`)
}
