// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageChromeProvider, usePageTitle } from './page-chrome'

/*
 * /hq/support でブラウザの題（<title>）が無いと監査で落ちた。
 * 題が空のままの画面では usePageTitle が画面名を入れる。
 * 既にある題（BrandTitle の公式アカウント名）は変えない。
 */
function Titled() {
  usePageTitle('お問い合わせ')
  return <p>本文</p>
}

describe('usePageTitle は空の題を出さない', () => {
  it('題が空なら画面名を入れる', () => {
    document.title = ''
    const { unmount } = render(
      <PageChromeProvider>
        <Titled />
      </PageChromeProvider>,
    )
    expect(document.title).toBe('お問い合わせ')
    expect(screen.getByText('本文')).toBeTruthy()
    unmount()
  })

  it('題があるときは変えない', () => {
    document.title = '然-NEN- LINE管理システム'
    const { unmount } = render(
      <PageChromeProvider>
        <Titled />
      </PageChromeProvider>,
    )
    expect(document.title).toBe('然-NEN- LINE管理システム')
    unmount()
    document.title = ''
  })
})
