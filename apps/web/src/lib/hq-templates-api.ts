import { ApiError, fetchApi } from './api'
import type { FormLayout } from '@line-crm/shared'

export const TEMPLATE_TYPES = ['tag', 'template', 'rich_menu', 'form'] as const
export type TemplateType = typeof TEMPLATE_TYPES[number]
export type DistributionMode = 'create' | 'overwrite' | 'alias'
export interface HqTemplate {
  id: string; name: string; description: string | null; template_type: TemplateType
  revision: number; updated_at: string; reference_summary?: string; distributed_account_count?: number
}
export interface TagDefinition {
  schemaVersion: 1
  tag: { name: string; color?: string; description?: string | null; folderId?: string | null }
  folders: { id: string; name: string; parentId?: string | null; color?: string | null }[]
}
export interface MessageTemplateDefinition {
  schemaVersion: 1
  template: {
    id: string; name: string; category: string
    messageType: 'text' | 'image' | 'flex' | 'carousel'
    messageContent: string; carouselActionsJson: string | null
    carouselTapLimitMode: 'none' | 'once'; carouselTapLimitText: string | null
    questionJson: string | null; questionStatus: 'draft' | 'published'
  }
  media: Array<{
    id: string; kind: 'image' | 'video' | 'audio' | 'file'; filename: string; mimeType: string
    sizeBytes: number; width: number | null; height: number | null; durationMs: number | null
    r2Key: string; publicUrl: string | null; versionId: string; versionNo: number; contentHash: string
  }>
}
export interface RichMenuDefinition {
  schemaVersion: 1
  richMenu: {
    id: string; name: string; chatBarText: string; size: 'large' | 'compact'; defaultPageId: string
    pages: Array<{
      id: string; name: string; imageR2Key: string
      areas: Array<{
        id: string; bounds: { x: number; y: number; width: number; height: number }
        actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch'; actionData: Record<string, string>
        intent?: 'url' | 'text' | 'form' | 'template' | 'switch'; label?: string
        tagIds?: string[]; formId?: string; templateId?: string; scenarioId?: string
      }>
    }>
  }
}
export type FormFieldType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'select' | 'file' | 'date' | 'prefecture'
export interface FormDefinition {
  schemaVersion: 1
  form: {
    name: string; description: string | null
    fields: Array<{ name: string; label: string; type: FormFieldType; required?: boolean; options?: string[]; placeholder?: string | null; description?: string | null }>
    layout: FormLayout | null; on_submit_tag_id: string | null; on_submit_scenario_id: string | null; save_to_metadata: boolean
  }
}
export interface TemplateDefinitionByType {
  tag: TagDefinition
  template: MessageTemplateDefinition
  rich_menu: RichMenuDefinition
  form: FormDefinition
}
export type TemplateDefinition = TemplateDefinitionByType[TemplateType]
export type TemplateInput = {
  [K in TemplateType]: { type: K; name: string; description?: string; definition: TemplateDefinitionByType[K] }
}[TemplateType]
export type TemplateDetail = {
  [K in TemplateType]: { template: HqTemplate & { template_type: K }; definition: TemplateDefinitionByType[K] }
}[TemplateType]
export interface HqAccount { id: string; name: string }
export interface PreflightItem {
  sourceId: string; itemKind: string; name: string; targetId?: string | null; operation?: 'reuse'
  expectedRevision?: string | number | null; duplicate: boolean; allowedModes: DistributionMode[]
}
export interface Preflight {
  preflightId: string; expiresAt: string
  stores: { accountId: string; accountName: string; items: PreflightItem[] }[]
}
export interface Resolution { accountId: string; sourceId: string; mode: DistributionMode }
export interface DistributionResult {
  runId: string; status: 'running' | 'completed' | 'partial' | 'failed'
  stores: {
    accountId: string; accountName?: string
    status: 'pending' | 'staged' | 'succeeded' | 'failed' | 'version_conflict' | 'unsupported'
    reason?: string | null; cleanupPending?: boolean; counts: { created: number; overwritten: number; aliased: number; reused?: number }
  }[]
}
export class HqTemplatesApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly responseReceived = false, public readonly requestNotApplied = false) {
    super(message)
    this.name = 'HqTemplatesApiError'
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, headers?: HeadersInit): Promise<T> {
  try {
  const result = await fetchApi<{ success: true; data: T } | { success: false; error: string; code?: string }>(
    `/api/hq/templates${path}`, {
      method,
      ...(headers ? { headers } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  if (!result.success) {
    const message = result.code === 'UNSUPPORTED'
      ? 'この種類のひな形は未対応です（UNSUPPORTED）。'
      : '入力内容を確認してください。'
    throw new HqTemplatesApiError(message, 422, true)
  }
  return result.data
  } catch (error) {
    if (error instanceof HqTemplatesApiError) throw error
    const detail = error && typeof error === 'object'
      ? error as { status?: number; code?: string; message?: string }
      : {}
    const safeBodyMessage = error instanceof ApiError && [400, 409, 422, 428].includes(error.status)
      ? error.message
      : ''
    const message = detail.code === 'UNSUPPORTED' ? 'この種類のひな形は未対応です（UNSUPPORTED）。'
      : detail.status === 401 ? 'ログインし直してから再確認してください。'
      : detail.status === 403 ? 'ひな形を操作する権限がありません。管理者に確認してください。'
      : safeBodyMessage || (detail.status === 409 || detail.code === 'VERSION_CONFLICT'
        ? '内容が更新されました。もう一度確認してください。'
        : '処理できませんでした。接続と入力内容を確認し、もう一度お試しください。')
    // A gateway/timeout response can arrive after the Worker committed. Receiving
    // HTTP is not proof that creation failed. Only known rejection statuses prove
    // this request did not apply; a previous ambiguous attempt remains ambiguous.
    const requestNotApplied = error instanceof ApiError && [400, 401, 403, 404, 405, 409, 422, 428].includes(error.status)
    throw new HqTemplatesApiError(message, detail.status, error instanceof ApiError, requestNotApplied)
  }
}
const idPath = (id: string) => `/${encodeURIComponent(id)}`
export const hqTemplatesApi = {
  uploadImage: async (file: File, purpose: 'message' | 'rich_menu'): Promise<MessageTemplateDefinition['media'][number]> => {
    const max = purpose === 'rich_menu' ? 1024 * 1024 : 8 * 1024 * 1024
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 1 || file.size > max) throw new Error('PNG・JPEGの画像を、表示されたサイズ上限内で選んでください。')
    const result = await fetchApi<{ success: boolean; data?: MessageTemplateDefinition['media'][number] }>(`/api/hq/templates/media?purpose=${purpose}&filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
    if (!result.success || !result.data) throw new Error('画像を登録できませんでした。もう一度選択してください。')
    return result.data
  },
  context: async (): Promise<{ tenantId: string; actorId: string }> => {
    const response = await fetchApi<{ success: boolean; data?: { id?: string; tenantId?: string } }>('/api/staff/me')
    const { id, tenantId } = response.data ?? {}
    if (!response.success || typeof id !== 'string' || typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) {
      throw new HqTemplatesApiError('所属先を確認できません。ログイン状態を確認してから再読み込みしてください。')
    }
    return { tenantId, actorId: id }
  },
  list: (type: TemplateType) => request<HqTemplate[]>(`?type=${type}`),
  accounts: () => request<HqAccount[]>('/accounts'),
  get: (id: string) => request<TemplateDetail>(idPath(id)),
  create: (input: TemplateInput, requestId: string) => request<TemplateDetail>(
    '',
    'POST',
    { ...input, requestId },
    { 'Idempotency-Key': requestId },
  ),
  update: (id: string, input: TemplateInput & { expectedRevision: number }) => request<TemplateDetail>(idPath(id), 'PATCH', input),
  remove: (id: string, expectedRevision: number) => request<unknown>(idPath(id), 'DELETE', { expectedRevision }),
  preflight: (id: string, accountIds: string[]) => request<Preflight>(`${idPath(id)}/preflight`, 'POST', { accountIds }),
  distribute: (id: string, preflightId: string, resolutions: Resolution[]) => request<DistributionResult>(`${idPath(id)}/distribute`, 'POST', { preflightId, resolutions }),
  result: (id: string, runId: string) => request<DistributionResult>(`${idPath(id)}/distributions/${encodeURIComponent(runId)}`),
}
