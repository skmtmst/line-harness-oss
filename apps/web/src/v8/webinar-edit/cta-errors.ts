import { ApiError } from '@/lib/api'

export function isConflict(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409 && (!cause.code || /version_conflict/i.test(cause.code))
}
