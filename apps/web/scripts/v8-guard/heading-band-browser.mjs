/** 見出しの閲覧帯は、見出しと操作の行の下で頭の内側いっぱいに1つだけ置く（list・restaurant）。 */
export default function scanHeadingBand() {
  const findings = []
  const frames = document.querySelectorAll('main#main-content > [data-design-shell] > [data-page-template="list"], main#main-content > [data-design-shell] > [data-page-template="restaurant"]')
  for (const frame of frames) {
    const target = frame.getAttribute('data-design-node') || frame.getAttribute('data-page-template')
    const fail = (kind, measure) => findings.push({ kind, target, measure })
    const headers = [...frame.querySelectorAll('header[data-template-region="heading"]')].filter(header => header.closest('[data-page-template]') === frame)
    for (const header of headers) {
      const notices = header.querySelectorAll('[data-read-only-notice]')
      if (notices.length === 0) continue
      if (notices.length !== 1) {
        fail('heading-band-count', { count: notices.length })
        continue
      }
    const cs = getComputedStyle(header)
    const h = header.getBoundingClientRect()
    const n = notices[0].getBoundingClientRect()
    const innerLeft = h.left + parseFloat(cs.paddingLeft)
    const innerRight = h.right - parseFloat(cs.paddingRight)
    if (Math.abs(n.left - innerLeft) > 1 || Math.abs(n.right - innerRight) > 1) {
      fail('heading-band-inset', { notice: n.toJSON(), header: h.toJSON(), paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight })
    }
    const title = header.querySelector('h1, h2')
    const body = header.nextElementSibling
    if (!title || n.top < title.getBoundingClientRect().bottom - 1) {
      fail('heading-band-order', { noticeTop: n.top, titleBottom: title?.getBoundingClientRect().bottom ?? null })
    }
    if (!body || n.bottom > body.getBoundingClientRect().top + 1) {
      fail('heading-band-order', { noticeBottom: n.bottom, bodyTop: body?.getBoundingClientRect().top ?? null })
    }
    }
  }
  return findings
}
