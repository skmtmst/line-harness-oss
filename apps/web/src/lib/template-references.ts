import { api, ApiError } from '@/lib/api'
import type { CommonVar, FriendField } from '@line-crm/shared'

export interface TemplateReferences {
  friendFields: FriendField[]
  commonVars: CommonVar[]
}
export type TemplateReferenceState = 'idle' | 'loading' | 'ready' | 'failed'
export const EMPTY_REFERENCES: TemplateReferences = { friendFields: [], commonVars: [] }

/* 友だち情報・共通情報は任意機能。機能オフの 403 は「候補なし」として扱う。 */
export async function loadTemplateReferences(accountId: string): Promise<TemplateReferences> {
  const emptyOnDisabled = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'FEATURE_DISABLED') return { success: true as const, data: [] }
    throw error
  }
  const [fieldResponse, varResponse] = await Promise.all([
    api.friendFields.list(accountId, undefined, { suppressFeatureDisabledEvent: true }).catch(emptyOnDisabled),
    api.commonVars.list(accountId, undefined, { suppressFeatureDisabledEvent: true }).catch(emptyOnDisabled),
  ])
  if (!fieldResponse.success || !varResponse.success) throw new Error('差し込み項目を読み込めませんでした')
  return {
    friendFields: fieldResponse.data.filter((field) => field.canInsertText !== false),
    commonVars: varResponse.data,
  }
}

/** 遅れて届いた古い応答は捨てる（捨てたら null、読めなければ 'failed'）。 */
export async function requestTemplateReferences(request: {
  load: (accountId: string) => Promise<TemplateReferences>
  accountId: string
  generation: number
  currentGeneration: () => number
}): Promise<TemplateReferences | 'failed' | null> {
  try {
    const references = await request.load(request.accountId)
    return request.generation === request.currentGeneration() ? references : null
  } catch {
    return request.generation === request.currentGeneration() ? 'failed' : null
  }
}
