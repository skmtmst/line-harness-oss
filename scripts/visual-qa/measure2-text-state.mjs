/** 同じ押し口の中の分割文字を、実際の文字の範囲から1つとして撮る。 */
export async function joinControlText(page, selector, texts) {
  const joined = await page.evaluate(selector => [...document.querySelectorAll(selector)].flatMap(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.trim()) nodes.push(node)
    if (nodes.length < 2) return []
    const range = document.createRange(); range.setStart(nodes[0], 0); range.setEnd(nodes.at(-1), nodes.at(-1).textContent.length)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    if (!rects.length || rects.some(r => Math.abs(r.y - rects[0].y) > 1)) return []
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y))
    return [{ text: el.textContent.replace(/\s+/g, ' ').trim(), boxes: [{ x, y, w: Math.max(...rects.map(r => r.right)) - x, h: Math.max(...rects.map(r => r.bottom)) - y }] }]
  }), selector)
  return replaceJoinedControlText(texts, joined)
}

export function replaceJoinedControlText(texts, joined) {
  const inside = (a, b) => a.x >= b.x - .1 && a.y >= b.y - .1 && a.x + a.w <= b.x + b.w + .1 && a.y + a.h <= b.y + b.h + .1
  return [...texts.flatMap(t => { const boxes = t.boxes.filter(r => !joined.some(j => j.boxes.some(b => inside(r, b)))); return boxes.length ? [{ ...t, boxes }] : [] }), ...joined]
}
