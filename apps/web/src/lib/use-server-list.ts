'use client'

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import ListState from '@/components/shared/list-state'

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
  if (error) return createElement(ListState, { kind: 'error', onRetry: retry })
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
}: {
  /** 絞り込み・アカウント等を直列化したキー。変わると1ページ目へ戻る。 */
  requestKey: string
  load: (request: { page: number; limit: number }, signal: AbortSignal) => Promise<ServerListResponse<T>>
  initialLimit?: number
}) {
  const [navigation, setNavigation] = useState({ requestKey, page: 1 })
  const [state, setState] = useState<LoadState<T>>(() => initialState(initialLimit))
  const [retryVersion, setRetryVersion] = useState(0)
  const page = navigation.requestKey === requestKey ? navigation.page : 1

  useEffect(() => {
    if (navigation.requestKey !== requestKey) {
      setNavigation({ requestKey, page: 1 })
      setState(initialState(initialLimit))
      return
    }

    const controller = new AbortController()
    setState((current) => ({ ...current, items: [], loaded: false, loading: true, error: null }))
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
        setState((current) => ({ ...current, loaded: false, loading: false, error: asError(error) }))
      },
    )
    return () => controller.abort()
  }, [initialLimit, load, navigation.requestKey, page, requestKey, retryVersion])

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
