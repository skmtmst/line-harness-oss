import { describeApiFailure } from '@/components/shared/api-error-message'
import { ApiError } from '@/lib/api'


export function retryEffectsFailureText(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiFailure(error, '後処理の再実行', {
      scope: 'store',
    })
  }
  return describeApiFailure(error, '後処理の再実行')
}
