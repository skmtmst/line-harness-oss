import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js'
import { inspectTags, parseTagDefinition, planTags, tagSnapshot } from './tag.js'

let fixture: SqliteD1

beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true })
  fixture.raw.exec("INSERT INTO tenants(id,name) VALUES ('tenant','統括'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('account','店舗','channel','fixture','fixture','tenant')")
})
afterEach(() => fixture.raw.close())

async function commit(definition: ReturnType<typeof parseTagDefinition>, mode: 'create' | 'overwrite' = 'create') {
  const snapshot = await tagSnapshot(fixture.db, 'account')
  const item = inspectTags(definition, snapshot).find(row => row.sourceId === 'tag')!
  const plan = planTags({
    accountId: 'account', actorId: 'owner', definition, snapshot,
    resolutions: [{ sourceId: 'tag', itemKind: 'tag', mode, targetId: item.targetId ?? undefined, expectedRevision: item.expectedRevision ?? undefined }],
  })
  await fixture.db.batch(plan.statements.map(statement => fixture.db.prepare(statement.sql).bind(...statement.bindings)))
  return plan.resolutions.find(row => row.sourceId === 'tag')!.targetId!
}

describe('HQ portable tag definition', () => {
  test('all canonical tag settings and portable actions are stored atomically', async () => {
    const definition = parseTagDefinition({ schemaVersion: 1, folders: [], tag: {
      name: 'VIP', color: '#123456', description: '重要顧客', folderId: null,
      isStarred: true, manualAssignmentAllowed: false, reapplyPolicy: 'every_time', linkedEnabled: true,
      mileage: { self: 20, referrer: 10, multiplier: 15000, priority: 3 },
      actions: [
        { id: 'message', type: 'send_message', params: { content: 'ありがとうございます', delayMinutes: 0, cancelIfTagRemoved: true }, onFailure: 'stop' },
        { id: 'miles', type: 'grant_mileage', params: { amount: 50, delayMinutes: 60 }, onFailure: 'continue' },
      ],
    } })
    const id = await commit(definition)
    expect(fixture.raw.prepare('SELECT name,color,description,is_starred,manual_assignment_allowed,reapply_policy,linked_enabled,mileage_reward,referral_mileage_reward,mileage_multiplier_bps,mileage_multiplier_priority FROM tags WHERE id=?').get(id)).toEqual({
      name: 'VIP', color: '#123456', description: '重要顧客', is_starred: 1, manual_assignment_allowed: 0,
      reapply_policy: 'every_time', linked_enabled: 1, mileage_reward: 20, referral_mileage_reward: 10,
      mileage_multiplier_bps: 15000, mileage_multiplier_priority: 3,
    })
    const stored = fixture.raw.prepare("SELECT v.action_config FROM common_action_bindings b JOIN common_action_versions v ON v.id=b.common_action_version_id WHERE b.consumer_id=? AND b.consumer_path='tag.added'").get(id) as { action_config: string }
    expect(JSON.parse(stored.action_config)).toEqual(definition.tag.actions)
    expect(fixture.raw.pragma('foreign_key_check')).toEqual([])
  })

  test('an explicit empty action list clears the active binding without deleting history', async () => {
    const original = parseTagDefinition({ schemaVersion: 1, folders: [], tag: { name: 'VIP', actions: [{ id: 'message', type: 'send_message', params: { content: 'old' }, onFailure: 'stop' }] } })
    const id = await commit(original)
    const replacement = parseTagDefinition({ schemaVersion: 1, folders: [], tag: { name: 'VIP', linkedEnabled: false, actions: [] } })
    await commit(replacement, 'overwrite')
    const rows = fixture.raw.prepare('SELECT action_config FROM common_action_versions WHERE common_action_id=(SELECT common_action_id FROM common_action_bindings WHERE consumer_id=?) ORDER BY version_number').all(id) as Array<{ action_config: string }>
    expect(rows.map(row => JSON.parse(row.action_config))).toEqual([original.tag.actions, []])
    expect(fixture.raw.prepare('SELECT linked_enabled FROM tags WHERE id=?').get(id)).toEqual({ linked_enabled: 0 })
  })

  test('account-bound action references stop before planning', () => {
    for (const action of [
      { id: 'template', type: 'send_message', params: { templateId: 'source-template' }, onFailure: 'stop' },
      { id: 'tag', type: 'add_tag', params: { tagId: 'source-tag' }, onFailure: 'stop' },
    ]) expect(() => parseTagDefinition({ schemaVersion: 1, folders: [], tag: { name: 'unsafe', actions: [action] } })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_REFERENCE' }))
  })
})
