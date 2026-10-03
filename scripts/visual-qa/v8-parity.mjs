/**
 * V8 の実装を見本と並べて比べる（1画面ずつ）。
 *
 * 見本は Pencil と同じ見た目に撮った画像（`v8-design-refs/<板ID>.png`）。
 * 対応表（`v8-design-map.json`）の URL・幅で実装を開き、横に並べた画像と
 * 差の強い所に赤枠を付けた画像と、数値（metrics.json）を出す。
 *
 * 前に用意するもの（capture-screens.mjs と同じ）
 *   node scripts/visual-qa/mock-api.mjs &
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &
 *   node scripts/visual-qa/sync-v8-design-refs.mjs --boards <板ID>
 *
 * 使い方
 *   node scripts/visual-qa/v8-parity.mjs --board ywJ5H
 *   node scripts/visual-qa/v8-parity.mjs --board ywJ5H --width 1152
 *   node scripts/visual-qa/v8-parity.mjs --board ywJ5H --route /friends?page=2
 *   node scripts/visual-qa/v8-parity.mjs --board ywJ5H --out /tmp/parity
 *
 * 出るもの（`out/<板ID>-<幅>/`）
 *   impl.png … 実装の全画面
 *   side-by-side.png … 左が見本・右が実装
 *   diff.png … 実装に差の強い所の赤枠
 *   metrics.json … 下の数値ぜんぶ
 *
 * 数で出すもの
 * - はみ出し：中身が枠より広い要素（scrollWidth > clientWidth）・
 *   画面の右端を越える要素
 * - 単語の途中の改行：空白なしの短い文字が2行になっている要素
 * - 表の列のずれ：同じ表の行で列の左端が揃わない表
 * - 書体：日本語が入っているのに Noto Sans JP でない要素
 * - 見本とのずれ：見出し・ボタン・表の見出しの文字の有無（見本の
 *   `data-pencil-name` の文字と実装の文字を突き合わせる）＋画素の差
 *
 * 最初は報告だけに使う（落とさない）。`drift` は目安の点数で、
 * 大きいほどずれている。重みは仮決めで、誤検知が減ったら見直す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { annotate, decodePng, diffImages, encodePng, scaleDown, sideBySide } from './v8-png.mjs'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..', '..')

export const DESIGN_DIR = process.env.V8_DESIGN_DIR ?? '/Users/kentakenta/lh-work/design/v8'
export const VISUAL_QA_BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

/** 対応表を読む。一括実行（v8-parity-all.mjs）も同じものを見る。 */
export function loadMap() {
  return JSON.parse(readFileSync(join(HERE, 'v8-design-map.json'), 'utf8'))
}

/** 板の撮影条件を決める。--route/--width の上書きつき。 */
export function resolveTarget(map, board, routeOpt, widthOpt) {
  const entry = map.boards[board]
  if (!entry) throw new Error(`対応表に無い板: ${board}`)
  const route = routeOpt ?? entry.url ?? entry.route
  if (!route) throw new Error(`画面の場所が無い板（まだ積み替え前）: ${board}`)
  const width = Number(widthOpt ?? entry.width ?? 1440)
  if (![1440, 1152].includes(width)) throw new Error(`幅は 1440 か 1152: ${widthOpt}`)
  return { entry, route, width }
}

/** 見本の場所。写しが無ければ null（写し方を案内する）。 */
export function refPaths(entry, board) {
  const png = join(HERE, 'v8-design-refs', `${board}.png`)
  if (!existsSync(png)) return { png: null, html: null }
  const htmlCandidates = [join(HERE, 'v8-design-refs', `${board}.html`), join(DESIGN_DIR, `lint/${entry.doc}/${board}.html`)]
  return { png, html: htmlCandidates.find(existsSync) ?? null }
}

/**
 * ブラウザの中で数える（実装の生の寸法）。重い DOM でも1回で終わらせる。
 * 戻りは JSON にできる形だけ。
 */
export const MEASURE_SCRIPT = `() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }
  const path = (el) => {
    const parts = []
    let node = el
    for (let depth = 0; depth < 4 && node && node !== document.body; depth += 1) {
      const tag = (node.tagName || '?').toLowerCase()
      const cls = (node.className && typeof node.className === 'string' ? node.className : '').split(/\\s+/).slice(0, 2).join('.')
      parts.unshift(cls ? tag + '.' + cls : tag)
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // はみ出し：中身が枠より広い・画面の右端を越える。
  const overflows = []
  const viewportOverflows = []
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    if (!visible(el)) continue
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      overflows.push({ path: path(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })
      if (overflows.length >= 50) break
    }
  }
  for (const el of all) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth + 1) {
      viewportOverflows.push({ path: path(el), right: Math.round(r.right), width: window.innerWidth })
      if (viewportOverflows.length >= 50) break
    }
  }
  // 単語の途中の改行：空白なしの短い文字が2行になっている。
  const midWordBreaks = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = (node.nodeValue || '').trim()
    if (text.length < 2 || text.length > 24 || /\\s/.test(text)) continue
    const parent = node.parentElement
    if (!parent || seen.has(parent) || !visible(parent)) continue
    seen.add(parent)
    const style = getComputedStyle(parent)
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
    if (parent.scrollHeight > lineHeight * 1.5 + 2) {
      midWordBreaks.push({ path: path(parent), text: text.slice(0, 24), height: parent.scrollHeight, lineHeight: Math.round(lineHeight) })
      if (midWordBreaks.length >= 30) break
    }
  }
  // 表の列のずれ：同じ表の行で列の左端が揃わない。
  const tableMisalignments = []
  for (const table of document.querySelectorAll('table')) {
    if (!visible(table)) continue
    const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.children.length > 1)
    if (rows.length < 2) continue
    const columns = new Map()
    for (const tr of rows) {
      [...tr.children].forEach((cell, index) => {
        if (!columns.has(index)) columns.set(index, [])
        columns.get(index).push(Math.round(cell.getBoundingClientRect().left))
      })
    }
    const bad = []
    for (const [index, lefts] of columns) {
      const spread = Math.max(...lefts) - Math.min(...lefts)
      if (spread > 2) bad.push({ column: index, spread })
    }
    if (bad.length > 0) {
      tableMisalignments.push({ path: path(table), rows: rows.length, bad })
      if (tableMisalignments.length >= 10) break
    }
  }
  // 書体：日本語が入っているのに Noto Sans JP でない。
  const fontIssues = []
  const japanese = /[\\u3040-\\u30FF\\u4E00-\\u9FFF]/
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const text = (el.textContent || '').trim()
    if (text.length === 0 || text.length > 60 || !japanese.test(text)) continue
    // 子に同じ文字がある親は数えない（いちばん内側だけ）。
    if ([...el.children].some((child) => (child.textContent || '').includes(text))) continue
    const family = getComputedStyle(el).fontFamily || ''
    if (!/Noto Sans JP/i.test(family)) {
      fontIssues.push({ path: path(el), text: text.slice(0, 30), font: family.slice(0, 80) })
      if (fontIssues.length >= 20) break
    }
  }
  // 主な要素：見出し・ボタン・表の見出し（文字つき）。
  const keys = []
  for (const el of document.querySelectorAll('h1, h2, h3, button, th, [role="button"], [role="columnheader"]')) {
    if (!visible(el)) continue
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!text) continue
    keys.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 60), rect: rectOf(el) })
    if (keys.length >= 120) break
  }
  return { overflows, viewportOverflows, midWordBreaks, tableMisalignments, fontIssues, keys }
}`

/** 見本 HTML から `data-pencil-name` の文字を抜く（見出し・ボタン相当）。 */
export function refTexts(html) {
  const texts = new Set()
  for (const match of html.matchAll(/data-pencil-name="([^"]+)"[^>]*>([^<]{1,80}?)</g)) {
    const text = match[2].replace(/\s+/g, ' ').trim()
    if (text.length >= 1 && text.length <= 60) texts.add(text)
  }
  return texts
}

export const normalize = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * MEASURE_SCRIPT を呼ぶ形。`page.evaluate(文字列)` は文字列を式として
 * 評価するだけで、関数式のまま渡すと関数の値が返って呼ばれない
 * （関数は送れないので `measured` が `undefined` になる）。
 */
export const MEASURE_CALL = `(${MEASURE_SCRIPT})()`

/**
 * 1つの URL を開いて数え、撮る（ブラウザは呼び出し元が使い回す）。
 * 戻りは { measured, shotBuffer }。開けないときは throw。
 */
export async function shootUrl(browser, base, route, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const url = `${base}${route.startsWith('/') ? route : `/${route}`}`
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
    if (!response || response.status() >= 400) {
      throw new Error(`画面が ${response?.status()} を返した: ${url}`)
    }
    // 遅れて出る中身（表・数）を待つ。
    await page.waitForTimeout(1500)
    const measured = await page.evaluate(MEASURE_CALL)
    const shotBuffer = await page.screenshot({ fullPage: true })
    return { measured, shotBuffer, url }
  } finally {
    await page.close()
  }
}

/**
 * 見本と突き合わせて、画像と metrics.json を書く。戻りは metrics。
 * 画素の差は粗い目安（幅・高さ・DPR が違うため縮めて比べる）。
 */
export function compareAndWrite({ board, route, width, url, refPng, refHtml, measured, shotBuffer, outDir }) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'impl.png'), shotBuffer)
  const refImage = decodePng(readFileSync(refPng))
  const implImage = decodePng(shotBuffer)
  const NORM_WIDTH = 720
  const refSmall = scaleDown(refImage, NORM_WIDTH)
  const implSmall = scaleDown(implImage, NORM_WIDTH)
  const { fraction, boxes } = diffImages(refSmall, implSmall)
  const back = implImage.width / implSmall.width
  const implBoxes = boxes.map((box) => ({
    x: Math.round(box.x * back),
    y: Math.round(box.y * back),
    w: Math.round(box.w * back),
    h: Math.round(box.h * back),
  }))
  writeFileSync(join(outDir, 'side-by-side.png'), encodePng(sideBySide(scaleDown(refImage, 480), scaleDown(implImage, 480))))
  writeFileSync(join(outDir, 'diff.png'), encodePng(annotate(implImage, implBoxes)))

  // 測れなかったときも落とさない（evaluate の失敗・測る前の画像だけの実行）。
  const keys = measured?.keys ?? []
  const overflows = measured?.overflows ?? []
  const viewportOverflows = measured?.viewportOverflows ?? []
  const midWordBreaks = measured?.midWordBreaks ?? []
  const tableMisalignments = measured?.tableMisalignments ?? []
  const fontIssues = measured?.fontIssues ?? []

  let refCount = 0
  let missingInImpl = []
  let extraInImpl = []
  if (refHtml) {
    const refs = refTexts(readFileSync(refHtml, 'utf8'))
    refCount = refs.size
    const implTexts = new Set(keys.map((key) => normalize(key.text)))
    // 見本の文字のうち、実装の主な要素に無いもの（部分一致も許す）。
    missingInImpl = [...refs].filter((text) => {
      const norm = normalize(text)
      if (norm.length < 2) return false
      return ![...implTexts].some((impl) => impl.includes(norm) || norm.includes(impl))
    }).slice(0, 40)
    extraInImpl = [...implTexts].filter((text) => {
      if (text.length < 2) return false
      return ![...refs].some((ref) => normalize(ref).includes(text) || text.includes(normalize(ref)))
    }).slice(0, 40)
  }

  // 目安の点数（大きいほどずれている）。重みは仮決め。
  const drift =
    overflows.length * 10 +
    viewportOverflows.length * 10 +
    midWordBreaks.length * 5 +
    tableMisalignments.length * 8 +
    fontIssues.length * 2 +
    missingInImpl.length * 3 +
    Math.round(fraction * 200)

  const metrics = {
    board,
    route,
    width,
    url,
    refShot: refPng,
    refHtml: refHtml,
    drift,
    pixelDiffFraction: Number(fraction.toFixed(4)),
    diffBoxes: boxes.length,
    overflows,
    viewportOverflows,
    midWordBreaks,
    tableMisalignments,
    fontIssues,
    refTexts: refCount,
    missingInImpl,
    extraInImpl,
    keyElements: keys.length,
  }
  writeFileSync(join(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(`[v8-parity] ${board} ${width}px drift=${drift} 差=${(fraction * 100).toFixed(1)}% はみ出し=${overflows.length} 右端越え=${viewportOverflows.length} 途中改行=${midWordBreaks.length} 列表れ=${tableMisalignments.length} 書体=${fontIssues.length} → ${outDir}`)
  return metrics
}

/** 1枚ずつの入口（`--board` 必須）。 */
async function cli() {
  const args = process.argv.slice(2)
  const pick = (flag) => {
    const at = args.indexOf(flag)
    return at >= 0 && args[at + 1] ? args[at + 1] : null
  }
  const board = pick('--board')
  if (!board) {
    console.error('使い方: node scripts/visual-qa/v8-parity.mjs --board <板ID> [--route URL] [--width 1440|1152] [--out dir]')
    process.exit(2)
  }
  let target = null
  try {
    target = resolveTarget(loadMap(), board, pick('--route'), pick('--width'))
  } catch (error) {
    console.error(`[v8-parity] ${error.message}`)
    process.exit(2)
  }
  const refs = refPaths(target.entry, board)
  if (!refs.png) {
    console.error(`[v8-parity] 見本が無い。先に写す: node scripts/visual-qa/sync-v8-design-refs.mjs --boards ${board}`)
    process.exit(2)
  }
  const outRoot = pick('--out') ?? join(HERE, 'v8-parity-out')
  const outDir = join(outRoot, `${board}-${target.width}`)
  const { chromium } = await import('@playwright/test')
  let browser = null
  try {
    browser = await chromium.launch()
  } catch (error) {
    console.error(`[v8-parity] ブラウザが開けない: ${error.message}`)
    console.error('[v8-parity] 初回だけ `npx playwright install chromium` が要る。')
    process.exit(3)
  }
  try {
    const shot = await shootUrl(browser, VISUAL_QA_BASE, target.route, target.width)
    compareAndWrite({
      board,
      route: target.route,
      width: target.width,
      url: shot.url,
      refPng: refs.png,
      refHtml: refs.html,
      measured: shot.measured,
      shotBuffer: shot.shotBuffer,
      outDir,
    })
  } catch (error) {
    console.error(`[v8-parity] 開けない（web と mock-api が起きているか見てください）: ${error.message}`)
    process.exit(3)
  } finally {
    await browser.close()
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) await cli()
