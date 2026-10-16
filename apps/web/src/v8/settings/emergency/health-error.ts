import { ApiError } from '@/lib/api'
export function operationFailureText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message && !/^API error: \d+$/.test(error.message)) return error.message
  return fallback
}
