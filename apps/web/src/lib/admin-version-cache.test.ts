// @vitest-environment happy-dom
/*
 * 画面を開くたびに2回取っていた /admin/version を、タブ内で使い回す。
 * 共通メニューのいちばん上と更新案内の帯が、同じ版番号を共有する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearAdminVersionCache, loadAdminVersion, loadAdminVersionDetail } from './admin-version-cache'

const body = { version: '2.6.4', worker_hash: 'w', admin_hash: 'a', liff_hash: 'l' }

function versionOk() {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('版番号の共有', () => {
  beforeEach(() => {
    clearAdminVersionCache()
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.test')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => versionOk())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('同時に来た要求は1本にまとめ、版番号と照合材料の両方へ同じ答えを返す', async () => {
    const [short, detail] = await Promise.all([loadAdminVersion(), loadAdminVersionDetail()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('/admin/version')
    expect(short).toEqual({ version: '2.6.4' })
    expect(detail).toEqual(body)
  })

  it('5分のあいだは取り直さない（2回目の画面移動で呼ばない）', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadAdminVersion()
    now += 4 * 60_000
    await loadAdminVersionDetail()
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 2 * 60_000
    await loadAdminVersion()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('失敗は覚えず、次は取り直す', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('ng', { status: 500 }))
    await expect(loadAdminVersion()).rejects.toThrow()
    await loadAdminVersion()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
