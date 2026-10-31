/** Visible short labels must fit without hiding characters or splitting a word. */
export function shortTextFindings(records) {
  return records.filter(record => record.clipped || record.lines > 1).map(record => ({ ...record, kind: record.clipped ? 'short-text-clipped' : 'short-text-wrapped' }))
}

/** DOM geometry from the rendered product; long names keep their existing title/ellipsis contract. */
export function collectShortText() {
  const records = [], seen = new Set()
  const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[inert],[aria-hidden="true"],nav,[data-template-region="folders"],[data-line-preview-part]') }
  for (const scope of document.querySelectorAll('main,[role="dialog"]')) {
    for (const input of scope.querySelectorAll('input[inputmode="numeric"]')) {
      if (!visible(input) || !/^\d{2}\s?:\s?\d{2}$/.test(input.value)) continue
      const css = getComputedStyle(input), n = value => parseFloat(value) || 0
      const probe = document.createElement('span')
      probe.setAttribute('aria-hidden','true'); probe.setAttribute('inert','')
      probe.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;pointer-events:none'
      for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariantNumeric','fontVariationSettings','fontFeatureSettings','letterSpacing','wordSpacing']) probe.style[key] = css[key]
      probe.textContent = input.value
      document.body.append(probe)
      let required
      try { required = probe.getBoundingClientRect().width } finally { probe.remove() }
      const room = input.getBoundingClientRect().width - n(css.borderLeftWidth) - n(css.borderRightWidth) - n(css.paddingLeft) - n(css.paddingRight)
      records.push({ text: input.value, selector: input.id ? '#'+input.id : input.tagName, required, room, clipped: required > room, lines: 1 })
    }
    const targets = scope.querySelectorAll('[data-row-link],[data-list-name],[data-list-name-cell],[data-list-number],[data-cell-grow], [data-segmented-control] button, [data-detail-actions] button,[data-detail-actions] a, h1,h2,h3, strong, [title]')
    for (const target of targets) {
      if (!visible(target) || target.closest('[data-choice-field]:not([data-choice-time]),[data-input-field][aria-haspopup]')) continue
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode());) {
        if (seen.has(node)) continue
        const text = node.textContent.trim()
        if (!text || text.replace(/\s/g,'').length > 16 || /[\r\n]/.test(text) || !visible(node.parentElement) || node.parentElement.closest('.sr-only')) continue
        seen.add(node)
        const range = document.createRange(); range.selectNodeContents(node)
        const rect = range.getBoundingClientRect(), lineRects = [...range.getClientRects()].filter(r=>r.width>0 && r.height>0)
        const tops = [...new Set(lineRects.map(r=>Math.round(r.top)))]
        let clipped = false, clipper = null
        for (let parent = node.parentElement; parent && parent !== scope.parentElement; parent = parent.parentElement) {
          const css = getComputedStyle(parent), box = parent.getBoundingClientRect()
          if (/(hidden|clip|auto|scroll)/.test(css.overflowX) && (rect.left < box.left || rect.right > box.right)) { clipped = true; clipper = parent.tagName; break }
        }
        records.push({ text, selector: target.id ? '#'+target.id : target.tagName, clipped, clipper, lines: tops.length, width: rect.width })
      }
    }
  }
  const entities = [...document.querySelectorAll('main [data-entity-picker-field]')].filter(visible)
  const checkboxes = [...document.querySelectorAll('main input[type="checkbox"]')].map(input => input.closest('label') ?? input.parentElement).filter(visible)
  for (const entity of entities) for (const checkbox of checkboxes) {
    if (entity.contains(checkbox)) continue
    const a = entity.getBoundingClientRect(), b = checkbox.getBoundingClientRect()
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0) {
      records.push({text: entity.textContent.trim(), selector: '[data-entity-picker-field]', clipped: true, lines: 1, overlap: 'checkbox'})
    }
  }
  return records
}
