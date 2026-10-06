// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushListUrlState,
  nextListUrl,
  parseListUrlState,
  readListUrlParam,
  useListScrollMemory,
  useListUrlFlag,
  useListUrlParam,
  useListUrlState,
} from './list-url-state'

/*
 * 動きの点検（2026-10-07）5 番：一覧の絞り込み・検索語・ページを URL に置く口。
 * 戻る・再読み込みで同じ一覧に戻れること、既定値は URL に残さないこと、
 * 知らない鍵（?id= など）を消さないこと、絞るたびに「戻る」の段を増やさないこと。
 */

beforeEach(() => {
  flushListUrlState()
  window.history.replaceState(null, '', '/scenarios')
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe('URL の読み書き（純粋な関数）', () => {
  it('既定値と同じ値・空の値は URL から消し、知らない鍵は残す', () => {
    const url = nextListUrl({ pathname: '/scenarios', search: '?id=7&q=old', hash: '' }, { q: '', status: 'all' }, { q: '', status: 'all' })
    expect(url).toBe('/scenarios?id=7')
    expect(nextListUrl({ pathname: '/s', search: '', hash: '#x' }, { status: 'all' }, { status: 'stopped' })).toBe('/s?status=stopped#x')
  })

  it('URL に無い鍵は既定値で埋める', () => {
    expect(parseListUrlState('?q=%E3%81%82', { q: '', status: 'all' })).toEqual({ q: 'あ', status: 'all' })
  })
})

function Probe() {
  const [q, setQ] = useListUrlParam('q')
  const [stopped, setStopped] = useListUrlFlag('stopped')
  const [view, setView] = useListUrlState({ folder: '', page: '1' })
  return (
    <div>
      <output data-testid="q">{q}</output>
      <output data-testid="stopped">{String(stopped)}</output>
      <output data-testid="folder">{view.folder}</output>
      <output data-testid="page">{view.page}</output>
      <button type="button" onClick={() => setQ('フォロー')}>検索</button>
      <button type="button" onClick={() => setStopped(!stopped)}>停止中</button>
      <button type="button" onClick={() => setView({ folder: 'f1', page: '2' })}>フォルダ</button>
      <button type="button" onClick={() => { setQ(''); setStopped(false); setView({ folder: '', page: '1' }) }}>解除</button>
    </div>
  )
}

describe('useListUrlParam・useListUrlFlag・useListUrlState', () => {
  it('URL にある値から始まる（戻る・再読み込みで同じ一覧）', () => {
    window.history.replaceState(null, '', '/scenarios?q=abc&stopped=1&folder=f9&page=3')
    render(<Probe />)
    expect(screen.getByTestId('q').textContent).toBe('abc')
    expect(screen.getByTestId('stopped').textContent).toBe('true')
    expect(screen.getByTestId('folder').textContent).toBe('f9')
    expect(screen.getByTestId('page').textContent).toBe('3')
  })

  it('変えると URL を置き換え、画面も変わる。「戻る」の段は増やさない', () => {
    window.history.replaceState(null, '', '/scenarios?id=7')
    const length = window.history.length
    render(<Probe />)
    act(() => screen.getByText('検索').click())
    act(() => screen.getByText('停止中').click())
    act(() => screen.getByText('フォルダ').click())
    // 見た目は押した瞬間に変わり、URL は描いた後に書く。
    expect(screen.getByTestId('folder').textContent).toBe('f1')
    flushListUrlState()
    expect(new URLSearchParams(window.location.search).get('q')).toBe('フォロー')
    expect(window.location.search).toContain('stopped=1')
    expect(window.location.search).toContain('folder=f1')
    expect(window.location.search).toContain('page=2')
    expect(window.location.search).toContain('id=7')
    expect(screen.getByTestId('q').textContent).toBe('フォロー')
    expect(screen.getByTestId('stopped').textContent).toBe('true')
    expect(window.history.length).toBe(length)
  })

  it('既定に戻すと URL から消える（知らない鍵は残る）', () => {
    window.history.replaceState(null, '', '/scenarios?id=7&q=a&stopped=1&folder=f&page=4')
    render(<Probe />)
    act(() => screen.getByText('解除').click())
    flushListUrlState()
    expect(window.location.search).toBe('?id=7')
    expect(readListUrlParam('q')).toBe('')
  })
})

function ScrollProbe({ ready }: { ready: boolean }) {
  useListScrollMemory(ready)
  return <div style={{ height: 3000 }}>一覧</div>
}

describe('useListScrollMemory', () => {
  it('戻る（popstate）で来たら、中身が描けてから覚えていた位置へ戻す', async () => {
    window.sessionStorage.setItem('lh:list-scroll:/scenarios', '420')
    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 0
    window.dispatchEvent(new PopStateEvent('popstate'))
    const view = render(<ScrollProbe ready={false} />)
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    expect(scroller.scrollTop).toBe(0)
    view.rerender(<ScrollProbe ready />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(scroller.scrollTop).toBe(420)
  })
})

import { useOffsetServerList } from '@/lib/use-server-list'

function PagedProbe({ load }: { load: (request: { page: number; limit: number }) => Promise<{ items: string[]; total: number; limit: number; sort: [] }> }) {
  const list = useOffsetServerList<string>({ requestKey: 'k', load, initialLimit: 10, pageUrlKey: 'page' })
  return (
    <div>
      <output data-testid="list-page">{list.page}</output>
      <button type="button" onClick={() => list.setPage(2)}>2ページ</button>
      <button type="button" onClick={() => list.setPage(1)}>1ページ</button>
    </div>
  )
}

describe('useOffsetServerList の pageUrlKey', () => {
  it('URL のページから読み、ページを送ると URL に書く（1 ページ目は書かない）', async () => {
    window.history.replaceState(null, '', '/reminders?page=3')
    const pages: number[] = []
    const load = async (request: { page: number; limit: number }) => {
      await Promise.resolve()
      pages.push(request.page)
      return { items: ['a'], total: 50, limit: 10, sort: [] as [] }
    }
    render(<PagedProbe load={load} />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(screen.getByTestId('list-page').textContent).toBe('3')
    expect(pages.at(-1)).toBe(3)
    act(() => screen.getByText('2ページ').click())
    flushListUrlState()
    expect(window.location.search).toBe('?page=2')
    act(() => screen.getByText('1ページ').click())
    flushListUrlState()
    expect(window.location.search).toBe('')
  })
})

describe('URL への書き込みは描いた後', () => {
  it('押した処理の中では書かず、次のコマの後にまとめて 1 回書く', async () => {
    render(<Probe />)
    const spy = vi.spyOn(window.history, 'replaceState')
    act(() => screen.getByText('検索').click())
    act(() => screen.getByText('停止中').click())
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('q').textContent).toBe('フォロー')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(window.location.search).toContain('stopped=1')
    spy.mockRestore()
  })
})
