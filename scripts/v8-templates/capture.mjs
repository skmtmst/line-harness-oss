/** Browserスキルで接続した tab と fs を渡し、Node REPL 内で実行する。
 * 例: await captureTemplates(tab, fs, 'http://localhost:4318', '/tmp/v8-capture')
 * 認証と店舗選択は通常の画面操作で済ませる。隠れた状態には触れない。
 */
export const kinds = ['dashboard', 'list', 'list-folders', 'create', 'detail', 'inbox', 'settings', 'analytics']
// Pencil の画面見本と同じ寸法。上下の固定帯も比較するため、高さを切り落とさない。
export const captureViewport = { width: 1440, height: 1000 }
function measure() {
  const root = document.querySelector('[data-template-preview]')
  const boxes = [...root.querySelectorAll('[data-pencil-id], [data-pencil-name], [data-template-region]')].map((e) => ({
    id: e.getAttribute('data-pencil-id'), region: e.getAttribute('data-template-region'),
    name: e.getAttribute('data-pencil-name'), leaf: e.children.length === 0, rect: e.getBoundingClientRect().toJSON(),
  }))
  const texts = []
  for (const e of root.querySelectorAll('*')) for (const node of e.childNodes) {
    if (node.nodeType !== 3 || !node.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    texts.push(...[...range.getClientRects()].map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })))
  }
  return { kind: root.getAttribute('data-template-preview'), viewport: { width: innerWidth, height: innerHeight }, boxes, texts }
}
export async function captureTemplates(tab, fs, base, output, subset = kinds) {
  await fs.mkdir(output, { recursive: true })
  const captures = {}
  for (const kind of subset) {
    captures[kind] = {}
    for (const source of ['implementation', 'reference']) {
      await tab.goto(`${base}/v8-templates?type=${kind}&capture=1${source === 'reference' ? '&source=reference' : ''}`)
      // 外側だけ先に描かれた途中の状態を合格として扱わない。
      await tab.playwright.locator(`[data-template-preview="${kind}"] [data-pencil-name="会社"]`).waitFor({ state: 'visible', timeoutMs: 15000 })
      await tab.playwright.locator(source === 'reference' ? '[data-pencil-name="白い板"]' : '[data-page-template]').waitFor({ state: 'visible', timeoutMs: 15000 })
      const result = await tab.playwright.evaluate(measure)
      if (result.kind !== kind || result.boxes.length < 20) throw new Error(`撮影の中身が不足しています: ${kind}/${source}`)
      if (result.viewport.width !== captureViewport.width || result.viewport.height !== captureViewport.height) {
        throw new Error(`撮影寸法を ${captureViewport.width}×${captureViewport.height} にしてください: ${kind}/${source}`)
      }
      captures[kind][source] = result
      let screenshot
      try { screenshot = await tab.screenshot({ clip: { x: 0, y: 0, ...captureViewport } }) }
      catch {
        // 再描画中の撮影タイムアウトだけ、表示を確認して一度取り直す。
        await tab.playwright.locator('[data-template-preview]').waitFor({ state: 'visible', timeoutMs: 15000 })
        screenshot = await tab.screenshot({ clip: { x: 0, y: 0, ...captureViewport } })
      }
      await fs.writeFile(`${output}/${kind}-${source}.jpg`, screenshot)
    }
  }
  await fs.writeFile(`${output}/captures.json`, JSON.stringify(captures))
  return Object.keys(captures)
}
