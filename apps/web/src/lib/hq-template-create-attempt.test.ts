import { describe, expect, it } from 'vitest'
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
  it('別scopeのコピー・破損・過大データを破棄して新規作成せず停止する', () => {
    const s = storage(); persistCreationAttempt(s, scope, 'tag', attempt)
    const key = creationStorageKey(scope, 'tag'), other = creationStorageKey({ ...scope, tenantId: 'tenant-b' }, 'tag')
    s.setItem(other, s.getItem(key)!)
    expect(() => loadCreationAttempt(s, { ...scope, tenantId: 'tenant-b' }, 'tag')).toThrow()
    for (const raw of ['{broken', 'x'.repeat(32_001)]) { s.setItem(key, raw); expect(() => loadCreationAttempt(s, scope, 'tag')).toThrow(); expect(s.getItem(key)).toBe(raw) }
  })
})
