import { api, eventsApi, type ConversionDefinitionListItem } from './api'

function requireSuccess<T>(response: { success: boolean; data?: T; error?: string }): T {
  if (!response.success || !response.data) throw new Error(response.error || '移せませんでした')
  return response.data
}

/** 分類も通常の保存口で版を照合する。公開・送信の口は呼ばない。 */
export async function moveAutomationToFolder(id: string, accountId: string, folderId: string | null) {
  requireSuccess(await api.automations.createDraftFromAutomation(id))
  const draft = requireSuccess(await api.automations.getDraft(id, accountId))
  const response = await api.automations.updateDraft(id, accountId, {
    ...draft, folderId, expectedDraftVersionId: draft.draftVersionId,
  })
  if (!response.success) throw new Error(response.error)
}

export async function moveCommonActionToFolder(id: string, accountId: string, folderId: string | null) {
  let detail = requireSuccess(await api.commonActions.get(id, accountId))
  if (!detail.currentDraftVersionId) {
    requireSuccess(await api.commonActions.createDraft(id, accountId, detail.currentPublishedVersionId ?? undefined))
    detail = requireSuccess(await api.commonActions.get(id, accountId))
  }
  const version = detail.versions.find((item) => item.id === detail.currentDraftVersionId)
  if (!version) throw new Error('編集する版を読み直してください')
  const response = await api.commonActions.updateDraft(id, accountId, {
    folderId, name: detail.name, description: detail.description,
    actions: version.actions, expectedDraftVersionId: version.id, expectedDraftRevision: version.draftRevision,
  })
  if (!response.success) throw new Error(response.error)
}

export async function moveConversionToFolder(point: ConversionDefinitionListItem, folderId: string | null) {
  const response = await api.conversions.reviseDefinition(point.id, {
    folderId, expectedVersion: point.version, name: point.name, sourceType: point.sourceType,
    sourceConfig: point.sourceConfig, deduplicationMode: point.deduplicationMode,
    deduplicationWindowDays: point.deduplicationWindowDays, valueMode: point.valueMode,
    fixedValue: point.value, reversalPolicy: point.reversalPolicy,
    attributionDays: point.attributionDays, targetUrl: point.targetUrl, reason: 'フォルダへ移す',
  })
  if (!response.success) throw new Error(response.error)
}

export async function moveEventToFolder(id: string, accountId: string, version: number, folderId: string | null) {
  await eventsApi.updateEvent(accountId, id, { folderId }, version)
}

export async function moveOutgoingWebhookToFolder(id: string, accountId: string, folderId: string | null) {
  const detail = requireSuccess(await api.webhooks.outgoing.detail(id, accountId))
  const response = await api.webhooks.outgoing.update(id, accountId, { folderId, expectedVersion: detail.version })
  if (!response.success) throw new Error(response.error)
}
