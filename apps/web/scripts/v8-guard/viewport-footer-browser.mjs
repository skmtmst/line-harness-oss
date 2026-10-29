/** 明示した独立viewport板は、本文だけを送り、保存帯と親の内側へ収める。 */
export default function scanViewportFooter() {
  const findings = []
  const frames = document.querySelectorAll('main#main-content > [data-design-shell] > [data-page-template][data-standalone][data-has-footer][data-frame-height="viewport"]:not([data-page-template="settings"], [data-page-template="create"])')
  for (const frame of frames) {
    const target = frame.getAttribute('data-design-node') || frame.getAttribute('data-page-template')
    const main = frame.parentElement.parentElement
    const bodies = frame.querySelectorAll(':scope > [data-template-region="body"]')
    const footers = frame.querySelectorAll(':scope > [data-template-region="footer"]')
    const bars = footers[0]?.querySelectorAll(':scope > [data-shared-part="sticky-bar"]')
    const fail = (kind, measure) => findings.push({ kind, target, measure })
    if (bodies.length !== 1 || footers.length !== 1 || bars?.length !== 1) {
      fail('viewport-footer-regions', { bodies: bodies.length, footers: footers.length, bars: bars?.length ?? 0 })
      continue
    }
    const body = bodies[0], footer = footers[0], bar = bars[0]
    const m = main.getBoundingClientRect(), f = frame.getBoundingClientRect()
    const b = body.getBoundingClientRect(), footerRect = footer.getBoundingClientRect(), barRect = bar.getBoundingClientRect()
    if (main.scrollHeight > main.clientHeight + 1 || main.scrollTop > 1) fail('viewport-footer-outer-scroll', { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollTop: main.scrollTop })
    if (f.top < m.top - 1 || f.bottom > m.bottom + 1 || f.left < m.left - 1 || f.right > m.right + 1) fail('viewport-footer-frame-overflow', { frame: f.toJSON(), main: m.toJSON() })
    if (b.bottom > Math.min(footerRect.top, barRect.top) + 1) fail('viewport-footer-body-overlap', { body: b.toJSON(), footer: footerRect.toJSON(), bar: barRect.toJSON() })
    if (barRect.left < f.left - 1 || barRect.right > f.right + 1 || barRect.bottom > f.bottom + 1) fail('viewport-footer-bar-overflow', { bar: barRect.toJSON(), frame: f.toJSON() })
    if (!['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) fail('viewport-footer-body-scroll', { overflowY: getComputedStyle(body).overflowY })
  }
  return findings
}
