// @vitest-environment happy-dom
/*
 * R606: 参照画像が3枚ある状態で一致しない語を検索すると、
 * 画像未登録時と同じ「選べる画像がありません」と誤案内する。
 *
 * 本物の React で本物の `ReferencePickerDialog` を mount し、差し替えるのは通信だけ。
 * 全画像0件と検索一致0件を区別し、検索条件の解除を案内するのを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import ReferencePickerDialog from './reference-picker-dialog'
import type { BannerImage, BannerProject } from '@/lib/hq-banners'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const PROJECTS: BannerProject[] = [
  {
    id: 'pj-a', name: '春のキャンペーン', description: null,
    isFavorite: false, archivedAt: null, imageCount: 3, runningCount: 0,
    createdBy: null, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
  },
]

function image(id: string, filename: string): BannerImage {
  return {
    id, projectId: 'pj-a', generationId: null, sequence: 1,
    source: 'upload', parentImageId: null, isFavorite: false,
    createdBy: null, createdAt: '2026-09-21T12:00:00+09:00',
    media: {
      id: `media-${id}`, filename, mimeType: 'image/png',
      sizeBytes: 100, width: 100, height: 100, url: `https://example.test/${id}.png`,
    },
    generation: null, deliveredAccountIds: [],
  }
}

const store = vi.hoisted(() => ({
  images: [image('img-1', 'haru.png'), image('img-2', 'natsu.png'), image('img-3', 'aki.png')] as BannerImage[],
}))

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/hq/banners/images')) {
      return new Response(JSON.stringify({ success: true, data: store.images }), { status: 200 })
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
  store.images = [image('img-1', 'haru.png'), image('img-2', 'natsu.png'), image('img-3', 'aki.png')]
  stubFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

function open() {
  root.render(
    <ReferencePickerDialog
      open
      projectId="pj-a"
      presets={[]}
      projects={PROJECTS}
      selected={[]}
      onClose={() => undefined}
      onPick={() => undefined}
      onUpload={() => undefined}
    />,
  )
}

function searchFor(word: string) {
  const input = document.body.querySelector('input[aria-label="参照画像を検索"]')
  expect(input).toBeTruthy()
  fireEvent.change(input!, { target: { value: word } })
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

/** 選べる画像タイルの数（ファイル名は画面に出ないため数で見る）。 */
function optionCount(): number {
  return document.body.querySelectorAll('[role="option"]').length
}

describe('R606 参照画像の検索0件と未登録0件の区別（本物のReact）', () => {
  it('3枚ある状態で一致しない語を検索すると未登録の案内を出さず条件解除を案内する', async () => {
    await act(async () => { open() })
    await flush()
    expect(optionCount()).toBe(3)

    await act(async () => { searchFor('存在しない監査語') })
    await flush()

    const text = bodyText()
    // 未登録時と同じ説明は出さない（既存画像が消えたと誤読される）。
    expect(text).not.toContain('選べる画像がありません')
    // 検索条件の不一致と、条件を外す口を案内する。
    expect(text).toContain('条件に合うものがありません')
    expect(screen.getByRole('button', { name: '条件を外す' })).toBeTruthy()
  })

  it('画像が1枚も無いときは未登録の案内のままにする', async () => {
    store.images = []
    await act(async () => { open() })
    await flush()

    const text = bodyText()
    expect(text).toContain('選べる画像がありません')
    expect(text).not.toContain('条件に合うものがありません')
  })

  it('「条件を外す」で検索が消え3枚に戻る', async () => {
    await act(async () => { open() })
    await flush()
    await act(async () => { searchFor('存在しない監査語') })
    await flush()
    expect(bodyText()).toContain('条件に合うものがありません')

    await act(async () => { screen.getByRole('button', { name: '条件を外す' }).click() })
    await flush()

    expect(optionCount()).toBe(3)
    expect(bodyText()).toContain('haru')
  })
})
