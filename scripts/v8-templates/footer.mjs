/** 古い画面の保存帯に代わり、司令塔の正本StickyBarを実寸と縦送りで確認する。 */
function measureFooter() {
  const wrapper = document.querySelector('[data-template-region="footer"]')
  const bar = wrapper.firstElementChild
  const actions = bar.children[1]
  const style = getComputedStyle(bar)
  const rect = bar.getBoundingClientRect().toJSON()
  const actionRect = actions.getBoundingClientRect().toJSON()
  const preview = document.querySelector('[data-template-region="preview"]')
  const isCreate = document.querySelector('[data-page-template="create"]')
  const scroll = preview && getComputedStyle(preview).display !== 'none' ? preview
    : document.querySelector(isCreate ? '[data-template-region="content"]' : '[data-template-region="body"]')
  return {
    width: innerWidth, height: innerHeight, rect, actionRect,
    buttonRects: [...actions.querySelectorAll('button')].map(e => e.getBoundingClientRect().toJSON()),
    style: { display: style.display, position: style.position, bottom: style.bottom, border: style.borderTopWidth, background: style.backgroundColor, shadow: style.boxShadow },
    scroll: { rect: scroll.getBoundingClientRect().toJSON(), position: scroll.scrollTop, height: scroll.scrollHeight, viewport: scroll.clientHeight },
  }
}
export async function checkFooters(tab, viewport, fs, base, output) {
  const results = []
  for (const height of [1000, 900]) for (const width of [1152, 1280, 1440, 1920]) for (const kind of ['create', 'settings']) {
    await viewport.set({ width, height })
    await tab.goto(`${base}/v8-templates?type=${kind}&capture=1`)
    await tab.playwright.locator('[data-template-region="footer"]').waitFor({state:'visible'})
    const before = await tab.playwright.evaluate(measureFooter)
    const r = before.scroll.rect
    // スマホ内のスクロール領域や入力操作に当てず、欄の右余白から送る。
    if (before.scroll.height > before.scroll.viewport) {
      await tab.ax.scroll([r.right - 28, Math.min(r.top + r.height / 2, height - 150)], 'down', 2)
    }
    let after = await tab.playwright.evaluate(measureFooter)
    if (before.scroll.height > before.scroll.viewport && after.scroll.position <= before.scroll.position) {
      // ネイティブの縦送りがまだ反映されていない場合、表示を読み直して確かめる。
      await tab.ax.get()
      after = await tab.playwright.evaluate(measureFooter)
    }
    const issues = []
    if (Math.abs(before.rect.height - 72) > 1) issues.push('共通帯の高さ72pxに不一致')
    if (Math.abs((before.actionRect.left + before.actionRect.right) - (before.rect.left + before.rect.right)) > 2) issues.push('保存操作が中央からずれている')
    if (before.rect.bottom > height || before.rect.top < 60) issues.push('保存帯が画面外')
    if (before.style.position !== 'sticky' || before.style.bottom !== '12px' || before.style.border !== '0px' || before.style.shadow === 'none') issues.push('V8の浮く帯と違う')
    if (Object.keys(before.rect).some(key => Math.abs(before.rect[key] - after.rect[key]) > 1)) issues.push('縦送りで保存帯が動いた')
    if (before.scroll.height > before.scroll.viewport && after.scroll.position <= before.scroll.position) issues.push('本文の縦送りを確認できない')
    if (before.buttonRects.some(r => r.left < before.rect.left || r.right > before.rect.right || r.bottom > before.rect.bottom)) issues.push('保存ボタンが帯からはみ出した')
    results.push({kind, width, height, before, after, issues})
  }
  await fs.writeFile(output, JSON.stringify({authority:'司令塔2026-10-05 04時：StickyBarを正本として画面の古い帯とは別検証', results}, null, 2) + '\n')
  return {checked:results.length, failures:results.filter(r=>r.issues.length).map(({kind,width,height,issues})=>({kind,width,height,issues}))}
}
