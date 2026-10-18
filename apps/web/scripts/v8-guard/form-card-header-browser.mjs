export default function collectFormHeaderInsets() {
  const rows = []
  for (const card of document.querySelectorAll('[data-card-variant="form"]')) {
    const children = Array.from(card.children)
    for (const [index, header] of children.entries()) {
      if (!header.hasAttribute('data-design-node')) continue
      const heading = header.querySelector(':scope > h2, :scope > h3, :scope > div > h2, :scope > div > h3')
      if (!heading || !heading.getBoundingClientRect().height) continue
      const content = children.slice(index + 1).find(child => !child.hasAttribute('data-design-node') && child.getBoundingClientRect().height > 0)
      if (!content) continue
      const headingLeft = heading.getBoundingClientRect().left, contentLeft = content.getBoundingClientRect().left
      rows.push({ heading: heading.textContent.trim(), headingLeft, contentLeft, difference: headingLeft - contentLeft })
    }
  }
  return rows
}

export function formHeaderFailures(rows) {
  return rows.filter(row => Math.abs(row.difference) > 4)
}
