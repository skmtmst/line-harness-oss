import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { manuals } from './lib/manuals'
import {
  ManualFigure,
  Step,
  StepList,
  Tip,
  Troubleshooting,
  Warning,
} from './components/manual-elements'

const template = readFileSync(
  new URL('./app/manual/line-account-setup/page.mdx', import.meta.url),
  'utf8',
)

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

describe('manual site shell', () => {
  it('registers the template under /manual/<slug>', () => {
    expect(manuals).toEqual([
      expect.objectContaining({
        slug: 'line-account-setup',
        title: '記事テンプレート',
      }),
    ])
  })

  it('renders every reusable article element with its reader-facing label', () => {
    expect(html(createElement(StepList, null, createElement(Step, null, '手順')))).toBe(
      '<ol class="manual-steps"><li class="manual-step">手順</li></ol>',
    )
    expect(html(createElement(Warning, null, '本文'))).toContain('aria-label="注意"')
    expect(html(createElement(Tip, null, '本文'))).toContain('aria-label="補足"')
    const figure = html(createElement(ManualFigure, { src: '/manual/x.svg', alt: '見本', caption: '画像1' }))
    expect(figure).toContain('<img src="/manual/x.svg" alt="見本"/>')
    expect(figure).toContain('<figcaption>画像1</figcaption>')
    expect(html(createElement(Troubleshooting, null, '本文'))).toContain('<h2>うまくいかないときは</h2>')
  })

  it('shows every reusable article element in the template', () => {
    // MDX をここで描く道具は docs に入っていないので、見本の記事が部品を使っていることは文字で見る。
    for (const component of [
      'StepList',
      'Warning',
      'Tip',
      'ManualFigure',
      'Troubleshooting',
    ]) {
      expect(template).toContain(`<${component}`)
    }
  })

  it('uses only the public manual asset path in the template', () => {
    expect(template).toContain('src="/manual/setup-placeholder.svg"')
    expect(template).not.toMatch(/(?:https?:\/\/|\/api\/|localhost)/)
  })
})
