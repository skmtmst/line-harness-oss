import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const ROUTES_1011 = JSON.parse(readFileSync(new URL('./frozen-v8-1011-routes.json', import.meta.url), 'utf8'))

const HIDDEN = {
  gobhu: ['VIij4', '統括 作る① 形と画像'],
  egdGx: ['cmRZc', '統括 作る② ボタンの動き'],
  K0gu1: ['UgZPJ', '統括 作る③ 配る先'],
  gQabc: ['BVSbe', '統括 作る④ 確かめて配る'],
}

// 説明・部品・幕は地図に残すが、画面として測らない（幅なし）。
const ADDITIONS = {
  wVSxu: { from: 'GtI4Y', kind: '小窓' },
  xOQKw: { from: 'R2w4j', width: 1152, kind: '1152' },
  K3qhdY: { from: 'n9vvGx', width: null, kind: '採用の説明' },
  Ct7aA: { url: '/chats', width: null, kind: '採用の説明' },
  GBTyR: { url: '/chats', width: null, kind: '部品' },
  aRvrh: { url: '/visit-stamps', kind: '小窓', html: 'QX56l', node: 'G-8k 店頭の QR の小窓' },
  Bb8xi: { width: null, kind: '幕' },
  Z3gJS: { width: null, kind: '幕' },
  Upx1c: { from: 'LRc93', width: null, kind: '採用の説明' },
  tfxQh: { from: 'LRc93', width: null, kind: '採用の説明' },
  Ft2Ey: { from: 'meBRB', width: null, kind: '採用の説明' },
  G8KDe: { url: '/visit-stamps', width: null, kind: '採用の説明' },
  T53Stv: { from: 'HfK0O', width: null, kind: '採用の説明' },
  cu3vm: { from: 'dnzqC', width: null, kind: '採用の説明' },
  oIFk7: { from: 'Ni0V8', width: null, kind: '採用の説明' },
  fpPlW: { url: '/visit-stamps', kind: '画面' },
  byCFU: { url: '/visit-stamps?tab=paper', kind: '画面' },
  NVN1Y: { url: '/visit-stamps?tab=history', kind: '画面' },
  QUF2R: { from: 'KMaMk', width: null, kind: '採用の説明' },
}

export function parseChanges(text) {
  const [head, ...lines] = text.trimEnd().split('\n').map(line => line.replace(/\r$/, '').split('\t'))
  return lines.map(cells => Object.fromEntries(head.map((key, i) => [key, cells[i] ?? ''])))
}

export function regenerateFrozenMap(seed, changes, names) {
  const boards = structuredClone(seed.boards)
  const replacements = { ...(seed.replacements ?? {}) }
  const unresolved = []
  const routeRows = changes.map(row => ({ ...row }))
  for (const row of routeRows) {
    const old = row['旧ID']
    let next = row['新ID']
    if (row['種類'].startsWith('隠した')) {
      const candidate = HIDDEN[old]
      const found = candidate && Object.entries(names).find(([id, name]) => id === candidate[0] && name.startsWith(candidate[1]))
      if (!found) { unresolved.push(old); continue }
      next = found[0]
      row['新ID'] = next
      row['備考'] += '。固定HTMLの板名で正の板を確認'
    }
    if (old && next) {
      replacements[old] = next
      const previous = boards[old]
      const current = boards[next]
      if (!current && !previous) { unresolved.push(next); continue }
      // 融合の正の板にある撮影用データ・URL・状態を優先する。
      boards[next] = {
        ...previous, ...current,
        doc: row['文書'].includes('新 V8.pen') ? 'V8' : current?.doc ?? previous.doc,
        name: names[next] ?? current?.name ?? row['名前'],
      }
      if (/LIFF/.test(boards[next].name)) boards[next].width = null
      if (ADDITIONS[next]) Object.assign(boards[next], { kind: ADDITIONS[next].kind, width: ADDITIONS[next].width })
      delete boards[old]
    }
    if (!old && next && ADDITIONS[next]) {
      const spec = ADDITIONS[next]
      const donor = spec.from ? boards[spec.from] : null
      const url = spec.url ?? donor?.url ?? donor?.route ?? null
      boards[next] ??= {
        doc: 'V8', name: names[next] ?? row['名前'], kind: spec.kind,
        route: url?.split('?')[0] ?? null, url, routes: url ? [url] : [],
        width: Object.hasOwn(spec, 'width') ? spec.width : 1440, shot: null,
      }
      Object.assign(boards[next], { route: url?.split('?')[0] ?? null, url, routes: url ? [url] : [] })
      if (row['文書'] === 'V8-B.pen') boards[next].doc = 'V8-B'
      // 新しい1152は元の1440の撮影用データも引き継ぐ。
      if (donor?.state && !boards[next].state) boards[next].state = structuredClone(donor.state)
      if (spec.html) {
        boards[next].exportHtml = `html/${spec.html}.html`
        boards[next].exportNodeName = spec.node
      }
    }
    const entry = boards[next] ?? boards[old]
    row.route = entry?.url ?? entry?.route ?? ''
    if (!row.route && entry && entry.kind !== '幕') unresolved.push(next || old)
  }
  return {
    map: {
      ...seed, generatedBy: 'scripts/visual-qa/build-v8-design-map.mjs',
      sources: ['v8-design-map.json (route/state)', 'html/*.html', 'pencil-texts/*.tsv', 'review/PEN-ID-CHANGES-1010.tsv', 'review/PEN-FREEZE-1009.md §8'],
      frozenAt: '2026-10-10 19:37 JST', boardCount: Object.keys(boards).length,
      // 旧の置き場へ移したIDと、Penから消えたID（retired）は区別する。
      replacements,
      boards,
    },
    routeRows, unresolved: [...new Set(unresolved)],
  }
}

// 10-11 の一覧には削除前の行も残る。削除表を先に適用し、固定写しで確認する。
export function regenerateFrozen1011Map(seed, changes, inventory, names, routeSpecs = ROUTES_1011) {
  const boards = structuredClone(seed.boards)
  const replacements = { ...(seed.replacements ?? {}), p17Qku: 'pIHp3' }
  const deletedBoards = new Set(seed.deletedBoards ?? [])
  const routeRows = changes.map(row => ({ ...row }))
  for (const row of routeRows) {
    const old = row['旧ID'], next = row['新ID']
    if (next === '（なし）' && /^[A-Za-z0-9]+$/.test(old)) {
      deletedBoards.add(old)
      delete boards[old]
    } else if (/^[A-Za-z0-9]+$/.test(old) && /^[A-Za-z0-9]+$/.test(next) && old !== next) {
      replacements[old] = next
    }
  }
  const byId = Object.fromEntries(inventory.map(row => [row['板ID'], row]))
  const unresolved = []
  for (const [id, spec] of Object.entries(routeSpecs)) {
    if (deletedBoards.has(id)) continue
    const row = byId[id]
    if (!row || !names[id]) throw new Error(`固定写しの一覧に追加板がない: ${id}`)
    const donor = spec.from ? boards[spec.from] : null
    const { from, ...values } = spec
    boards[id] = {
      ...structuredClone(donor ?? {}), ...boards[id],
      doc: row['文書'], name: names[id], kind: spec.kind ?? '画面',
      route: spec.url?.split('?')[0] ?? null, routes: spec.url ? [spec.url] : [],
      width: Number(row['幅']) === 1152 ? 1152 : 1440, ...values,
    }
    if (donor?.state || boards[id].state) boards[id].state = { ...donor?.state, ...boards[id].state }
    if (spec.app === 'liff') boards[id].route = null
    if (!spec.url && spec.kind !== '幕') unresolved.push(id)
  }
  // 名前からURLを推測しない。未対応の独立画面は場所なしで記録して返す。
  for (const row of inventory) {
    const id = row['板ID']
    if (row['区分'] !== '地図' || boards[id] || replacements[id] || deletedBoards.has(id) || !names[id]
      || /^(採用 |LIFFの決まり|旧・)/.test(row['板の名前'])) continue
    boards[id] = { doc: row['文書'], name: names[id], kind: '画面', route: null, url: null, routes: [],
      width: Number(row['幅']) === 1152 ? 1152 : Number(row['幅']) === 1440 ? 1440 : null }
    unresolved.push(id)
  }
  for (const [id, board] of Object.entries(boards)) {
    if (names[id] && board.name) board.name = names[id]
    if (byId[id] && ['V8', 'V8-B'].includes(byId[id]['文書'])) board.doc = byId[id]['文書']
    // 写しのPNGは別工程で作る。古い lint の撮影を新しい固定版の正解にしない。
    board.shot = null
    board.exportHtml ??= `html/${id}.html`
    if (!board.exportNodeName) board.exportTexts = `pencil-texts/${id}.tsv`
  }
  for (const row of routeRows) {
    const id = replacements[row['旧ID']] ?? row['新ID']
    const entry = boards[id]
    row.route = entry?.url ?? entry?.route ?? ''
    row['正のID'] = entry ? id : ''
  }
  return {
    map: { ...seed, sources: ['v8-design-map.json (route/state)', 'html/*.html', 'pencil-texts/*.tsv', 'review/BOARDS-1011.tsv', 'review/PEN-ID-CHANGES-1011.tsv', 'scripts/visual-qa/frozen-v8-1011-routes.json'],
      frozenAt: '2026-10-11 03:10 JST', boardCount: Object.keys(boards).length,
      replacements, deletedBoards: [...deletedBoards].sort(), boards },
    routeRows, unresolved,
  }
}

export function buildFrozenMap(seedPath, designDir, out) {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
  const names = {}
  for (const file of readdirSync(join(designDir, 'html')).filter(file => file.endsWith('.html'))) {
    const html = readFileSync(join(designDir, 'html', file), 'utf8')
    const match = /data-pencil-name="([^"]+)"/.exec(html)
    if (match) names[file.slice(0, -5)] = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  }
  const changesPath = 'review/PEN-ID-CHANGES-1011.tsv'
  const result = regenerateFrozen1011Map(seed,
    parseChanges(readFileSync(join(designDir, changesPath), 'utf8')),
    parseChanges(readFileSync(join(designDir, 'review/BOARDS-1011.tsv'), 'utf8')), names)
  const hash = path => createHash('sha256').update(readFileSync(join(designDir, path))).digest('hex')
  for (const [id, entry] of Object.entries(result.map.boards)) {
    if (!existsSync(join(designDir, entry.exportHtml ?? `html/${id}.html`))) throw new Error(`固定HTMLがない: ${id}`)
    if (entry.exportTexts && !existsSync(join(designDir, entry.exportTexts))) throw new Error(`座標表がない: ${id}`)
    entry.exportSha256 = hash(entry.exportHtml)
    if (entry.exportTexts) entry.textsSha256 = hash(entry.exportTexts)
  }
  writeFileSync(out, `${JSON.stringify(result.map, null, 2)}\n`)
  const columns = ['旧ID', '新ID', '正のID', '名前', 'route', '理由']
  writeFileSync(join(designDir, 'review/PEN-ID-CHANGES-1011-routes.tsv'), `${columns.join('\t')}\n${result.routeRows.map(row => columns.map(k => row[k]).join('\t')).join('\n')}\n`)
  console.log(`[build-v8-design-map] 固定書き出し: ${seed.boardCount} → ${result.map.boardCount} 板。場所不明: ${result.unresolved.join(', ') || 'なし'}`)
}
