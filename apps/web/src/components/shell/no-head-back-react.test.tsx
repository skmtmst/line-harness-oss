// @vitest-environment happy-dom
/*
 * ★V8 板の頭の「← 〇〇へ」を全画面で無くした（オーナー 2026-10-08「全部消す」）。
 * 戻るのは上の帯のパンくずと下の帯の［キャンセル］だけ。
 *
 * - 型（PageHeading）は identity（戻る）を渡されても描かない
 * - パンくずを渡さない子の画面でも、上の帯に左メニューの親（一覧）が出る
 * - 同じ URL のまま段だけ替える画面は、パンくずの動き（onSelect）で戻る
 * - 書きかけ（dirty）なら、パンくずを押しても「保存せずに移りますか」の確認が先に出る
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

import { CreatePage, DetailPage } from '@/components/templates'
import TopBar from '@/components/shared/top-bar'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { parentCrumbForPath } from './app-top-bar'

beforeEach(() => {
  router.push.mockReset()
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

function Bar({ crumbs, title = 'テンプレートを作る', titleHref }: {
  crumbs: { label: string; href?: string; onSelect?: () => void }[] | null
  title?: string
  titleHref?: string
}) {
  return (
    <TopBar
      title={title}
      accounts={[]}
      selectedAccountId=""
      onAccountChange={() => {}}
      roleLabel=""
      userName=""
      onLogout={() => {}}
      v8Chrome
      chromeVariant="shell"
      crumbs={crumbs}
      titleHref={titleHref}
    />
  )
}

/** 書きかけの画面（作る・編集の番兵と同じ useUnsavedGuard）。確認の窓は文字で見る。 */
function DirtyScreen({ dirty = true }: { dirty?: boolean }) {
  const { leaveTarget, confirmLeave } = useUnsavedGuard({ dirty })
  return leaveTarget ? (
    <div role="dialog">
      <p>保存せずに移りますか</p>
      <button type="button" onClick={confirmLeave}>保存せずに移る</button>
    </div>
  ) : null
}

describe('型は板の頭に戻るを描かない', () => {
  it('CreatePage・DetailPage に identity を渡しても「← 〇〇へ」は出ない', () => {
    render(
      <>
        <CreatePage title="テンプレートを作る" identity={<a href="/templates">← テンプレートへ</a>} footerActions={<button type="button">キャンセル</button>}>入力</CreatePage>
        <DetailPage title="予約の詳細" identity={<a href="/booking/bookings">← 予約へ</a>}>中身</DetailPage>
      </>,
    )
    expect(screen.queryByText('← テンプレートへ')).toBeNull()
    expect(screen.queryByText('← 予約へ')).toBeNull()
    // 戻るのは下の帯の［キャンセル］
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy()
  })
})

describe('パンくずを渡さない子の画面でも親へ戻れる', () => {
  it('左メニューの項目の下の道は、その項目を親にする（一覧そのものは親を持たない）', () => {
    expect(parentCrumbForPath('/templates/edit')).toEqual({ label: 'テンプレート', href: '/templates' })
    expect(parentCrumbForPath('/booking/bookings/detail')).toEqual({ label: '予約管理', href: '/booking/bookings' })
    expect(parentCrumbForPath('/reminders/new')).toEqual({ label: 'リマインダ', href: '/reminders' })
    expect(parentCrumbForPath('/contents/vars/edit')).toEqual({ label: '共通情報', href: '/contents/vars' })
    expect(parentCrumbForPath('/hq/templates')).toBeNull()
    expect(parentCrumbForPath('/contents/vars')).toBeNull()
    expect(parentCrumbForPath('/templates')).toBeNull()
  })

  it('画面名が一覧の名前と同じなら、その名前が一覧へのリンクになる', () => {
    render(<Bar crumbs={null} title="ウェビナー" titleHref="/webinars" />)
    expect(screen.getByRole('link', { name: 'ウェビナー' }).getAttribute('href')).toBe('/webinars')
  })
})

describe('書きかけの画面でパンくずを押すと確認が出る', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/templates/edit?id=t-1')
  })

  it('リンクのパンくず（テンプレートを作る → テンプレート）', () => {
    render(<><Bar crumbs={[{ label: 'テンプレート', href: '/templates' }]} /><DirtyScreen /></>)
    const crumb = screen.getByRole('link', { name: 'テンプレート' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    act(() => { crumb.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByText('保存せずに移りますか')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    expect(router.push).toHaveBeenCalledWith('/templates')
  })

  it('段を替えるパンくず（統括の作る画面 → テンプレート）は確認のあとで戻る', () => {
    const toList = vi.fn()
    render(<><Bar crumbs={[{ label: 'テンプレート', href: '/hq/templates', onSelect: toList }]} /><DirtyScreen /></>)
    fireEvent.click(screen.getByRole('button', { name: 'テンプレート' }))
    expect(toList).not.toHaveBeenCalled()
    expect(screen.getByText('保存せずに移りますか')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    expect(toList).toHaveBeenCalledTimes(1)
  })

  it('書きかけでなければ、段を替えるパンくずはそのまま戻る', () => {
    const toList = vi.fn()
    render(<><Bar crumbs={[{ label: 'テンプレート', href: '/hq/templates', onSelect: toList }]} /><DirtyScreen dirty={false} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'テンプレート' }))
    expect(toList).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('保存せずに移りますか')).toBeNull()
  })
})
