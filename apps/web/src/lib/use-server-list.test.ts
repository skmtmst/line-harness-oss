import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { serverListPageCount, serverListStateView } from './use-server-list'

describe('共通一覧フックのページ計算', () => {
  it('total=0 でも pageCount は1になる', () => {
    expect(serverListPageCount(0, 50)).toBe(1)
    expect(serverListPageCount(0, 0)).toBe(1)
  })

  it('端数は次のページとして数える', () => {
    expect(serverListPageCount(101, 50)).toBe(3)
  })
})

describe('共通一覧フックの状態表示', () => {
  it('読み込み中・0件・失敗を共通 ListState で言い分ける', () => {
    const retry = vi.fn()
    const loading = renderToStaticMarkup(serverListStateView({
      loaded: false, loading: true, itemCount: 0, error: null, retry,
    }))
    const empty = renderToStaticMarkup(serverListStateView({
      loaded: true, loading: false, itemCount: 0, error: null, retry,
    }))
    const failed = renderToStaticMarkup(serverListStateView({
      loaded: false, loading: false, itemCount: 0, error: new Error('failed'), retry,
    }))

    expect(loading).toContain('data-list-state="loading"')
    expect(empty).toContain('data-list-state="empty"')
    expect(failed).toContain('data-list-state="error"')
    expect(failed).toContain('再読み込み')
  })

  it('取得済みの行があれば一覧を共通状態で覆わない', () => {
    expect(serverListStateView({
      loaded: true, loading: false, itemCount: 1, error: null, retry: vi.fn(),
    })).toBeNull()
  })

  it('続きの取得失敗も共通の再読み込み表示にする', () => {
    const failed = renderToStaticMarkup(serverListStateView({
      loaded: true, loading: false, itemCount: 3, error: new Error('failed'), retry: vi.fn(),
    }))
    expect(failed).toContain('data-list-state="error"')
  })
})
