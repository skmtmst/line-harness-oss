// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { PageChromeProvider, usePageTitle, usePageChrome } from './page-chrome'
import { formatDocumentTitle } from '@/lib/document-title'
import { DocumentTitleProvider, useDocumentTitle } from './document-title'

beforeEach(() => { cleanup(); document.querySelectorAll('title').forEach(node => node.remove()) })
afterEach(cleanup)

/*
 * ブラウザのタブの題は「<画面名> | musubo」（リリース前点検 2026-10-07）。
 * 以前は全画面が公式アカウント名の同じ題で、タブを並べると見分けられなかった。
 * /hq/support で <title> が空だと監査で落ちたので、空にもしない。
 */
function Titled({ name }: { name: string | null }) {
  usePageTitle(name)
  return <p>本文</p>
}

function NestedEditor({ visible }: { visible: boolean }) {
  usePageTitle('一斉配信を作成・メッセージ')
  return <>{visible ? <DisabledTitle /> : null}<ChromeTitle /></>
}
function DisabledTitle() { usePageTitle('カルーセルを作る', false); return null }
function ChromeTitle() { const chrome = usePageChrome(); return <p>{chrome.title}</p> }

describe('タブの題', () => {
  it('引き出しの編集画面を開閉しても親の画面名を残す', () => {
    const { rerender, unmount } = render(<PageChromeProvider><NestedEditor visible={false} /></PageChromeProvider>)
    rerender(<PageChromeProvider><NestedEditor visible /></PageChromeProvider>)
    expect(screen.getByText('一斉配信を作成・メッセージ')).toBeTruthy()
    rerender(<PageChromeProvider><NestedEditor visible={false} /></PageChromeProvider>)
    expect(screen.getByText('一斉配信を作成・メッセージ')).toBeTruthy()
    expect(document.title).toBe('一斉配信を作成・メッセージ | musubo')
    unmount()
  })

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
    const { documentTitleForPath } = await import('@/lib/page-title')
    expect(documentTitleForPath('/hq/templates', '')).toBe('テンプレート（統括）')
    expect(documentTitleForPath('/scoring/new', '')).toBe('スコアリング')
    expect(documentTitleForPath('/friends', '友だち')).toBe('友だち')
    expect(documentTitleForPath('/no-such', '')).toBe('')
  })
})

function StandaloneTitle({ name }: { name: string }) { useDocumentTitle(name); return null }

describe('文書の題の持ち主', () => {
  it('親子の境界があっても title は1つ。題が確定したあと既定へ戻らない', async () => {
    const { rerender, unmount } = render(<DocumentTitleProvider pathname="/form-submissions/edit"><PageChromeProvider><Titled name="春のアンケート" /></PageChromeProvider></DocumentTitleProvider>)
    expect(document.querySelectorAll('title')).toHaveLength(1)
    expect(document.title).toBe('春のアンケート | musubo')
    rerender(<DocumentTitleProvider pathname="/form-submissions/edit"><PageChromeProvider><Titled name="春のアンケート" /></PageChromeProvider></DocumentTitleProvider>)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.title).toBe('春のアンケート | musubo')
    expect(document.querySelectorAll('title')).toHaveLength(1)
    unmount()
  })

  it('別の道では前の登録を使わず、同じ道の再描画は確定名を保つ', () => {
    const { rerender, unmount } = render(<DocumentTitleProvider pathname="/friends"><StandaloneTitle name="ももちゃん" /></DocumentTitleProvider>)
    expect(document.title).toBe('ももちゃん | musubo')
    rerender(<DocumentTitleProvider pathname="/settings">本文</DocumentTitleProvider>)
    expect(document.title).toBe('機能設定 | musubo')
    expect(document.querySelectorAll('title')).toHaveLength(1)
    unmount()
  })

  it('認証・スマホも同じ登録で題を更新し、解除済みの登録が次の題を消さない', () => {
    const { rerender, unmount } = render(<DocumentTitleProvider pathname="/login"><StandaloneTitle name="ログイン" /></DocumentTitleProvider>)
    expect(document.title).toBe('ログイン | musubo')
    rerender(<DocumentTitleProvider pathname="/m"><StandaloneTitle key="mobile" name="今日の予定" /></DocumentTitleProvider>)
    expect(document.title).toBe('今日の予定 | musubo')
    expect(document.querySelectorAll('title')).toHaveLength(1)
    unmount()
  })
})
