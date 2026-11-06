/** : computed layout, including clipped overflow; executed in the page. */
export function scanListSkeleton() {
  const failures = []
  const roots = [...document.querySelectorAll('[data-list-skeleton]')].filter((root) => !root.parentElement?.closest('[data-list-skeleton]'))
  const visible = (el) => {
    const box = el.getBoundingClientRect(), css = getComputedStyle(el)
    return box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert], [role="dialog"]')
  }
  const examples = [], coverage = { heads: 0, rows: 0 }
  const fail = (rule, element) => { failures.push(rule); if (examples.length < 15) examples.push({ rule, text: element.textContent.trim().slice(0, 50), height: element.getBoundingClientRect().height }) }
  for (const root of roots) {
    const width = root.closest('[data-page-template]')?.getBoundingClientRect().width ?? root.getBoundingClientRect().width
    coverage.heads += [...root.querySelectorAll('thead > tr,[role="columnheader"]')].filter(visible).length
    coverage.rows += [...root.querySelectorAll('tbody > tr,[role="row"]')].filter(visible).length
    for (const detail of root.querySelectorAll('[data-kpi-strip] [data-kpi-detail]')) {
      const note = detail.querySelector('[role="note"]')
      if (!note || !visible(note) || !note.textContent.trim()) continue
      const css = getComputedStyle(note)
      const ellipsis = css.whiteSpace === 'nowrap' && css.overflowX === 'hidden' && css.textOverflow === 'ellipsis'
      const single = note.closest('[data-kpi-detail-layout]')?.getAttribute('data-kpi-detail-layout') === 'single'
      if (note.scrollHeight > note.clientHeight + 1 || note.scrollWidth > note.clientWidth + 1
        && (!ellipsis || note.title.trim() !== note.textContent.trim())) fail('U6 数の補足の切れ', note)

    }
    for (const toolbar of root.querySelectorAll('[data-list-toolbar]')) {
      if (!visible(toolbar)) {
        if (getComputedStyle(toolbar).display !== 'contents' && toolbar.dataset.toolbarLayout
          && [...toolbar.querySelectorAll('input, button')].some(visible)) fail('B-178 道具の幅0', toolbar)
        continue
      }
      if (toolbar.scrollWidth > toolbar.clientWidth + 1) fail('B-178 道具のはみ出し', toolbar)
      const controls = [...toolbar.querySelectorAll('input,button')].filter(el => visible(el)
        && !el.closest('[role="menu"],[role="listbox"],[role="dialog"]')
        && !el.closest('[data-toolbar-optional][data-collapsed] [data-toolbar-optional-content]'))
      for (const [index, control] of controls.entries()) for (const other of controls.slice(index + 1)) {
        if (control.contains(other) || other.contains(control)) continue
        const a = control.getBoundingClientRect(), b = other.getBoundingClientRect()
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) fail('U5 道具の重なり', control)
      }
      for (const sort of toolbar.querySelectorAll('[data-list-sort]')) {
        const value = sort.querySelector('[data-select-value]')
        if (visible(sort) && (!value || !visible(value) || !value.textContent.trim()
          || /^(?:transparent|rgba\([^)]*,\s*0\))$/.test(getComputedStyle(value).color))) fail('U4 並びの現在値なし', sort)
      }
      for (const input of toolbar.querySelectorAll('input[type="search"]')) {
        if (!visible(input) || input.value || !input.placeholder) continue
        const css = getComputedStyle(input), context = document.createElement('canvas').getContext('2d')
        context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
        const available = input.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
        if (context.measureText(input.placeholder).width > available + 1) fail('B-191 探す欄の見本文字切れ', input)
      }
      for (const value of toolbar.querySelectorAll('[data-select-value]')) {
        if (!visible(value)) continue
        const range = document.createRange(); range.selectNodeContents(value)
        if (range.getBoundingClientRect().width > value.clientWidth + 1) fail('B-191 選ぶ欄の文字切れ', value)
      }
      for (const tool of toolbar.querySelectorAll('input, button, [role="combobox"]')) {
        if (visible(tool) && !tool.closest('[role="menu"], [role="dialog"], details[open]') && (tool.getBoundingClientRect().right > toolbar.getBoundingClientRect().right + 1 || tool.getBoundingClientRect().left < toolbar.getBoundingClientRect().left - 1)) fail('B-178 道具のはみ出し', tool)
      }
    }
    if (root.scrollWidth > root.clientWidth + 1) fail('B-178 一覧のはみ出し', root)
  }
  return { scopes: roots.length, coverage, failures: [...new Set(failures)], failureCounts: Object.fromEntries([...new Set(failures)].map(reason=>[reason,failures.filter(rule=>rule===reason).length])), examples }
}

/** 一覧に出ない3部品も、実際の作る画面で測る。 */
export function scanSharedSkeletonParts() {
  const visible = (el) => {
    const box = el.getBoundingClientRect(), css = getComputedStyle(el)
    return box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert], [role="dialog"]')
  }
  const failures = [], examples = [], parts = {}
  for (const part of ['image-frame', 'sticky-bar', 'event-actions']) parts[part] = [...document.querySelectorAll(`[data-shared-part="${part}"]`)].filter(visible).length
  const fail = (rule, el) => { failures.push(rule); examples.push({ rule, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }) }
  for (const row of document.querySelectorAll('[data-event-action-row]')) {
    if (visible(row) && row.scrollWidth > row.clientWidth + 1) fail('B-178 することの行のはみ出し', row)
  }
  return { parts, failures: [...new Set(failures)], examples }
}
