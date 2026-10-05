// @vitest-environment happy-dom
/*
 * 参照画像を選ぶ（承認済み ★BG-C `cOgWE`、旧 ★V8 `UcBQ5`）。
 * - 外枠に cOgWE を付ける
 * - 並ぶ画像に名前と寸法を添える
 * - 複数選べる（選んだ順に「1枚目」）。選んだ画像は `JOi8G` で 1 枚ずつ使い方を決める
 *   （使い方は `B3hdL4`「ルール3択」のとおり行の中の 3 つのラジオから直接選ぶ）
 * - 「この N 枚を使う」で、使い方つきの参照と画像の実体を返す
 * 絞り方・取り込みの動きは変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import ReferencePickerDialog from './reference-picker-dialog'
import type { BannerImage, BannerProject, BannerReference } from '@/lib/hq-banners'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))

const PROJECTS: BannerProject[] = [
  { id: 'pj-a', name: '春のキャンペーン', description: null, isFavorite: false, archivedAt: null, imageCount: 1, runningCount: 0, createdBy: null, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' },
]

function image(): BannerImage {
  return {
    id: 'img-1', projectId: 'pj-a', generationId: null, sequence: 1,
    source: 'upload', parentImageId: null, isFavorite: false,
    createdBy: null, createdAt: '2026-09-21T12:00:00+09:00',
    media: { id: 'media-1', filename: 'haru.png', mimeType: 'image/png', sizeBytes: 100, width: 100, height: 100, url: 'https://example.test/img-1.png' },
    generation: null, deliveredAccountIds: [],
  }
}

const picked: { references: BannerReference[]; images: BannerImage[] }[] = []

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/hq/banners/images')) {
      return new Response(JSON.stringify({ success: true, data: [image()] }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
const originalFetch = globalThis.fetch

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  picked.length = 0
  stubFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
})

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

describe('参照画像を選ぶ（★BG-C `cOgWE`）', () => {
  it('名前と寸法・選んだ枚数・1 枚ずつの使い方つきで渡す', async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          projectId="pj-a"
          presets={[]}
          projects={PROJECTS}
          selected={[]}
          onClose={() => undefined}
          onPick={(references, images) => { picked.push({ references, images }) }}
          onUpload={() => undefined}
        />,
      )
    })
    await flush()
    expect(document.querySelector('[data-design-node="cOgWE"]')).toBeTruthy()
    // 複数選べることを支援技術にも伝える
    expect(document.querySelector('[data-design-node="exeSo"]')?.getAttribute('aria-multiselectable')).toBe('true')
    // 名称と寸法を添える（引継ぎの指摘）
    expect(screen.getByText('haru')).toBeTruthy()
    expect(screen.getByText('100×100')).toBeTruthy()
    // 選ぶ前は使い方の行を出さない（そもそも描かない）
    expect(document.querySelector('[data-design-node="JOi8G"]')).toBeNull()
    const use = screen.getByRole('button', { name: 'この画像を使う' }) as HTMLButtonElement
    expect(use.disabled).toBe(true)

    fireEvent.click(screen.getByRole('option', { name: /haru/ }))
    // 選んだ順が分かる
    expect(await screen.findByText('1枚目')).toBeTruthy()
    expect(document.querySelector('[data-design-node="JOi8G"]')).toBeTruthy()
    // 既定は「雰囲気を参考にする」。3 択を行に並べて直接選ぶ（★BG-C `B3hdL4`）
    expect(screen.getByRole('group', { name: 'haruの使い方' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: '雰囲気を参考にする' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: '土台にする' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('radio', { name: '素材を一部使う' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'この 1 枚を使う' }))
    expect(picked).toHaveLength(1)
    expect(picked[0].references).toEqual([{ imageId: 'img-1', mode: 'inspire' }])
    expect(picked[0].images.map((entry) => entry.id)).toEqual(['img-1'])

    // 使い方は 1 枚ずつ変えられる
    fireEvent.click(screen.getByRole('radio', { name: '土台にする' }))
    await flush(2)
    expect((screen.getByRole('radio', { name: '土台にする' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'この 1 枚を使う' }))
    expect(picked[1].references).toEqual([{ imageId: 'img-1', mode: 'edit' }])

    // 外すと使い方の行ごと消え、確定できなくなる
    fireEvent.click(screen.getByRole('button', { name: 'haruを外す' }))
    expect(document.querySelector('[data-design-node="JOi8G"]')).toBeNull()
    expect((screen.getByRole('button', { name: 'この画像を使う' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
