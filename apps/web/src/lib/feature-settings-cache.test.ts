// @vitest-environment happy-dom
/*
 * 画面を移るたびに取り直していた /api/settings/features を、タブ内で使い回す。
 * サイドバー（統括・管理者の並び順）と機能設定画面と導入ガイドのカードが、
 * 同じアカウントの同じ答えを共有する。保存の合図で捨てる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ api: { featureSettings: { get } } }))

import { clearFeatureSettingsCache, loadFeatureSettings } from './feature-settings-cache'
import { FEATURE_SETTINGS_UPDATED_EVENT } from './feature-settings-event'

const ok = {
  success: true as const,
  data: {
    features: { broadcasts: true },
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    specializedFeatureKeys: [],
    version: 3,
  },
}

describe('機能設定全体の共有', () => {
  beforeEach(() => {
    clearFeatureSettingsCache()
    get.mockReset()
    get.mockResolvedValue(ok)
  })
  afterEach(() => vi.restoreAllMocks())

  it('同時に来た要求は1本にまとめ、同じ答えを返す', async () => {
    const [a, b] = await Promise.all([loadFeatureSettings('acc-1'), loadFeatureSettings('acc-1')])
    expect(get).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('アカウントが違えば別に取る', async () => {
    await loadFeatureSettings('acc-1')
    await loadFeatureSettings('acc-2')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('30秒のあいだは取り直さない（2回目の画面移動で呼ばない）', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await loadFeatureSettings('acc-1')
    now += 29_000
    await loadFeatureSettings('acc-1')
    expect(get).toHaveBeenCalledTimes(1)
    now += 2_000
    await loadFeatureSettings('acc-1')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('失敗は覚えず、次は取り直す', async () => {
    get.mockResolvedValueOnce({ success: false, error: 'x' })
    await loadFeatureSettings('acc-1')
    await loadFeatureSettings('acc-1')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('保存した合図で、そのアカウントの答えを捨てる', async () => {
    await loadFeatureSettings('acc-1')
    await loadFeatureSettings('acc-2')
    window.dispatchEvent(new CustomEvent(FEATURE_SETTINGS_UPDATED_EVENT, { detail: { accountId: 'acc-1' } }))
    await loadFeatureSettings('acc-1')
    await loadFeatureSettings('acc-2')
    expect(get.mock.calls.map(([id]) => id)).toEqual(['acc-1', 'acc-2', 'acc-1'])
  })

  it('アカウント切替で捨てたら、次は取り直す', async () => {
    await loadFeatureSettings('acc-1')
    clearFeatureSettingsCache('acc-1')
    await loadFeatureSettings('acc-1')
    expect(get).toHaveBeenCalledTimes(2)
  })
})
