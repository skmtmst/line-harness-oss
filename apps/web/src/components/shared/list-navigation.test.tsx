// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageLink, { ListNavigationAccount, ListReturnAccountGuard, listNavigationHref, listReturnUrl } from './list-navigation'
import { RovingTbody } from './row-roving'
import { Tr, Td, NameCell, RowNameLink } from './table'
import Button from './button'
import Breadcrumb from '@/components/layout/breadcrumb'
import { flushListUrlState, useListUrlState } from './list-url-state'
import { useDetailPanelUrl } from './detail-panel'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); flushListUrlState() })
beforeEach(() => window.history.replaceState(null, '', '/tags'))
const origin = 'http://localhost:3000'
const source = '/templates?q=予約&folder=f1&sort=name&page=2&row=t1'
const edit = listNavigationHref('/templates/edit?id=t1', source, 'account-a', origin)

describe('一覧→詳細→編集→戻る', () => {
  it('一覧条件と選んだ対象を詳細→編集まで持ち帰る', () => {
    const detail = listNavigationHref('/templates/detail?id=t1', source, 'account-a', origin)
    const next = listNavigationHref('/templates/edit?id=t1', detail, 'account-a', origin)
    expect(new URL(next, origin).searchParams.get('returnTo')).toBe(new URL(source, origin).pathname + new URL(source, origin).search)
    expect(listReturnUrl(next, '/templates', 'account-a', origin)).toBe(new URL(source, origin).pathname + new URL(source, origin).search)
    expect(listReturnUrl(next, '/templates', 'account-b', origin)).toBe('/templates')
  })
  it.each(['https://evil.test/templates?q=x', '//evil.test/templates', '/tags?q=x', '/templates/edit?id=x', 'javascript:alert(1)', '/templates/../tags', '/templates\\evil', '/templates\n?q=x'])('許さない戻り先 %s は基本一覧へ', back => {
    const url = `/templates/edit?id=t1&returnAccount=account-a&returnTo=${encodeURIComponent(back)}`
    expect(listReturnUrl(url, '/templates', 'account-a', origin)).toBe('/templates')
  })
  it('直接開いた編集は基本一覧、別機能と外へのリンクへ条件を付けない', () => {
    expect(listReturnUrl('/templates/edit?id=t1', '/templates', 'account-a', origin)).toBe('/templates')
    expect(listNavigationHref('/friends?tag=t1', source, 'account-a', origin)).toBe('/friends?tag=t1')
    expect(listNavigationHref('https://example.com', source, 'account-a', origin)).toBe('https://example.com')
  })
  it('同じサイトの一覧だけ許し、戻り先の中に戻り先を重ねない', () => {
    const nested = `${origin}/templates?q=x&returnTo=bad&returnAccount=other`
    expect(listReturnUrl(`/templates/edit?returnAccount=account-a&returnTo=${encodeURIComponent(nested)}`, '/templates', 'account-a', origin)).toBe('/templates?q=x')
  })
  it('キャンセルとパンくずは同じ元一覧。アカウントを変えたら両方とも条件なし', () => {
    window.history.replaceState(null, '', edit)
    const ui = (account: string) => <ListNavigationAccount.Provider value={account}><ListReturnAccountGuard accountId={account}/><Button href="/templates">キャンセル</Button><Breadcrumb items={[{ label: 'テンプレート', href: '/templates' }, { label: '編集' }]} /></ListNavigationAccount.Provider>
    const view = render(ui('account-a'))
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe(new URL(source, origin).pathname + new URL(source, origin).search)
    view.rerender(ui(''))
    view.rerender(ui('account-b'))
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/templates')
    view.rerender(ui('account-a'))
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/templates')
  })
})

describe('一覧の共通の行と名前', () => {
  it.each(['tag', 'row', 'form'])('%s: 余白・Enter・Spaceはパネル、名前はページ、副操作は独立', key => {
    const open = vi.fn(), menu = vi.fn()
    render(<table><tbody><Tr data-row-id="one" detailKey={key} onOpen={open}><Td><RowNameLink href="/tags/edit?id=one">名前</RowNameLink></Td><Td>余白</Td><Td><a href="/friends?tag=one">12人</a><input type="checkbox" aria-label="選ぶ"/><button onClick={menu}>…</button></Td></Tr></tbody></table>)
    const row = screen.getByRole('row')
    fireEvent.click(screen.getByText('余白'))
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(open).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('link', { name: '名前' }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('link', { name: '12人' }))
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' })
    fireEvent.click(screen.getByRole('button'))
    expect(open).toHaveBeenCalledTimes(3)
    expect(menu).toHaveBeenCalledOnce()
    const back = new URL(screen.getByRole('link', { name: '名前' }).getAttribute('href')!, origin).searchParams.get('returnTo')!
    expect(new URL(back, origin).searchParams.get(key)).toBe('one')
  })
  it('件数リンクだけの記録行は余白とキーでそのリンクを横取りしない', () => {
    render(<table><tbody><Tr><Td>記録</Td><Td><a href="/friends">12人</a></Td></Tr></tbody></table>)
    const row = screen.getByRole('row')
    expect(row.hasAttribute('tabindex')).toBe(false)
    const click = vi.fn(); screen.getByRole('link').addEventListener('click', click)
    fireEvent.click(screen.getByText('記録')); fireEvent.keyDown(row, { key: 'Enter' })
    expect(click).not.toHaveBeenCalled()
  })
  it('パネルは書きかけの検索を残し、読み直し・別タブ・戻るでも対象を復元', () => {
    function Probe() {
      const [, setFilters] = useListUrlState({ q: '' })
      const [id, setId] = useDetailPanelUrl('form')
      return <><output>{id ?? '閉じた'}</output><button onClick={() => { setFilters({ q: '予約' }); setId('one') }}>開く</button><button onClick={() => setId(null)}>閉じる</button><PageLink href="/tags/edit?id=one">編集</PageLink></>
    }
    const view = render(<Probe />)
    act(() => fireEvent.click(screen.getByText('開く')))
    expect(new URLSearchParams(window.location.search).get('q')).toBe('予約')
    expect(new URLSearchParams(window.location.search).get('form')).toBe('one')
    view.unmount(); render(<Probe />)
    expect(screen.getByText('one')).toBeTruthy()
    act(() => { window.history.replaceState(null, '', '/tags?form=two'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.getByText('two')).toBeTruthy()
    act(() => fireEvent.click(screen.getByText('閉じる')))
    expect(new URLSearchParams(window.location.search).has('form')).toBe(false)
  })
})

it('ページへ開く名前をNameCellに渡した行もEnter・Spaceで名前のページへ進む', () => {
  const navigate = vi.fn()
  render(<table><tbody><Tr><NameCell name={<RowNameLink href="/friends/detail?id=one" onClick={event => { event.preventDefault(); navigate() }}>友だち</RowNameLink>} /></Tr></tbody></table>)
  const row = screen.getByRole('row')
  fireEvent.keyDown(row, { key: 'Enter' }); fireEvent.keyDown(row, { key: ' ' })
  expect(navigate).toHaveBeenCalledTimes(2)
})

it('同じURLで開く統括の詳細→編集→一覧も元の条件を保つ', () => {
   const source = '/hq/templates?q=予約&folderFilter=f1&page=2'
   const detail = listNavigationHref('/hq/templates?item=t1&mode=detail', source, 'a', origin)
   const edit = listNavigationHref('/hq/templates?item=t1&mode=edit', detail, 'a', origin)
   expect(new URL(edit, origin).searchParams.get('returnTo')).toBe(new URL(source, origin).pathname + new URL(source, origin).search)
   expect(listNavigationHref('/hq/templates', edit, 'a', origin)).toBe(new URL(source, origin).pathname + new URL(source, origin).search)
})

it('同じ一覧の詳細を開く名前もLinkを保ち、別タブ操作は選び直しを起こさない', () => {
  const open = vi.fn()
  render(<RowNameLink href="/tags?tag=one" onOpen={open}>名前</RowNameLink>)
  const link = screen.getByRole('link')
  const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(link, ordinary)
  expect(ordinary.defaultPrevented).toBe(true)
  expect(open).toHaveBeenCalledOnce()
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true })
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(false)
  }
  expect(open).toHaveBeenCalledOnce()
  expect(link.getAttribute('href')).toBe('/tags?tag=one')
})

it('矢印移動付きの表でも行のSpaceはパネルを開き、チェックを横取りしない', () => {
  const open = vi.fn()
  render(<table><RovingTbody><Tr onOpen={open}><Td><RowNameLink href="/tags/edit?id=one">名前</RowNameLink></Td><Td><input type="checkbox" aria-label="選ぶ" /></Td></Tr></RovingTbody></table>)
  fireEvent.keyDown(screen.getByRole('row'), { key: ' ' })
  expect(open).toHaveBeenCalledOnce()
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
})
