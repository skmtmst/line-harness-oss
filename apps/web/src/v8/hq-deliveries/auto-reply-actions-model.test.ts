import { expect, it } from 'vitest'
import { replaceHqAutoReplyActions } from './auto-reply-actions-model'
import type { HqDeliveryTemplateDefinition } from '@line-crm/shared'

it('removes only unused action declarations, preserves condition/template/unknown action references and settings', () => {
 const unknown = { actionType: 'notify_staff', config: { notificationRuleId: 'notice', notificationRuleVersion: 7 }, onFailure: 'continue' }
 const definition: HqDeliveryTemplateDefinition = { schemaVersion: 1, settings: { name: '案内', priority: 42, templateId: 'template', friendConditions: [{ condition: JSON.stringify({ type: 'tag_exists', value: 'shared' }) }], actions: [{ actionType: 'tag', config: { tagIds: ['old', 'shared'] } }, unknown] }, references: [{ sourceId: 'old', kind: 'tag', name: '旧' }, { sourceId: 'shared', kind: 'tag', name: '共用' }, { sourceId: 'template', kind: 'template', name: '本文' }, { sourceId: 'notice', kind: 'notification_rule', name: '担当者' }] }
 const resource = { kind: 'scenario' as const, id: 'scenario', name: '初回', accountId: 'a1', accountName: '本店' }
 const next = replaceHqAutoReplyActions(definition, [unknown, { actionType: 'scenario', config: { op: 'start', scenarioId: 'scenario' } }], [resource, resource, { ...resource, id: 'unused' }])
 expect(next.settings).toMatchObject({ priority: 42, templateId: 'template', friendConditions: definition.settings.friendConditions })
 expect((next.settings.actions as unknown[])[0]).toBe(unknown)
 expect(next.references?.map(ref => ref.sourceId)).toEqual(['shared', 'template', 'notice', 'scenario'])
 expect(next.references?.at(-1)).toEqual({ sourceId: 'scenario', kind: 'scenario', name: '初回', accountId: 'a1' })
 expect(definition.references).toHaveLength(4)
})
