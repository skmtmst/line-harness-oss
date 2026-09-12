import type { TemplateInput, TemplateType } from './hq-templates-api'

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

export function sameCreationScope(a: CreationScope, b: CreationScope): boolean {
  return a.tenantId === b.tenantId && a.actorId === b.actorId
}
export function creationStorageKey(scope: CreationScope, type: TemplateType): string {
  if (!identifier(scope.tenantId) || !identifier(scope.actorId) || !['tag', 'template', 'rich_menu', 'form'].includes(type)) throw storageError()
  return `lh_hq_create_v1:${scope.tenantId}:${scope.actorId}:${type}`
}
function validAttempt(value: unknown): value is CreationAttempt {
  if (!object(value, ['requestId', 'input', 'distribute']) || !identifier(value.requestId) || typeof value.distribute !== 'boolean') return false
  const input = value.input
  if (!object(input, ['type', 'name', 'description', 'definition']) || !['tag', 'template', 'rich_menu', 'form'].includes(String(input.type)) || !text(input.name, 200) || !input.name.trim() || !optionalText(input.description, 2000)) return false
  const definition = input.definition
  if (input.type === 'tag') {
    if (!object(definition, ['schemaVersion', 'tag', 'folders']) || definition.schemaVersion !== 1 || !Array.isArray(definition.folders) || definition.folders.length > 8) return false
    const tag = definition.tag
    if (!object(tag, ['name', 'color', 'description', 'folderId']) || !text(tag.name, 200) || !tag.name.trim() || !(tag.description === null || optionalText(tag.description, 2000))
      || !(tag.folderId === null || tag.folderId === undefined || identifier(tag.folderId)) || (tag.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(tag.color)))) return false
    return definition.folders.every(folder => object(folder, ['id', 'name', 'parentId', 'color']) && identifier(folder.id) && text(folder.name, 200)
      && (folder.parentId === null || folder.parentId === undefined || identifier(folder.parentId)) && (folder.color === null || folder.color === undefined || /^#[0-9a-f]{6}$/i.test(String(folder.color))))
  }
  if (input.type === 'template') {
    if (!object(definition, ['schemaVersion', 'template', 'media']) || definition.schemaVersion !== 1 || !Array.isArray(definition.media) || definition.media.length > 50) return false
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
  if (!object(form, ['name', 'description', 'fields', 'layout', 'on_submit_tag_id', 'on_submit_scenario_id', 'save_to_metadata']) || !text(form.name, 200) || !nullableText(form.description, 2000) || !Array.isArray(form.fields) || form.fields.length > 100 || form.layout !== null || !(form.on_submit_tag_id === null || identifier(form.on_submit_tag_id)) || !(form.on_submit_scenario_id === null || identifier(form.on_submit_scenario_id)) || typeof form.save_to_metadata !== 'boolean') return false
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
