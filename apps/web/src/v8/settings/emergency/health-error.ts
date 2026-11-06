import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { ApiError } from '@/lib/api'
export function operationFailureText(error: unknown, fallback: string): string {
  if (japaneseDetailOf(error)) return japaneseDetailOf(error)
  return fallback
}
