/** Inspect the painted surface, person name and requested state separately. */
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
  const avatars = new Set(document.querySelectorAll('main td [data-avatar], main [role="cell"] [data-avatar]'))
  // Person cells can paint an initial directly instead of using Avatar.
  // Identify their semantic name column and circular painted face, not a page class.
  for (const el of document.querySelectorAll('main td [aria-hidden="true"],main [role="cell"] [aria-hidden="true"],main td img,main [role="cell"] img')) {
    if (!visible(el) || el.closest('[data-avatar]') || el.matches('svg') || el.querySelector('svg')) continue
    const cell = el.closest('td,[role="cell"]'), row = cell.parentElement
    const index = [...row.children].indexOf(cell)
    const table = cell.closest('table,[role="table"]')
    const header = table?.querySelectorAll('thead th,[role="columnheader"]')[index]?.textContent ?? ''
    const person = /友だち|会員|ユーザー|スタッフ|担当者|氏名/.test(header)
      || [...cell.querySelectorAll('a[href]')].some(link => /\/(?:friends|staff)\/detail/.test(link.getAttribute('href')))
    if (!person || !(el.matches('img') || el.textContent.trim())) continue
    const rect = el.getBoundingClientRect(), radius = getComputedStyle(el).borderTopLeftRadius
    const rounded = radius.endsWith('%') ? parseFloat(radius) >= 50 : parseFloat(radius) >= Math.min(rect.width,rect.height) / 2
    if (Math.abs(rect.width-rect.height) <= 1 && rounded) avatars.add(el)
  }
  for (const avatar of avatars) {
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
