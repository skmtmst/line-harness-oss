// @vitest-environment happy-dom
/*
 * 画像の取り込み V8（板 AnwtH）。
 * - 外枠に AnwtH を付ける
 * - ファイルを選んでから「取り込む」を押せる（選ぶまでは押せない）
 * - 置く（ドラッグ＆ドロップ）でも選べる
 * 形式・大きさの決まりと送り先は変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import UploadTargetDialog from './upload-target-dialog'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})


const PROJECTS = [
  { id: 'pj-a', name: '秋のキャンペーン', description: null, isFavorite: false, archivedAt: null, imageCount: 0, runningCount: 0, createdBy: null, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' },
]

const uploaded: { projectId: string; filename: string }[] = []

function stubFetch() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input)
    if (url.includes('/api/hq/banners/projects') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ success: true, data: PROJECTS }), { status: 200 })
    }
    if (url.includes('/uploads') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { filename: string }
      uploaded.push({ projectId: 'pj-a', filename: body.filename })
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
const originalFetch = globalThis.fetch
const originalFileReader = globalThis.FileReader

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  uploaded.length = 0
  stubFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  globalThis.FileReader = originalFileReader
})

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

function fileInput(): HTMLInputElement {
  const input = document.body.querySelector('input[type="file"]')
  expect(input).toBeTruthy()
  return input as HTMLInputElement
}

describe('画像の取り込み V8（AnwtH）', () => {
  it('選んでから取り込むを押せる', async () => {
    const onPick = vi.fn()
    await act(async () => {
      root.render(<UploadTargetDialog open onClose={() => undefined} onPick={onPick} />)
    })
    await flush()
    expect(document.querySelector('[data-design-node="AnwtH"]')).toBeTruthy()
    const takeIn = screen.getByRole('button', { name: '取り込む' }) as HTMLButtonElement
    // ファイル選択後だけ取り込みを有効にする
    expect(takeIn.disabled).toBe(true)
    const file = new File(['x'], 'torikomi.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [file] } })
    })
    expect(await screen.findByText('torikomi.png')).toBeTruthy()
    expect(takeIn.disabled).toBe(false)
    fireEvent.click(takeIn)
    await flush(12)
    expect(uploaded).toHaveLength(1)
    expect(uploaded[0].filename).toBe('torikomi.png')
    expect(onPick).toHaveBeenCalledWith('pj-a')
  })

  it('形式違いは窓に理由を出す', async () => {
    await act(async () => {
      root.render(<UploadTargetDialog open onClose={() => undefined} onPick={() => undefined} />)
    })
    await flush()
    const file = new File(['x'], 'memo.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [file] } })
    })
    expect(await screen.findByText('画像は PNG・JPEG・WebP のみ取り込めます')).toBeTruthy()
    expect((screen.getByRole('button', { name: '取り込む' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
