import { api } from '@/lib/api'

type CacheEntry = {
  expiresAt: number
  promise: Promise<unknown>
}

/**
 * シナリオ編集で何度も開く窓が、同じ選択肢一覧を毎回取り直さないためのキャッシュ。
 * 失敗した応答は残さず、次に窓を開いたとき再試行できるようにする。
 */
export class ScenarioReferenceCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.promise as Promise<T>

    const promise = loader().catch((error) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key)
      throw error
    })
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, promise })
    return promise
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

const cache = new ScenarioReferenceCache()
const scopeKey = (accountId?: string | null) => accountId || 'visible'

export const scenarioReferenceData = {
  scenario: (id: string, fresh = false) => {
    const key = `scenario:${id}`
    if (fresh) cache.delete(key)
    return cache.load(key, () => api.scenarios.get(id))
  },
  stats: (id: string, fresh = false) => {
    const key = `scenario-stats:${id}`
    if (fresh) cache.delete(key)
    return cache.load(key, () => api.scenarios.stats(id))
  },
  invalidateScenario: (id: string) => {
    cache.delete(`scenario:${id}`)
    cache.delete(`scenario-stats:${id}`)
  },
  tags: (_accountId?: string | null) => cache.load('tags:visible', () => api.tags.list()),
  // #645 差し戻し: 渡されたアカウントを口へ必ず渡す(渡されなければ従来どおり全部)。
  templates: (accountId?: string | null) =>
    cache.load(`templates:${scopeKey(accountId)}`, () =>
      api.templates.list(undefined, accountId || undefined)),
  friendFields: (accountId: string) =>
    cache.load(`friend-fields:${accountId}`, () => api.friendFields.list(accountId)),
  supportMarks: (accountId: string) =>
    cache.load(`support-marks:${accountId}`, () => api.supportMarks.list(accountId)),
  scenarios: (accountId?: string | null) =>
    cache.load(`scenarios:${scopeKey(accountId)}`, () =>
      api.scenarios.list({ ...(accountId ? { accountId } : {}), limit: 200 })),
  commonVars: (accountId: string) =>
    cache.load(`common-vars:${accountId}`, () => api.commonVars.list(accountId)),
}
