// @vitest-environment happy-dom
/*
 * 更新告知と画面撮影。
 *
 * 撮影器（scripts/visual-qa/capture-screens.mjs の initializeCapture）は
 * セッションに一時印を付ける。印がある間だけ、更新告知の取得を始めない
 * （運用環境向けの告知が撮った絵に混ざらないように）。印が無い普段の
 * 利用では、これまでどおり版を読みに行く。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeCapture } from '../../../../../scripts/visual-qa/capture-screens.mjs'

const client = vi.hoisted(() => ({ getCurrentVersion: vi.fn() }))
vi.mock('@/lib/update-client', () => ({
  getCurrentVersion: client.getCurrentVersion,
  getManifest: vi.fn(async () => ({ releases: [] })),
  detectFork: vi.fn(() => ({ kind: 'ok' })),
  findLatestUpgrade: vi.fn(() => null),
}))

import { useUpdateStatus } from './use-update-status'

beforeEach(() => {
  client.getCurrentVersion.mockReset().mockResolvedValue({ version: '0.0.0-dev' })
  window.sessionStorage.clear()
})

afterEach(() => {
  window.sessionStorage.clear()
})

async function mountHook() {
  const view = renderHook(() => useUpdateStatus())
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve() })
  return view
}

describe('更新告知と画面撮影', () => {
  it('撮影器が付けた一時印がある間は、更新告知の取得を始めない', async () => {
    initializeCapture([[]])
    expect(window.sessionStorage.getItem('lh_visual_qa_capture')).toBe('1')

    const view = await mountHook()
    expect(client.getCurrentVersion).not.toHaveBeenCalled()
    expect(view.result.current).toEqual({ kind: 'loading' })
  })

  it('一時印が無い普段の利用では、版を読みに行く', async () => {
    await mountHook()
    expect(client.getCurrentVersion).toHaveBeenCalledTimes(1)
  })
})
