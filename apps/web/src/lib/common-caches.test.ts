// @vitest-environment happy-dom
/*
 * ログアウト・セッション切れのあとは、使い回していた共通の答えを捨てる。
 * 古い権限や別アカウントの一覧・名簿・設定を見せない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  visibility: vi.fn(),
  accountsList: vi.fn(),
  operatorsList: vi.fn(),
}))
vi.mock('./api', () => ({
  api: {
    featureSettings: { get: mocks.settingsGet, visibility: mocks.visibility },
    lineAccounts: { list: mocks.accountsList },
    operators: { list: mocks.operatorsList },
  },
}))

import { clearCommonCaches } from './common-caches'
import { loadFeatureSettings } from './feature-settings-cache'
import { loadFeatureVisibility } from './feature-visibility-cache'
import { loadLineAccounts } from './line-accounts-cache'
import { loadOperators } from './operators-cache'

describe('共通の使い回しの破棄', () => {
  beforeEach(() => {
    clearCommonCaches()
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
      mock.mockResolvedValue({ success: true, data: { features: {} } })
    }
    mocks.accountsList.mockResolvedValue({ success: true, data: [] })
    mocks.operatorsList.mockResolvedValue({ success: true, data: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('捨てる前はどれも取り直さない', async () => {
    await loadFeatureSettings('acc-1')
    await loadFeatureVisibility('acc-1')
    await loadLineAccounts()
    await loadOperators()
    await loadFeatureSettings('acc-1')
    await loadFeatureVisibility('acc-1')
    await loadLineAccounts()
    await loadOperators()
    expect(mocks.settingsGet).toHaveBeenCalledTimes(1)
    expect(mocks.visibility).toHaveBeenCalledTimes(1)
    expect(mocks.accountsList).toHaveBeenCalledTimes(1)
    expect(mocks.operatorsList).toHaveBeenCalledTimes(1)
  })

  it('捨てたあとはどれも取り直す', async () => {
    await loadFeatureSettings('acc-1')
    await loadFeatureVisibility('acc-1')
    await loadLineAccounts()
    await loadOperators()
    clearCommonCaches()
    await loadFeatureSettings('acc-1')
    await loadFeatureVisibility('acc-1')
    await loadLineAccounts()
    await loadOperators()
    expect(mocks.settingsGet).toHaveBeenCalledTimes(2)
    expect(mocks.visibility).toHaveBeenCalledTimes(2)
    expect(mocks.accountsList).toHaveBeenCalledTimes(2)
    expect(mocks.operatorsList).toHaveBeenCalledTimes(2)
  })
})
