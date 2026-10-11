// 固定済みHTMLのインライン値だけを読む。.pen と画面コードは読まない。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = process.env.V8_DESIGN_DIR ?? '/Users/kentakenta/lh-work/design/v8'
const DATE = '2026-10-11'
const aliases = {
  ASVsl: '表の見出し（B-178）', JpOg0: '表の行（B-178）',
  NUOgw: '手順', Fa8ED: '手順（共通・題と説明の下・左寄せ）',
}

const px = value => /^-?\d+(?:\.\d+)?px$/.test(value) ? parseFloat(value) : undefined
const compact = values => values.length === 4 && values[0] === values[2] && values[1] === values[3]
  ? values[0] === values[1] ? values[0] : values.slice(0, 2) : values
export function extractNode(el, depth = 0) {
  const style = el.style
  const out = { d: depth, n: el.getAttribute('data-pencil-name') ?? '', t: el.localName === 'svg' ? 'icon' : style.fontSize ? 'text' : 'frame' }
  if (style.padding) out.pad = compact(['Top', 'Right', 'Bottom', 'Left'].map(side => px(style[`padding${side}`])))
  for (const [key, prop] of Object.entries({ gap: 'gap', r: 'borderRadius', h: 'height', w: 'width', fs: 'fontSize' })) {
    const n = px(style[prop]); if (n !== undefined) out[key] = n
  }
  if (style.fontWeight) out.fw = style.fontWeight
  if (style.lineHeight && style.lineHeight !== 'normal') {
    out.lh = style.lineHeight.endsWith('px') ? px(style.lineHeight) / out.fs : Number(style.lineHeight)
  }
  for (const [key, prop] of Object.entries({ fill: 'backgroundColor', color: 'color', stroke: 'outlineColor', shadow: 'boxShadow' })) {
    if (style[prop]) out[key] = style[prop]
  }
  const outline = px(style.outlineWidth)
  if (outline !== undefined) out.sw = /(?:#00000000|rgba\(0, 0, 0, 0\)|transparent)/.test(style.outlineColor) ? 0 : outline
  else if (style.borderWidth) {
    const widths = ['Top', 'Right', 'Bottom', 'Left'].map(side => px(style[`border${side}Width`]) ?? 0)
    out.sw = widths.every(w => w === widths[0]) ? widths[0] : Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side, i) => [side, widths[i]]))
  }
  return out
}

function load(file) {
  const html = readFileSync(join(DESIGN, 'html', `${file}.html`), 'utf8')
  const window = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true } })
  window.document.body.innerHTML = html
  return { file, window, sha256: createHash('sha256').update(html).digest('hex') }
}

function find(doc, name, { text = false } = {}) {
  const hits = [...doc.window.document.querySelectorAll('[data-pencil-name]')]
    .filter(el => el.getAttribute('data-pencil-name') === name && Boolean(el.style.fontSize) === text)
  const depth = el => { let n = 0; while (el.parentElement) { n++; el = el.parentElement } return n }
  return hits.sort((a, b) => depth(a) - depth(b))[0]
}

function walk(el, depth = 0) {
  const nodes = [extractNode(el, depth)]
  if (depth < 2 && el.localName !== 'svg') {
    for (const child of el.children) nodes.push(...walk(child, depth + 1))
  }
  return nodes
}

export function regenerate() {
  const valuePath = join(WEB, 'design/v8-part-values.json')
  const old = JSON.parse(readFileSync(valuePath, 'utf8'))
  const docs = ['components-ZBjxY', 'components-NbomF'].map(load)
  const parts = {}
  // 部品所有表の「手順」にはNUOgw（旧）とFa8ED（正）がある。IDを混同しない。
  for (const [id, part] of Object.entries({ ...old.parts, Fa8ED: { name: aliases.Fa8ED } })) {
    const name = aliases[id] ?? part.name
    const doc = docs.find(doc => find(doc, name))
    if (!doc) throw new Error(`固定HTMLに部品がない: ${id} ${name}`)
    const el = find(doc, name)
    parts[id] = { name: el.getAttribute('data-pencil-name'), export: `html/${doc.file}.html`, nodes: walk(el) }
  }
  const snapshot = {
    frozenAt: '2026-10-11 03:10 JST', generatedBy: 'apps/web/scripts/regenerate-v8-design-values.mjs',
    exports: Object.fromEntries(docs.map(doc => [`html/${doc.file}.html`, doc.sha256])),
  }
  const checks = []

  const path = join(WEB, 'design/design-parts.json')
  const contract = JSON.parse(readFileSync(path, 'utf8'))
  contract.$snapshot = snapshot
  const provenance = '2026-10-11 03:10 JST 固定HTML'
  if (!contract['$説明'].some(line => line.startsWith(provenance))) contract['$説明'].push(`${provenance}からB-219〜B-238を含む共通部品の色・余白・枠・文字を再生成。実装が古ければ落とす。既存の本番部品の棚卸し・未変更の契約も残す。`)
  // 本番側にも同じ役目の宣言があるものは、古い色を残さず写し直す。
  const update = (key, cls, prop, value, source) => {
    const d = contract.parts[key].declarations.find(d => d.class === cls && d.prop === prop)
    if (!d) throw new Error(`宣言がない: ${key}.${cls} ${prop}`)
    d.resolved = value; d.source = value; d.pencil = `${provenance}: ${source}`
    contract.parts[key].lastCheckedAt = DATE
  }
  const link = find(docs[0], 'リンク').querySelector('[data-pencil-name="文字"]')
  update('card-header', 'action', 'color', link.style.color, 'components-ZBjxY リンク/文字 B-198')
  const pages = find(docs[1], 'ページ送り')
  const current = pages.querySelector('[data-pencil-name="頁 1"]')
  for (const [prop, value] of Object.entries({ background: current.style.backgroundColor, color: current.firstElementChild.style.color, 'border-color': current.style.outlineColor })) {
    update('pagination', 'current', prop, value, 'components-NbomF ページ送り/頁 1 B-211')
  }

  // 現行V8の実効セレクタを照合する。宣言と値は固定HTMLから取得する。
  const files = { 'filter-chip': 'shared/filter-chip.css', segmented: 'shared/segmented.module.css', 'text-link': 'shared/text-link.module.css', table: 'shared/table.module.css', steps: 'templates/steps.module.css', radio: 'shared/radio.module.css' }
  const add = (key, prefix, id, specs) => {
    // 写しは色も保存する。verifyV8Partsでは寸法以外を比べていないため別の照合欄へ渡す。
    delete contract.parts[key]
    for (const [cls, prop, el, sourceProp = prop, selector] of specs) {
        const value = el.style.getPropertyValue(sourceProp)
        if (!value) throw new Error(`固定HTMLに値がない: ${key} ${sourceProp}`)
        checks.push({ name: `${parts[id]?.name ?? id} ${prop}`, file: `src/components/${files[prefix]}`, selector: selector ?? `.${cls}`, source: `${parts[id].export} ${id} ${el.getAttribute('data-pencil-name')}`, declarations: [{ prop, resolved: value }] })
    }
  }
  const green = find(docs[0], '絞り込みの札/オン')
  add('v8-filter-chip', 'filter-chip', 'XGJDa', [
    ['v6-filter-chip', 'background', green, 'background-color', "[data-theme='v8'] .v6-filter-chip[aria-pressed='true']"],
    ['v6-filter-chip', 'color', green.querySelector('[data-pencil-name="文字"]'), 'color', "[data-theme='v8'] .v6-filter-chip[aria-pressed='true']"],
    ['v6-filter-chip', 'outline-color', green, 'outline-color', "[data-theme='v8'] .v6-filter-chip[aria-pressed='true']"],
  ])
  const root = find(docs[0], '切り替え（3つ）')
  const selected = root.children[0]
  add('v8-segmented-selected', 'segmented', 'dtJVi', [
    ['selected', 'background', selected, 'background-color', "[data-theme='v8'] .selected"],
    ['selected', 'color', selected.firstElementChild, 'color', "[data-theme='v8'] .selected"],
  ])
  add('v8-text-link', 'text-link', 'g5Db8', [['root', 'color', link]])
  const table = find(docs[1], '表の見出し（B-178）')
  add('v8-table-spacing', 'table', 'ASVsl', [['headRow', 'padding', table, 'padding', "[data-theme='v8'] .headRow[data-table-layout='columns']"]])
  const steps = find(docs[0], aliases.Fa8ED)
  const dot = steps.querySelector('[data-pencil-name="丸"]')
  add('v8-step-circle', 'steps', 'Fa8ED', [['dot', 'width', dot], ['dot', 'height', dot]])
  const on = find(docs[0], 'ラジオ/オン').querySelector('[data-pencil-name="丸"]')
  add('v8-radio', 'radio', 'y4YQSB', [
    ['input', 'width', on], ['input', 'height', on],
    ['input', 'outline-width', on, 'outline-width', "[data-theme='v8'] .input:checked"],
  ])
  for (const [id, file, cls] of [['fNPdg', 'radio-card', 'card'], ['w6uYMd', 'check-card', 'card']]) {
    const el = find(docs[1], parts[id].name)
    for (const prop of ['background-color', 'outline-color']) checks.push({
      name: `${parts[id].name} B-203 ${prop}`, file: `src/components/shared/${file}.module.css`, selector: `.${cls}.checked`,
      source: `${parts[id].export} ${id}`, declarations: [{ prop: prop === 'background-color' ? 'background' : prop, resolved: el.style.getPropertyValue(prop) }],
    })
  }
  const sample = load('l5V9a')
  docs.push(sample)
  snapshot.exports['html/l5V9a.html'] = sample.sha256
  const title = find(sample, '名前', { text: true })
  for (const feature of ['broadcasts', 'scenarios']) checks.push({
    name: `${feature === 'broadcasts' ? '一斉配信' : 'シナリオ'}一覧の名前 B-218`,
    file: `src/v8/${feature}/list.module.css`, selector: '.cellTitle', source: 'html/l5V9a.html 名前（一覧共通の決まりB-218）',
    declarations: ['color', 'font-weight'].map(prop => ({ prop, resolved: title.style.getPropertyValue(prop) })),
  })
  writeFileSync(valuePath, `${JSON.stringify({
    $description: '固定済みHTMLの共通部品を名前で照合し、解決済みインライン値を深さ2まで写したもの。refは書き出しで展開済み。pad=[上下,左右]または4辺。lhは倍率。自動幅・高さのbw/bhはHTMLに計算値がないため収録しない。色・影も収録。checksは色・状態・画面共通の決まりの照合。画面コードの値は読み取らない。',
    $snapshot: snapshot, parts, checks,
  }, null, 2)}\n`)
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`)
  for (const doc of docs) doc.window.close()
  console.log(`固定HTMLから部品 ${Object.keys(parts).length} 件と照合契約を再生成`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) regenerate()
