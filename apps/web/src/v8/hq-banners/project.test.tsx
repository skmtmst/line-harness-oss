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
const createGeneration = vi.hoisted(() => vi.fn())
const listAccounts = vi.hoisted(() => vi.fn())
const deliverImage = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
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
        projects: { ...actual.api.hqBanners.projects, get: getProject, update: updateProject, list: vi.fn(async () => ({ success: true, data: [] })), createGeneration },
        images: { ...actual.api.hqBanners.images, remove: removeImage, deliver: deliverImage },
      },
      lineAccountFolders: { ...actual.api.lineAccountFolders, list: listFolders },
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
  listFolders.mockResolvedValue({ success: true, data: { folders: [] } })
  deliverImage.mockReset()
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
    expect(host.textContent).toContain('配布済み 1')
    expect(host.textContent).toContain('リッチメッセージ・1:1')
    // 下の帯のボタンは板 `b1So7a`「生成する（2枚）」＝v7 と同じ言葉。
    expect(buttonNamed('生成する（1枚）') ?? buttonNamed('生成する（4枚）')).toBeTruthy()
  })

  it('絞り込みで見えている画像だけまとめて選び、画像を押すと詳細へ進む', async () => {
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    expect(buttonNamed('2 枚をアカウントへ配る')).toBeUndefined()
    act(() => { buttonNamed('お気に入り 1')!.click() })
    await flush()
    const all = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => all.click())
    await flush()
    expect(buttonNamed('1 枚をアカウントへ配る')).toBeTruthy()
    expect(host.querySelector('[aria-label="画像 1 を選ぶ"]')?.closest('article')?.dataset.selected).toBe('true')
    act(() => { buttonNamed('すべて 2')!.click() })
    await flush()
    expect((host.querySelector('[aria-label="画像 2 を選ぶ"]') as HTMLInputElement).checked).toBe(false)
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).indeterminate).toBe(true)
    act(() => { (host.querySelector('[aria-label="画像 1 を開く"]') as HTMLButtonElement).click() })
    await flush()
    expect(document.body.textContent).toContain('画像の詳細')
  })

  it('共通の配る窓でフォルダを選び、途中の失敗があっても残りを配り、失敗分だけ再試行する', async () => {
    listAccounts.mockResolvedValue({ success: true, data: [
      { id: 'a1', name: '銀座店', folderId: 'f1' },
      { id: 'a2', name: '新宿店', folderId: null },
      { id: 'a3', name: '閉店', archivedAt: '2026-10-01', folderId: 'f1' },
    ] })
    listFolders.mockResolvedValue({ success: true, data: { folders: [{ id: 'f1', name: '東京', color: 'green', displayOrder: 0 }] } })
    deliverImage.mockImplementation(async (id: string) => id === 'img-1'
      ? { success: false, error: '通信できませんでした' }
      : { success: true, data: { image: image(2, { deliveredAccountIds: ['a1'] }), deliveries: [] } })
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    act(() => { (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click() })
    await flush()
    act(() => { buttonNamed('2 枚をアカウントへ配る')!.click() })
    await flush()
    expect(document.body.textContent).toContain('2枚の画像をアカウントへ配る')
    expect(document.body.textContent).not.toContain('閉店')
    expect(deliverImage).not.toHaveBeenCalled()
    act(() => { (document.querySelector('[aria-label="東京をまとめて選ぶ"]') as HTMLInputElement).click() })
    await flush()
    act(() => { buttonNamed('1 アカウントへ配る')!.click() })
    await flush()
    expect(deliverImage.mock.calls).toEqual([['img-1', ['a1']], ['img-2', ['a1']]])
    expect(document.body.textContent).toContain('2枚中 1枚を1アカウントへ配りました')
    expect(document.body.textContent).toContain('失敗 1枚')
    expect((host.querySelector('[aria-label="画像 1 を選ぶ"]') as HTMLInputElement).checked).toBe(true)
    expect((host.querySelector('[aria-label="画像 2 を選ぶ"]') as HTMLInputElement).checked).toBe(false)
    deliverImage.mockResolvedValue({ success: true, data: { image: image(1, { deliveredAccountIds: ['a1'] }), deliveries: [] } })
    act(() => { buttonNamed('1 アカウントへ配る')!.click() })
    await flush()
    expect(deliverImage.mock.calls).toEqual([['img-1', ['a1']], ['img-2', ['a1']], ['img-1', ['a1']]])
    expect(document.body.textContent).toContain('1枚中 1枚を1アカウントへ配りました')
    expect((buttonNamed('1 アカウントへ配る') as HTMLButtonElement).disabled).toBe(true)
  })

  it('配布中は二重送信と閉じる操作を止め、あとではAPIを呼ばず選択を保つ', async () => {
    listAccounts.mockResolvedValue({ success: true, data: [{ id: 'a1', name: '銀座店', folderId: null }] })
    let finish!: (result: unknown) => void
    deliverImage.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    act(() => { (host.querySelector('[aria-label="画像 2 を選ぶ"]') as HTMLInputElement).click() })
    await flush()
    act(() => { buttonNamed('1 枚をアカウントへ配る')!.click() })
    await flush()
    act(() => { buttonNamed('あとで')!.click() })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(deliverImage).not.toHaveBeenCalled()
    act(() => { buttonNamed('1 枚をアカウントへ配る')!.click() })
    await flush()
    act(() => { (document.querySelector('[aria-label="銀座店"]') as HTMLInputElement).click() })
    await flush()
    const send = buttonNamed('1 アカウントへ配る') as HTMLButtonElement
    act(() => { send.click(); send.click() })
    await flush()
    expect(deliverImage).toHaveBeenCalledTimes(1)
    expect((buttonNamed('あとで') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('1枚中 1枚目を配っています')
    await act(async () => finish({ success: true, data: { image: image(2, { deliveredAccountIds: ['a1'] }), deliveries: [] } }))
    await flush()
    expect(document.body.textContent).toContain('1枚中 1枚を1アカウントへ配りました')
  })

  it('アーカイブは確かめてから行い、一覧へ戻る', async () => {
    act(() => { root.render(<HqBannerProjectV8 />) })
    await flush()
    act(() => { buttonNamed('アーカイブ')!.click() })
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
    expect(buttonNamed('アーカイブ')).toBeUndefined()
    expect(host.querySelector('[aria-label="画像を生成"]')).toBeNull()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.querySelector('[aria-label="お気に入りにする"]')).toBeNull()
    act(() => { (host.querySelector('[aria-label="画像 1 を開く"]') as HTMLButtonElement).click() })
    await flush()
    expect(document.body.textContent).toContain('画像の詳細')
    expect(buttonNamed('一覧から外す')).toBeUndefined()
    expect(buttonNamed('同じ設定でもう一度生成')).toBeUndefined()
  })

  it('WEB205：作り始める要求が返るまでは、生成するをもう一度押せない', async () => {
    createGeneration.mockImplementation(() => new Promise(() => undefined))
    await act(async () => { root.render(<HqBannerProjectV8 />) })
    await flush()
    const line = document.querySelector('input[aria-label="テキスト 1行目"], textarea[aria-label="テキスト 1行目"]') as HTMLInputElement
    expect(line).toBeTruthy()
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(line), 'value')!.set!.call(line, '秋の新商品')
      line.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const start = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('生成する（')) as HTMLButtonElement
    await act(async () => { start.click() })
    await act(async () => { start.click() })
    expect(createGeneration).toHaveBeenCalledTimes(1)
    expect(start.disabled).toBe(true)
  })
})
