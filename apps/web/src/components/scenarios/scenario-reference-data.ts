import { api, ApiError } from '@/lib/api'

/*
  任意機能（友だち情報・対応マーク・共通情報）の参照一覧。
  そのaccountで機能がオフならAPIは403を返す。差し込み口は補助なので
  「空」と同じ扱いにする。機能オフ以外の失敗はキャッシュへ残さず投げ直す。
*/
const FEATURE_DISABLED_RESULT = { success: false as const, error: 'feature_disabled' }
const emptyWhenFeatureDisabled = (error: unknown): { success: false; error: string } => {
  if (error instanceof ApiError && error.code === 'FEATURE_DISABLED') return FEATURE_DISABLED_RESULT
  throw error
}

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
  templates: (_accountId?: string | null) =>
    cache.load('templates:visible', () => api.templates.list()),
  friendFields: (accountId: string) =>
    cache.load(`friend-fields:${accountId}`, () =>
      api.friendFields.list(accountId, undefined, { suppressFeatureDisabledEvent: true }).catch(emptyWhenFeatureDisabled)),
  supportMarks: (accountId: string) =>
    cache.load(`support-marks:${accountId}`, () =>
      api.supportMarks.list(accountId, { suppressFeatureDisabledEvent: true }).catch(emptyWhenFeatureDisabled)),
  scenarios: (accountId?: string | null) =>
    cache.load(`scenarios:${scopeKey(accountId)}`, () =>
      api.scenarios.list({ ...(accountId ? { accountId } : {}), limit: 200 })),
  commonVars: (accountId: string) =>
    cache.load(`common-vars:${accountId}`, () =>
      api.commonVars.list(accountId, undefined, { suppressFeatureDisabledEvent: true }).catch(emptyWhenFeatureDisabled)),
}
