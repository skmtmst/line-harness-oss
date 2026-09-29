import { describe, expect, it } from 'vitest'
import { emptyLayout } from '@line-crm/shared'
import { clearCreationAttempt, creationStorageKey, loadCreationAttempt, persistCreationAttempt } from './hq-template-create-attempt'

const scope = { tenantId: 'tenant-a', actorId: 'owner' }
const attempt = { requestId: 'request-123', distribute: true, input: { type: 'tag' as const, name: '来店', definition: { schemaVersion: 1 as const, tag: { name: '来店' }, folders: [] } } }
function storage() {
  const rows = new Map<string, string>()
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}
describe('HQ creation receipt storage', () => {
  it('tenant・本人・種別で分離し、同じ依頼だけ再保存と消去を許す', () => {
    const s = storage(); persistCreationAttempt(s, scope, 'tag', attempt)
    expect(loadCreationAttempt(s, scope, 'tag')).toEqual(attempt)
    expect(loadCreationAttempt(s, { ...scope, tenantId: 'tenant-b' }, 'tag')).toBeNull()
    expect(loadCreationAttempt(s, { ...scope, actorId: 'other' }, 'tag')).toBeNull()
    expect(loadCreationAttempt(s, scope, 'form')).toBeNull()
    expect(() => persistCreationAttempt(s, scope, 'tag', { ...attempt, requestId: 'different' })).toThrow()
    expect(() => clearCreationAttempt(s, scope, 'tag', 'different')).toThrow()
    persistCreationAttempt(s, scope, 'tag', attempt); clearCreationAttempt(s, scope, 'tag', attempt.requestId)
    expect(loadCreationAttempt(s, scope, 'tag')).toBeNull()
  })
  it('認証値等の未定義フィールドを保存しない', () => {
    const s = storage()
    expect(() => persistCreationAttempt(s, scope, 'tag', { ...attempt, token: 'fixture-not-a-secret' } as typeof attempt)).toThrow()
    expect(() => persistCreationAttempt(s, scope, 'tag', { ...attempt, input: { ...attempt.input, authorization: 'fixture' } } as typeof attempt)).toThrow()
    expect(loadCreationAttempt(s, scope, 'tag')).toBeNull()
  })
  it('店舗画面と同じタグ連動設定を含む作成依頼を保存する', () => {
    const s = storage()
    const item = { requestId: 'request-canonical-tag', distribute: false, input: { type: 'tag' as const, name: '来店', definition: { schemaVersion: 1 as const, tag: {
      name: '来店', color: '#3B82F6', description: null, folderId: null, isStarred: false, manualAssignmentAllowed: true,
      reapplyPolicy: 'first_only' as const, linkedEnabled: true, mileage: { self: 10, referrer: 0, multiplier: null, priority: 0 },
      actions: [{ id: 'message_1', type: 'send_message', params: { delayMinutes: 0, cancelIfTagRemoved: true, content: 'ご来店ありがとうございます' }, onFailure: 'stop' as const }],
    }, folders: [] } } }
    persistCreationAttempt(s, scope, 'tag', item)
    expect(loadCreationAttempt(s, scope, 'tag')).toEqual(item)
  })
  it('店舗画面と同じ回答フォームのレイアウトを含む作成依頼を保存する', () => {
    const s = storage(), layout = emptyLayout()
    layout.sections[0].blocks.push({ id: 'answer_1', kind: 'input', type: 'text', name: 'answer', label: '回答', required: true })
    const item = { requestId: 'request-canonical-form', distribute: false, input: { type: 'form' as const, name: 'アンケート', definition: { schemaVersion: 1 as const, form: {
      name: 'アンケート', description: null, fields: [{ name: 'answer', label: '回答', type: 'text' as const, required: true }], layout,
      on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true,
    } } } }
    persistCreationAttempt(s, scope, 'form', item)
    expect(loadCreationAttempt(s, scope, 'form')).toEqual(item)
  })
  it.each([
    ['template', { schemaVersion: 1, template: { id: 'template-main', name: 'お礼', category: 'general', messageType: 'text', messageContent: 'ありがとう', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' }, media: [] }],
    ['rich_menu', { schemaVersion: 1, richMenu: { id: 'rich-menu-main', name: 'メニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/menu.png', areas: [] }] } }],
    ['form', { schemaVersion: 1, form: { name: 'アンケート', description: null, fields: [{ name: 'answer', label: '回答', type: 'text', required: true }], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } }],
  ] as const)('%s の未確定依頼も種類ごとの保存領域へ復元する', (type, definition) => {
    const s = storage()
    const item = { requestId: `request-${type}`, distribute: false, input: { type, name: 'ひな形', definition } }
    persistCreationAttempt(s, scope, type, item)
    expect(loadCreationAttempt(s, scope, type)).toEqual(item)
    expect(loadCreationAttempt(s, scope, type === 'form' ? 'template' : 'form')).toBeNull()
  })
  it.each(['text', 'template'] as const)('%sタップのシナリオ参照を未確定依頼へ保存する', intent => {
    const s = storage()
    const area = intent === 'text'
      ? { id: 'area-1', bounds: { x: 0, y: 0, width: 2500, height: 1686 }, actionType: 'message' as const, actionData: { text: '案内を見る' }, intent, scenarioId: 'source-scenario' }
      : { id: 'area-1', bounds: { x: 0, y: 0, width: 2500, height: 1686 }, actionType: 'postback' as const, actionData: {}, intent, templateId: 'source-template', scenarioId: 'source-scenario' }
    const item = { requestId: `request-${intent}`, distribute: false, input: { type: 'rich_menu' as const, name: 'メニュー', definition: { schemaVersion: 1 as const, richMenu: { id: 'rich-menu-main', name: 'メニュー', chatBarText: 'メニュー', size: 'large' as const, defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/menu.png', areas: [area] }] } } } }
    persistCreationAttempt(s, scope, 'rich_menu', item)
    expect(loadCreationAttempt(s, scope, 'rich_menu')).toEqual(item)
  })
  it('URLタップや不正なIDのシナリオ参照は未確定依頼へ保存しない', () => {
    const s = storage()
    const definition = { schemaVersion: 1 as const, richMenu: { id: 'rich-menu-main', name: 'メニュー', chatBarText: 'メニュー', size: 'large' as const, defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/menu.png', areas: [{ id: 'area-1', bounds: { x: 0, y: 0, width: 2500, height: 1686 }, actionType: 'uri' as const, actionData: { uri: 'https://example.com' }, intent: 'url' as const, scenarioId: 'source-scenario' }] }] } }
    expect(() => persistCreationAttempt(s, scope, 'rich_menu', { requestId: 'request-url', distribute: false, input: { type: 'rich_menu', name: 'メニュー', definition } })).toThrow()
    const textDefinition = { ...definition, richMenu: { ...definition.richMenu, pages: [{ ...definition.richMenu.pages[0], areas: [{ ...definition.richMenu.pages[0].areas[0], intent: 'text' as const, actionType: 'message' as const, actionData: { text: '案内' }, scenarioId: 'invalid id' }] }] } }
    expect(() => persistCreationAttempt(s, scope, 'rich_menu', { requestId: 'request-invalid-id', distribute: false, input: { type: 'rich_menu', name: 'メニュー', definition: textDefinition } })).toThrow()
  })
  it('別scopeのコピー・破損・過大データを破棄して新規作成せず停止する', () => {
    const s = storage(); persistCreationAttempt(s, scope, 'tag', attempt)
    const key = creationStorageKey(scope, 'tag'), other = creationStorageKey({ ...scope, tenantId: 'tenant-b' }, 'tag')
    s.setItem(other, s.getItem(key)!)
    expect(() => loadCreationAttempt(s, { ...scope, tenantId: 'tenant-b' }, 'tag')).toThrow()
    for (const raw of ['{broken', 'x'.repeat(32_001)]) { s.setItem(key, raw); expect(() => loadCreationAttempt(s, scope, 'tag')).toThrow(); expect(s.getItem(key)).toBe(raw) }
  })
})
