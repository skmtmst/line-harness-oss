// @vitest-environment happy-dom
/*
 * 参照画像の選択 V8（板 UcBQ5）。
 * - 外枠に UcBQ5 を付ける
 * - 並ぶ画像に名前と寸法を添える
 * - 選んだ画像に「選んだ」を付け、「この画像を使う」で使い方ごと渡す
 * 絞り方・取り込み・選ぶ動きは変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import ReferencePickerDialog from './reference-picker-dialog'
import type { BannerImage, BannerProject, BannerReferenceMode } from '@/lib/hq-banners'

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

const picked: { image: BannerImage; usage: BannerReferenceMode }[] = []

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

describe('参照画像の選択 V8（UcBQ5）', () => {
  it('名前と寸法・選んだ・使い方ごと渡す', async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          projectId="pj-a"
          presets={[]}
          projects={PROJECTS}
          selectedId={null}
          initialUsage="edit"
          onClose={() => undefined}
          onPick={(img, usage) => { picked.push({ image: img, usage }) }}
          onUpload={() => undefined}
        />,
      )
    })
    await flush()
    expect(document.querySelector('[data-design-node="UcBQ5"]')).toBeTruthy()
    // 名称と寸法を添える（引継ぎの指摘）
    expect(screen.getByText('haru')).toBeTruthy()
    expect(screen.getByText('100×100')).toBeTruthy()
    // 親の使い方（土台に描き直す）を開いたときの値に戻す
    expect((screen.getByRole('radio', { name: '土台に描き直す' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('option', { name: /haru/ }))
    expect(await screen.findByText('選んだ')).toBeTruthy()
    const use = screen.getByRole('button', { name: 'この画像を使う' }) as HTMLButtonElement
    expect(use.disabled).toBe(false)
    fireEvent.click(use)
    expect(picked).toHaveLength(1)
    expect(picked[0].usage).toBe('edit')
    // 使い方を変えて渡せる
    fireEvent.click(screen.getByRole('radio', { name: '雰囲気を参考にする' }))
    fireEvent.click(screen.getByRole('button', { name: 'この画像を使う' }))
    expect(picked[1].usage).toBe('inspire')
  })
})
