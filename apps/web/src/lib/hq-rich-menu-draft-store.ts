'use client'

const DB_NAME = 'lh-hq-rich-menu-drafts'
const STORE = 'drafts'
const queues = new Map<string, Promise<unknown>>()

function marker(scope: string) { return `lh_hq_menu_draft_tab:${scope}` }
function token(scope: string): string {
  const key = marker(scope)
  let value = sessionStorage.getItem(key)
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(key, value) }
  return `${scope}:${value}`
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onblocked = () => reject(new Error('下書きの保存先を開けません'))
  })
}
async function operation<T>(key: string, method: 'get' | 'put' | 'delete', value?: unknown): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, method === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore(STORE)
      const request = method === 'get' ? store.get(key) : method === 'put' ? store.put(value, key) : store.delete(key)
      let result: T
      request.onsuccess = () => { result = request.result as T }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('下書きの保存が中断されました'))
    })
  } finally { db.close() }
}
function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(fn)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => undefined)
  return next
}
export async function readHqRichMenuDraft(scope: string): Promise<unknown> {
  const key = token(scope)
  return enqueue(key, () => operation(key, 'get'))
}
export async function writeHqRichMenuDraft(scope: string, value: unknown): Promise<void> {
  const current = sessionStorage.getItem(marker(scope))
  if (!current) return
  const key = `${scope}:${current}`
  await enqueue(key, async () => { if (`${scope}:${sessionStorage.getItem(marker(scope))}` === key) await operation(key, 'put', value) })
}
export async function clearHqRichMenuDraft(scope: string): Promise<void> {
  const current = sessionStorage.getItem(marker(scope))
  if (!current) return
  sessionStorage.removeItem(marker(scope))
  const key = `${scope}:${current}`
  await enqueue(key, () => operation(key, 'delete'))
}
