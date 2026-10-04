/** Browserスキルの tab・viewport を使い、型そのものの幅と折り畳みを確認する。
 * 正本から差し込んだ中身のレスポンシブ実装は、各画面レーンで別に確認する。
 */
import { kinds } from './capture.mjs'

function measureLayout() {
  const frame = document.querySelector('[data-page-template]')
  const board = document.querySelector('[data-template-region="shell-board"]')
  const regions = [...frame.querySelectorAll('[data-template-region]')].map((element) => ({
    region: element.getAttribute('data-template-region'),
    display: getComputedStyle(element).display,
    rect: element.getBoundingClientRect().toJSON(),
  }))
  return { width: innerWidth, frame: frame.getBoundingClientRect().toJSON(), board: board.getBoundingClientRect().toJSON(), regions }
}

export async function probeTemplates(tab, viewport, fs, base, output) {
  const measurements = []
  for (const width of [1152, 1280, 1440, 1920]) {
    await viewport.set({ width, height: 900 })
    for (const kind of kinds) {
      await tab.goto(`${base}/v8-templates?type=${kind}&capture=1`)
      await tab.playwright.locator('[data-page-template]').waitFor({ state: 'visible', timeoutMs: 15000 })
      const result = await tab.playwright.evaluate(measureLayout)
      const narrow = result.board.width < 1100
      const collapseRegion = { dashboard: 'aside', 'list-folders': 'folders', create: 'preview', inbox: 'summary', analytics: 'aside' }[kind]
      const collapsible = collapseRegion ? result.regions.filter((region) => region.region === collapseRegion) : []
      const issues = []
      if (Math.abs(result.board.width - (width - 252)) > 1) issues.push('板の幅が画面幅から決まっていない')
      if (Math.abs(result.frame.width - result.board.width) > 1) issues.push('型が板からはみ出している')
      if (collapseRegion && !collapsible.length) issues.push('折り畳み対象の欄が確認ページにない')
      if (collapsible.some((region) => (region.display === 'none') !== narrow)) issues.push('板幅1100pxの折り畳みが効いていない')
      if (kind === 'create' || kind === 'settings') {
        const footer = result.regions.find((region) => region.region === 'footer')
        if (!footer || footer.rect.bottom > 900 || footer.rect.top < 60 || footer.rect.height < 36) issues.push('保存の帯が画面内に収まっていない')
      }
      if (kind === 'settings') {
        const content = result.regions.find((region) => region.region === 'content')
        if (!content || content.rect.width > 720) issues.push('設定の欄が最大720pxを超えている')
      }
      measurements.push({ kind, narrow, ...result, issues })
    }
  }
  await fs.writeFile(output, JSON.stringify(measurements, null, 2) + '\n')
  return { checked: measurements.length, failures: measurements.filter((measurement) => measurement.issues.length).map(({ kind, width, issues }) => ({ kind, width, issues })) }
}
