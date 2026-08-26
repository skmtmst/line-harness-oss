/*
 * Pencil V5を共通基盤とし、V6がある対象はV6を優先して、実際のCSSと突き合わせる。
 *
 * これが無かったため「35項目一致」という報告が再現できなかった。
 * 手元でその場かぎりに数えたものは証拠にならないので、ここへ置く。
 *
 *   node apps/web/scripts/verify-design-values.mjs
 *
 * 正本は Pencil の .pen ファイル。`design/design-parts.json` はそこから
 * 写したスナップショットで、値を変えるときはPencilを先に直す。
 *
 * 状態で見る場所が変わる:
 *
 *   pending      コード未実装。報告するだけで落とさない
 *   implemented  CSSモジュールの**ソース**を見る（まだ画面で使われていない）
 *   active       **ビルド後のCSS**を見る。var() を解いて比べ、配信漏れも調べる
 *
 * `active` をビルド後で見るのは、部品があっても画面が使っていなければ
 * CSSモジュールは出力されないため。逆に `implemented` をビルド後で見ると、
 * 「まだ誰も使っていないだけ」なのに配信漏れとして落ちてしまう。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(WEB, 'design', 'design-parts.json')
const INVENTORY = join(WEB, 'design', 'pencil-component-inventory.json')
const BUILT_CSS_DIR = join(WEB, '.next', 'static', 'css')

/* ---------- 値の正規化 ---------------------------------------------------
 * ビルドは `#ffffff` を `#fff`、`0.5rem` を `.5rem` に縮める。
 * 書き方の違いで落ちないよう、比べる前にそろえる。
 */
export function normalize(value) {
  let v = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
  v = v.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, '#$1$1$2$2$3$3')
  v = v.replace(/(^|[\s(,])\.(\d)/g, '$10.$2')
  v = v.replace(/\s*,\s*/g, ',')
  return v
}

/* ---------- CSSの読み取り ------------------------------------------------ */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** `.card{...}` の中身を取り出す。クラス名は完全一致。 */
function ruleBody(css, selector) {
  const re = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'g')
  const bodies = []
  let m
  while ((m = re.exec(css))) bodies.push(m[1])
  return bodies.join(';')
}

/**
 * ビルド後は `.summary-card_card__A1b2` のようにハッシュが付く。
 *
 * CSS最適化は、同じ宣言を持つクラスを
 * `.breadcrumb_root__A,.sticky_actions__B{display:flex;gap:8px}` のように
 * 1つへ束ねる。単独セレクタだけを探すと、実際には配信されている宣言を
 * 「宣言なし」と誤判定するため、カンマ区切りのセレクタも読む。
 */
export function builtRuleBody(css, prefix, cls) {
  const escaped = `${prefix}_${cls}__`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // hover・[hidden]・子孫指定は別状態なので、基準状態の完全一致だけを拾う。
  const target = new RegExp(`^\\.${escaped}[A-Za-z0-9_-]+$`)
  const re = /([^{}]+)\{([^{}]*)\}/g
  const bodies = []
  let m
  while ((m = re.exec(css))) {
    if (m[1].split(',').some((selector) => target.test(selector.trim()))) bodies.push(m[2])
  }
  return bodies.join(';')
}

function declaration(body, prop) {
  // 最後の宣言が勝つので後ろから探す。`border` と `border-radius` を
  // 取り違えないよう、プロパティ名の直後がコロンであることを見る。
  const re = new RegExp(`(?:^|;)\\s*${prop.replace(/-/g, '\\-')}\\s*:([^;]*)`, 'g')
  let found = null
  let m
  while ((m = re.exec(body))) found = m[1]
  return found === null ? null : found.trim()
}

/* ---------- ビルド後CSSの読み込みと var() の解決 ------------------------- */

function loadBuiltCss() {
  if (!existsSync(BUILT_CSS_DIR)) return null
  const files = readdirSync(BUILT_CSS_DIR).filter((f) => f.endsWith('.css'))
  if (files.length === 0) return null
  return files.map((f) => readFileSync(join(BUILT_CSS_DIR, f), 'utf8')).join('\n')
}

function collectVariables(css) {
  const vars = {}
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    if (!(m[1] in vars)) vars[m[1]] = m[2].trim()
  }
  return vars
}

function resolveVars(value, vars, depth = 0) {
  if (depth > 8 || !value.includes('var(')) return value
  const next = value.replace(/var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)/gi, (whole, name) =>
    name in vars ? vars[name] : whole,
  )
  return next === value ? value : resolveVars(next, vars, depth + 1)
}

/* ---------- スキーマと必須件数 ------------------------------------------ */

export function checkShape(data) {
  const problems = []
  const req = data.required
  if (!req) return ['design-parts.json に required がありません']

  const priority = data.$designPriority
  if (!priority || priority.base !== 'V5' || !String(priority.override ?? '').includes('V6')) {
    problems.push('設計の優先順位は「共通基盤V5、対象にV6があればV6優先」でなければなりません')
  }
  if (!priority?.tokenResult || !priority?.lastCheckedAt) {
    problems.push('$designPriority に tokenResult または lastCheckedAt がありません')
  }

  const v6 = data.$v6Verification
  const v6Nodes = v6?.representativeNodes
  if (!Array.isArray(v6Nodes) || v6Nodes.length < (req.v6RepresentativeNodes ?? 1)) {
    problems.push(
      `V6代表ノードが ${Array.isArray(v6Nodes) ? v6Nodes.length : 0} 件。必須 ${req.v6RepresentativeNodes ?? 1} 件を下回っています`,
    )
  }
  if (!v6?.summary || !v6?.lastCheckedAt) {
    problems.push('$v6Verification に summary または lastCheckedAt がありません')
  }
  if (!v6?.partResult) {
    problems.push('$v6Verification に partResult がありません')
  }
  for (const id of req.v6PartNodes ?? []) {
    if (typeof v6?.partReferences?.[id] !== 'number') {
      problems.push(`V6部品 ${id} の参照数が記録されていません`)
    }
  }

  const tokens = Object.keys(data.tokens || {}).filter((k) => !k.startsWith('$'))
  const parts = Object.keys(data.parts || {}).filter((k) => !k.startsWith('$'))
  const declarations = parts.reduce((n, k) => n + (data.parts[k].declarations?.length ?? 0), 0)
  const nodes = parts.flatMap((k) => data.parts[k].pencilNodes ?? [])

  if (tokens.length < req.tokens) problems.push(`トークンが ${tokens.length} 件。必須 ${req.tokens} 件を下回っています`)
  if (parts.length < req.parts) problems.push(`部品が ${parts.length} 件。必須 ${req.parts} 件を下回っています`)
  if (declarations < req.partDeclarations) problems.push(`部品の宣言が ${declarations} 件。必須 ${req.partDeclarations} 件を下回っています`)
  for (const id of req.pencilNodes ?? []) {
    if (!nodes.includes(id)) problems.push(`必須のPencil Node ID ${id} が部品に含まれていません`)
  }

  const STATUS = ['pending', 'implemented', 'active']
  const ROLE = ['canonical', 'sample', 'deprecated']
  const REVIEW = ['confirmed', 'investigating']
  for (const key of tokens) {
    const t = data.tokens[key]
    if (!STATUS.includes(t.status)) problems.push(`${key}: status が不正です（${t.status}）`)
    for (const f of ['pencil', 'source', 'resolved', 'lastCheckedAt']) {
      if (typeof t[f] !== 'string') problems.push(`${key}: ${f} がありません`)
    }
  }
  for (const key of parts) {
    const p = data.parts[key]
    if (!STATUS.includes(p.status)) problems.push(`${key}: status が不正です（${p.status}）`)
    if (!ROLE.includes(p.role)) problems.push(`${key}: role が不正です（${p.role}）`)
    if (!REVIEW.includes(p.reviewStatus)) problems.push(`${key}: reviewStatus が不正です（${p.reviewStatus}）`)
    if (p.reviewStatus === 'investigating') problems.push(`${key}: 調査中の部品は契約に入れられません。investigations へ移してください`)
    if (!p.lastCheckedAt) problems.push(`${key}: lastCheckedAt がありません`)
    for (const d of p.declarations ?? []) {
      for (const f of ['pencil', 'class', 'prop', 'source', 'resolved']) {
        if (typeof d[f] !== 'string') problems.push(`${key}: 宣言に ${f} がありません（${d.pencil ?? '?'}）`)
      }
    }
  }
  for (const [id, inv] of Object.entries(data.investigations ?? {})) {
    if (id.startsWith('$')) continue
    if (inv.reviewStatus !== 'investigating') problems.push(`investigations.${id}: reviewStatus は investigating だけです`)
    if (!inv.reason) problems.push(`investigations.${id}: reason がありません`)
    if (!inv.lastCheckedAt) problems.push(`investigations.${id}: lastCheckedAt がありません`)
  }
  return problems
}

/** Pen.devの再利用部品一覧が、移行判断に必要な情報を保っているか確認する。 */
export function checkInventoryShape(data, inventory) {
  const problems = []
  const declaration = data.$componentInventory
  const requiredCount = data.required?.componentInventory ?? declaration?.requiredCount ?? 1
  const components = inventory?.components
  const families = inventory?.families

  if (!declaration) return ['design-parts.json に $componentInventory がありません']
  if (declaration.file !== 'design/pencil-component-inventory.json') {
    problems.push('$componentInventory.file が design/pencil-component-inventory.json ではありません')
  }
  if (!declaration.lastCheckedAt) problems.push('$componentInventory.lastCheckedAt がありません')
  if (inventory?.$pencilFile !== data.$pencilFile) {
    problems.push('部品棚卸しのPencilファイルが design-parts.json と一致しません')
  }
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return [...problems, 'pencil-component-inventory.json に components がありません']
  }
  if (!families || typeof families !== 'object' || Array.isArray(families)) {
    return [...problems, 'pencil-component-inventory.json に families がありません']
  }

  const entries = Object.entries(components)
  if (entries.length < requiredCount) {
    problems.push(`Pen.dev部品が ${entries.length} 件。必須 ${requiredCount} 件を下回っています`)
  }
  if (inventory?.$snapshot?.reusableComponents !== entries.length) {
    problems.push(`部品棚卸しの件数 ${entries.length} 件と snapshot ${inventory?.$snapshot?.reusableComponents ?? 0} 件が一致しません`)
  }

  const CLASSIFICATION = declaration.requiredClassifications ?? ['global', 'feature', 'screen']
  const STATUS = ['pending', 'implemented', 'active']
  const ROLE = ['canonical', 'sample', 'deprecated']
  const V6 = ['same', 'variant', 'unverified']
  const ACTION = ['reuse', 'implement', 'merge', 'replace', 'investigate']
  const usedClassifications = new Set()
  const activePencilNodes = Object.entries(data.parts ?? {})
    .filter(([key, part]) => !key.startsWith('$') && part.status === 'active')
    .flatMap(([, part]) => part.pencilNodes ?? [])
  const investigationIds = new Set(
    Object.keys(data.investigations ?? {}).filter((key) => !key.startsWith('$')),
  )

  for (const [familyName, family] of Object.entries(families)) {
    if (!Array.isArray(family.props) || family.props.length === 0) {
      problems.push(`families.${familyName}: props がありません`)
    }
    if (!Array.isArray(family.requiredStates) || family.requiredStates.length === 0) {
      problems.push(`families.${familyName}: requiredStates がありません`)
    }
  }

  for (const [nodeId, component] of entries) {
    const prefix = `components.${nodeId}`
    usedClassifications.add(component.classification)
    for (const field of ['name', 'family', 'classification', 'designState', 'role', 'status', 'lastCheckedAt']) {
      if (typeof component[field] !== 'string' || !component[field]) {
        problems.push(`${prefix}: ${field} がありません`)
      }
    }
    if (!families[component.family]) problems.push(`${prefix}: family ${component.family} が定義されていません`)
    if (!CLASSIFICATION.includes(component.classification)) {
      problems.push(`${prefix}: classification が不正です（${component.classification}）`)
    }
    if (!STATUS.includes(component.status)) problems.push(`${prefix}: status が不正です（${component.status}）`)
    if (!ROLE.includes(component.role)) problems.push(`${prefix}: role が不正です（${component.role}）`)
    if (component.version?.base !== declaration.requiredVersionBase) {
      problems.push(`${prefix}: version.base は ${declaration.requiredVersionBase} でなければなりません`)
    }
    if (!V6.includes(component.version?.v6)) {
      problems.push(`${prefix}: version.v6 が不正です（${component.version?.v6}）`)
    }
    if (!Array.isArray(component.impactRoutes) || component.impactRoutes.length === 0) {
      problems.push(`${prefix}: impactRoutes がありません`)
    }
    if (component.classification === 'global' && !component.impactRoutes?.includes('*')) {
      problems.push(`${prefix}: 全画面共通部品の impactRoutes には * が必要です`)
    }
    if (!ACTION.includes(component.migration?.action) || !component.migration?.target) {
      problems.push(`${prefix}: migration.action または target が不正です`)
    }
    if (component.status === 'active' && !activePencilNodes.includes(nodeId)) {
      problems.push(`${prefix}: active ですが design-parts.json のactive部品に含まれていません`)
    }
    if (component.migration?.action === 'investigate' && !investigationIds.has(nodeId)) {
      problems.push(`${prefix}: investigate ですが design-parts.json の investigations にありません`)
    }
  }
  for (const classification of CLASSIFICATION) {
    if (!usedClassifications.has(classification)) {
      problems.push(`部品棚卸しに classification=${classification} がありません`)
    }
  }
  return problems
}

/* ---------- 本体 -------------------------------------------------------- */

const pad = (s, n) => String(s).padEnd(n)

export function verify() {
  const data = JSON.parse(readFileSync(PARTS, 'utf8'))
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'))
  const inventoryComponents = Object.values(inventory.components ?? {})
  const lines = []
  const failures = []
  const shape = [...checkShape(data), ...checkInventoryShape(data, inventory)]

  const built = loadBuiltCss()
  const builtVars = built ? collectVariables(built) : {}

  let checked = 0
  let matched = 0
  let waiting = 0

  /* --- トークン --- */
  lines.push('トークン')
  for (const [name, t] of Object.entries(data.tokens)) {
    if (name.startsWith('$')) continue
    if (t.status === 'pending') {
      waiting++
      lines.push(`  ${pad(name, 24)}${pad(t.pencil, 18)}${pad(t.resolved, 24)}… 未実装`)
      continue
    }
    checked++
    const want = normalize(t.status === 'active' ? t.resolved : t.source)
    let got = null
    if (t.status === 'active') {
      got = name.slice(2) in builtVars ? builtVars[name.slice(2)] : null
      if (got === null) {
        failures.push(`配信漏れ: ${name} がビルド後CSSに見つかりません（${t.pencil}）`)
        lines.push(`  ${pad(name, 24)}${pad(t.pencil, 18)}${pad(want, 24)}★配信漏れ`)
        continue
      }
    } else {
      const src = readFileSync(join(WEB, 'src', 'app', 'globals.css'), 'utf8')
      const m = src.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
      got = m ? m[1] : null
      if (got === null) {
        failures.push(`未定義: ${name} が globals.css にありません（${t.pencil}）`)
        lines.push(`  ${pad(name, 24)}${pad(t.pencil, 18)}${pad(want, 24)}★未定義`)
        continue
      }
    }
    const ok = normalize(got) === want
    if (ok) matched++
    else failures.push(`不一致: ${name}\n    設計 Pencil ${t.pencil} = ${want}\n    実際 ${normalize(got)}`)
    lines.push(`  ${pad(name, 24)}${pad(t.pencil, 18)}${pad(want, 24)}${ok ? '一致' : '★不一致'}`)
  }

  /* --- 部品 --- */
  lines.push('', '部品')
  for (const [key, part] of Object.entries(data.parts)) {
    if (key.startsWith('$')) continue
    const head = `  ${part.name}（${part.pencilNodes.join(' / ')}）`

    if (part.status === 'pending') {
      waiting += part.declarations.length
      lines.push(`${head} … 未実装（${part.declarations.length}項目）`)
      continue
    }

    let css = null
    if (part.status === 'implemented') {
      const file = join(WEB, part.cssModule)
      if (!existsSync(file)) {
        failures.push(`未実装: ${key} の ${part.cssModule} がありません`)
        lines.push(`${head} ★CSSモジュールがありません`)
        continue
      }
      css = stripComments(readFileSync(file, 'utf8'))
    } else if (!built) {
      failures.push(`ビルド成果物がありません。先に pnpm --filter web build を流してください（${key}）`)
      lines.push(`${head} ★ビルド未実行`)
      continue
    }

    lines.push(head)
    for (const d of part.declarations) {
      checked++
      const want = normalize(part.status === 'active' ? d.resolved : d.source)
      const body =
        part.status === 'implemented'
          ? ruleBody(css, d.class)
          : builtRuleBody(built, part.cssPrefix, d.class)

      if (!body) {
        const why =
          part.status === 'active'
            ? `配信漏れ: ${key} の .${d.class} がビルド後CSSにありません。部品が実際に使われていないか、CSSが出力されていません`
            : `未実装: ${key} の .${d.class} が ${part.cssModule} にありません`
        failures.push(why)
        lines.push(`    ${pad(d.pencil, 34)}${pad(d.prop, 15)}${pad(want, 26)}★${part.status === 'active' ? '配信漏れ' : '宣言なし'}`)
        continue
      }

      const raw = declaration(body, d.prop)
      if (raw === null) {
        failures.push(`宣言なし: ${key} .${d.class} に ${d.prop} がありません（設計 ${d.pencil}）`)
        lines.push(`    ${pad(d.pencil, 34)}${pad(d.prop, 15)}${pad(want, 26)}★宣言なし`)
        continue
      }

      const got = normalize(part.status === 'active' ? resolveVars(raw, builtVars) : raw)
      const ok = got === want
      if (ok) matched++
      else
        failures.push(
          `不一致: ${key} の ${d.prop}\n    設計 Pencil ${d.pencil} = ${want}\n    実際 ${got}\n    Pencilを変えたのであれば design/design-parts.json も更新してください。`,
        )
      lines.push(`    ${pad(d.pencil, 34)}${pad(d.prop, 15)}${pad(want, 26)}${ok ? '一致' : '★不一致'}`)
    }
  }

  return {
    lines,
    failures,
    shape,
    checked,
    matched,
    waiting,
    inventoryCount: inventoryComponents.length,
    inventoryActive: inventoryComponents.filter((component) => component.status === 'active').length,
    inventoryPending: inventoryComponents.filter((component) => component.status === 'pending').length,
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-design-values.mjs')) {
  const r = verify()
  console.log('Pencil V5/V6 とCSSの照合\n')
  console.log(r.lines.join('\n'))
  console.log('\n' + '─'.repeat(60))
  console.log(`照合対象 ${r.checked} 件 / 一致 ${r.matched} / 不一致 ${r.checked - r.matched}`)
  console.log(`未実装   ${r.waiting} 件`)
  console.log(`部品棚卸し ${r.inventoryCount} 件（利用中 ${r.inventoryActive} / 未実装 ${r.inventoryPending}）`)
  if (r.shape.length) {
    console.log('\n契約の形が壊れています:')
    for (const p of r.shape) console.log(`  ${p}`)
  }
  if (r.failures.length) {
    console.log('\n不合格:')
    for (const f of r.failures) console.log(`  ${f}`)
  }
  const bad = r.shape.length + r.failures.length
  console.log(bad === 0 ? (r.checked === 0 ? '\n合格（照合対象がまだありません）' : '\n合格') : '')
  process.exit(bad === 0 ? 0 : 1)
}
