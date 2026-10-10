import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

export function buildFrozenMap(seedPath, designDir, out) {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
  const names = {}
  for (const file of readdirSync(join(designDir, 'html')).filter(file => file.endsWith('.html'))) {
    const html = readFileSync(join(designDir, 'html', file), 'utf8')
    const match = /data-pencil-name="([^"]+)"/.exec(html)
    if (match) names[file.slice(0, -5)] = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  }
  const result = regenerateFrozenMap(seed, parseChanges(readFileSync(join(designDir, 'review/PEN-ID-CHANGES-1010.tsv'), 'utf8')), names)
  for (const [id, entry] of Object.entries(result.map.boards)) {
    if (!existsSync(join(designDir, entry.exportHtml ?? `html/${id}.html`))) throw new Error(`固定HTMLがない: ${id}`)
    if (entry.width && !existsSync(join(designDir, 'pencil-texts', `${id}.tsv`)) && !entry.exportNodeName) throw new Error(`座標表がない: ${id}`)
  }
  writeFileSync(out, `${JSON.stringify(result.map, null, 2)}\n`)
  const columns = ['種類', '旧ID', '新ID', '名前', '文書', 'route', '備考']
  writeFileSync(join(designDir, 'review/PEN-ID-CHANGES-1010-routes.tsv'), `${columns.join('\t')}\n${result.routeRows.map(row => columns.map(k => row[k]).join('\t')).join('\n')}\n`)
  console.log(`[build-v8-design-map] 固定書き出し: ${seed.boardCount} → ${result.map.boardCount} 板。場所不明: ${result.unresolved.join(', ') || 'なし'}`)
}
