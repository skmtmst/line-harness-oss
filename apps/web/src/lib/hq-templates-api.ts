import { ApiError, fetchApi } from './api'
import type { FormLayout, HqTemplateListDisplay } from '@line-crm/shared'

export const TEMPLATE_TYPES = ['tag', 'template', 'rich_menu', 'form', 'scenario'] as const
export type TemplateType = typeof TEMPLATE_TYPES[number]
export type DistributionMode = 'create' | 'overwrite' | 'alias'
export interface HqTemplate extends Partial<HqTemplateListDisplay> {
  id: string; name: string; description: string | null; template_type: TemplateType
  folder_id?: string | null; revision: number; updated_at: string; reference_summary?: string; distributed_account_count?: number
}
export type HqTemplateListItem = HqTemplate & HqTemplateListDisplay
export interface TagDefinition {
  schemaVersion: 1
  tag: {
    name: string; color?: string; description?: string | null; folderId?: string | null
    isStarred?: boolean; manualAssignmentAllowed?: boolean
    reapplyPolicy?: 'first_only' | 'every_time'; linkedEnabled?: boolean
    mileage?: { self: number; referrer: number; multiplier: number | null; priority: number }
    actions?: Array<{ id: string; type: string; params: Record<string, unknown>; onFailure: 'stop' | 'continue' }>
  }
  folders: { id: string; name: string; parentId?: string | null; color?: string | null }[]
}
export type { MessageTemplateDefinition } from '@line-crm/shared'
import type { MessageTemplateDefinition, TemplateKind, TemplateKindCounts } from '@line-crm/shared'
export interface RichMenuDefinition {
  schemaVersion: 1
  richMenu: {
    id: string; name: string; chatBarText: string; size: 'large' | 'compact'; defaultPageId: string; displayOrder?: number; displayAudience?: 'all' | 'store'
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
  scenario: import('@line-crm/shared').HqScenarioDefinition
}
export type TemplateDefinition = TemplateDefinitionByType[TemplateType]
export type TemplateInput = {
  [K in TemplateType]: { type: K; name: string; description?: string; folderId?: string | null; definition: TemplateDefinitionByType[K] }
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
  stores: ({ accountId: string; accountName: string; items: PreflightItem[]; textOverride?: string } & import('@line-crm/shared').HqTemplatePreflightDisplay)[]
}
export interface Resolution { accountId: string; sourceId: string; mode: DistributionMode }
export interface DistributionResult {
  runId: string; status: 'running' | 'completed' | 'partial' | 'failed'
  stores: ({
    accountId: string; accountName?: string
    status: 'pending' | 'staged' | 'succeeded' | 'failed' | 'version_conflict' | 'unsupported'
    reason?: string | null; cleanupPending?: boolean; counts: { created: number; overwritten: number; aliased: number; reused?: number }
  } & import('@line-crm/shared').HqTemplateResultDisplay)[]
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
  versions: (id:string) => fetchHqTemplateVersions(id),
  compareVersions: (id:string,from:number,to:number) => compareHqTemplateVersions(id,from,to),
  restoreVersion: (id:string,version:number,expectedRevision:number) => restoreHqTemplateVersion(id,version,expectedRevision),
  receivedVersions: (id:string) => fetchHqTemplateReceivedVersions(id),
  listStats: (type:TemplateType='template') => fetchHqTemplateListStats(type),
  listAttributeTags: () => request<HqTemplateListItem[]>('?kind=tag'),
  attributeKindCounts: () => request<{tag:number;friend_field:null;support_mark:null}>('/attribute-kind-counts'),
  uploadRichMessageImage: async (file:File):Promise<import('@line-crm/shared').TemplateImagemapUpload> => {
    if(!['image/png','image/jpeg'].includes(file.type) || !file.size || file.size>8*1024*1024) throw new Error('PNG・JPEGの画像を8MB以内で選んでください。')
    const response=await fetchApi<{success:true;data:import('@line-crm/shared').TemplateImagemapUpload}>(`/api/hq/templates/media?purpose=rich_message&filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type},body:file})
    return response.data
  },
  uploadImage: async (file: File, purpose: 'message' | 'rich_menu', expected?: { width: number; height: number }): Promise<MessageTemplateDefinition['media'][number]> => {
    const max = purpose === 'rich_menu' ? 1024 * 1024 : 8 * 1024 * 1024
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 1 || file.size > max) throw new Error('PNG・JPEGの画像を、表示されたサイズ上限内で選んでください。')
    // R568: 採用できる寸法を宣言する。違う寸法の画像はサーバが登録せず422で返す。
    const size = purpose === 'rich_menu' && expected ? `&width=${expected.width}&height=${expected.height}` : ''
    const result = await fetchApi<{ success: boolean; data?: MessageTemplateDefinition['media'][number] }>(`/api/hq/templates/media?purpose=${purpose}&filename=${encodeURIComponent(file.name)}${size}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
    if (!result.success || !result.data) throw new Error('画像を登録できませんでした。もう一度選択してください。')
    return result.data
  },
  deleteImage: async (r2Key: string): Promise<{ deleted: boolean }> => {
    // R568: 保存されなかった画像の後片付け。所有確認はサーバが行う。
    const result = await fetchApi<{ success: boolean; data?: { deleted: boolean } }>(`/api/hq/templates/media?r2Key=${encodeURIComponent(r2Key)}`, { method: 'DELETE' })
    if (!result.success || !result.data) throw new Error('画像の後片付けができませんでした。')
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
  /** 店と同じ6種類のタブ用。省略時はテンプレートの6種類すべて。 */
  listByKind: (kind?: TemplateKind) => request<HqTemplateListItem[]>(`?type=template${kind ? `&kind=${kind}` : ''}`),
  kindCounts: () => request<TemplateKindCounts>('/kind-counts'),
  /**
   * 種類を指定すればその種類だけ、省けば全部の種類を返す（R119）。
   * リッチメニューや回答フォームの編集では、別種類のタグやテンプレートを
   * 参照先に選ぶため、一覧表示とは別に全部入りの目録が要る。
   */
  list: (type?: TemplateType) => request<HqTemplateListItem[]>(type ? `?type=${type}` : ''),
  folders: {
    list: () => request<import('@line-crm/shared').HqTemplateFolder[]>('/folders'),
    create: (name: string) => request<import('@line-crm/shared').HqTemplateFolder>('/folders', 'POST', { name }),
    update: (id: string, name: string, expectedRevision: number) => request<import('@line-crm/shared').HqTemplateFolder>(`/folders/${encodeURIComponent(id)}`, 'PATCH', { name, expectedRevision }),
    remove: (id: string, expectedRevision: number) => request<{ id: string }>(`/folders/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }),
  },
  duplicate: (id: string, name: string, expectedRevision: number, requestId: string) => request<TemplateDetail>(`${idPath(id)}/duplicate`, 'POST', { name, expectedRevision, requestId }),
  accounts: () => request<HqAccount[]>('/accounts'),
  messageReferences: () => request<import('@line-crm/shared').HqMessageReference[]>('/message-references'),
  get: (id: string) => request<TemplateDetail>(idPath(id)),
  create: (input: TemplateInput, requestId: string) => request<TemplateDetail>(
    '',
    'POST',
    { ...input, requestId },
    { 'Idempotency-Key': requestId },
  ),
  update: (id: string, input: TemplateInput & { expectedRevision: number }) => request<TemplateDetail>(idPath(id), 'PATCH', input),
  remove: (id: string, expectedRevision: number) => request<unknown>(idPath(id), 'DELETE', { expectedRevision }),
  preflight: (id: string, accountIds: string[], textOverrides?: import('@line-crm/shared').HqTemplateTextOverride[]) => request<Preflight>(`${idPath(id)}/preflight`, 'POST', { accountIds, ...(textOverrides ? {textOverrides} : {}) }),
  distribute: (id: string, preflightId: string, resolutions: Resolution[]) => request<DistributionResult>(`${idPath(id)}/distribute`, 'POST', { preflightId, resolutions }),
  result: (id: string, runId: string) => request<DistributionResult>(`${idPath(id)}/distributions/${encodeURIComponent(runId)}`),
}

export const fetchHqTemplateVersions = (id: string) => request<import('@line-crm/shared').HqTemplateVersionDisplay[]>(`/${encodeURIComponent(id)}/versions`)
export const compareHqTemplateVersions = (id: string, from: number, to: number) => request<import('@line-crm/shared').HqTemplateVersionComparison>(`/${encodeURIComponent(id)}/versions/compare?from=${from}&to=${to}`)
export const restoreHqTemplateVersion = (id: string, version: number, expectedRevision: number) => request<TemplateDetail>(`/${encodeURIComponent(id)}/versions/${version}/restore`, 'POST', {expectedRevision})
export const fetchHqTemplateReceivedVersions = (id: string) => request<import('@line-crm/shared').HqTemplateReceivedVersion[]>(`/${encodeURIComponent(id)}/received-versions`)
export async function fetchHqTemplateListStats(type: TemplateType = 'template') {
  const result = await fetchApi<{success: true; stats: import('@line-crm/shared').HqTemplateListStats}>(`/api/hq/templates?type=${type}`)
  return result.stats
}

export { request as requestHqTemplate };
