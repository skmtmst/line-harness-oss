/** B-178: computed layout, including clipped overflow; executed in the page. */
export function scanListSkeleton() {
  const failures = []
  const roots = [...document.querySelectorAll('[data-list-skeleton]')].filter((root) => !root.parentElement?.closest('[data-list-skeleton]'))
  const visible = (el) => {
    const box = el.getBoundingClientRect(), css = getComputedStyle(el)
    return box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert], [role="dialog"]')
  }
  const near = (value, expected) => Math.abs(value - expected) <= 1
  const examples = [], coverage = { heads: 0, rows: 0 }
  const fail = (rule, element) => { failures.push(rule); if (examples.length < 15) examples.push({ rule, text: element.textContent.trim().slice(0, 50), height: element.getBoundingClientRect().height }) }
  for (const root of roots) {
    const width = root.closest('[data-page-template]')?.getBoundingClientRect().width ?? root.getBoundingClientRect().width
    for (const head of root.querySelectorAll('[data-shared-part="list-head"], [data-shared-part="list-table"] thead > tr')) {
      if (visible(head)) coverage.heads++
      if (visible(head) && !near(head.getBoundingClientRect().height, 40)) fail('B-178 見出し40', head)
    }
    for (const row of root.querySelectorAll('[data-shared-part="list-row"], [data-shared-part="list-table"] tbody > tr')) {
      if (visible(row) && !row.querySelector('[colspan]')) coverage.rows++
      // B-254: read actual text geometry; don't trust the component's density marker.
      let contentLines = 1
      for (const cell of row.children) {
        if ([...cell.querySelectorAll('img, video, [aria-hidden="true"]')].some(el =>
          !el.closest('button, a, [role="button"], .sr-only') && el.getBoundingClientRect().height > 36)) contentLines = Math.max(contentLines, 2)
        const centers = [], walker = document.createTreeWalker(cell, 4)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement
          if (!node.textContent?.trim() || !parent || parent.closest('svg, script, style, [hidden], .sr-only, [role="menu"], [role="dialog"], [role="tooltip"]')) continue
          const css = getComputedStyle(parent)
          if (css.display === 'none' || css.visibility === 'hidden') continue
          const range = document.createRange(); range.selectNodeContents(node)
          for (const rect of range.getClientRects()) {
            const center = rect.top + rect.height / 2
            if (rect.width > 0 && rect.height > 0 && !centers.some(value => Math.abs(value - center) < 7)) centers.push(center)
          }
        }
        contentLines = Math.max(contentLines, centers.length)
      }
      const rowHeight = contentLines > 1 ? 60 : 52
      if (visible(row) && !row.querySelector('[colspan]') && !near(row.getBoundingClientRect().height, rowHeight)) fail(`B-178 行${rowHeight}`, row)
    }
    for (const cell of root.querySelectorAll('[data-kpi-strip]:not([data-kpi-density="compact"]) > [data-design-version]')) {
      if (visible(cell) && !near(cell.getBoundingClientRect().height, 116)) fail('B-178 数の帯116', cell)
    }
    for (const toolbar of root.querySelectorAll('[data-list-toolbar]')) {
      if (!visible(toolbar)) continue
      if (toolbar.scrollWidth > toolbar.clientWidth + 1) fail('B-178 道具のはみ出し', toolbar)
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
    for (const folder of root.querySelectorAll('[data-template-region="folders"]')) {
      if (visible(folder) && width < 1100) fail('B-178 フォルダの畳み忘れ', folder)
    }
    for (const pager of root.querySelectorAll('[data-list-pager], [data-template-region="pagination"]')) {
      const nav = pager.querySelector('nav')
      if (visible(pager) && nav && visible(nav) && Math.abs(nav.getBoundingClientRect().right - pager.getBoundingClientRect().right + parseFloat(getComputedStyle(pager).paddingRight)) > 2) fail('B-178 ページ送りの右寄せ', pager)
    }
    if (root.scrollWidth > root.clientWidth + 1) fail('B-178 一覧のはみ出し', root)
  }
  return { scopes: roots.length, coverage, failures: [...new Set(failures)], examples }
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
  for (const frame of document.querySelectorAll('[data-image-frame] [data-size="compact"]')) {
    const box = frame.getBoundingClientRect()
    if (visible(frame) && (Math.abs(box.width - 160) > 1 || Math.abs(box.height - 106) > 1)) fail('B-178 画像の枠160×106', frame)
  }
  for (const bar of document.querySelectorAll('[data-sticky-layout="center"]')) {
    const actions = bar.querySelector('[data-sticky-actions]')
    if (!visible(bar) || !actions || !visible(actions)) continue
    const b = bar.getBoundingClientRect(), a = actions.getBoundingClientRect()
    if (Math.abs(a.left + a.width / 2 - b.left - b.width / 2) > 4) fail('B-178 下の帯の中央操作', bar)
  }
  for (const row of document.querySelectorAll('[data-event-action-row]')) {
    if (visible(row) && row.scrollWidth > row.clientWidth + 1) fail('B-178 することの行のはみ出し', row)
  }
  return { parts, failures: [...new Set(failures)], examples }
}
