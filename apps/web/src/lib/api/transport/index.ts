/** 通信の実装口。機能クライアントは公開互換口を経由せず、ここから読む。 */
export { fetchApi } from './request'
export {
  ApiError,
  extractApiErrorMessage,
  extractApiErrorCode,
  extractApiErrorData,
  extractApiErrorTrackingId,
  extractApiFieldErrors,
  getApiFieldErrors,
  getApiErrorCode,
  responseApiError,
  describeSaveFailure,
  parseRetryAfterSeconds,
  NETWORK_FAILURE_MESSAGE,
} from './errors'
export { fetchApiBlob, downloadApiFile } from './download'
export { readCachedList, refreshCachedList } from './cache'
export { CSRF_STORAGE_KEY, FEATURE_DISABLED_EVENT, getCsrfToken, setCsrfToken } from './session'
export type { FetchApiOptions, ApiAccountEventDetail, FeatureDisabledEventDetail } from '../types/transport'
