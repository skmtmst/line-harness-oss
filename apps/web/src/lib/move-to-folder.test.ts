import { beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({
  createDraft: vi.fn(), getDraft: vi.fn(), updateDraft: vi.fn(),
  getAction: vi.fn(), createActionDraft: vi.fn(), updateActionDraft: vi.fn(),
  revise: vi.fn(), updateEvent: vi.fn(), detail: vi.fn(), updateWebhook: vi.fn(),
}))
vi.mock('./api', () => ({ api: {
  automations: { createDraftFromAutomation: net.createDraft, getDraft: net.getDraft, updateDraft: net.updateDraft },
  commonActions: { get: net.getAction, createDraft: net.createActionDraft, updateDraft: net.updateActionDraft },
  conversions: { reviseDefinition: net.revise },
  webhooks: { outgoing: { detail: net.detail, update: net.updateWebhook } },
}, eventsApi: { updateEvent: net.updateEvent } }))
import { moveAutomationToFolder, moveCommonActionToFolder, moveConversionToFolder, moveEventToFolder, moveOutgoingWebhookToFolder } from './move-to-folder'
import type { ConversionDefinitionListItem } from './api'

beforeEach(() => { for (const mock of Object.values(net)) mock.mockReset().mockResolvedValue({ success: true, data: {} }) })
it('ルールは条件と処理を残した下書きに分類だけ加え、現在の版を照合する', async () => {
  const draft = { name: '自動案内', draftVersionId: 'v2', trigger: { type: 'friend_add' }, actions: [{ type: 'wait' }] }
  net.getDraft.mockResolvedValue({ success: true, data: draft })
  await moveAutomationToFolder('rule', 'a', 'folder')
  expect(net.createDraft).toHaveBeenCalledWith('rule')
  expect(net.updateDraft).toHaveBeenCalledWith('rule', 'a', { ...draft, folderId: 'folder', expectedDraftVersionId: 'v2' })
})
it('共通アクションは公開内容から下書きを作り、処理・名前・説明・改訂番号を守る', async () => {
  const actions = [{ type: 'wait', params: { minutes: 5 } }]
  const detail = { name: '案内', description: '説明', currentPublishedVersionId: 'p1', versions: [{ id: 'd2', actions, draftRevision: 3 }] }
  net.getAction.mockResolvedValueOnce({ success: true, data: detail }).mockResolvedValueOnce({ success: true, data: { ...detail, currentDraftVersionId: 'd2' } })
  await moveCommonActionToFolder('action', 'a', null)
  expect(net.createActionDraft).toHaveBeenCalledWith('action', 'a', 'p1')
  expect(net.updateActionDraft).toHaveBeenCalledWith('action', 'a', {
    name: '案内', description: '説明', actions, folderId: null, expectedDraftVersionId: 'd2', expectedDraftRevision: 3,
  })
})
it('共通アクションを読めないときは保存せず失敗を呼び出し元に返す', async () => {
  net.getAction.mockResolvedValue({ success: false, error: 'Not found' })
  await expect(moveCommonActionToFolder('action', 'a', 'folder')).rejects.toThrow('Not found')
  expect(net.updateActionDraft).not.toHaveBeenCalled()
})
it('成果地点は金額と重複判定の条件を保ち、版と移動理由を渡す', async () => {
  const point = { id: 'point', name: '購入', version: 4, value: 500, sourceConfig: { kind: 'purchase' }, deduplicationMode: 'once', deduplicationWindowDays: 30 } as unknown as ConversionDefinitionListItem
  await moveConversionToFolder(point, 'folder')
  expect(net.revise).toHaveBeenCalledWith('point', expect.objectContaining({ folderId: 'folder', expectedVersion: 4, fixedValue: 500, sourceConfig: point.sourceConfig, deduplicationMode: 'once', deduplicationWindowDays: 30, reason: 'フォルダへ移す' }))
})
it('イベントと送るWebhookは分類だけを版つきで変え、秘密や送信設定を送らない', async () => {
  net.detail.mockResolvedValue({ success: true, data: { version: 7 } })
  await moveEventToFolder('event', 'a', 5, 'folder')
  await moveOutgoingWebhookToFolder('hook', 'a', null)
  expect(net.updateEvent).toHaveBeenCalledWith('a', 'event', { folderId: 'folder' }, 5)
  expect(net.updateWebhook).toHaveBeenCalledWith('hook', 'a', { folderId: null, expectedVersion: 7 })
})
