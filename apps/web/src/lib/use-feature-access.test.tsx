// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const me = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { staff: { me } }, SESSION_LOST_EVENT: 'lh-session-lost' }))
import { useFeatureAccess } from './use-feature-access'
import { useStaffRole, useTenantWideAccess } from './staff-role'
import { canEditFeature } from './staff-capability'
import { forgetStaffIdentity } from './staff-identity-state'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const stored = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
  clear: () => { stored.clear() },
} })
let root: Root
let host: HTMLDivElement
function Probe() {
  const role = useStaffRole()
  const values = {
    role, forms: useFeatureAccess('forms'), formsView: useFeatureAccess('forms', 'view'), scenarios: useFeatureAccess('scenarios'),
    test: useFeatureAccess('broadcasts', 'test'), varsCsv: useFeatureAccess('commonVars', 'export'),
    webinarCsv: useFeatureAccess('webinars', 'export'), hq: useTenantWideAccess(),
    conversionCsv: canEditFeature('/conversions', role) && canEditFeature('conversion.report.export', role),
    friend: canEditFeature('/friends', role),
  }
  return <pre>{JSON.stringify(values)}</pre>
}
const values = () => JSON.parse(host.textContent!)
async function render() {
  await act(async () => { root.render(<Probe />); await Promise.resolve() })
}
function answer(data: Partial<StaffMember>) { return { success: true, data } }
beforeEach(() => {
  forgetStaffIdentity()
  me.mockReset()
  window.localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); forgetStaffIdentity() })

describe('本人APIの役割・鍵を使う画面の権限', () => {
  it('保存値がownerでも確認中は隠し、1回の本人確認を全フックで共有する', async () => {
    let resolve!: (data: unknown) => void
    me.mockImplementation(() => new Promise(r => { resolve = r }))
    window.localStorage.setItem('lh_staff_role', 'owner')
    await render()
    expect(values()).toMatchObject({ role: null, forms: false, test: false, hq: false })
    expect(me).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(answer({ role: 'staff', permissionKeys: ['/form-submissions', '/scenarios', 'scenario.definition.edit'] })) })
    expect(values()).toMatchObject({ role: 'staff', forms: true, scenarios: true, test: false, hq: false })
  })
  it('古い保存鍵で昇格せず、サーバーの編集鍵とテスト鍵を別に見る', async () => {
    window.localStorage.setItem('lh_staff_permissions', JSON.stringify(['/friends', 'broadcast.test.send']))
    me.mockResolvedValue(answer({ role: 'staff', permissionKeys: ['/broadcasts', 'broadcast.definition.edit'] }))
    await render()
    expect(values()).toMatchObject({ forms: false, friend: false, test: false })
  })
  it('テスト送信と成果CSVはそれぞれの操作鍵があるスタッフだけに出す', async () => {
    me.mockResolvedValue(answer({ role: 'staff', permissionKeys: ['/broadcasts', 'broadcast.test.send', '/conversions', 'conversion.report.export'] }))
    await render()
    expect(values()).toMatchObject({ test: true, conversionCsv: true, varsCsv: false, webinarCsv: false })
  })
  it('閲覧鍵だけではフォームを編集できず、成果のCSV鍵も作らない', async () => {
    me.mockResolvedValue(answer({ role: 'staff', permissionKeys: [], permissionViewKeys: ['/form-submissions', '/conversions'] }))
    await render()
    expect(values()).toMatchObject({ forms: false, conversionCsv: false })
  })
  it('スタッフの保存鍵に管理者という文字があっても管理者限定CSVは出さない', async () => {
    me.mockResolvedValue(answer({ role: 'staff', permissionKeys: ['/contents/vars', '/webinars', 'administrator'] }))
    await render()
    expect(values()).toMatchObject({ varsCsv: false, webinarCsv: false })
  })
  it.each([
    [{ role: 'admin', accountScope: 'accounts' }, false, true],
    [{ role: 'admin', accountScope: 'all' }, true, true],
    [{ role: 'admin', accountScope: 'all', readOnly: true }, false, false],
    [{ role: 'owner', roleBundle: 'view_only' }, false, false],
  ])('範囲と閲覧専用を判定する: %j', async (data, hq, forms) => {
    me.mockResolvedValue(answer(data as Partial<StaffMember>))
    await render()
    expect(values()).toMatchObject({ hq, forms, varsCsv: forms, webinarCsv: forms })
  })
  it('閲覧専用の管理者は見る操作を保ち、変更・送信・CSVは隠す', async () => {
    me.mockResolvedValue(answer({ role: 'admin', readOnly: true }))
    await render()
    expect(values()).toMatchObject({ formsView: true, forms: false, test: false, varsCsv: false, webinarCsv: false, conversionCsv: false })
  })
  it('閲覧専用のスタッフは本人APIの閲覧鍵の範囲だけを見られる', async () => {
    me.mockResolvedValue(answer({ role: 'staff', readOnly: true, permissionViewKeys: ['/form-submissions'] }))
    await render()
    expect(values()).toMatchObject({ formsView: true, forms: false, scenarios: false, test: false, varsCsv: false })
  })
  it('本人確認の失敗時は保存値へ戻らない', async () => {
    window.localStorage.setItem('lh_staff_role', 'owner')
    me.mockRejectedValue(new Error('offline'))
    await render()
    expect(values()).toMatchObject({ role: null, forms: false, hq: false })
  })
  it('セッション失効後は確認済み操作を隠す', async () => {
    me.mockResolvedValue(answer({ role: 'owner' }))
    await render()
    expect(values().forms).toBe(true)
    act(() => { window.dispatchEvent(new Event('lh-session-lost')) })
    expect(values()).toMatchObject({ role: null, forms: false, test: false, hq: false })
  })
  it('失効前の遅い本人確認は権限を復活させない', async () => {
    let resolve!: (data: unknown) => void
    me.mockImplementation(() => new Promise(r => { resolve = r }))
    await render()
    act(() => { window.dispatchEvent(new Event('lh-session-lost')) })
    await act(async () => { resolve(answer({ role: 'owner' })) })
    expect(values()).toMatchObject({ role: null, forms: false, hq: false })
  })
})
