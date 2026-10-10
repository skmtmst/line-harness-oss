import { describe, expect, it } from 'vitest'
import { BUNDLE_PRESETS, DELIVERY_FEATURE_POLICIES, effectiveStaffEditKeys, hasDeliveryAccess, scopeLevelsToKeys, type DeliveryFeature } from './staff-permissions'

describe('束とAPIの操作判定', () => {
  const keys = scopeLevelsToKeys(BUNDLE_PRESETS.operations.levels).edit
  it.each(Object.keys(DELIVERY_FEATURE_POLICIES) as DeliveryFeature[])('%s は配信を変えられる束で変更できる', feature => {
    expect(hasDeliveryAccess({ role: 'staff', permissionKeys: keys }, feature, 'edit')).toBe(true)
    expect(hasDeliveryAccess({ role: 'staff', permissionKeys: [], viewPermissionKeys: keys }, feature, 'edit')).toBe(false)
    expect(hasDeliveryAccess({ role: 'admin', readOnly: true }, feature, 'edit')).toBe(false)
  })
  it('テスト送信は編集と別の鍵。一斉配信の編集だけでは送れない', () => {
    const subject = { role: 'staff', permissionKeys: ['/broadcasts', 'broadcast.definition.edit'] }
    expect(hasDeliveryAccess(subject, 'broadcasts', 'edit')).toBe(true)
    expect(hasDeliveryAccess(subject, 'broadcasts', 'test')).toBe(false)
    expect(hasDeliveryAccess({ ...subject, permissionKeys: [...subject.permissionKeys, 'broadcast.test.send'] }, 'broadcasts', 'test')).toBe(true)
  })
  it('既存の完全な配信束だけを展開し、個別の閲覧鍵は昇格させない', () => {
    const legacy = Object.values(DELIVERY_FEATURE_POLICIES).map(p => p.key)
    expect(effectiveStaffEditKeys(legacy)).toContain('scenario.definition.edit')
    expect(effectiveStaffEditKeys(['/scenarios'])).toEqual(['/scenarios'])
  })
  it('共通情報・参加者のCSVは役割の門を残す', () => {
    expect(hasDeliveryAccess({ role: 'staff', permissionKeys: keys }, 'commonVars', 'export')).toBe(false)
    expect(hasDeliveryAccess({ role: 'staff', permissionKeys: keys }, 'webinars', 'export')).toBe(false)
    expect(hasDeliveryAccess({ role: 'admin' }, 'webinars', 'export')).toBe(true)
    expect(hasDeliveryAccess({ role: 'admin', readOnly: true }, 'webinars', 'export')).toBe(false)
    expect(hasDeliveryAccess({ role: 'staff', permissionKeys: [], viewPermissionKeys: ['/broadcasts'] }, 'broadcasts', 'export')).toBe(false)
  })
  it('確認中はどの操作も隠す', () => {
    expect(hasDeliveryAccess(null, 'forms', 'edit')).toBe(false)
    expect(hasDeliveryAccess({ role: null, permissionKeys: keys }, 'broadcasts', 'test')).toBe(false)
  })
})
