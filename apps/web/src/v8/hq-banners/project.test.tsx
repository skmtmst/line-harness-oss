// @vitest-environment happy-dom
/*
 * V8 バナー生成・プロジェクトの中（src/v8/hq-banners/project.tsx）の動きの試験。
 * 札と画像のます・アーカイブの確かめ（I0w2e）・画像の詳細（rI5uh）→ 一覧から外す確かめ（B24oNg）・
 * 閲覧のみには取り込む・アーカイブ・生成パネル・星を置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const presets = vi.hoisted(() => vi.fn())
const getProject = vi.hoisted(() => vi.fn())
const updateProject = vi.hoisted(() => vi.fn())
const removeImage = vi.hoisted(() => vi.fn())
const listAccounts = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const roleBox = vi.hoisted(() => ({ role: 'owner' as string | null }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      hqBanners: {
        ...actual.api.hqBanners,
        presets,
        usage: vi.fn(async () => ({ success: false })),
        projects: { ...actual.api.hqBanners.projects, get: getProject, update: updateProject, list: vi.fn(async () => ({ success: true, data: [] })) },
        images: { ...actual.api.hqBanners.images, remove: removeImage },
      },
      lineAccounts: { ...actual.api.lineAccounts, list: listAccounts },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=p1'),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => roleBox.role }
})

import HqBannerProjectV8 from './project'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const PRESET = { key: 'line_rich_message', group: 'line', label: 'リッチメッセージ', note: '', aspectRatio: '1:1', apiSize: '1024x1024', targetWidth: 1040, targetHeight: 1040 }
const generation = {
  id: 'g1', projectId: 'p1', status: 'done', mode: 'banner', presetKey: 'line_rich_message', aspectRatio: '1:1', apiSize: '1024x1024', quality: 'medium',
  textLines: ['秋の新商品、はじまりました'], emphasisLines: [false], baseColor: null, mainColor: '#8B5A2B', subColor: null, accentColor: null,
  personOption: 'without', customPrompt: null, freePrompt: null, finalPrompt: '', engine: 'openai', modelName: 'x', requestedCount: 2, doneCount: 2, failedCount: 0,
  unitsPerImage: 1, errorMessage: null, references: null, createdBy: null, createdAt: '2026-09-30T10:12:00+09:00', startedAt: null, finishedAt: null,
}
const image = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `img-${n}`, projectId: 'p1', generationId: 'g1', sequence: n, source: 'generated', parentImageId: null, isFavorite: false,
  createdBy: null, createdAt: '2026-09-30T10:12:00+09:00',
  media: { id: `m-${n}`, filename: `${n}.png`, mimeType: 'image/png', sizeBytes: 100, width: 1040, height: 1040, url: `https://example.invalid/${n}.png` },
  generation, deliveredAccountIds: [], ...extra,
})

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  roleBox.role = 'owner'
  presets.mockResolvedValue({ success: true, data: { presets: [PRESET], maxCount: 4, engineReady: true, usage: { month: { used: 40, limit: 150, remaining: 110 }, today: { used: 6, limit: 30, remaining: 24 }, paused: false, pausedReason: null } } })
  getProject.mockResolvedValue({
    success: true,
    data: {
      project: { id: 'p1', name: '秋のキャンペーン', description: '一斉配信の上の写真・10月', isFavorite: false, archivedAt: null, imageCount: 2, runningCount: 0, createdBy: null, createdAt: '2026-09-01T09:00:00+09:00', updatedAt: '2026-09-30T10:00:00+09:00' },
      images: [image(1, { isFavorite: true, deliveredAccountIds: ['a1'] }), image(2)],
      generations: [generation],
    },
  })
  updateProject.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ success: true, data: { id: 'p1', name: '秋のキャンペーン', description: null, isFavorite: false, archivedAt: patch.archived ? '2026-10-06T10:00:00+09:00' : null, imageCount: 2, runningCount: 0, createdBy: null, createdAt: '', updatedAt: '' } }))
  removeImage.mockResolvedValue({ success: true, data: null })
  listAccounts.mockResolvedValue({ success: true, data: [] })
  push.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() })
}

const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s+/g, '') === name.replace(/\s+/g, ''))

describe('V8 バナー生成・プロジェクトの中（src/v8/hq-banners）の動き', () => {
  it('題・説明・札の数・画像の札が出る', async () => {
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    expect(host.textContent).toContain('秋のキャンペーン')
    expect(host.textContent).toContain('一斉配信の上の写真・10月。右で用途とテキストを決めて生成し')
    expect(host.textContent).toContain('すべて 2')
    expect(host.textContent).toContain('お気に入り 1')
    expect(host.textContent).toContain('アカウントへ渡し済み 1')
    expect(host.textContent).toContain('リッチメッセージ・1:1')
    expect(buttonNamed('画像を生成（1枚）') ?? buttonNamed('画像を生成（4枚）')).toBeTruthy()
  })

  it('アーカイブは確かめてから行い、一覧へ戻る', async () => {
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    act(() => { buttonNamed('アーカイブする')!.click() })
    await flush()
    expect(document.body.textContent).toContain('「秋のキャンペーン」をアーカイブしますか？')
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent?.includes('アーカイブする')) as HTMLButtonElement
    act(() => { confirm.click() })
    await flush()
    expect(updateProject).toHaveBeenCalledWith('p1', { archived: true })
    expect(push).toHaveBeenCalledWith('/hq/banners')
  })

  it('画像を押すと詳細が開き、一覧から外すは確かめの窓だけを出してから外す', async () => {
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    act(() => { (host.querySelector('[aria-label="画像 1 を開く"]') as HTMLButtonElement).click() })
    await flush()
    expect(document.body.textContent).toContain('画像の詳細')
    expect(document.body.textContent).toContain('生成時の条件')
    act(() => { buttonNamed('一覧から外す')!.click() })
    await flush()
    expect(document.body.textContent).toContain('この画像を一覧から外しますか？')
    expect(document.body.textContent).not.toContain('生成時の条件')
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === '一覧から外す') as HTMLButtonElement
    act(() => { confirm.click() })
    await flush()
    expect(removeImage).toHaveBeenCalledWith('img-1')
  })

  it('閲覧のみには取り込む・アーカイブ・生成パネル・星を置かない', async () => {
    roleBox.role = 'viewer'
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    expect(host.textContent).toContain('秋のキャンペーン')
    expect(buttonNamed('画像を取り込む')).toBeUndefined()
    expect(buttonNamed('アーカイブする')).toBeUndefined()
    expect(host.querySelector('[aria-label="画像を生成"]')).toBeNull()
    expect(host.querySelector('[aria-label="お気に入りにする"]')).toBeNull()
    act(() => { (host.querySelector('[aria-label="画像 1 を開く"]') as HTMLButtonElement).click() })
    await flush()
    expect(document.body.textContent).toContain('画像の詳細')
    expect(buttonNamed('一覧から外す')).toBeUndefined()
    expect(buttonNamed('同じ設定でもう一度生成')).toBeUndefined()
  })
})
