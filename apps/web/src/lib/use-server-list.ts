'use client'

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import ListState from '@/components/shared/list-state'
import { LIST_REQUEST_TIMEOUT_MS } from '@/lib/request-timeout'

export type ServerListSort = ReadonlyArray<Readonly<{
  field: string
  direction: 'asc' | 'desc'
}>>

export type ServerListResponse<T> = Readonly<{
  items: T[]
  total?: number
  nextCursor?: string
  limit: number
  sort: ServerListSort
}>

type LoadState<T> = {
  items: T[]
  total: number
  nextCursor?: string
  limit: number
  sort: ServerListSort
  loaded: boolean
  loading: boolean
  error: Error | null
}

type StateViewInput = Readonly<{
  loaded: boolean
  loading: boolean
  itemCount: number
  error: Error | null
  retry: () => void
}>

const DEFAULT_LIMIT = 50

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('一覧を読み込めませんでした')
}

function initialState<T>(limit: number): LoadState<T> {
  return {
    items: [],
    total: 0,
    limit,
    sort: [],
    loaded: false,
    loading: true,
    error: null,
  }
}

/** 画面が独自の読み込み文言を作らず、共通 ListState をそのまま置けるようにする。 */
export function serverListStateView({
  loaded,
  loading,
  itemCount,
  error,
  retry,
}: StateViewInput): ReactElement | null {
  if (loading && itemCount === 0) return createElement(ListState, { kind: 'loading' })
  // m23m: 捕まえた失敗をそのまま渡す。403 は権限の案内・再試行なし、
  // 429 は待ち案内になる（ListState の `error` が言い分ける）。
  if (error) return createElement(ListState, { kind: 'error', error, onRetry: retry })
  if (loaded && itemCount === 0) return createElement(ListState, { kind: 'empty' })
  return null
}

export function serverListPageCount(total: number, limit: number): number {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT
  return Math.max(1, Math.ceil(safeTotal / safeLimit))
}

export function useOffsetServerList<T>({
  requestKey,
  load,
  initialLimit = DEFAULT_LIMIT,
  requestTimeoutMs = LIST_REQUEST_TIMEOUT_MS,
}: {
  /** 絞り込み・アカウント等を直列化したキー。変わると1ページ目へ戻る。 */
  requestKey: string
  load: (request: { page: number; limit: number }, signal: AbortSignal) => Promise<ServerListResponse<T>>
  initialLimit?: number
  /*
   * #625: 応答しない要求をこの時間で打ち切り、失敗表示＋再試行へ落とす。
   * 検索語の異常な長さや経路の沈黙で「読み込んでいます」が消えない事故を防ぐ。
   */
  requestTimeoutMs?: number
}) {
  const [navigation, setNavigation] = useState({ requestKey, page: 1 })
  const [state, setState] = useState<LoadState<T>>(() => initialState(initialLimit))
  const [retryVersion, setRetryVersion] = useState(0)
  const page = navigation.requestKey === requestKey ? navigation.page : 1

  useEffect(() => {
    if (navigation.requestKey !== requestKey) {
      setNavigation({ requestKey, page: 1 })
      /*
       * ★V7 sTJsh §2: 条件の切り替えでも前の一覧を消さない。
       * 新しい答えが来るまで、いま出ている行・件数・ページ番号を
       * 残したまま読み直す（画面側は薄め＋上の線で伝える）。
       */
      setState((current) => ({ ...current, loading: true, error: null }))
      return
    }

    const controller = new AbortController()
    /*
     * 前の一覧を残したまま読み直す（★V7 sTJsh §2）。行が出ているときは
     * 消さず、画面側が `refreshing` で薄め＋線の帯を出す。行が無いときは
     * ListState の読み込み表示が従来どおり出る。
     */
    setState((current) => ({ ...current, loading: true, error: null }))
    /*
     * #625: 応答なしで「読み込んでいます」が残り続けないよう、時間切れで
     * 失敗状態へ落とす。abort で通信も止める。時間切れ後に遅れて成功しても
     * aborted 判定で捨てるので、失敗表示のまま再試行へ進める。
     * 前の行を残した読み直しでも時間切れは失敗表示へ落とす（残った行の
     * まま「読み込み中」のままにしない）。失敗時は行も消し、画面側の
     * 失敗の1枚が見えるようにする。
     */
    const timeout = setTimeout(() => {
      controller.abort()
      setState((current) => (current.loading
        ? { ...current, items: [], loaded: false, loading: false, error: new Error('一覧の読み込みが時間切れになりました') }
        : current))
    }, requestTimeoutMs)
    void load({ page, limit: initialLimit }, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return
        setState({
          items: response.items,
          total: response.total ?? 0,
          nextCursor: undefined,
          limit: response.limit,
          sort: response.sort,
          loaded: true,
          loading: false,
          error: null,
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // 失敗したときは行も消す。残ったままだと画面側の失敗表示が出ない。
        setState((current) => ({ ...current, items: [], loaded: false, loading: false, error: asError(error) }))
      },
    ).finally(() => clearTimeout(timeout))
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [initialLimit, load, navigation.requestKey, page, requestKey, requestTimeoutMs, retryVersion])

  const setPage = useCallback((nextPage: number) => {
    const safePage = Number.isSafeInteger(nextPage) && nextPage > 0 ? nextPage : 1
    setNavigation((current) => ({ ...current, page: safePage }))
  }, [])
  const retry = useCallback(() => setRetryVersion((version) => version + 1), [])
  const pageCount = serverListPageCount(state.total, state.limit)

  return {
    ...state,
    page,
    pageCount,
    setPage,
    retry,
    /*
     * 前の表示を残した読み直し中（★V7 sTJsh §2）。一覧を薄めて
     * 上に線の帯を出す合図。初回・0件からの読み込みでは立たない。
     */
    refreshing: state.loading && state.items.length > 0,
    stateView: serverListStateView({
      loaded: state.loaded,
      loading: state.loading,
      itemCount: state.items.length,
      error: state.error,
      retry,
    }),
  }
}

export function useCursorServerList<T>({
  requestKey,
  load,
  initialLimit = DEFAULT_LIMIT,
}: {
  /** 絞り込み・アカウント等を直列化したキー。変わると先頭から読み直す。 */
  requestKey: string
  load: (request: { cursor?: string; limit: number }, signal: AbortSignal) => Promise<ServerListResponse<T>>
  initialLimit?: number
}) {
  const [activeKey, setActiveKey] = useState(requestKey)
  const [state, setState] = useState<LoadState<T>>(() => initialState(initialLimit))
  const [retryVersion, setRetryVersion] = useState(0)
  const requestId = useRef(0)
  const activeController = useRef<AbortController | null>(null)
  const lastFailedCursor = useRef<string | undefined>(undefined)

  const request = useCallback(async (cursor: string | undefined, replace: boolean) => {
    activeController.current?.abort()
    const id = requestId.current + 1
    requestId.current = id
    const controller = new AbortController()
    activeController.current = controller
    setState((current) => ({
      ...current,
      ...(replace ? { items: [], loaded: false } : {}),
      loading: true,
      error: null,
    }))
    try {
      const response = await load({ cursor, limit: initialLimit }, controller.signal)
      if (requestId.current !== id) return
      lastFailedCursor.current = undefined
      setState((current) => ({
        items: replace ? response.items : [...current.items, ...response.items],
        total: response.total ?? 0,
        nextCursor: response.nextCursor,
        limit: response.limit,
        sort: response.sort,
        loaded: true,
        loading: false,
        error: null,
      }))
    } catch (error) {
      if (controller.signal.aborted || requestId.current !== id) return
      lastFailedCursor.current = cursor
      setState((current) => ({ ...current, loaded: current.items.length > 0, loading: false, error: asError(error) }))
    } finally {
      if (activeController.current === controller) activeController.current = null
    }
  }, [initialLimit, load])

  useEffect(() => () => activeController.current?.abort(), [])

  useEffect(() => {
    if (activeKey !== requestKey) {
      requestId.current += 1
      activeController.current?.abort()
      setActiveKey(requestKey)
      setState(initialState(initialLimit))
      return
    }
    void request(undefined, true)
  }, [activeKey, initialLimit, request, requestKey, retryVersion])

  const loadNext = useCallback(() => {
    if (state.loading || !state.nextCursor) return
    void request(state.nextCursor, false)
  }, [request, state.loading, state.nextCursor])
  const retry = useCallback(() => {
    if (lastFailedCursor.current) {
      void request(lastFailedCursor.current, false)
      return
    }
    setRetryVersion((version) => version + 1)
  }, [request])

  return {
    ...state,
    hasNext: Boolean(state.nextCursor),
    loadNext,
    retry,
    stateView: serverListStateView({
      loaded: state.loaded,
      loading: state.loading,
      itemCount: state.items.length,
      error: state.error,
      retry,
    }),
  }
}
