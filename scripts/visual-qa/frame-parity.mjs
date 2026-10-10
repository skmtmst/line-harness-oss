#!/usr/bin/env node
/*
 * 絵と画面の「文字の位置」を測る道具（デリバリー受注の6枚ぶん）。
 *
 * なぜ新しく書いたか
 * ------------------
 * `docs/v8-design-rules.md` §3 は合格の測り方を `~/lh-work/tools/hq/measure.sh` と定め、
 * 合格の台帳を `~/lh-work/design/v8/PASSED.tsv` と定めている。
 * この作業場所には `~/lh-work` が無い（司令塔のマシンの中にある）。
 * だから **この回の測り方を自分で書いて、数字の出どころを書き残す**。
 * 同じことを `apps/web/src/v8/hq-banners/BEHAVIOR.md` が前にやっている。
 *
 * ここで出る % は**この回に自分で書いた測り方の数字**で、正本の % ではない。
 * 位置の合否はレーンが決めてはいけない（§3）。この道具も合否を書かない。
 *
 * 測り方
 * ------
 * 1. 絵： `v8-design-refs/<板>.html`（Pencil の書き出し）を `file://` で開く。
 *    枠の根は body の (0,0) にあるので、窓の座標とそのまま比べられる。
 * 2. 画面： 開発サーバーの `/restaurant-test/delivery` を開く。
 *    ログインの印を `addInitScript` で先に置き、API は `page.route` で仮のこたえに差し替える。
 *    仮のこたえは `delivery-fixtures.mjs`（絵に出ている文字と同じ件数・同じ並び）。
 * 3. 両方で同じ関数（MEASURE）を動かし、文字の葉ごとに矩形を取る。
 *    **測る前に全要素の `scrollTop`/`scrollLeft` を 0 に戻す**（管理画面は中の容器が送られる）。
 * 4. 同じ文字を順に突き合わせ、ずれ（dx, dy）を出す。
 *    同じ文字が2か所にあるときは、直前に合った文字のずれに近い方を選ぶ。
 * 5. 生のまま／全体のずれを引いたあと／左メニューと右側を別に直したあと、の3通りで
 *    ±4px に入る割合を出す。行の送り（間隔）も比べる。
 *
 * 使い方
 *   # 1. 開発サーバーを上げる。環境の値は**2つとも**必ず付ける。
 *   #    - `NEXT_PUBLIC_API_URL`：`apps/web/src/lib/api.ts` は未設定だと読み込みの時点で
 *   #      投げるので、付けないと画面が 500 になり、文字が1つも出ない。
 *   #      値は `scripts/visual-qa/v8-parity.mjs` と同じ地元の口でよい。
 *   #    - `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true`：無いと
 *   #      `apps/web/src/app/restaurant-test/layout.tsx` が server 側で `redirect('/hq')` し、
 *   #      統括のアカウント一覧が出て測れない（`docs/v8-screen-playbook.md` §4の表に載っている）。
 *   #      CI も同じ2つを付けている（`.github/workflows/required-pr-gate.yml`）。
 *   #    API は下の `context.route` で全部差し替えるので、仮サーバーは動かさなくても済む。
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true \
 *     pnpm --filter web exec next dev --port 3101 &
 *
 *   # 2. 測る。
 *   node scripts/visual-qa/frame-parity.mjs            # 1440 と 1152
 *   VISUAL_QA_BASE=http://localhost:3101 node scripts/visual-qa/frame-parity.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESIGN_DIR = path.join(HERE, 'v8-design-refs')
const OUT_DIR = path.join(HERE, 'v8-parity-out', 'delivery')
const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

const {
  DELIVERY_CLOCK,
  ordersData,
  orderDetailData,
  historyData,
  menuItemsData,
  restaurantSnapshot,
  featureSettings,
  featureVisibility,
} = await import('./delivery-fixtures.mjs')

/* ── 測る枠 ──────────────────────────────────────────────── */

const ROUTE = '/restaurant-test/delivery'

/**
 * `open` は窓を出すための操作。文字で押す（印は押さない）。
 * `designHeight` は絵の枠の高さ（Pencil の書き出しに入っている）。
 */
const FRAMES = [
  { id: 'kDQHr', name: 'D-1 注文一覧', kind: '板', url: `${ROUTE}?tab=new`, open: [] },
  { id: 'hjdqV', name: 'D-2 注文の詳細', kind: '窓', url: `${ROUTE}?tab=new&id=ord-ue-1042`, open: [] },
  { id: 'dgeTy', name: 'D-3 キャンセルの確認', kind: '窓', url: `${ROUTE}?tab=new&id=ord-ue-1042`, open: ['キャンセル'] },
  { id: 'OzHLO', name: 'D-4 注文履歴・売上', kind: '板', url: `${ROUTE}?view=history`, open: [] },
  { id: 'h7OeT', name: 'D-5 品切れ一括設定', kind: '板', url: `${ROUTE}?view=sold-out`, open: [] },
  { id: 'XCVGd', name: 'D-6 受付の一括停止', kind: '窓', url: `${ROUTE}?tab=new`, open: ['受付を一括停止'] },
]

/* 絵の側だけにある飾り。模型用の注記と、絵が写していない共通の帯は突き合わせから外す。 */
const DESIGN_ONLY = [
  'デリバリー受注 v02（検討用）', // 左メニューの下にある模型の注記
]
/* 画面の側だけにある共通の帯（CHz31「検証環境の帯」）。絵の6枚は写していない。 */
const IMPL_ONLY = [
  '検証環境専用',
  '既存の然-NEN運用とは分離された飲食店向けテスト領域です。',
  'デリバリー3社とは検証用の接続・本番の注文は流れません',
]

/* 左メニューと右側の境目（絵の左メニューは 240px 幅）。 */
const SIDEBAR_EDGE = 240

/* ── 画面の中で動かす測り方（絵と画面で同じものを使う） ──────── */

const MEASURE = () => {
  document.querySelectorAll('*').forEach((el) => {
    if (el.scrollTop) el.scrollTop = 0
    if (el.scrollLeft) el.scrollLeft = 0
  })
  window.scrollTo(0, 0)

  const nodes = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node = walk.nextNode()
  while (node) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    const parent = node.parentElement
    if (text && text.length <= 60 && parent) {
      const cs = getComputedStyle(parent)
      const shown = cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0
      if (shown) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const box = range.getBoundingClientRect()
        if (box.width > 0 || box.height > 0) {
          nodes.push({
            text,
            x: Math.round(box.left),
            y: Math.round(box.top),
            w: Math.round(box.width),
            h: Math.round(box.height),
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            color: cs.color,
          })
        }
      }
    }
    node = walk.nextNode()
  }

  const docWidth = document.documentElement.clientWidth
  const breach = []
  document.querySelectorAll('*').forEach((el) => {
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    if (box.right > docWidth + 1) {
      breach.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 48),
        right: Math.round(box.right),
      })
    }
  })

  return {
    nodes,
    docWidth,
    scrollWidth: document.documentElement.scrollWidth,
    breach: breach.slice(0, 20),
    theme: document.documentElement.dataset.theme ?? null,
  }
}

const MEASURE_CALL = `(${MEASURE.toString()})()`

/*
 * 画面にだけある共通の帯（CHz31「検証環境の帯」）を隠す。
 *
 * 帯の文字は IMPL_ONLY で数えないようにしているが、帯の「高さ」は残るので
 * その下の中身がまとめて下へずれる。ずれの何 px がこの共通部品の分なのかを
 * 切り分けるため、隠してもう一度測る。隠した高さも返す。
 */
const HIDE_BANNER = () => {
  const hidden = []
  for (const mark of document.querySelectorAll('span, div')) {
    if ((mark.textContent ?? '').trim() !== '検証環境専用') continue
    const band = mark.parentElement
    if (!band) continue
    hidden.push({
      cls: String(band.className || '').slice(0, 48),
      height: Math.round(band.getBoundingClientRect().height),
    })
    band.style.display = 'none'
  }
  return hidden
}

const HIDE_BANNER_CALL = `(${HIDE_BANNER.toString()})()`

/* ── 突き合わせ ──────────────────────────────────────────── */

const norm = (text) => text.replace(/\s+/g, '').replace(/[，､、]/g, '、')

const median = (list) => {
  if (list.length === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** 絵の文字を画面の文字に順に当てる。同じ文字が複数あるときは直前のずれに近い方。 */
function pair(designNodes, implNodes) {
  const buckets = new Map()
  implNodes.forEach((node, index) => {
    const key = norm(node.text)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(index)
  })

  const used = new Set()
  const pairs = []
  const missing = []
  let lastDx = 0
  let lastDy = 0

  for (const design of designNodes) {
    if (DESIGN_ONLY.includes(design.text)) continue
    const key = norm(design.text)
    const candidates = (buckets.get(key) ?? []).filter((index) => !used.has(index))
    if (candidates.length === 0) {
      missing.push(design.text)
      continue
    }
    let best = candidates[0]
    let bestCost = Infinity
    for (const index of candidates) {
      const impl = implNodes[index]
      const cost = Math.abs(impl.x - design.x - lastDx) + Math.abs(impl.y - design.y - lastDy)
      if (cost < bestCost) {
        bestCost = cost
        best = index
      }
    }
    used.add(best)
    const impl = implNodes[best]
    lastDx = impl.x - design.x
    lastDy = impl.y - design.y
    pairs.push({
      text: design.text,
      design: { x: design.x, y: design.y, w: design.w, h: design.h, fontSize: design.fontSize, fontWeight: design.fontWeight },
      impl: { x: impl.x, y: impl.y, w: impl.w, h: impl.h, fontSize: impl.fontSize, fontWeight: impl.fontWeight },
      dx: impl.x - design.x,
      dy: impl.y - design.y,
    })
  }

  const extra = implNodes
    .filter((node, index) => !used.has(index) && !IMPL_ONLY.includes(node.text))
    .map((node) => node.text)

  return { pairs, missing, extra }
}

const within = (pairs, tolerance, dx = 0, dy = 0) =>
  pairs.filter((item) => Math.abs(item.dx - dx) <= tolerance && Math.abs(item.dy - dy) <= tolerance).length

function rates(pairs) {
  if (pairs.length === 0) return null
  const left = pairs.filter((item) => item.design.x < SIDEBAR_EDGE)
  const right = pairs.filter((item) => item.design.x >= SIDEBAR_EDGE)
  const gdx = median(pairs.map((item) => item.dx))
  const gdy = median(pairs.map((item) => item.dy))
  const ldx = median(left.map((item) => item.dx))
  const ldy = median(left.map((item) => item.dy))
  const rdx = median(right.map((item) => item.dx))
  const rdy = median(right.map((item) => item.dy))

  const pct = (hit, total) => (total === 0 ? null : Math.round((hit / total) * 1000) / 10)

  return {
    matched: pairs.length,
    offsetAll: { dx: gdx, dy: gdy },
    offsetSidebar: { dx: ldx, dy: ldy, count: left.length },
    offsetContent: { dx: rdx, dy: rdy, count: right.length },
    raw: pct(within(pairs, 4), pairs.length),
    globalCorrected: pct(within(pairs, 4, gdx, gdy), pairs.length),
    groupCorrected: pct(
      within(left, 4, ldx, ldy) + within(right, 4, rdx, rdy),
      pairs.length,
    ),
    sidebarCorrected: pct(within(left, 4, ldx, ldy), left.length),
    contentCorrected: pct(within(right, 4, rdx, rdy), right.length),
    worstAfterGroup: [...pairs]
      .map((item) => {
        const base = item.design.x < SIDEBAR_EDGE ? { dx: ldx, dy: ldy } : { dx: rdx, dy: rdy }
        return { ...item, ex: item.dx - base.dx, ey: item.dy - base.dy }
      })
      .sort((a, b) => Math.max(Math.abs(b.ex), Math.abs(b.ey)) - Math.max(Math.abs(a.ex), Math.abs(a.ey)))
      .slice(0, 12)
      .map((item) => ({ text: item.text, ex: item.ex, ey: item.ey, designY: item.design.y })),
  }
}

/**
 * 横幅が狭い回（1152）の見方。絵は 1440 で描かれているので横のずれは当然出る。
 * 中身の側だけを取り、縦のずれが中身のずれ幅でそろっているかを見る。
 */
function verticalOnly(pairs) {
  const r = rates(pairs)
  if (!r) return null
  const dy = r.offsetContent.dy
  const right = pairs.filter((item) => item.design.x >= SIDEBAR_EDGE)
  return {
    matched: right.length,
    offsetDy: dy,
    withinDy4: right.length === 0 ? null
      : Math.round((right.filter((item) => Math.abs(item.dy - dy) <= 4).length / right.length) * 1000) / 10,
  }
}

/** 行の送り（となりの行との間隔）を比べる。幅に関係なく形が合っているかを見る。 */
function pitch(pairs, labels) {
  const pick = (side) => labels
    .map((label) => pairs.find((item) => norm(item.text) === norm(label))?.[side]?.y)
    .filter((value) => typeof value === 'number')
  const designY = pick('design')
  const implY = pick('impl')
  if (designY.length < 2 || designY.length !== implY.length) return null
  const steps = []
  for (let i = 1; i < designY.length; i += 1) {
    steps.push({
      from: labels[i - 1],
      to: labels[i],
      design: designY[i] - designY[i - 1],
      impl: implY[i] - implY[i - 1],
      diff: (implY[i] - implY[i - 1]) - (designY[i] - designY[i - 1]),
    })
  }
  return steps
}

/* ── ページを用意する ────────────────────────────────────── */

const SESSION = {
  'lh-admin-theme': 'v8',
  lh_csrf: 'frame-parity-csrf',
  lh_staff_role: 'owner',
  lh_staff_name: 'K',
  lh_staff_permissions: '[]',
  lh_staff_view_permissions: '[]',
  lh_selected_account: 'frame-parity-account',
  lh_auth_selection_cleared: '1',
}

const json = (body) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) })

/*
 * 画面を出すのに要る共通の口。
 *
 * `AuthGuard`（apps/web/src/components/auth-guard.tsx）は `/api/auth/session` を
 * 見に行き、失敗すると `/login` へ送る。`AccountProvider` は
 * `/api/line-accounts` の一覧に選択中のIDが無いと選択を外す。この2つを返さないと
 * 板の中身は1行も描かれず、`data-auth-pending` の骨組みのままになる。
 * 返す値は `scripts/visual-qa/mock-api.mjs` と同じ器の作り物で、秘密値は持たない。
 */
const authSession = () => ({
  success: true,
  data: {
    id: 'frame-parity-owner',
    name: 'K',
    role: 'owner',
    readOnly: false,
    permissionKeys: [],
    viewPermissionKeys: [],
    assignedLineAccountId: null,
    canAccessDescendantAccounts: true,
    tenantId: null,
    tenantStatus: 'active',
    impersonation: null,
    stepUpMethod: 'none',
  },
  csrfToken: 'frame-parity-csrf',
})

const lineAccounts = () => ({
  success: true,
  data: [{
    id: 'frame-parity-account',
    channelId: '0000000000',
    name: '測定用アカウント',
    displayName: '測定用アカウント',
    pictureUrl: null,
    basicId: null,
    isActive: true,
    country: 'JP',
    role: 'owner',
    displayOrder: 1,
    archivedAt: null,
  }],
})

/*
 * 役割の問い合わせ（`apps/web/src/lib/staff-role.ts` の `useStaffRole`）。
 * 返さないと役割が `undefined` になり、`canManageRole` が偽になる。すると窓の下の
 * ボタンが「閉じる」だけに減り、絵の `dgeTy`（キャンセルの確認）へ進めない。
 */
const staffMe = () => ({
  success: true,
  data: { id: 'frame-parity-owner', name: 'K', email: 'frame-parity@example.invalid', role: 'owner' },
})

async function openImpl(browser, frame, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1400 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    deviceScaleFactor: 1,
  })
  await context.addInitScript((session) => {
    for (const [key, value] of Object.entries(session)) {
      try { window.localStorage.setItem(key, value) } catch { /* 砂場で弾かれたら黙って進む */ }
    }
  }, SESSION)

  /*
   * `**` は配信元を問わないので、`NEXT_PUBLIC_API_URL` が別サイトでも
   * 未設定（`undefined/api/...` の相対解決）でも同じ口に当たる。
   */
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p.endsWith('/api/auth/session')) return route.fulfill(json(authSession()))
    if (p.endsWith('/api/line-accounts')) return route.fulfill(json(lineAccounts()))
    if (p.endsWith('/api/staff/me')) return route.fulfill(json(staffMe()))
    /* 左メニューの出し分け。`/features/visibility` を先に見る（後ろだと `/features` が食う）。 */
    if (p.endsWith('/api/settings/features/visibility')) return route.fulfill(json(featureVisibility()))
    if (p.endsWith('/api/settings/features')) return route.fulfill(json(featureSettings()))
    if (/\/delivery\/orders\/[^/]+$/.test(p)) return route.fulfill(json(orderDetailData()))
    if (p.endsWith('/delivery/orders')) return route.fulfill(json(ordersData(url.searchParams.get('tab') ?? 'new')))
    if (p.endsWith('/delivery/history')) return route.fulfill(json(historyData()))
    if (p.endsWith('/delivery/menu-items')) return route.fulfill(json(menuItemsData()))
    if (p.endsWith('/restaurant-test/snapshot')) return route.fulfill(json(restaurantSnapshot()))
    /*
     * 運営からのお知らせ。`AuthGuard` が全画面の殻で読む（`components/hq/platform-notices.tsx`）。
     * 一覧なので下の `data: {}` を返すと `notices.map is not a function` で画面ごと落ちる。
     */
    if (p.endsWith('/api/hq/notices')) return route.fulfill(json({ success: true, data: [] }))
    // 残りは空の成功。測定の対象は板の形だけで、ここに書いていない口は絵に出てこない。
    return route.fulfill(json({ success: true, data: {} }))
  })

  const page = await context.newPage()
  /*
   * 時計は Playwright の口で止める（`scripts/visual-qa/v8-parity.mjs` と同じ書き方）。
   * `window.Date` を自分で差し替えると React の組み立てが壊れることがある。
   */
  await page.clock.setFixedTime(new Date(DELIVERY_CLOCK))

  await page.goto(`${BASE}${frame.url}`, { waitUntil: 'networkidle', timeout: 60000 })
  /*
   * 印の付いた要素を待つ。`state: 'visible'` だと最初に当たる要素（左メニューの身元の器）が
   * 幅ゼロの入れ物なので永久に待つ。数えるのは「幅のある印が12個以上そろったか」。
   * 12 は一番少ない板（h7OeT 品切れ一括設定）が 16 なので、その下に置いた。
   */
  await page.waitForSelector('[data-design-node]', { state: 'attached', timeout: 60000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-design-node]')]
      .filter((e) => e.getBoundingClientRect().width > 0).length >= 12,
    undefined,
    { timeout: 60000 },
  )
  for (const label of frame.open) {
    await page.getByRole('button', { name: label, exact: true }).first().click()
  }
  await page.waitForTimeout(600)
  return { context, page }
}

async function openDesign(browser, frame, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1400 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.goto(`file://${path.join(DESIGN_DIR, `${frame.id}.html`)}`, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  return { context, page }
}

/* ── 本体 ───────────────────────────────────────────────── */

const ROW_LABELS = {
  kDQHr: ['#UE-1042', '#DM-8821', '#RN-310', '#UE-1041', '#DM-8820', '#UE-1039', '#RN-309'],
  OzHLO: ['#UE-1042', '#DM-0896', '#RN-0311', '#UE-1041', '#DM-0895', '#UE-1040', '#RN-0310'],
  h7OeT: ['唐揚げ弁当', '日替わり弁当', '親子丼セット', '焼き魚定食', 'ポテトサラダ', '特製から揚げ（単品）', '緑茶（500ml）', 'ほうじ茶（500ml）'],
  hjdqV: ['唐揚げ弁当', 'ポテトサラダ', '緑茶（500ml）'],
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  let chromium
  try {
    ({ chromium } = await import('@playwright/test'))
  } catch {
    console.error('[frame-parity] @playwright/test が無い。`pnpm -w add -D @playwright/test` のあと `npx playwright install chromium`。')
    process.exit(1)
  }

  let browser
  try {
    browser = await chromium.launch()
  } catch (error) {
    console.error('[frame-parity] ブラウザを起動できない。初回は `npx playwright install chromium`。')
    console.error(String(error))
    process.exit(1)
  }

  const report = { base: BASE, clock: DELIVERY_CLOCK, widths: {}, note: 'この数字はこの回に自分で書いた測り方のもの。正本の % ではない。' }

  /*
   * 調べ直すときの手当て。
   *   ONLY=kDQHr,hjdqV … その板・窓だけ測る（直しながら試すとき用）
   *   DUMP_PAIRS=1      … 突き合わせた1件ずつを metrics.json に残す（ずれの中身を見るため）
   * どちらも付けなければ 6枚すべて・要約だけ。
   */
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null
  const targets = only ? FRAMES.filter((frame) => only.includes(frame.id)) : FRAMES

  for (const width of [1440, 1152]) {
    const perFrame = []
    for (const frame of targets) {
      const design = await openDesign(browser, frame, 1440) // 絵は 1440 固定で描かれている
      const impl = await openImpl(browser, frame, width)

      const designOut = await design.page.evaluate(MEASURE_CALL)
      const implOut = await impl.page.evaluate(MEASURE_CALL)

      if (implOut.theme !== 'v8') {
        console.error(`[frame-parity] ${frame.id}: data-theme が v8 でない（${implOut.theme}）。測定を止める。`)
        process.exit(1)
      }

      const { pairs, missing, extra } = pair(designOut.nodes, implOut.nodes)

      /* 目で確かめる分。絵と画面を同じ幅で丸ごと撮って並べて見る。 */
      await design.page.screenshot({ path: path.join(OUT_DIR, `${frame.id}-${width}-design.png`), fullPage: true })
      await impl.page.screenshot({ path: path.join(OUT_DIR, `${frame.id}-${width}-impl.png`), fullPage: true })

      /*
       * 共通の帯を隠してもう一度測る。撮影のあとに隠す（写真は本物の画面のまま）。
       * ここで縮まった分は「絵が描いていない共通部品の高さ」で、
       * 残った分がこの画面自身のずれ。
       */
      const bannerBoxes = await impl.page.evaluate(HIDE_BANNER_CALL)
      const implNoBanner = await impl.page.evaluate(MEASURE_CALL)
      const noBanner = pair(designOut.nodes, implNoBanner.nodes)

      const entry = {
        frame: frame.id,
        name: frame.name,
        kind: frame.kind,
        url: frame.url,
        designNodes: designOut.nodes.length,
        implNodes: implOut.nodes.length,
        position: width === 1440 ? rates(pairs) : null,
        verticalOnly: width === 1152 ? verticalOnly(pairs) : null,
        /* 共通の帯を隠した回。帯の高さ（複数あれば全部）と、隠したあとの数字。 */
        banner: bannerBoxes,
        positionNoBanner: width === 1440 ? rates(noBanner.pairs) : null,
        verticalOnlyNoBanner: width === 1152 ? verticalOnly(noBanner.pairs) : null,
        pitch: ROW_LABELS[frame.id] ? pitch(pairs, ROW_LABELS[frame.id]) : null,
        missing,
        extra,
        breach: implOut.breach,
        scrollWidth: implOut.scrollWidth,
        docWidth: implOut.docWidth,
        overflowX: implOut.scrollWidth - implOut.docWidth,
        ...(process.env.DUMP_PAIRS ? { pairs, pairsNoBanner: noBanner.pairs } : {}),
      }
      perFrame.push(entry)

      const line = width === 1440
        ? `raw ${entry.position?.raw}% / 全体直し ${entry.position?.globalCorrected}% / 組ごと直し ${entry.position?.groupCorrected}%`
          + ` ｜帯なし raw ${entry.positionNoBanner?.raw}% / 組ごと直し ${entry.positionNoBanner?.groupCorrected}%`
        : `縦だけ ${entry.verticalOnly?.withinDy4}% ｜帯なし ${entry.verticalOnlyNoBanner?.withinDy4}%`
      console.log(`[${width}] ${frame.id} ${frame.name}: 突き合わせ ${pairs.length}件・${line}・右はみ出し ${implOut.breach.length}件・横送り ${entry.overflowX}px`)
      if (missing.length) console.log(`         絵にあって画面に無い文字 ${missing.length}件: ${missing.slice(0, 6).join(' / ')}`)
      if (extra.length) console.log(`         画面にあって絵に無い文字 ${extra.length}件: ${extra.slice(0, 6).join(' / ')}`)

      await impl.context.close()
      await design.context.close()
    }
    report.widths[width] = perFrame
  }

  /* 1920 は見張りの試験が見る幅。はみ出しだけ確かめる。 */
  const wide = []
  for (const frame of targets.filter((item) => item.kind === '板')) {
    const impl = await openImpl(browser, frame, 1920)
    const out = await impl.page.evaluate(MEASURE_CALL)
    wide.push({ frame: frame.id, breach: out.breach.length, overflowX: out.scrollWidth - out.docWidth })
    console.log(`[1920] ${frame.id}: 右はみ出し ${out.breach.length}件・横送り ${out.scrollWidth - out.docWidth}px`)
    await impl.context.close()
  }
  report.widths[1920] = wide

  await browser.close()
  const outFile = path.join(OUT_DIR, 'metrics.json')
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\n[frame-parity] 書いた: ${outFile}`)
}

await main()
