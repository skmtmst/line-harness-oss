import { parseHqMessageCard } from '@line-crm/shared'
import type { TemplateInput, TemplateType } from './hq-templates-api'
import { normalizeLayout } from '@line-crm/shared'

export interface CreationScope { tenantId: string; actorId: string }
export interface CreationAttempt { requestId: string; input: TemplateInput; distribute: boolean }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const storageError = () => new Error('前回の作成依頼を安全に保存・確認できません。同じタブで保存設定を確認してから再試行してください。')
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const object = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max)
const nullableText = (value: unknown, max: number) => value === null || text(value, max)
const nullableInteger = (value: unknown) => value === null || Number.isSafeInteger(value)
const integerBetween = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max

function validTagAction(value: unknown): boolean {
  if (!object(value, ['id', 'type', 'params', 'onFailure']) || !identifier(value.id) || !['send_message', 'grant_mileage'].includes(String(value.type)) || !['stop', 'continue'].includes(String(value.onFailure))) return false
  const params = value.params
  if (!object(params, ['delayMinutes', 'cancelIfTagRemoved', 'content', 'amount']) || (params.delayMinutes !== undefined && !integerBetween(params.delayMinutes, 0, 525_600)) || (params.cancelIfTagRemoved !== undefined && typeof params.cancelIfTagRemoved !== 'boolean')) return false
  if (value.type === 'send_message') return text(params.content, 5000) && params.content.trim().length > 0 && params.amount === undefined
  return integerBetween(params.amount, 1, 1_000_000) && params.content === undefined
}

export function sameCreationScope(a: CreationScope, b: CreationScope): boolean {
  return a.tenantId === b.tenantId && a.actorId === b.actorId
}
export function creationStorageKey(scope: CreationScope, type: TemplateType): string {
  if (!identifier(scope.tenantId) || !identifier(scope.actorId) || !['tag', 'template', 'rich_menu', 'form', 'scenario'].includes(type)) throw storageError()
  return `lh_hq_create_v1:${scope.tenantId}:${scope.actorId}:${type}`
}
function validAttempt(value: unknown): value is CreationAttempt {
  if (!object(value, ['requestId', 'input', 'distribute']) || !identifier(value.requestId) || typeof value.distribute !== 'boolean') return false
  const input = value.input
  if (!object(input, ['type', 'name', 'description', 'definition', 'folderId']) || !['tag', 'template', 'rich_menu', 'form', 'scenario'].includes(String(input.type)) || !text(input.name, 200) || !input.name.trim() || !optionalText(input.description, 2000)) return false
  if (!(input.folderId === undefined || input.folderId === null || identifier(input.folderId))) return false
  const definition = input.definition
  if (definition && typeof definition === 'object' && 'card' in definition && definition.card !== undefined) {
    try { parseHqMessageCard(definition.card) } catch { return false }
  }
  if (input.type === 'scenario') {
    if (!object(definition,['schemaVersion','scenario','steps']) || definition.schemaVersion!==1 || !object(definition.scenario,['name','description']) || !text(definition.scenario.name,200) || !definition.scenario.name.trim() || !(definition.scenario.description===null || optionalText(definition.scenario.description,2000)) || !Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length>100) return false
    return definition.steps.every(step=>object(step,['id','delayMinutes','messageType','messageContent']) && identifier(step.id) && integerBetween(step.delayMinutes,0,525600) && ['text','flex'].includes(String(step.messageType)) && text(step.messageContent,step.messageType==='text'?5000:32000) && !!step.messageContent.trim())
  }
  if (input.type === 'tag') {
    if (!object(definition, ['schemaVersion', 'tag', 'folders']) || definition.schemaVersion !== 1 || !Array.isArray(definition.folders) || definition.folders.length > 8) return false
    const tag = definition.tag
    if (!object(tag, ['name', 'color', 'description', 'folderId', 'isStarred', 'manualAssignmentAllowed', 'reapplyPolicy', 'linkedEnabled', 'mileage', 'actions']) || !text(tag.name, 200) || !tag.name.trim() || !(tag.description === null || optionalText(tag.description, 2000))
      || !(tag.folderId === null || tag.folderId === undefined || identifier(tag.folderId)) || (tag.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(tag.color)))
      || (tag.isStarred !== undefined && typeof tag.isStarred !== 'boolean') || (tag.manualAssignmentAllowed !== undefined && typeof tag.manualAssignmentAllowed !== 'boolean')
      || (tag.reapplyPolicy !== undefined && !['first_only', 'every_time'].includes(String(tag.reapplyPolicy))) || (tag.linkedEnabled !== undefined && typeof tag.linkedEnabled !== 'boolean')) return false
    if (tag.mileage !== undefined && (!object(tag.mileage, ['self', 'referrer', 'multiplier', 'priority']) || !integerBetween(tag.mileage.self, 0, 1_000_000)
      || !integerBetween(tag.mileage.referrer, 0, 1_000_000) || !(tag.mileage.multiplier === null || integerBetween(tag.mileage.multiplier, 1000, 100_000)) || !integerBetween(tag.mileage.priority, 0, 1000))) return false
    if (tag.actions !== undefined && (!Array.isArray(tag.actions) || tag.actions.length > 50 || !tag.actions.every(validTagAction))) return false
    return definition.folders.every(folder => object(folder, ['id', 'name', 'parentId', 'color']) && identifier(folder.id) && text(folder.name, 200)
      && (folder.parentId === null || folder.parentId === undefined || identifier(folder.parentId)) && (folder.color === null || folder.color === undefined || /^#[0-9a-f]{6}$/i.test(String(folder.color))))
  }
  if (input.type === 'template') {
    if (!object(definition, ['schemaVersion', 'template', 'media', 'card', 'asset']) || definition.schemaVersion !== 1 || !Array.isArray(definition.media) || definition.media.length > 50) return false
    /* API-17：店と同じ6種類の素材（クーポン・リサーチ・リッチメッセージ・カード）。中身の検査はサーバーが行う。 */
    if (definition.asset !== undefined && (!object(definition.asset, ['kind', 'payload']) || !['card_message', 'rich_message', 'coupon', 'research'].includes(String(definition.asset.kind))
      || !definition.asset.payload || typeof definition.asset.payload !== 'object' || Array.isArray(definition.asset.payload))) return false
    const template = definition.template
    if (!object(template, ['id', 'name', 'category', 'messageType', 'messageContent', 'carouselActionsJson', 'carouselTapLimitMode', 'carouselTapLimitText', 'questionJson', 'questionStatus'])
      || !identifier(template.id) || !text(template.name, 255) || !text(template.category, 100) || !['text', 'image', 'flex', 'carousel'].includes(String(template.messageType))
      || !text(template.messageContent, 1_000_000) || !nullableText(template.carouselActionsJson, 1_000_000) || !['none', 'once'].includes(String(template.carouselTapLimitMode))
      || !nullableText(template.carouselTapLimitText, 10_000) || !nullableText(template.questionJson, 1_000_000) || !['draft', 'published'].includes(String(template.questionStatus))) return false
    return definition.media.every(media => object(media, ['id', 'kind', 'filename', 'mimeType', 'sizeBytes', 'width', 'height', 'durationMs', 'r2Key', 'publicUrl', 'versionId', 'versionNo', 'contentHash'])
      && identifier(media.id) && ['image', 'video', 'audio', 'file'].includes(String(media.kind)) && text(media.filename, 255) && text(media.mimeType, 255)
      && Number.isSafeInteger(media.sizeBytes) && nullableInteger(media.width) && nullableInteger(media.height) && nullableInteger(media.durationMs)
      && text(media.r2Key, 1024) && nullableText(media.publicUrl, 2048) && identifier(media.versionId) && Number.isSafeInteger(media.versionNo) && text(media.contentHash, 255))
  }
  if (input.type === 'rich_menu') {
    if (!object(definition, ['schemaVersion', 'richMenu']) || definition.schemaVersion !== 1) return false
    const menu = definition.richMenu
    if (!object(menu, ['id', 'name', 'chatBarText', 'size', 'defaultPageId', 'pages']) || !identifier(menu.id) || !text(menu.name, 200) || !text(menu.chatBarText, 14) || !['large', 'compact'].includes(String(menu.size)) || !identifier(menu.defaultPageId) || !Array.isArray(menu.pages) || !menu.pages.length || menu.pages.length > 10) return false
    return menu.pages.every(page => object(page, ['id', 'name', 'imageR2Key', 'areas']) && identifier(page.id) && text(page.name, 200) && text(page.imageR2Key, 1024) && Array.isArray(page.areas) && page.areas.length <= 20 && page.areas.every(area => {
      if (!object(area, ['id', 'bounds', 'actionType', 'actionData', 'intent', 'label', 'tagIds', 'formId', 'templateId', 'scenarioId']) || !identifier(area.id) || !object(area.bounds, ['x', 'y', 'width', 'height']) || !Object.values(area.bounds).every(Number.isSafeInteger) || !object(area.actionData, ['uri', 'text', 'targetPageId']) || !Object.values(area.actionData).every(entry => text(entry, 2000))) return false
      return ['uri', 'message', 'postback', 'richmenuswitch'].includes(String(area.actionType)) && (area.intent === undefined || ['url', 'text', 'form', 'template', 'switch'].includes(String(area.intent))) && optionalText(area.label, 200)
        && (area.tagIds === undefined || Array.isArray(area.tagIds) && area.tagIds.length <= 30 && area.tagIds.every(identifier)) && (area.formId === undefined || identifier(area.formId)) && (area.templateId === undefined || identifier(area.templateId))
        && (area.scenarioId === undefined || identifier(area.scenarioId) && ['text', 'template'].includes(String(area.intent)))
    }))
  }
  if (!object(definition, ['schemaVersion', 'form']) || definition.schemaVersion !== 1) return false
  const form = definition.form
  if (!object(form, ['name', 'description', 'fields', 'layout', 'on_submit_tag_id', 'on_submit_scenario_id', 'save_to_metadata']) || !text(form.name, 200) || !nullableText(form.description, 2000) || !Array.isArray(form.fields) || form.fields.length > 100 || !(form.layout === null || normalizeLayout(form.layout) !== null) || !(form.on_submit_tag_id === null || identifier(form.on_submit_tag_id)) || !(form.on_submit_scenario_id === null || identifier(form.on_submit_scenario_id)) || typeof form.save_to_metadata !== 'boolean') return false
  return form.fields.every(field => object(field, ['name', 'label', 'type', 'required', 'options', 'placeholder', 'description']) && text(field.name, 200) && text(field.label, 200) && ['text', 'textarea', 'radio', 'checkbox', 'select', 'file', 'date', 'prefecture'].includes(String(field.type)) && (field.required === undefined || typeof field.required === 'boolean') && (field.options === undefined || Array.isArray(field.options) && field.options.length <= 100 && field.options.every(option => text(option, 200))) && (field.placeholder === undefined || nullableText(field.placeholder, 2000)) && (field.description === undefined || nullableText(field.description, 2000)))
}
export function loadCreationAttempt(storage: StoragePort, scope: CreationScope, type: TemplateType): CreationAttempt | null {
  try {
    const raw = storage.getItem(creationStorageKey(scope, type))
    if (raw === null) return null
    if (raw.length > 32_000) throw storageError()
    const record: unknown = JSON.parse(raw)
    if (!object(record, ['version', 'tenantId', 'actorId', 'type', 'attempt']) || record.version !== 1 || record.tenantId !== scope.tenantId || record.actorId !== scope.actorId || record.type !== type || !validAttempt(record.attempt)) throw storageError()
    return record.attempt
  } catch { throw storageError() }
}
export function persistCreationAttempt(storage: StoragePort, scope: CreationScope, type: TemplateType, attempt: CreationAttempt): void {
  try {
    if (!validAttempt(attempt) || attempt.input.type !== type) throw storageError()
    const existing = loadCreationAttempt(storage, scope, type)
    if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) throw storageError()
    const key = creationStorageKey(scope, type)
    const raw = JSON.stringify({ version: 1, ...scope, type, attempt })
    if (raw.length > 32_000) throw storageError()
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw storageError()
  } catch { throw storageError() }
}
export function clearCreationAttempt(storage: StoragePort, scope: CreationScope, type: TemplateType, requestId: string): void {
  try {
    const existing = loadCreationAttempt(storage, scope, type)
    if (existing && existing.requestId !== requestId) throw storageError()
    const key = creationStorageKey(scope, type)
    storage.removeItem(key)
    if (storage.getItem(key) !== null) throw storageError()
  } catch { throw storageError() }
}
/*
 * H-18原文（再読込で入力が消える）の子画面の通常入力の一時下書き。結果不明の送信依頼（attempt）とは
 * 別キーで、所属・種別・タブ（kind）を区別する。保存・取消・作り直しで消す。壊れても本機能を止めない。
 */
export interface EditorDraftContent { kind: string; name: string; [key: string]: unknown }
const DRAFT_LIMIT = 262_144
const draftKind = (kind: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(kind)
export function editorDraftStorageKey(scope: CreationScope, type: TemplateType, kind: string): string {
  if (!identifier(scope.tenantId) || !identifier(scope.actorId) || !draftKind(kind)) throw storageError()
  return `lh_hq_create_draft_v1:${scope.tenantId}:${scope.actorId}:${type}:${kind}`
}
const recordObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function validDraftExtrasTree(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(validDraftExtrasTree)
  if (!recordObject(value)) return true
  return Object.entries(value).every(([key, child]) => {
    if (key === 'choiceTapExtras') return child === undefined || Array.isArray(child) && child.every(extra => validDraftExtrasTree({ tapExtras: extra }))
    if (key !== 'tapExtras') return validDraftExtrasTree(child)
    return child == null || recordObject(child)
      && (child.tagIds === undefined || Array.isArray(child.tagIds) && child.tagIds.every(id => typeof id === 'string'))
      && (child.scoreChange == null || typeof child.scoreChange === 'number')
  })
}
function validEditorState(kind: string, value: unknown): boolean {
  if (!recordObject(value) || !validDraftExtrasTree(value)) return false
  if (!(value.pickedMedia === null || recordObject(value.pickedMedia) && typeof value.pickedMedia.id === 'string' && typeof value.pickedMedia.kind === 'string')) return false
  if (kind === 'coupon' || kind === 'research') {
    const strings = ['description', 'couponTitle', 'imageUrl', 'couponOnce', 'couponVisibility', 'lotteryRate', 'winnerLimit', 'couponStartsAt', 'couponEndsAt', 'researchStartsAt', 'researchEndsAt', 'targetTagId']
    if (!strings.every(key => typeof value[key] === 'string') || !['once', 'unlimited', 'limited'].includes(String(value.couponOnce)) || !['friends', 'link'].includes(String(value.couponVisibility))
      || typeof value.countTouched !== 'boolean' || typeof value.lottery !== 'boolean' || !recordObject(value.couponDraft) || !Array.isArray(value.couponUseActions) || !Array.isArray(value.answerActions) || !Array.isArray(value.questions)) return false
    if (![...value.couponUseActions, ...value.answerActions].every(action => recordObject(action) && typeof action.key === 'string' && typeof action.actionType === 'string' && ['stop', 'continue'].includes(String(action.onFailure)))) return false
    const coupon = value.couponDraft
    if (!['amount', 'percent', 'before', 'after', 'conditions', 'code', 'instructions'].every(key => typeof coupon[key] === 'string') || typeof coupon.showCode !== 'boolean'
      || !['discount', 'none'].includes(String(coupon.couponType)) || !['amount', 'percent', 'price', 'none'].includes(String(coupon.mode))) return false
    return value.questions.every(q => recordObject(q) && typeof q.key === 'string' && typeof q.text === 'string' && ['single', 'multiple', 'free'].includes(String(q.format)) && typeof q.required === 'boolean' && Array.isArray(q.choices) && q.choices.every(choice => typeof choice === 'string'))
  }
  if (kind === 'rich_message') {
    if (typeof value.imageUrl !== 'string' || typeof value.shapeValue !== 'string' || !recordObject(value.areas)) return false
    if (!(value.uploaded === null || recordObject(value.uploaded) && recordObject(value.uploaded.payload) && Array.isArray(value.uploaded.media))) return false
    return Object.values(value.areas).every(area => recordObject(area) && typeof area.kind === 'string' && typeof area.uri === 'string' && typeof area.text === 'string' && typeof area.refId === 'string')
  }
  return false
}
function validEditorDraft(value: unknown): value is EditorDraftContent {
  if (!recordObject(value) || typeof value.kind !== 'string' || !draftKind(value.kind) || !text(value.name, 200)) return false
  if (!(value.folderId === undefined || value.folderId === null || identifier(value.folderId))) return false
  return value.editorState === undefined || validEditorState(value.kind, value.editorState)
}
export function loadEditorDraft(storage: StoragePort, scope: CreationScope, type: TemplateType, kind: string, onFailure?: () => void): EditorDraftContent | null {
  let key: string
  try { key = editorDraftStorageKey(scope, type, kind) } catch { return null }
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    if (raw.length > DRAFT_LIMIT) throw new Error('draft size')
    const record: unknown = JSON.parse(raw)
    if (!object(record, ['version', 'tenantId', 'actorId', 'type', 'kind', 'draft']) || record.version !== 1 || record.tenantId !== scope.tenantId || record.actorId !== scope.actorId || record.type !== type || record.kind !== kind || !validEditorDraft(record.draft) || record.draft.kind !== kind) throw new Error('draft')
    return record.draft
  } catch { try { storage.removeItem(key) } catch { /* 呼ぶ側で再読込前の保存を案内する。 */ } onFailure?.(); return null }
}
export function persistEditorDraft(storage: StoragePort, scope: CreationScope, type: TemplateType, kind: string, draft: EditorDraftContent): boolean {
  let key: string
  try { key = editorDraftStorageKey(scope, type, kind) } catch { return false }
  try {
    if (!validEditorDraft(draft) || draft.kind !== kind) throw new Error('draft')
    const raw = JSON.stringify({ version: 1, ...scope, type, kind, draft })
    if (raw.length > DRAFT_LIMIT) throw new Error('draft size')
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw new Error('draft write')
    return true
  } catch {
    // 最新入力を記録できなければ、古い内容を最新として復元しない。
    try { storage.removeItem(key) } catch {
      try { storage.setItem(key, 'null') } catch { /* 呼ぶ側に失敗を知らせ、再読込前の保存を案内する。 */ }
    }
    return false
  }
}
export function clearEditorDraft(storage: StoragePort, scope: CreationScope, type: TemplateType, kind: string): void {
  let key: string
  try { key = editorDraftStorageKey(scope, type, kind) } catch { return }
  try { storage.removeItem(key) } catch { /* 下書きの掃除失敗は無視する */ }
}
