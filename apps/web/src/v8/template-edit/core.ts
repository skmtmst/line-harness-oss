/*
 * ★V8 テンプレートの作る・編集の決まり（読み込み・断り方・保存・利用先）。
 *
 * 今の画面（app/templates/edit/edit-core.tsx・template-detail-data.ts・
 * edit/template-conflict-diff.ts）と同じ決まりを写した。src/v8 からは
 * @/app を読めないので写している。呼ぶ API・送る形・断る文は今と同じ。
 * 違いは1つだけ：保存の 409（ほかの人が先に保存した）を「競合」として返す
 * （絵 NCbYn の帯を出すため。今の画面は文だけを出していた）。
 */
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { validateFlexContent, type CommonVar, type FriendField } from '@line-crm/shared'

export interface TemplateReferences {
  friendFields: FriendField[]
  commonVars: CommonVar[]
}
export type TemplateReferenceState = 'idle' | 'loading' | 'ready' | 'failed'
export const EMPTY_REFERENCES: TemplateReferences = { friendFields: [], commonVars: [] }

/** 詳細口（GET /api/templates/:id）が返す1件分の形。 */
export type TemplateDetailData = Extract<
  Awaited<ReturnType<typeof api.templates.get>>,
  { success: true }
>['data']
export type TemplateUsedBy = TemplateDetailData['usedBy']

/*
 * 詳細口の応答の形の番人（D007/D008）。名前・種類・本文の3つが文字列の
 * ときだけ中身として受け取る。利用先は有るときだけ、表が配列かを見る。
 */
export function isTemplateDetailData(data: unknown): data is TemplateDetailData {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.messageType !== 'string' || typeof record.messageContent !== 'string') {
    return false
  }
  const usedBy = record.usedBy
  if (usedBy === undefined || usedBy === null) return true
  if (typeof usedBy !== 'object') return false
  const lists = usedBy as Record<string, unknown>
  for (const key of ['broadcasts', 'reminderEnrollments'] as const) {
    const value = lists[key]
    if (value !== undefined && !Array.isArray(value)) return false
  }
  for (const key of ['autoReplies', 'automations', 'scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks'] as const) {
    if (!Array.isArray(lists[key])) return false
  }
  return true
}

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

export type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 「上のバーで選んでいるもの」と「開いているテンプレートの所属」は別物。 */
export interface TemplateAccountBinding {
  templateId: string | null
  templateStatus: TemplateLoadStatus
  templateAccountId: string | null
  selectedAccountId: string | null
}

export const ACCOUNT_MISMATCH_MESSAGE =
  '別のLINE公式アカウントに切り替わっています。上のバーでこのテンプレートのアカウントへ戻すと保存できます。'
export const TEMPLATE_LOAD_FAILED_MESSAGE = '読み込めませんでした。開き直してください。'
export const TEMPLATE_LOADING_MESSAGE = 'テンプレートを読み込んでいます。読み終わるまで保存できません。'

/** 差し込み候補を読むアカウント。既存テンプレートは所属へ固定する。 */
export function resolveEditorAccountId(binding: TemplateAccountBinding): string | null {
  if (!binding.templateId) return binding.selectedAccountId
  if (binding.templateStatus !== 'ready') return null
  return binding.templateAccountId ?? binding.selectedAccountId
}

export function templateAccountMismatch(binding: TemplateAccountBinding): boolean {
  if (!binding.templateId || binding.templateStatus !== 'ready') return false
  if (!binding.templateAccountId || !binding.selectedAccountId) return false
  return binding.templateAccountId !== binding.selectedAccountId
}

/** 保存を閉じる理由。null のときだけ保存の口を開ける。 */
export function templateSaveGuard(binding: TemplateAccountBinding): string | null {
  if (binding.templateId) {
    if (binding.templateStatus === 'failed') return TEMPLATE_LOAD_FAILED_MESSAGE
    if (binding.templateStatus !== 'ready') return TEMPLATE_LOADING_MESSAGE
  }
  if (templateAccountMismatch(binding)) return ACCOUNT_MISMATCH_MESSAGE
  return null
}

export interface TemplateDraft {
  name: string
  category: string
  folderId: string | null
  messageType: string
  messageContent: string
}

export interface TemplateSaveInput extends TemplateAccountBinding, TemplateDraft {}

export function validateTemplateSave(input: TemplateSaveInput): string | null {
  const guard = templateSaveGuard(input)
  if (guard) return guard
  if (!input.templateId && !input.selectedAccountId) return '上のバーでLINE公式アカウントを選んでください'
  if (!input.name.trim()) return '名前を入力してください'
  if (!input.messageContent.trim()) return '本文を入力してください'
  const flexError = validateFlexContent(input.messageType, input.messageContent)
  if (flexError) return flexError
  return null
}

export type TemplateSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; conflict?: boolean }

/** 保存する。断る条件に当たったら API を一度も呼ばない。409 は競合として返す。 */
export async function saveTemplateEdit(input: TemplateSaveInput): Promise<TemplateSaveResult> {
  const blocked = validateTemplateSave(input)
  if (blocked) return { ok: false, error: blocked }
  const payload = {
    name: input.name.trim(),
    category: input.category,
    messageType: input.messageType,
    messageContent: input.messageContent,
    folderId: input.folderId,
  }
  try {
    const res = input.templateId
      ? await api.templates.update(input.templateId, payload)
      : await api.templates.create({ accountId: input.selectedAccountId as string, ...payload })
    return res.success ? { ok: true, id: res.data.id } : { ok: false, error: res.error }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { ok: false, error: describeSaveFailure(e), conflict: true }
    return { ok: false, error: describeSaveFailure(e) }
  }
}

/** 利用先の1行分（IDEA-11）。一覧のドロワーと同じ行き先。 */
export function templateUsageEntries(usedBy: TemplateUsedBy): Array<{ key: string; href: string | null; label: string }> {
  return [
    ...usedBy.scenarioSteps.map((usage) => ({
      key: `scenario-${usage.stepId}`,
      href: `/scenarios/detail?id=${usage.scenarioId}`,
      label: `シナリオ「${usage.scenarioName}」${usage.stepOrder}通目`,
    })),
    ...usedBy.autoReplies.map((usage) => ({
      key: `auto-reply-${usage.id}`,
      href: `/auto-replies/edit?id=${usage.id}`,
      label: `自動応答「${usage.keyword}」の返信`,
    })),
    ...usedBy.automations.map((usage) => ({
      key: `automation-${usage.id}`,
      href: null,
      label: usage.eventType === 'inbox_favorite'
        ? '受信箱の「よく使う」'
        : `オートメーション「${usage.name}」（旧形式・画面からは開けません）`,
    })),
    ...usedBy.reminderSteps.map((usage) => ({
      key: `reminder-${usage.stepId}`,
      href: `/reminders/edit?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」`,
    })),
    ...(usedBy.reminderEnrollments ?? []).map((usage) => ({
      key: `reminder-enrollment-${usage.enrollmentId}`,
      href: `/reminders/detail?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」第${usage.versionNumber}版（${usage.enrollmentStatus === 'cancelled' ? '取消ずみ' : '送信待ち'}）`,
    })),
    ...usedBy.richMenuAreas.map((usage) => ({
      key: `rich-menu-${usage.areaId}`,
      href: `/rich-menus/edit?id=${usage.groupId}`,
      label: `リッチメニュー「${usage.groupName}」${usage.pageName}`,
    })),
    ...usedBy.trackedLinks.map((usage) => ({
      key: `tracked-link-${usage.id}`,
      href: `/inflow-links/detail?id=${usage.id}`,
      label: `流入リンク「${usage.name}」`,
    })),
  ]
}

/** 画面が持つテンプレート1件分。requestedId と中身は必ず一緒に動かす。 */
export interface TemplateEditorState {
  requestedId: string | null
  status: TemplateLoadStatus
  templateAccountId: string | null
  publishedVersion: number | null
  draft: TemplateDraft
  usedBy: TemplateUsedBy | null
  /** 最後に読んだ版の保存時刻（競合の帯で「いつ保存されたか」に使う）。 */
  updatedAt: string | null
}

export function newTemplateEditorState(templateId: string | null, visual: boolean): TemplateEditorState {
  return {
    requestedId: templateId,
    status: templateId ? 'loading' : 'idle',
    templateAccountId: null,
    publishedVersion: null,
    usedBy: null,
    updatedAt: null,
    draft: {
      name: visual ? '定期便 初回のご案内' : '',
      // category は旧一覧との互換用に保存だけ続ける。分け方は folderId。
      category: 'general',
      folderId: null,
      messageType: 'text',
      messageContent: visual
        ? '{{name}}さん、いつもありがとうございます。\n初回のお届け予定はこちらです。\nhttps://example.co.jp/first-delivery'
        : '',
    },
  }
}

export function draftFromDetail(data: TemplateDetailData): TemplateDraft {
  return {
    name: data.name,
    category: data.category ?? '',
    folderId: data.folderId ?? null,
    messageType: data.messageType,
    messageContent: data.messageContent,
  }
}

/** 競合の「違いを比べる」で出す差分。変わった所を運用者の言葉で返す。 */
export function describeTemplateDiff(mine: TemplateDraft, incoming: TemplateDraft): string[] {
  const lines: string[] = []
  if (mine.name !== incoming.name) {
    lines.push(`テンプレート名が違います（最新「${incoming.name || '（無題）'}」／あなた「${mine.name || '（無題）'}」）`)
  }
  if (mine.messageType !== incoming.messageType) lines.push('メッセージの形が違います')
  if (mine.messageContent !== incoming.messageContent) lines.push('本文が違います')
  if (mine.category !== incoming.category || (mine.folderId ?? '') !== (incoming.folderId ?? '')) {
    lines.push('種類・フォルダが違います')
  }
  return lines
}

/** 競合の帯の時刻（日本時間の 時:分）。読めなければ空。 */
export function conflictTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
