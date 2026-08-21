import { fetchApi } from './api'

const RECENT_WINDOW_MS = 60_000
const recentReports = new Map<string, number>()

function errorDetails(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message || value.name, stack: value.stack }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) }
  } catch {
    return { message: String(value) }
  }
}

export async function reportClientRuntimeError(value: unknown, source: string): Promise<void> {
  if (typeof window === 'undefined') return
  const details = errorDetails(value)
  const path = `${window.location.origin}${window.location.pathname}`
  const key = `${source}:${path}:${details.message}`
  const now = Date.now()
  if (now - (recentReports.get(key) || 0) < RECENT_WINDOW_MS) return
  recentReports.set(key, now)
  await fetchApi('/api/client-errors', {
    method: 'POST',
    body: JSON.stringify({
      message: `[${source}] ${details.message}`.slice(0, 2_000),
      stack: details.stack?.slice(0, 8_000),
      path,
      occurredAt: new Date().toISOString(),
    }),
  })
}
