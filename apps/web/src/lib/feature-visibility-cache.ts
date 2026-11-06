import { api } from './api'
import { invalidateApiReads } from './api/transport/read-cache'
import { FEATURE_SETTINGS_UPDATED_EVENT } from './feature-settings-event'

/** 既存の利用口。認証・店舗・保存後の失効は共通 GET と共有する。 */
export function loadFeatureVisibility(accountId: string) {
  return api.featureSettings.visibility(accountId)
}

export function clearFeatureVisibilityCache(accountId?: string): void {
  invalidateApiReads('/api/settings/features/visibility', accountId)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, (event) => {
    const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
    clearFeatureVisibilityCache(accountId || undefined)
  })
}
