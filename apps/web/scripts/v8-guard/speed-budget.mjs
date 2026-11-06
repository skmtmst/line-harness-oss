/**
 * V8の11場面を各5回測り、中央値と生の測定値を保存する。
 * node apps/web/scripts/v8-guard/speed-budget.mjs <baseUrl> [結果json]
 * node apps/web/scripts/v8-guard/speed-budget.mjs --local-stub apps/web/out [結果json]
 * 超過の扱いはspeed-outcome.mjsで決め、測定失敗は常に失敗とする。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {cpus,loadavg,platform,arch} from 'node:os'
import {execFileSync} from 'node:child_process'
import { chromium } from '@playwright/test'
import { screenReady } from './screen-ready.mjs'
import { finishSpeedCheck } from './speed-outcome.mjs'
import { SAMPLE_COUNT, REGRESSION_FACTOR, LONG_TASK_FLOOR_MS, ONE_FRAME_MS, speedPolicy } from './speed-policy.mjs'
export { screenReady } from './screen-ready.mjs'

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

/* 悪くなったら落とす幅（2026-10-04 司令塔決定①）。時間は20%か1回分、JS は1KB。 */
export { REGRESSION_FACTOR, ONE_FRAME_MS }
export const JS_SLACK_BYTES = 1024

/* 5回の中央値。外れ値と欠測は生の測定値と一緒に結果へ残す。 */
export function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
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
const debug = (message) => { if (process.env.DEBUG_SPEED === '1') console.log(message) }

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(([session]) => {
    try {
      for (const [k, v] of Object.entries(session)) localStorage.setItem(k, v)
      localStorage.setItem('lh_auth_selection_cleared', '1')
      /* V8 だけで測る（layout.tsx の THEME_BOOT がこれを読む）。 */
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
  const button = page.locator('main button:enabled:visible').first()
  if ((await button.count()) === 0) return null
  await button.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
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

/* fetchApi は credentials: include。差し替えでも * ではなく要求元を返す。
   file 直開きの Origin は null。ログイン情報付きの通信をブラウザに拒否させない。 */
function apiCorsHeaders(route) {
  return {
    'Access-Control-Allow-Origin': route.request().headers().origin ?? 'null',
    'Access-Control-Allow-Credentials': 'true',
  }
}

/* 偽APIの答えをそのまま運ぶ（待ち受けなし方式の差し替え）。 */
export async function stubApi(page, mockFetch) {
  const answer = async (route) => {
    const url = new URL(route.request().url())
    const path = `${url.pathname}${url.search}`
    const answered = await mockFetch(route.request().method(), path)
    await route.fulfill({
      status: answered.status,
      contentType: 'application/json; charset=utf-8',
      headers: apiCorsHeaders(route),
      body: answered.body,
    })
  }
  await page.route('**/api/**', answer)
  // The shell also requests version/manifest endpoints outside /api. Keep the same fixture
  // as CI, rather than mixing real staging latency into a local-stub run.
  await page.route('**/admin/**', answer)
}

export async function gotoTarget(page, target, waitUntil = 'commit') {
  // 標準画面は従来の通信待ちを保つ。負荷画面は下の実データの印で判定する。
  // 通信待ちがtimeoutしても、描画中の画面を再読込しない。
  try {
    const response = await page.goto(target, { waitUntil, timeout: 20000 })
    if (response && !response.ok()) throw new Error(`文書を取得できません: HTTP ${response.status()} ${target}`)
  } catch (error) {
    if (waitUntil !== 'networkidle' || error.name !== 'TimeoutError') throw error
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 })
  }
}

export async function measureScreen(browser, target, name, route) {
  const page = await newPage(browser)
  try {
  if (target.stub) await stubApi(page, target.mockFetch)
  const start = Date.now()
  debug(`${name}: document`)
  await gotoTarget(page, target.url(route), 'networkidle')
  debug(`${name}: data-ready`)
  await waitForScreenReady(page, route)
  if (SLOW_MS) await page.waitForTimeout(SLOW_MS)
  const showMs = Date.now() - start
  /* 押す前の落ち着いた状態で LCP と JS を読む。長い作業は押した後も足す。 */
  debug(`${name}: lcp`)
  const lcpMs = await readLcpMs(page)
  const before = await readPageMetrics(page)
  debug(`${name}: press`)
  const pressMs = await measurePress(page)
  const after = await readPageMetrics(page)
  return {
    name,
    route,
    showMs,
    pressMs,
    lcpMs,
    jsBytes: before.jsBytes,
    longTaskMs: Math.max(before.longTaskMs, after.longTaskMs),
  }
  } finally {
    await page.close()
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
  if (!json || json.success === false || !Array.isArray(wrap?.items) || wrap.items.length === 0) return null
  const first = wrap.items[0]
  const items = Array.from({ length: 2000 }, (_, i) => ({ ...first, id: `stress-${i}` }))
  return json?.data && Array.isArray(json.data.items)
    ? JSON.stringify({ ...json, data: { ...json.data, items, total: 2000 } })
    : JSON.stringify({ ...json, items, total: 2000 })
}

export async function installStressApi(page, target) {
  const state = { rows: 0, error: null }
  // Playwright は最後に登録した route を先に使う。一般APIを先に置く。
  if (target.stub) await stubApi(page, target.mockFetch)
  await page.route('**/api/friends*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/friends') return route.fallback()
    try {
      const answered = target.stub
        ? await target.mockFetch(route.request().method(), `${url.pathname}${url.search}`)
        : await route.fetch().then(async (res) => ({ status: res.status(), body: await res.text() }))
      if (answered.status !== 200) throw new Error(`友だちの取得失敗: HTTP ${answered.status}`)
      const big = expandFriends(answered.body)
      if (!big) throw new Error('2,000行の元になる友だちを取得できませんでした')
      state.rows = (JSON.parse(big).data ?? JSON.parse(big)).items.length
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: apiCorsHeaders(route), body: big })
    } catch (error) {
      state.error = error
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: error.message }) })
    }
  })
  return state
}

/** 2,000行を返したという実際の応答を確かめる。予定の行数は結果に書かない。 */
export function assertStressResponse(state) {
  if (state.error) throw state.error
  if (state.rows !== 2000) throw new Error(`2,000行を取得できていません（実際 ${state.rows}行）`)
  return state.rows
}

export async function waitForScreenReady(page, route, expectedRows = null) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
  // 負荷画面は遅くても測り切って超過として報告する。速度の合格基準は変えない。
  const timeout = expectedRows === null ? 15000 : 180000
  const handle = await page.waitForFunction(screenReady, { route, expectedRows }, { timeout })
  const state = await handle.jsonValue()
  if (state !== true) throw new Error(`${route}: データを読み込めないため速度を測れません（${state}）`)
}

/* 友だち一覧に 2,000 行を返して、スクロール中の長い作業を測る。 */
export async function measureStress(browser, target) {
  const page = await newPage(browser)
  try {
  const responseState = await installStressApi(page, target)
  const start = Date.now()
  debug('friends-2000: document')
  await gotoTarget(page, target.url('/friends'), 'commit')
  debug('friends-2000: data-ready')
  await waitForScreenReady(page, '/friends', 2000)
  const rows = assertStressResponse(responseState)
  if (SLOW_MS) await page.waitForTimeout(SLOW_MS)
  const renderedRows = await page.locator('[data-friend-row]').count()
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
  return { name: 'friends-2000', route: '/friends', showMs, pressMs: null, lcpMs, ...rest, rows, renderedRows }
  } finally {
    await page.close()
  }
}

/* 時間は「20%」か「画面の書き換え1回分（17ms）」の大きい方まで許す。
   1回分は測り方の粒の揺れで、悪化とは呼ばない。JS は従来の1KBだけ。 */
export function budgetLimit(metric, baseline, policy = speedPolicy('local')) {
  if (metric === 'jsBytes') return baseline + JS_SLACK_BYTES
  const floor = metric === 'longTaskMs' ? Math.max(baseline, LONG_TASK_FLOOR_MS) : baseline
  const allowed = Math.max(floor * REGRESSION_FACTOR, floor + ONE_FRAME_MS)
  return allowed * policy.timeFactor
}

/* 落とすのは悪化だけ。時間は20%か1回分、JS は1KB（2026-10-04 司令塔決定①）。 */
export function budgetExceedances(measured, baselines, policy = speedPolicy('local')) {
  const exceedances = []
  for (const m of measured) {
    const base = baselines[m.name]
    if (!base) continue
    for (const metric of ['showMs', 'lcpMs', 'pressMs', 'longTaskMs', 'jsBytes']) {
      const value = m[metric], b = base[metric]
      if (!Number.isFinite(value) || !Number.isFinite(b)) continue
      const limit = budgetLimit(metric, b, policy)
      if (value > limit) exceedances.push({ screen: m.name, metric, value, limit, unit: metric === 'jsBytes' ? 'B' : 'ms', check: 'budget' })
    }
  }
  return exceedances
}

function judge(measured, baselines, policy = speedPolicy('local')) {
  return budgetExceedances(measured, baselines, policy).map(row => `${row.screen} ${row.metric}=${row.value} が許容上限 ${row.limit} を超過`)
}

export function targetExceedances(measured, targets) {
  return measured.flatMap(m => Object.entries(targets).filter(([metric, limit]) => Number.isFinite(m[metric]) && Number.isFinite(limit) && m[metric] > limit)
    .map(([metric, limit]) => ({ screen: m.name, metric, value: m[metric], limit, unit: metric === 'jsBytes' ? 'B' : 'ms', check: 'target' })))
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
  if (process.env.V8_GUARD_STUB_API === '1') {
    const { mockFetch } = await import('./mock-local.mjs')
    return { stub: true, mockFetch, url: (route) => new URL(route, baseUrl).toString() }
  }
  return { stub: false, url: (route) => new URL(route, baseUrl).toString() }
}

/* 各回を順番に測る。失敗した回を成功した回へ差し替えない。 */
export async function measureMedian(run) {
  const samples = []
  for (let i = 0; i < SAMPLE_COUNT; i += 1) samples.push(await run())
  const at = (key) => {
    const values = samples.map((sample) => sample[key])
    const count = values.filter(Number.isFinite).length
    const nullable = ['lcpMs', 'pressMs'].includes(key)
    if ((!nullable || count > 0) && count < Math.ceil(SAMPLE_COUNT / 2)) {
      throw new Error(`${samples[0].name} ${key}: 5回のうち${count}回しか測れませんでした`)
    }
    return median(values)
  }
  return {
    ...samples[0],
    showMs: at('showMs'),
    lcpMs: at('lcpMs'),
    pressMs: at('pressMs'),
    longTaskMs: at('longTaskMs'),
    jsBytes: at('jsBytes'),
    samples,
  }
}

function checkpoint(out, measured, error = null, policy = null, environment = null) {
  if (!out) return
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify({ measured, complete: measured.length === 11 && !error, error, policy, environment }, null, 2)}\n`)
}

async function main() {
  const { updateBaseline, stubDir, out, baseUrl } = parseArgs(process.argv.slice(2))
  const measured = []
  let browser = null
  let policy = null
  let environment = null
  checkpoint(out, measured)
  try {
  policy = speedPolicy()
  const target = await buildTarget({ stubDir, baseUrl })
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'))
  browser = await chromium.launch()
  const {mockFingerprint}=await import('../../../../scripts/visual-qa/mock-fingerprint.mjs')
  const cpu=cpus()
  environment={platform:platform(),arch:arch(),node:process.version,chromium:browser.version(),cpu:cpu[0]?.model,cpuCount:cpu.length,loadAverage:loadavg(),viewport:[1440,900],cpuThrottleRate:1,transport:target.stub?'route-fixture':'http-api',fixtureFingerprint:mockFingerprint(),worktreeSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString()}
  console.log(`測定条件: ${policy.profile}・各${policy.sampleCount}回の中央値・時間倍率${policy.timeFactor}`)
  for (const [name, route] of Object.entries(SPEED_ROUTES)) {
    console.log(`測定開始: ${name}`)
    measured.push(await measureMedian(() => measureScreen(browser, target, name, route)))
    checkpoint(out, measured, null, policy, environment)
    console.log(`測定完了: ${name} showMs=${measured.at(-1).showMs}`)
  }
  console.log('測定開始: friends-2000')
  measured.push(await measureMedian(() => measureStress(browser, target)))
  environment.finishedAt=new Date().toISOString()
  checkpoint(out, measured, null, policy, environment)
  return { budget, updateBaseline, out, measured, policy, environment }
  } catch (error) {
    checkpoint(out, measured, error.message, policy, environment)
    throw error
  } finally {
    await browser?.close()
  }
}

export { expandFriends, judge, parseArgs, targetMisses }

if (isMain) {
  const { budget, updateBaseline, out, measured, policy, environment } = await main()

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
    checkpoint(out, measured, null, policy, environment)
  }

  console.log('name showMs lcpMs pressMs longTaskMs jsBytes')
  for (const m of measured) {
    console.log(`${m.name} ${m.showMs} ${m.lcpMs ?? '-'} ${m.pressMs ?? '-'} ${m.longTaskMs} ${m.jsBytes}`)
  }

  const exceedances = updateBaseline ? [] : budgetExceedances(measured, budget.baselines, policy)
  const targets = targetExceedances(measured, budget.targets ?? {})
  if (out) writeFileSync(out, `${JSON.stringify({ measured, complete: true, error: null, policy, environment, budgetExceedances: exceedances, targetExceedances: targets }, null, 2)}\n`)
  process.exitCode = finishSpeedCheck(exceedances, '速さ予算')
  for (const miss of targetMisses(measured, budget.targets ?? {})) console.log(`目標未達: ${miss}`)
}
