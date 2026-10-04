// @vitest-environment happy-dom
/*
 * R605: バナープロジェクト一覧の検索0件で件数が「2件中 1〜0件を表示」になる。
 *
 * 本物の React で本物の `ProjectsSection` を mount し、差し替えるのは通信だけ。
 * プロジェクト2件の状態で存在しない語を検索し、件数と空状態が一致する（0件）を見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import ProjectsSection from './projects-section'
import type { BannerProject } from '@/lib/hq-banners'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const PROJECTS: BannerProject[] = [
  {
    id: 'pj-a', name: '春のキャンペーン', description: '3月の訴求',
    isFavorite: false, archivedAt: null, imageCount: 1, runningCount: 0,
    createdBy: null, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
  },
  {
    id: 'pj-b', name: '夏のセール', description: '7月の訴求',
    isFavorite: true, archivedAt: null, imageCount: 0, runningCount: 1,
    createdBy: null, createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z',
  },
]

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/hq/banners/projects')) {
      return new Response(JSON.stringify({ success: true, data: PROJECTS }), { status: 200 })
    }
    if (url.includes('/api/hq/banners/images')) {
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
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
  root.render(<ProjectsSection usage={null} onChanged={() => undefined} />)
}

function searchFor(word: string) {
  const input = container.querySelector('input[aria-label="プロジェクト名・説明で検索"]')
  expect(input).toBeTruthy()
  fireEvent.change(input!, { target: { value: word } })
}

describe('R605 検索0件の件数と空状態（本物のReact）', () => {
  it('2件の状態で一致しない語を検索すると「1〜0件」を出さず0件と空状態が一致する', async () => {
    await act(async () => { open() })
    await flush()
    expect(container.textContent ?? '').toContain('春のキャンペーン')

    await act(async () => { searchFor('存在しない監査語') })
    await flush()

    const text = container.textContent ?? ''
    // 「2件中 1〜0件を表示」のような読めない範囲は出さない。
    expect(text).not.toContain('1〜0件')
    expect(text).not.toContain('〜0件')
    // 件数は0件。
    expect(text).toContain('0件')
    // 空状態は絞り込みの結果が0件の文言で、作る口は出さない。
    expect(text).toContain('条件に合うものがありません')
    expect(text).not.toContain('最初のプロジェクトを作る')
  })

  it('「条件を外す」で検索が消え2件に戻る', async () => {
    await act(async () => { open() })
    await flush()
    await act(async () => { searchFor('存在しない監査語') })
    await flush()
    expect(container.textContent ?? '').toContain('条件に合うものがありません')

    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === '条件を外す')
    expect(clear).toBeTruthy()
    await act(async () => { clear?.click() })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('春のキャンペーン')
    expect(text).toContain('夏のセール')
    expect(text).toContain('2件中 1〜2件を表示')
  })
})
