// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { BannerImage } from '@/lib/hq-banners'
import LibrarySection from './library-section'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

type ImagePage = Awaited<ReturnType<typeof api.hqBanners.images.list>>

function image(id: string): BannerImage {
  return {
    id, projectId: 'project', generationId: null, sequence: 1,
    source: 'upload', parentImageId: null, isFavorite: false,
    createdBy: null, createdAt: '2026-10-04T12:00:00+09:00',
    media: {
      id: `media-${id}`, filename: `${id}.png`, mimeType: 'image/png',
      sizeBytes: 100, width: 100, height: 100, url: `https://example.test/${id}.png`,
    },
    generation: null, deliveredAccountIds: [],
  }
}

function page(ids: string[], nextBefore: string | null = null): ImagePage {
  return { success: true, data: ids.map(image), nextBefore }
}

let previousTheme: string | undefined

beforeEach(() => {
  previousTheme = document.documentElement.dataset.theme
  document.documentElement.dataset.theme = 'v8'
  vi.spyOn(api.hqBanners.projects, 'list').mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (previousTheme === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = previousTheme
})

async function open() {
  const view = render(<LibrarySection presets={[]} accounts={[]} onChanged={() => undefined} />)
  await screen.findByText('1枚を表示中・続きがあります')
  return view
}

async function chooseSize(size: number) {
  fireEvent.click(screen.getByRole('button', { name: '画像の取得件数' }))
  fireEvent.click(screen.getByRole('button', { name: `${size}枚`, exact: true }))
  await waitFor(() => expect(document.querySelector('[data-list-state="loading"]')).toBeNull())
}

describe('画像ライブラリの取得枚数と続きの読み込み', () => {
  it('V8は10枚で読み込み、取得条件の説明を押して確認できる', async () => {
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['first'], 'cursor-10'))
    await open()
    expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: 10, withCounts: true })
    expect(screen.getByRole('button', { name: 'さらに10枚を表示' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '画像の取得件数の説明' }))
    expect(screen.getByText(/一度に読み込む画像の枚数です/)).toBeTruthy()
  })

  it.each([20, 50])('取得枚数を%d枚へ変えると一覧と次の読み込み位置を更新する', async (size) => {
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['old'], 'old-cursor'))
    const view = await open()
    list.mockResolvedValue(page(['new'], 'new-cursor'))
    await chooseSize(size)
    await screen.findByRole('button', { name: `さらに${size}枚を表示` })
    expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: size, withCounts: true })
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/new.png')

    list.mockResolvedValue(page(['next']))
    fireEvent.click(screen.getByRole('button', { name: `さらに${size}枚を表示` }))
    await screen.findByText('2枚を表示中')
    expect(list).toHaveBeenLastCalledWith({ favorite: false, before: 'new-cursor', limit: size, withCounts: true })
  })

  it('続きを追加すると重複画像を除き、最後まで読んだら追加ボタンを閉じる', async () => {
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['first'], 'cursor'))
    const view = await open()
    list.mockResolvedValue(page(['first', 'second']))
    fireEvent.click(screen.getByRole('button', { name: 'さらに10枚を表示' }))
    await screen.findByText('2枚を表示中')
    expect(view.container.querySelectorAll('img')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /さらに.*枚を表示/ })).toBeNull()
  })

  it('続きを待っている間に枚数を変えても、遅れて届いた古い画像を混ぜない', async () => {
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['old'], 'old-cursor'))
    const view = await open()
    let finishOld!: (response: ImagePage) => void
    list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'さらに10枚を表示' }))
    list.mockResolvedValue(page(['new']))
    await chooseSize(20)
    await screen.findByText('1枚を表示中')
    await act(async () => { finishOld(page(['late'], 'late-cursor')) })
    expect(view.container.querySelectorAll('img')).toHaveLength(1)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/new.png')
    expect(screen.queryByRole('button', { name: /さらに.*枚を表示/ })).toBeNull()
  })

  it('枚数の変更後に取得が失敗しても、選んだ枚数で再読み込みできる', async () => {
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['first'], 'cursor'))
    await open()
    list.mockRejectedValue(new Error('通信失敗'))
    await chooseSize(20)
    await screen.findByText('一覧を読み込めませんでした')
    list.mockResolvedValue(page(['retried']))
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await screen.findByText('1枚を表示中')
    expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: 20, withCounts: true })
  })

  it('v7の取得は30枚のままで、取得枚数の選択欄を出さない', async () => {
    document.documentElement.dataset.theme = 'v7'
    const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['first'], 'cursor'))
    await open()
    expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: 30 })
    expect(screen.getByRole('button', { name: 'さらに30枚を表示' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '画像の取得件数' })).toBeNull()
  })
})

it('検索・渡し済み条件をAPIへ送り、続きにも同じ条件を送る', async () => {
  const list = vi.spyOn(api.hqBanners.images, 'list').mockResolvedValue(page(['first'], 'cursor'))
  await open()
  fireEvent.change(screen.getByRole('searchbox', { name: 'テキスト・指示・プロジェクト名で検索' }), { target: { value: '全件の検索' } })
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: 10, q: '全件の検索', withCounts: true }))
  fireEvent.click(screen.getByRole('button', { name: 'アカウントへ渡し済み' }))
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ favorite: false, limit: 10, q: '全件の検索', delivered: true, withCounts: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'さらに10枚を表示' }))
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ favorite: false, before: 'cursor', limit: 10, q: '全件の検索', delivered: true, withCounts: true }))
})
