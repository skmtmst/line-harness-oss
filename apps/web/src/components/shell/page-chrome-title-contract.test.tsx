// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageChromeProvider, usePageTitle } from './page-chrome'
import { formatDocumentTitle } from '@/lib/document-title'

/*
 * ブラウザのタブの題は「<画面名> | musubo」（リリース前点検 2026-10-07）。
 * 以前は全画面が公式アカウント名の同じ題で、タブを並べると見分けられなかった。
 * /hq/support で <title> が空だと監査で落ちたので、空にもしない。
 */
function Titled({ name }: { name: string | null }) {
  usePageTitle(name)
  return <p>本文</p>
}

describe('タブの題', () => {
  it('画面名を渡すと「<画面名> | musubo」になる', () => {
    document.title = ''
    const { unmount } = render(
      <PageChromeProvider>
        <Titled name="お問い合わせ" />
      </PageChromeProvider>,
    )
    expect(document.title).toBe('お問い合わせ | musubo')
    expect(screen.getByText('本文')).toBeTruthy()
    unmount()
  })

  it('前の画面の題が残っていても、新しい画面名に替える', () => {
    document.title = '友だち | musubo'
    const { unmount } = render(
      <PageChromeProvider>
        <Titled name="一斉配信" />
      </PageChromeProvider>,
    )
    expect(document.title).toBe('一斉配信 | musubo')
    unmount()
    document.title = ''
  })

  it('画面名が分からないときは musubo だけ。LINE Harness は出さない', () => {
    expect(formatDocumentTitle(null)).toBe('musubo')
    expect(formatDocumentTitle('  ')).toBe('musubo')
    expect(formatDocumentTitle('ダッシュボード')).toBe('ダッシュボード | musubo')
    expect(formatDocumentTitle('ダッシュボード')).not.toContain('LINE Harness')
  })
})

describe('上の帯に名前が無い画面のタブの題', () => {
  it('統括のメニューは「（統括）」付き、左メニューに無い画面も名前を引く', async () => {
    const { documentTitleForPath } = await import('./app-top-bar')
    expect(documentTitleForPath('/hq/templates', '')).toBe('テンプレート（統括）')
    expect(documentTitleForPath('/scoring/new', '')).toBe('スコアリング')
    expect(documentTitleForPath('/friends', '友だち')).toBe('友だち')
    expect(documentTitleForPath('/no-such', '')).toBe('')
  })
})
