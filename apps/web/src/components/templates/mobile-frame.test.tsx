// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileFrame, type MobileFrameTab } from './mobile-frame'
import { MobileTalkList } from './mobile-talk-list'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

afterEach(() => { cleanup() })

const TABS: MobileFrameTab[] = [
  { href: '/m/chats', label: 'トーク', icon: <svg />, current: true, badge: 120 },
  { href: '/m/todo', label: '対応', icon: <svg />, current: false, badge: 0 },
]

describe('モバイルの外枠（MobileFrame）', () => {
  it('選んでいるタブは aria-current で伝え、数の丸は 99+ で止め、0 は出さない', () => {
    render(<MobileFrame title="トーク" tabs={TABS}>本文</MobileFrame>)
    const nav = screen.getByRole('navigation', { name: '電話のメニュー' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/m/chats', '/m/todo'])
    expect(links[0].getAttribute('aria-current')).toBe('page')
    expect(links[1].getAttribute('aria-current')).toBeNull()
    expect(links[0].textContent).toContain('99+')
    expect(links[0].textContent).toContain('120件')
    expect(links[1].textContent).toBe('対応')
  })

  it('1 段目は戻るを出さず、2 段目は上の帯の左に戻る（ページの中には置かない）', () => {
    const { rerender } = render(<MobileFrame title="トーク" tabs={TABS}>本文</MobileFrame>)
    expect(screen.queryByRole('link', { name: /へ戻る$/ })).toBeNull()
    rerender(<MobileFrame title="山田さん" back={{ href: '/m/chats', label: 'トーク' }} tabs={TABS} hideTabs footer={<textarea aria-label="メッセージを入力" />}>本文</MobileFrame>)
    const back = screen.getByRole('link', { name: 'トークへ戻る' })
    expect(back.getAttribute('href')).toBe('/m/chats')
    expect(back.closest('header')).not.toBeNull()
    expect(screen.getByRole('main').contains(back)).toBe(false)
    // 返信を書く画面では下のタブを隠し、返信欄を出す。
    expect(screen.queryByRole('navigation', { name: '電話のメニュー' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'メッセージを入力' })).toBeTruthy()
  })

  it('長い題は 1 行のまま全文を title に持つ。タブが 0 個なら下のタブを出さない', () => {
    render(<MobileFrame title="とても長い名前のお客さまとのトーク" tabs={[]}>本文</MobileFrame>)
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe('とても長い名前のお客さまとのトーク')
    expect(screen.queryByRole('navigation', { name: '電話のメニュー' })).toBeNull()
  })
})

describe('モバイルの会話の一覧（MobileTalkList）', () => {
  it('カード 1 列で会話を開く住所を持ち、未読は色だけでなく文字でも伝える', () => {
    render(<MobileTalkList label="トーク" items={[
      { id: 'a', name: '山田', preview: '届きましたか', time: '17:51', unread: true, href: '/m/chats?friend=a' },
      { id: 'b', name: '佐藤', preview: 'ありがとうございます', outgoing: true, time: '昨日', unread: false, href: '/m/chats?friend=b' },
    ]} />)
    const list = screen.getByRole('list', { name: 'トーク' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/m/chats?friend=a', '/m/chats?friend=b'])
    expect(links[0].textContent).toContain('未読。')
    expect(links[1].textContent).not.toContain('未読')
    expect(links[1].textContent).toContain('返信：ありがとうございます')
  })
})
