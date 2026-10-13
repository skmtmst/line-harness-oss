/** B-269: inspect the painted surface, person name and requested state separately. */
export default function scanVisualState({ expectedState = null } = {}) {
  const visible = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert]')
  const findings = [], previews = [], people = []
  const effectiveBackground = el => {
    for (let node = el; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor
      if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
    }
    return 'rgb(255, 255, 255)'
  }
  for (const el of document.querySelectorAll('main [data-template-region="preview"]')) {
    if (!visible(el)) continue
    const background = effectiveBackground(el), expected = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim()
    const probe = document.createElement('span'); probe.style.backgroundColor = expected || 'white'; document.body.append(probe)
    const white = getComputedStyle(probe).backgroundColor; probe.remove()
    previews.push({ background, expected: white, label: el.getAttribute('aria-label'), text: el.textContent.trim().slice(0, 80) })
    if (background !== white) findings.push({ kind: 'preview-background', background, expected: white })
  }
  // Use the first painted name, not the secondary description in the same cell.
  for (const avatar of document.querySelectorAll('main td [data-avatar], main [role="cell"] [data-avatar]')) {
    if (!visible(avatar)) continue
    const cell = avatar.closest('td,[role="cell"]'), walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    let name, rects
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || avatar.contains(node) || !visible(node.parentElement) || node.parentElement.closest('svg,[data-avatar],.sr-only')) continue
      const range = document.createRange(); range.selectNodeContents(node)
      const painted = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
      if (painted.length) { name = node.textContent.trim(); rects = painted; break }
    }
    if (!rects) { people.push({ name: null, measured: false }); continue }
    const face = avatar.getBoundingClientRect(), first = rects[0]
    const overlap = Math.min(face.bottom, first.bottom) - Math.max(face.top, first.top)
    const bands = [...new Set(rects.map(rect => Math.round(rect.top)))].length
    people.push({ name, overlap, lines: bands, measured: true })
    if (overlap <= 0 || bands > 1) findings.push({ kind: 'person-name-stacked', name, overlap, lines: bands })
  }
  const observed = [...document.querySelectorAll('main [role="alert"], main [role="status"], main [data-save-conflict]')]
    .filter(visible).map(el => el.textContent.trim())
  let state = null
  if (expectedState) {
    const text = document.querySelector('main')?.innerText ?? ''
    const missing = (expectedState.requiredText ?? []).filter(value => !text.includes(value))
    const unexpected = (expectedState.forbiddenText ?? []).filter(value => text.includes(value))
    const specified = (expectedState.requiredText?.length ?? 0) + (expectedState.forbiddenText?.length ?? 0) > 0
    state = { requested: expectedState.name, observed, missing, unexpected, measured: specified }
    if (!specified || missing.length || unexpected.length) findings.push({ kind: 'state-mismatch', ...state })
  }
  return { findings, previews, people, state, observed, coverage: { previews: previews.length, people: people.length, state: state?.measured ?? null } }
}
