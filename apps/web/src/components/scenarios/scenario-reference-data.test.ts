import { describe, expect, it, vi } from 'vitest'
import { ScenarioReferenceCache } from './scenario-reference-data'

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
