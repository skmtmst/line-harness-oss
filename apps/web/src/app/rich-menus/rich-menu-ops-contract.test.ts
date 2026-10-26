import { api } from '@/lib/api'
import { areaDraftsWithSwitchTargets, mediaToFile } from '../../v8/rich-menus/new/create-draft'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * 画面の動きは描画の試験が持つ。
 * - 一覧の検索・複製・失敗の文：src/v8/rich-menus/list-ops-react.test.tsx
 * - 作成の口へ送る中身・登録メディア・スタッフの集計：app/rich-menus/new/create-ops-react.test.tsx
 * - 作成フォームの出す相手：components/rich-menus/rich-menu-create-form-audience-react.test.tsx
 * - 公開の履歴・再試行・照合：app/rich-menus/edit/publish-history-react.test.tsx
 * - 本人LINEへのテスト適用：src/v8/rich-menu-edit/test-apply-react.test.tsx
 * - 編集からの複製：app/rich-menus/rich-menu-dirty-guard.test.tsx
 * ここには作成の下ごしらえの関数と、API の口の送り先だけを残す。
 */
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 登録メディアの選択が作成フォームへ戻る */
describe('作成画面の登録メディア選択', () => {
  it('登録画像を現在のアカウントで取得し、失敗した応答を画像にしない', async () => {
    const contentUrl = vi.spyOn(api.media, 'contentUrl').mockReturnValue('/registered-image')
    const fetchImage = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image-data', { headers: { 'Content-Type': 'image/png' } }))
    const media = { id: 'media-a', filename: '案内.png', mimeType: 'image/png' } as Parameters<typeof mediaToFile>[0]
    const file = await mediaToFile(media, 'account-a')
    expect(contentUrl).toHaveBeenCalledWith('media-a', 'account-a')
    expect(fetchImage).toHaveBeenCalledWith('/registered-image', { credentials: 'include' })
    expect(file.name).toBe('案内.png')
    expect(await file.text()).toBe('image-data')
    fetchImage.mockResolvedValueOnce(new Response('denied', { status: 403 }))
    await expect(mediaToFile(media, 'account-a')).rejects.toThrow('403')
  })
})

/** 作成で切替・既定・出し分けを決める */
describe('作成時の切替', () => {
  it('切替の行き先は targetPageIndex に直して作成の口へ渡す', () => {
    const area = { id: 'switch', actionType: 'richmenuswitch', actionData: { targetPageId: '2' } } as Parameters<typeof areaDraftsWithSwitchTargets>[0][number]
    expect(areaDraftsWithSwitchTargets([area])[0].actionData).toEqual({ targetPageIndex: 2 })
  })
})

type Sent = { method: string; path: string; body: unknown }

function recordFetch(): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    sent.push({ method: init?.method ?? 'GET', path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return sent
}

/** APIクライアントの経路が route と一致する */
describe('APIクライアントの経路', () => {
  it('履歴・再試行・照合・複製・集計・テスト適用をそれぞれの口へ送る', async () => {
    const sent = recordFetch()
    await api.richMenuGroups.publishRuns('g-1')
    await api.richMenuGroups.retryPublishRun('g-1', 'req-1')
    await api.richMenuGroups.reconcile('g-1', true)
    await api.richMenuGroups.duplicate('g-1', 'key-1')
    await api.richMenuGroups.audienceSummary('g-1')
    await api.richMenuGroups.testApplyState('g-1')
    await api.richMenuGroups.testApply('g-1', 'key-2')
    await api.richMenuGroups.testApplyRevert('g-1', 'key-3')
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/rich-menu-groups/g-1/publish-runs',
      'POST /api/rich-menu-groups/g-1/publish-runs/req-1/retry',
      'POST /api/rich-menu-groups/g-1/reconcile',
      'POST /api/rich-menu-groups/g-1/duplicate',
      'GET /api/rich-menu-groups/g-1/audience-summary',
      'GET /api/rich-menu-groups/g-1/test-apply',
      'POST /api/rich-menu-groups/g-1/test-apply',
      'POST /api/rich-menu-groups/g-1/test-apply/revert',
    ])
  })

  it('作成に imageMediaId・既定ページ・出し分けを載せる', async () => {
    const sent = recordFetch()
    await api.richMenuGroups.create({
      accountId: 'account-a', name: 'メニュー', chatBarText: 'メニュー', size: 'large', pages: [],
      imageMediaId: 'media-a', defaultPageIndex: 1, targetingEnabled: true,
    })
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/api/rich-menu-groups' })
    expect(sent[0].body).toMatchObject({ imageMediaId: 'media-a', defaultPageIndex: 1, targetingEnabled: true })
  })
})
