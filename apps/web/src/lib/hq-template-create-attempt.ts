import type { TemplateInput, TemplateType } from './hq-templates-api'

export interface CreationScope { tenantId: string; actorId: string }
export interface CreationAttempt { requestId: string; input: TemplateInput; distribute: boolean }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const storageError = () => new Error('前回の作成依頼を安全に保存・確認できません。同じタブで保存設定を確認してから再試行してください。')
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const object = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max)

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
  if (!object(input, ['type', 'name', 'description', 'definition']) || input.type !== 'tag' || !text(input.name, 200) || !input.name.trim() || !optionalText(input.description, 2000)) return false
  const definition = input.definition
  if (!object(definition, ['schemaVersion', 'tag', 'folders']) || definition.schemaVersion !== 1 || !Array.isArray(definition.folders) || definition.folders.length > 8) return false
  const tag = definition.tag
  if (!object(tag, ['name', 'color', 'description', 'folderId']) || !text(tag.name, 200) || !tag.name.trim() || !optionalText(tag.description, 2000)
    || (tag.folderId !== undefined && !identifier(tag.folderId)) || (tag.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(tag.color)))) return false
  return definition.folders.every(folder => object(folder, ['id', 'name', 'parentId', 'color']) && identifier(folder.id) && text(folder.name, 200)
    && (folder.parentId === undefined || identifier(folder.parentId)) && (folder.color === undefined || /^#[0-9a-f]{6}$/i.test(String(folder.color))))
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
