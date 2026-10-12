/** B-267/268: rendered evidence. Presence is separate from defects; API/rights
 * differences require a stated reason, never an allowance or a guessed zero. */
export default function scanFixPatterns() {
  const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`F${i + 1}`, 0]))
  const findings = [], inventory = []
  const visible = el => !!el && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1
    && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],.sr-only')
  const add = (pattern, el, reason) => {
    counts[pattern]++
    findings.push({ pattern, reason, text: el.textContent?.trim().slice(0, 90) ?? '', label: el.getAttribute('aria-label') })
  }
  const lines = el => {
    const ys = [], walker = document.createTreeWalker(el, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !visible(node.parentElement) || node.parentElement.closest('svg')) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (r.width && r.height && !ys.some(y => Math.abs(y - r.y) < 2)) ys.push(r.y)
    }
    return ys.length
  }
  const canvas = document.createElement('canvas').getContext('2d')
  const roots = [...document.querySelectorAll('[data-page-template="list"]')].filter(visible)
  for (const root of roots) {
    const all = selector => [...root.querySelectorAll(selector)].filter(visible)
    if (!root.hasAttribute('data-list-skeleton') && !root.querySelector('[data-list-skeleton]')) add('F4', root, 'list template is missing its shared standard and audit scope')
    const heading = root.querySelector('[data-template-region="heading"],[data-template-region="header"]')
    inventory.push({
      board: root.dataset.designNode, frame: root.dataset.heightMode,
      help: heading ? [...heading.querySelectorAll('button')].filter(visible).map(el => el.getAttribute('aria-label') || el.textContent.trim()) : [],
      folders: all('[data-template-region="folders"]').length,
      folderSelect: all('[data-toolbar-leading] button[aria-haspopup="listbox"]').filter(el => /フォルダ/.test(el.getAttribute('aria-label') ?? el.textContent)).length,
      folderCreate: all('[data-template-region="folders"] button').filter(el => /フォルダ.*追加/.test(el.textContent)).length,
      checks: all('tbody input[type="checkbox"]').length,
      rowMenus: all('tbody [data-row-menu]').length,
      rows: all('tbody tr:not(:has([colspan]))').map(el => el.getBoundingClientRect().height),
      pageSizes: all('[data-list-page-size]').length,
    })
    for (const el of all('[data-select-value],[data-design-node="xRvDB"] > span,[data-kpi-detail] [role="note"],th,button:not(:has([data-list-name]))')) {
      if (el.closest('[data-list-name-cell]') || el.closest('tbody td') && !el.matches('[data-select-value]') && !el.closest('[data-design-node="xRvDB"]')) continue
      if (el.closest('[data-kpi-number]')) continue
      const css = getComputedStyle(el)
      if (!el.textContent.trim() || css.display === 'contents') continue
      const range = document.createRange(); range.selectNodeContents(el)
      if (range.getBoundingClientRect().width > (el.clientWidth || el.getBoundingClientRect().width) - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1
        || el.scrollHeight > el.clientHeight + 1) add('F1', el, 'short text does not fit')
    }
    for (const el of all('input[type="search"]')) {
      if (el.value || !el.placeholder) continue
      const css = getComputedStyle(el); canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      if (canvas.measureText(el.placeholder).width > el.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0) + 1) add('F1', el, 'search placeholder does not fit')
    }
    for (const el of all('[data-list-date-time],[data-list-name],th,[data-design-node="xRvDB"]')) {
      if (lines(el) > 1) add('F2', el, 'short text wraps')
    }
    for (const el of all('button,a[role="button"],[data-page-title]')) {
      if (/^(直す|編集|編集をする)$/.test(el.textContent.trim()) || /（任意）/.test(el.textContent) && el.matches('[data-page-title]')) add('F3', el, 'noncanonical action or optional title')
    }
    for (const el of all('[data-unknown-value],td:not([data-list-name-cell]) [data-design-node="xRvDB"],td:not([data-list-name-cell])')) {
      if ((el.hasAttribute('data-unknown-value') || /^(?:種類を確認.*|確認できません|不明|未取得|[（(]未取得[）)])$/.test(el.textContent.trim())) && !['—', '未設定', 'なし'].includes(el.textContent.trim())) add('F7', el, 'unknown value is not one of the three canonical values')
    }
    for (const el of all('[data-list-sort]')) {
      const value = el.querySelector('[data-select-value]')
      if (!visible(value) || !/^並び[：:].+/.test(value.textContent.trim())) add('F8', el, 'sort has no visible current value')
    }
    for (const el of all('[data-template-region="toolbar"] button:disabled,[data-template-region="toolbar"] input:disabled')) {
      const explained = el.title || (el.getAttribute('aria-describedby') || '').split(/\s+/).some(id => document.getElementById(id)?.textContent.trim())
      if (!explained && !el.closest('[aria-busy="true"]') && !/読み込|保存中|送信中|処理中/.test(el.textContent)) add('F8', el, 'disabled tool has no reason')
    }
    for (const el of all('[data-row-menu]')) if (el.closest('[data-kpi-strip]')) add('F9', el, 'row menu in KPI band')
    for (const el of all('[data-list-name-cell] [data-design-node="xRvDB"]')) add('F9', el, 'state is in name column')
    if (root.getBoundingClientRect().width < 1100) {
      for (const folder of all('[data-template-region="folders"]')) add('F10', folder, 'folder column remains in narrow list')
      for (const count of all('[data-list-page-size]')) {
        const toolbar = count.closest('[data-template-region="toolbar"]')
        if (!toolbar) continue
        const controls = [...toolbar.querySelectorAll('input,button')].filter(visible)
        const c = count.getBoundingClientRect(), bottom = Math.max(...controls.map(el => el.getBoundingClientRect().bottom))
        const right = Math.max(...controls.map(el => el.getBoundingClientRect().right))
        if (c.bottom < bottom - 1 || c.right < right - 1) add('F9', count, 'page size is not last row right')
      }
    }
  }
  return { counts, findings, inventory, coverage: { listPages: roots.length, DOM: ['F1','F2','F3','F7','F8','F9','F10'], presence: 'F4', sourceAudit: 'F5', layoutAndValues: 'F6' } }
}
