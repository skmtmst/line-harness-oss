/** 共通の外側：案内帯の下でも、設定・版・本人カードを画面内に保つ。 */
export default function inspectSidebarLayout() {
  const findings = [], evidence = []
  for (const aside of document.querySelectorAll('aside')) {
    const navigation = aside.querySelector(':scope > nav')
    if (!navigation || !aside.offsetWidth || aside.closest('main')) continue
    const box = node => {
      const r = node.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right }
    }
    const side = box(aside), nav = box(navigation)
    const fixed = [...aside.children].filter(node => node !== navigation && node.getBoundingClientRect().height > 0)
    const below = fixed.filter(node => box(node).top >= nav.top)
    const footer = below.map(node => ({ ...box(node), scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, text: node.textContent.trim().slice(0, 60) }))
    evidence.push({ side, nav, footer, scrollHeight: navigation.scrollHeight, clientHeight: navigation.clientHeight, scrollTop: navigation.scrollTop })
    if (side.top < -1 || side.bottom > innerHeight + 1) findings.push({ kind: 'sidebar-outside-viewport', side, viewportHeight: innerHeight })
    if (nav.top < side.top - 1 || nav.bottom > side.bottom + 1 || nav.height < 1) findings.push({ kind: 'navigation-outside-sidebar', side, nav })
    for (const item of footer) {
      if (item.top < nav.bottom - 1) findings.push({ kind: 'footer-overlaps-navigation', nav, item })
      if (item.bottom > innerHeight + 1) findings.push({ kind: 'footer-outside-viewport', item, viewportHeight: innerHeight })
      if (item.scrollHeight > item.clientHeight + 1) findings.push({ kind: 'footer-content-clipped', item })
    }
  }
  return { findings, evidence }
}
