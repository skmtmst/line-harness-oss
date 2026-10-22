import { api } from './api'
import { invalidateApiReads } from './api/transport/read-cache'

/** 担当の選択肢も共通 GET の認証・店舗・失効と30秒の期限で共有する。 */
export function loadOperators() {
  return api.operators.list()
}

export function clearOperatorsCache(): void {
  invalidateApiReads('/api/operators')
}
