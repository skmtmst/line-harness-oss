/** B-159/161/180 の採用済みの値を、CSS の上書き・変数参照まで解いて照合する。 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import postcss from 'postcss'

export const RULE_VALUES = {
  '--color-badge-neutral-bg': '#94a3b81a', '--color-badge-neutral': '#475569',
  '--color-badge-success-bg': '#16a34a1a', '--color-badge-success': '#087a3e',
  '--color-badge-warning-bg': '#f973161a', '--color-badge-warning': '#c2410c',
  '--color-badge-danger-bg': '#ef44441a', '--color-badge-danger': '#b91c1c',
  '--color-badge-info-bg': '#2563eb1a', '--color-badge-info': '#1d4ed8',
  '--text-body': '13px', '--text-label': '12px', '--text-caption': '12px',
  '--radius-segment': '10px', '--color-table-head': '#f7f8fa',
  '--color-focus-ring': '#2563eb',
  '--shadow-controls-pop': '0 8px 24px rgba(29, 29, 31, 0.12)',
  '--shadow-float': '0 8px 24px rgba(29, 29, 31, 0.12)',
  '--select-menu-shadow': '0 8px 24px rgba(29, 29, 31, 0.12)',
  '--card-edge': 'rgba(29, 29, 31, 0.08)',
  '--shadow-overlay': '0 8px 24px rgba(29, 29, 31, 0.12)',
  '--v8-parts-dialog-shadow': '0 8px 24px rgba(29, 29, 31, 0.12)',
  '--shadow-controls-toggle': '0 1px 2px rgba(29, 29, 31, 0.16)',
  '--tpl-folder-create-h': '36px', '--tpl-folder-create-pad': '0 16px',
  '--tpl-button-h': '36px', '--tpl-button-pad-side': '16px',
  '--tpl-dialog-width': '560px', '--tpl-dialog-large-width': '720px',
  '--tpl-dialog-title-size': '18px', '--tpl-dialog-title-weight': '700',
  '--tpl-tabs-h': '36px', '--tpl-tabs-weight': '500', '--tpl-tabs-current-weight': '600',
  '--tpl-badge-h': '22px', '--tpl-tag-pill-h': '24px',
  '--tpl-section-title-size': '15px', '--tpl-section-title-weight': '700',
  '--tpl-field-label-size': '12px', '--tpl-field-label-weight': '500',
  '--tpl-card-pad': '16px', '--tpl-notice-pad': '12px 16px', '--tpl-thead-pad-side': '16px',
}

export function verifyRuleValues(css, expected = RULE_VALUES) {
  const defaults = new Map()
  const overrides = new Map()
  const root = postcss.parse(css)
  root.walkDecls(/^--/, decl => {
    // 要素専用の変数や別テーマは、全画面の値として数えない。
    const p = decl.parent
    if ((p.type === 'atrule' && p.name === 'theme') ||
        (p.type === 'rule' && /^\s*:root\s*$/.test(p.selector))) defaults.set(decl.prop, decl.value)
    if (p.type === 'rule' && /^\s*\[data-theme=['"]v8['"]\]\s*$/.test(p.selector)) overrides.set(decl.prop, decl.value)
  })
  // テーマの詳細度は :root より高い。後ろにある :root にも勝つ。
  const vars = new Map([...defaults, ...overrides])
  const resolve = (value, seen = new Set()) => value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    if (seen.has(name) || !vars.has(name)) throw new Error(`未定義または循環: ${name}`)
    return resolve(vars.get(name), new Set([...seen, name]))
  })
  const normalize = value => value.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',')
  return Object.entries(expected).flatMap(([name, want]) => {
    try {
      const got = resolve(vars.get(name) ?? '')
      return normalize(got) === normalize(want) ? [] : [`${name}: 決まり ${want} / 実際 ${got || '未定義'}`]
    } catch (e) { return [`${name}: ${e.message}`] }
  })
}

// 値だけ正しくても、部品が旧い直書きを読んでいたら落とす。
export const RULE_BINDINGS = [
  ['button', ".field", 'height', '--tpl-button-h'],
  ['button', ".button", 'padding', '0 var(--tpl-button-pad-side)'],
  ['folder-panel', ".panel .add", 'height', '--tpl-button-h'],
  ['folder-panel', ".panel .add", 'padding', '0 var(--tpl-button-pad-side)'],
  ['tabs', ".list .tab.tab", 'height', '--tpl-tabs-h'],
  ['tabs', ".list .tab.tab", 'font-weight', '--tpl-tabs-weight'],
  ['tabs', ".list .current.current", 'font-weight', '--tpl-tabs-current-weight'],
  ['status-badge', ".badge", 'height', '--tpl-badge-h'],
  ['tag-pill', ".pill[data-size]", 'height', '--tpl-tag-pill-h'],
  ['dialog', ".title", 'font-size', '--tpl-dialog-title-size'],
  ['dialog', ".title", 'font-weight', '--tpl-dialog-title-weight'],
  ['dialog', ".panel", 'box-shadow', '--shadow-controls-pop'],
  ['drawer', ".panel.panel .title", 'font-size', '--tpl-dialog-title-size'],
  ['drawer', ".panel.panel .title", 'font-weight', '--tpl-dialog-title-weight'],
  ['folder-editor-dialog', ".label", 'font-size', '--tpl-field-label-size'],
  ['folder-editor-dialog', ".label", 'font-weight', '--tpl-field-label-weight'],
  ['form-controls', ".label", 'font-size', '--tpl-field-label-size'],
  ['form-controls', ".label", 'font-weight', '--tpl-field-label-weight'],
  ['card', ".header .title", 'font-size', '--tpl-section-title-size'],
  ['card', ".header .title", 'font-weight', '--tpl-section-title-weight'],
  ['line-preview', ".phoneTitle", 'font-size', '--tpl-section-title-size'],
  ['line-preview', ".phoneTitle", 'font-weight', '--tpl-section-title-weight'],
  ['../templates/create-parts', ".summaryTitle", 'font-size', '--tpl-section-title-size'],
  ['../templates/create-parts', ".summaryTitle", 'font-weight', '--tpl-section-title-weight'],
  ['section-header', ".title", 'font-size', '--tpl-section-title-size'],
  ['section-header', ".title", 'font-weight', '--tpl-section-title-weight'],
]

export function verifyRuleBindings(readCss) {
  const normalize = selector => selector.trim().replaceAll('"', "'").replace(/\s+/g, ' ')
  return RULE_BINDINGS.flatMap(([file, selector, prop, token]) => {
    const target = normalize(`[data-theme='v8'] ${selector}`)
    let actual
    const root = postcss.parse(readCss(file))
    root.walkRules(rule => {
      if (!rule.selectors.some(s => normalize(s) === target)) return
      for (const node of rule.nodes) if (node.type === 'decl' && node.prop === prop) actual = node.value
    })
    // SectionHeader の基本の.titleはV8用の部品なので、テーマ限定がなければ基本を読む。
    if (actual === undefined && file === 'section-header') root.walkRules(rule => {
      if (rule.selector !== selector) return
      for (const node of rule.nodes) if (node.type === 'decl' && node.prop === prop) actual = node.value
    })
    const expected = token.startsWith('--') ? `var(${token})` : token
    return actual === expected ? [] : [`${file} ${selector} ${prop}: 決まり ${expected} / 実際 ${actual ?? '未定義'}`]
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = [
    ...verifyRuleValues(readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')),
    ...verifyRuleBindings(file => readFileSync(new URL(`../src/components/shared/${file}.module.css`, import.meta.url), 'utf8')),
  ]
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log(`V8 の決まりの値: ${Object.keys(RULE_VALUES).length} 件・部品の参照 ${RULE_BINDINGS.length} 件一致（B-159/161/180）`)
}
