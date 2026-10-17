import { describeApiFailure } from '@/components/shared/api-error-message'
import { ApiError } from '@/lib/api'


export function retryEffectsFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiFailure(error, '後処理の再実行', {
      scope: 'store',
    })
  }
  if (error instanceof Error && error.message && error.message !== 'retry_failed' && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)) {
    return error.message
  }
  return describeApiFailure(error, '後処理の再実行')
}
