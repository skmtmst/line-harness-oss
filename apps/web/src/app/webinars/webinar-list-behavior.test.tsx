import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from '@/components/shared/button'
import { ApiError, type WebinarListItem, type WebinarListParams, type WebinarListResponse } from '@/lib/api'
import WebinarsPage from './page'
import { webinarLoadFailure } from './webinar-load-failure'

const {
  WEBINAR_SEARCH_DEBOUNCE_MS,
  WebinarArchiveConfirm,
  WebinarListContent,
  WebinarListErrorNotice,
  requestWebinarList,
  scheduleWebinarSearch,
} = WebinarsPage.__testing

type WebinarListSnapshot = Parameters<typeof requestWebinarList>[0]['snapshot']

function webinar(overrides: Partial<WebinarListItem> = {}): WebinarListItem {
  return {
    id: 'webinar-1',
    accountId: 'account-1',
    title: '入門ウェビナー',
    slug: 'intro',
    status: 'draft',
    videoPrefix: null,
    durationSeconds: 1_800,
    schedule: [],
    cta: null,
    tagOnAttend: null,
    tagOnCtaClick: null,
    folderId: null,
    folderName: null,
    registrationCount: 12,
    viewerCount: 8,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  }
}

function response(items: WebinarListItem[]): { data: WebinarListResponse } {
  return {
    data: {
      items,
      total: items.length,
      limit: 20,
      sort: [{ field: 'updated_at', direction: 'desc' }],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function descendants(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = []
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue
    found.push(child)
    found.push(...descendants((child.props as { children?: ReactNode }).children))
  }
  return found
}

const initialSnapshot: WebinarListSnapshot = {
  items: [webinar()],
  total: 1,
  loadedAccountId: 'account-1',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ウェビナー一覧の検索操作', () => {
  it('入力を連打しても最後の値だけを300ms後にAPIへ渡す', async () => {
    vi.useFakeTimers()
    const list = vi.fn<(accountId: string, params: WebinarListParams) => Promise<{ data: WebinarListResponse }>>()
      .mockResolvedValue(response([webinar({ title: '最終結果' })]))
    const generation = { current: 0 }
    const requests: Array<Promise<WebinarListSnapshot | null>> = []
    const onReady = (query: string) => {
      const requestGeneration = ++generation.current
      requests.push(requestWebinarList({
        list,
        snapshot: initialSnapshot,
        generation: requestGeneration,
        currentGeneration: () => generation.current,
        accountId: 'account-1',
        params: { page: 1, limit: 20, q: query },
      }))
    }

    const cancelFirst = scheduleWebinarSearch('ウ', onReady)
    cancelFirst()
    const cancelSecond = scheduleWebinarSearch('ウェ', onReady)
    cancelSecond()
    scheduleWebinarSearch('ウェビナー', onReady)

    await vi.advanceTimersByTimeAsync(WEBINAR_SEARCH_DEBOUNCE_MS - 1)
    expect(list).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith('account-1', { page: 1, limit: 20, q: 'ウェビナー' })
    await expect(requests[0]).resolves.toMatchObject({ items: [{ title: '最終結果' }] })
  })

  it('遅い古い応答が、新しい検索結果を上書きしない', async () => {
    const oldResponse = deferred<{ data: WebinarListResponse }>()
    const newResponse = deferred<{ data: WebinarListResponse }>()
    const list = vi.fn<(accountId: string, params: WebinarListParams) => Promise<{ data: WebinarListResponse }>>()
      .mockImplementation((_accountId, params) => params.q === '古い' ? oldResponse.promise : newResponse.promise)
    const generation = { current: 0 }
    const oldRequestGeneration = ++generation.current
    const oldRequest = requestWebinarList({
      list,
      snapshot: initialSnapshot,
      generation: oldRequestGeneration,
      currentGeneration: () => generation.current,
      accountId: 'account-1',
      params: { q: '古い' },
    })
    const newRequestGeneration = ++generation.current
    const newRequest = requestWebinarList({
      list,
      snapshot: initialSnapshot,
      generation: newRequestGeneration,
      currentGeneration: () => generation.current,
      accountId: 'account-1',
      params: { q: '新しい' },
    })

    newResponse.resolve(response([webinar({ id: 'new', title: '新しい結果' })]))
    const committed = await newRequest
    expect(committed?.items[0].title).toBe('新しい結果')
    expect(renderToStaticMarkup(
      <WebinarListContent
        accountLoading={false}
        loading={false}
        selectedAccountId="account-1"
        accountsCount={1}
        loadFailure={null}
        visibleItems={committed?.items ?? []}
        panelGrand={1}
        refreshing={false}
        onRetry={vi.fn()}
        onArchive={vi.fn()}
      />,
    )).toContain('新しい結果')

    oldResponse.resolve(response([webinar({ id: 'old', title: '古い結果' })]))
    await expect(oldRequest).resolves.toBeNull()
  })
})

describe('ウェビナー一覧の表示状態と操作', () => {
  it('検索中も直前の一覧を残す', () => {
    const html = renderToStaticMarkup(
      <WebinarListContent
        accountLoading={false}
        loading={false}
        selectedAccountId="account-1"
        accountsCount={1}
        loadFailure={null}
        visibleItems={[webinar()]}
        panelGrand={1}
        refreshing
        onRetry={vi.fn()}
        onArchive={vi.fn()}
      />,
    )
    expect(html).toContain('検索中…')
    expect(html).toContain('入門ウェビナー')
    expect(html).not.toContain('読み込んでいます')
  })

  it('0件を「全体が空」と「検索結果が空」に分けて描く', () => {
    const common = {
      accountLoading: false,
      loading: false,
      selectedAccountId: 'account-1',
      accountsCount: 1,
      loadFailure: null,
      visibleItems: [],
      refreshing: false,
      onRetry: vi.fn(),
      onArchive: vi.fn(),
    }
    expect(renderToStaticMarkup(<WebinarListContent {...common} panelGrand={0} />))
      .toContain('まだウェビナーがありません')
    expect(renderToStaticMarkup(<WebinarListContent {...common} panelGrand={4} />))
      .toContain('条件に合うウェビナーはありません')
  })

  it('再検索が失敗しても直前の行を残し、再読み込み操作を受け付ける', async () => {
    const list = vi.fn<(accountId: string, params: WebinarListParams) => Promise<{ data: WebinarListResponse }>>()
      .mockRejectedValue(new ApiError(500, 'failed'))
    await expect(requestWebinarList({
      list,
      snapshot: initialSnapshot,
      generation: 1,
      currentGeneration: () => 1,
      accountId: 'account-1',
      params: { q: '失敗' },
    })).rejects.toBeInstanceOf(ApiError)

    const failure = webinarLoadFailure(new ApiError(500, 'failed'))
    const html = renderToStaticMarkup(
      <WebinarListContent
        accountLoading={false}
        loading={false}
        selectedAccountId="account-1"
        accountsCount={1}
        loadFailure={failure}
        visibleItems={initialSnapshot.items}
        panelGrand={1}
        refreshing={false}
        onRetry={vi.fn()}
        onArchive={vi.fn()}
      />,
    )
    expect(html).toContain('ウェビナーを表示できませんでした')
    expect(html).toContain('入門ウェビナー')

    const retry = vi.fn()
    const notice = WebinarListErrorNotice({ failure, onRetry: retry })
    const retryButton = descendants(notice).find((element) => element.type === Button) as
      | ReactElement<{ onClick: () => void }>
      | undefined
    expect(retryButton).toBeDefined()
    retryButton?.props.onClick()
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe('ウェビナーのアーカイブ操作', () => {
  it('公開中は停止への次操作を出し、アーカイブ確定を実行できない', () => {
    const confirm = vi.fn()
    const dialog = WebinarArchiveConfirm({
      target: webinar({ status: 'active' }),
      busy: false,
      error: undefined,
      onCancel: vi.fn(),
      onConfirm: confirm,
    }) as ReactElement<{ onConfirm?: () => void }>
    const html = renderToStaticMarkup(dialog)

    expect(html).toContain('先に公開を停止してから')
    expect(html).toContain('/webinars/edit?id=webinar-1')
    expect(html).toContain('編集画面で公開を停止する')
    expect(html).not.toContain('>アーカイブする</button>')
    expect(dialog.props.onConfirm).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('停止中は確認内容を描き、確定操作を実行する', () => {
    const confirm = vi.fn()
    const dialog = WebinarArchiveConfirm({
      target: webinar({ status: 'draft' }),
      busy: false,
      error: undefined,
      onCancel: vi.fn(),
      onConfirm: confirm,
    }) as ReactElement<{ onConfirm?: () => void }>
    const html = renderToStaticMarkup(dialog)

    expect(html).toContain('申込者・視聴履歴・CTA・分析結果は消えません')
    expect(html).toContain('>アーカイブする</button>')
    dialog.props.onConfirm?.()
    expect(confirm).toHaveBeenCalledOnce()
  })
})
