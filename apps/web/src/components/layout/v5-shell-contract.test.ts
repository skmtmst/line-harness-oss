import { createElement, type AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Breadcrumb from './breadcrumb'

vi.mock('@/components/shared/list-navigation', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props),
}))

describe('パンくずの移動と現在地', () => {
  it('途中はリンク、現在地は移動しない読み上げの目印になる', () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, { items: [
      { label: 'ホーム', href: '/' }, { label: '一覧', href: '/tags' }, { label: '編集', href: '/tags/edit?id=a' },
    ] }))
    expect(html).toContain('aria-label="パンくず"')
    expect(html).toContain('href="/tags"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('編集')
    expect(html).not.toContain('href="/tags/edit')
  })

  it('長い階層は先頭と末尾を残して省略し、省略部分をリンクにしない', () => {
    const html = renderToStaticMarkup(createElement(Breadcrumb, { maxItems: 3, items: [
      { label: 'ホーム', href: '/' }, { label: '省く一覧', href: '/hidden' }, { label: '省く分類', href: '/hidden-group' }, { label: '現在地' },
    ] }))
    expect(html).toContain('href="/"')
    expect(html).toContain('…')
    expect(html).toContain('現在地')
    expect(html).not.toContain('/hidden')
  })
})
