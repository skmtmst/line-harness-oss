import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { ScenarioReferenceCache, scenarioReferenceData } from './scenario-reference-data'

describe('シナリオ編集の参照データ共有', () => {
  it('同じキーは期限内に1回だけ取得する', async () => {
    let now = 1_000
    const cache = new ScenarioReferenceCache(500, () => now)
    const loader = vi.fn(async () => ['tag-1'])

    await expect(cache.load('tags:account-1', loader)).resolves.toEqual(['tag-1'])
    await expect(cache.load('tags:account-1', loader)).resolves.toEqual(['tag-1'])
    expect(loader).toHaveBeenCalledTimes(1)

    now += 501
    await cache.load('tags:account-1', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('失敗した取得は残さず次回に再試行する', async () => {
    const cache = new ScenarioReferenceCache()
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(['tag-1'])

    await expect(cache.load('tags:account-1', loader)).rejects.toThrow('temporary')
    await expect(cache.load('tags:account-1', loader)).resolves.toEqual(['tag-1'])
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('保存後に対象キーを消すと次の画面では最新値を取り直す', async () => {
    const cache = new ScenarioReferenceCache()
    const loader = vi.fn()
      .mockResolvedValueOnce({ name: '保存前' })
      .mockResolvedValueOnce({ name: '保存後' })

    await expect(cache.load('scenario:s-1', loader)).resolves.toEqual({ name: '保存前' })
    cache.delete('scenario:s-1')
    await expect(cache.load('scenario:s-1', loader)).resolves.toEqual({ name: '保存後' })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})

describe('任意機能オフ時の参照一覧(#861/#862)', () => {
  it('機能オフ(403 FEATURE_DISABLED)は「候補なし」として解決し、窓全体を落とさない', async () => {
    const spy = vi.spyOn(api.friendFields, 'list')
      .mockRejectedValueOnce(new ApiError(403, 'disabled', 'FEATURE_DISABLED'))
    const res = await scenarioReferenceData.friendFields('acc-feature-off')
    expect(res.success).toBe(false)
    // 共通ゲートへ画面を切り替えないよう、抑制印を付けて呼んでいる。
    expect(spy).toHaveBeenCalledWith('acc-feature-off', undefined, { suppressFeatureDisabledEvent: true })
    spy.mockRestore()
  })

  it('共通情報も同じく、機能オフは「候補なし」として解決する', async () => {
    const spy = vi.spyOn(api.commonVars, 'list')
      .mockRejectedValueOnce(new ApiError(403, 'disabled', 'FEATURE_DISABLED'))
    const res = await scenarioReferenceData.commonVars('acc-common-vars-off')
    expect(res.success).toBe(false)
    expect(spy).toHaveBeenCalledWith('acc-common-vars-off', undefined, { suppressFeatureDisabledEvent: true })
    spy.mockRestore()
  })

  it('機能オフ以外の失敗は投げ直す（空だと誤認させない・キャッシュに残さない）', async () => {
    const spy = vi.spyOn(api.supportMarks, 'list')
      .mockRejectedValueOnce(new ApiError(500, 'down'))
    await expect(scenarioReferenceData.supportMarks('acc-server-down')).rejects.toMatchObject({ status: 500 })
    spy.mockRestore()
  })
})

describe('R23横展開 タグ・テンプレート候補は今のアカウントだけ', () => {
  it('タグの取得に選んでいるアカウントを渡す', async () => {
    const spy = vi.spyOn(api.tags, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    await scenarioReferenceData.tags('r23-acc-a')
    expect(spy).toHaveBeenCalledWith({ accountId: 'r23-acc-a' })
    spy.mockRestore()
  })

  it('アカウントが違えば取り直す（混ぜない）', async () => {
    const spy = vi.spyOn(api.tags, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    await scenarioReferenceData.tags('r23-acc-c')
    await scenarioReferenceData.tags('r23-acc-d')
    expect(spy).toHaveBeenCalledWith({ accountId: 'r23-acc-c' })
    expect(spy).toHaveBeenCalledWith({ accountId: 'r23-acc-d' })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('テンプレートの取得に選んでいるアカウントを渡す', async () => {
    const spy = vi.spyOn(api.templates, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    await scenarioReferenceData.templates('r23-acc-e')
    expect(spy).toHaveBeenCalledWith(undefined, 'r23-acc-e')
    spy.mockRestore()
  })

  it('未指定は従来どおり全体を取る', async () => {
    const tagsSpy = vi.spyOn(api.tags, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    const tplSpy = vi.spyOn(api.templates, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    await scenarioReferenceData.tags()
    await scenarioReferenceData.templates()
    expect(tagsSpy).toHaveBeenCalledWith(undefined)
    expect(tplSpy).toHaveBeenCalledWith(undefined, undefined)
    tagsSpy.mockRestore()
    tplSpy.mockRestore()
  })
})
