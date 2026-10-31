/** このタブで自動作成したフォームだけを、店・ID・最後に確認した版で識別する。 */
const fallback = new Map<string, number>()
const creationFallback = new Map<string, string>()
const keyFor = (accountId: string, id: string) => `musubo:created-form:${encodeURIComponent(accountId)}:${encodeURIComponent(id)}`
const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function readCreatedFormDraft(accountId: string, id: string): number | null {
  const key = keyFor(accountId, id)
  try {
    const raw = window.sessionStorage.getItem(key)
    const revision: unknown = raw === null ? null : JSON.parse(raw)
    return validRevision(revision) ? revision : null
  } catch { return fallback.get(key) ?? null }
}
export function rememberCreatedFormDraft(accountId: string, id: string, revision: unknown): void {
  if (!accountId || !id || !validRevision(revision)) return
  const key = keyFor(accountId, id)
  fallback.set(key, revision)
  try { window.sessionStorage.setItem(key, JSON.stringify(revision)) } catch { /* このタブの記録を使う。 */ }
}
export function forgetCreatedFormDraft(accountId: string, id: string): void {
  const key = keyFor(accountId, id)
  fallback.delete(key)
  try { window.sessionStorage.removeItem(key) } catch { /* このタブの記録も解除済み。 */ }
}

const creationKey = (accountId: string, token: string) => `musubo:form-creation:${encodeURIComponent(accountId)}:${encodeURIComponent(token)}`
export function readFormDraftCreation(accountId: string, token: string): string | null {
  const key = creationKey(accountId, token)
  try { return window.sessionStorage.getItem(key) || null } catch { return creationFallback.get(key) ?? null }
}
export function rememberFormDraftCreation(accountId: string, token: string, id: string): void {
  const key = creationKey(accountId, token)
  creationFallback.set(key, id)
  try { window.sessionStorage.setItem(key, id) } catch { /* このタブの記録を使う。 */ }
}
