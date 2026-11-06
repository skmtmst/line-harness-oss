/*
 * 撮影直後の読み取り診断の本体（DOM → 測定値）。
 * 自己完結させること（import も外の変数も使わない）。
 * shots.mjs が toString で頁へ直列化し、focused 検証も同じ関数を読む。
 * 表示 DOM 以外は読まない。失敗時は null を返し、理由コードは呼出側が付ける
 *（URL・query・error 文字列を reason に入れない）。
 */
export function collectTabsDiag(doc) {
  const cands = [...doc.querySelectorAll('a[aria-current="page"]')]
    .map((a) => ({ a, row: a.closest('.overflow-x-auto') }))
    .filter((x) => x.row)
  if (cands.length === 0) return null
  // sidebar の aria-current を拾わない。main 内の行を優先し、
  // 複数ならリンク数の多い行（タブ帯）を決定的に選ぶ。
  const inMain = cands.filter((x) => x.row.closest('main'))
  const pool = inMain.length > 0 ? inMain : cands
  const ranked = [...pool].sort(
    (p, q) => q.row.querySelectorAll('a').length - p.row.querySelectorAll('a').length,
  )
  const active = ranked[0].a
  const row = ranked[0].row
  const win = doc.defaultView
  const links = [...row.querySelectorAll('a')].map((a) => (a.textContent || '').trim())
  const r = row.getBoundingClientRect()
  const cs = win.getComputedStyle(active)
  const fade = row.parentElement
    ? row.parentElement.querySelector('div[aria-hidden="true"]')
    : null
  const fadeStyle = fade ? win.getComputedStyle(fade) : null
  const fadeRect = fade ? fade.getBoundingClientRect() : null
  const fonts = doc.fonts || null
  return {
    tabsRowFound: true,
    candidates: cands.length,
    choseInMain: inMain.length > 0,
    tabLabels: links,
    scrollWidth: row.scrollWidth,
    clientWidth: row.clientWidth,
    overflowingByRule: row.scrollWidth > row.clientWidth + 1,
    rowRect: { x: r.x, y: r.y, width: r.width, height: r.height },
    fontsStatus: fonts ? fonts.status : 'unknown',
    fontsSize: fonts ? fonts.size : -1,
    activeTabFont: {
      family: cs.fontFamily,
      size: cs.fontSize,
      weight: cs.fontWeight,
    },
    fadeFound: !!fade,
    fadeClass: fade ? fade.className : null,
    fadeBackground: fadeStyle ? fadeStyle.backgroundImage : null,
    fadeRect: fadeRect
      ? { x: fadeRect.x, y: fadeRect.y, width: fadeRect.width, height: fadeRect.height }
      : null,
  }
}
