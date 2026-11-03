// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'
import type { TagDependencies, TagDeleteImpactReferences } from '@/lib/api'

const net = vi.hoisted(() => ({ dependencies: vi.fn(), archive: vi.fn(), remove: vi.fn(), unexpectedFetch: vi.fn() }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async load => ({ ...await load<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async load => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, dependencies: net.dependencies, archive: net.archive, delete: net.remove } } }
})

import TagsList from './list'
import { flushListUrlState } from '@/components/shared/list-url-state'

const tag: Tag = { id: 'tag-1', name: '確認用タグ', color: '#000000', friendCount: 1, createdAt: '2026-01-01T00:00:00.000Z', status: 'active', version: 3, lineAccountId: 'account-a', mileageReward: 0, referralMileageReward: 0, mileageMultiplierBps: null }
const refs = Object.fromEntries(['broadcasts','forms','scenarios','autoReplies','savedSearches','automations','commonActions','richMenus','templates','webinars','reminders','entryRoutes','trackedLinks','bookingMenus','affiliateOffers','events','analyticsFunnels','friendAddSettings'].map(key => [key, 0])) as TagDeleteImpactReferences
function impact(values: Partial<TagDependencies['mileageImpact']> = {}, blocked?: 'affiliateOffers' | 'broadcasts'): TagDependencies {
  return { tag: { id: tag.id, name: tag.name, version: 3, status: 'active' }, friendCount: 1, referenceCounts: { ...refs, ...(blocked ? { [blocked]: 1 } : {}) }, references: [], linkedActions: [], pendingRunCount: 0, mileageImpact: { configured: false, self: 0, referrer: 0, multiplier: null, priority: 0, reapplyPolicy: 'first_only', historyPreserved: true, ...values }, blockingReferenceCount: blocked ? 1 : 0, canArchive: true, canDelete: !blocked, checkedAt: '2026-11-01T00:00:00.000Z', revision: 'revision-3' }
}
beforeEach(() => {
  window.history.replaceState(null, '', '/tags')
  flushListUrlState()
  net.dependencies.mockReset().mockResolvedValue({ success: true, data: impact() })
  net.archive.mockReset(); net.remove.mockReset(); net.unexpectedFetch.mockReset()
  vi.stubGlobal('fetch', net.unexpectedFetch.mockImplementation(() => { throw new Error('unexpected real fetch') }))
})
afterEach(() => {
  cleanup()
  expect(net.archive).not.toHaveBeenCalled()
  expect(net.remove).not.toHaveBeenCalled()
  expect(net.unexpectedFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
async function open(input: Tag = tag, phase = 'ready') {
  render(<TagsList accountId="account-a" fixture={{ items: [input], groups: [] }} />)
  const row = document.querySelector<HTMLElement>('tr[data-row-id="tag-1"]')!
  fireEvent.click(within(row).getByRole('button', { name: 'タグ「確認用タグ」の操作', exact: true }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '保管する', exact: true }))
  await waitFor(() => expect(document.querySelector('[data-qa-dialog="tag-delete"]')?.getAttribute('data-impact')).toBe(phase))
  expect(net.dependencies).toHaveBeenCalledExactlyOnceWith('tag-1', 'account-a')
  return document.querySelector('[data-qa-dialog="tag-delete"]')!.closest('[role="alertdialog"], [role="dialog"]') as HTMLElement
}
function verify(dialog: HTMLElement, mileage: boolean) {
  const rows = [...dialog.querySelectorAll('dl > div')]
  expect(rows.filter(row => row.querySelector('dt')?.textContent === '積んだマイル')).toHaveLength(mileage ? 1 : 0)
  if (mileage) expect(rows.find(row => row.querySelector('dt')?.textContent === '積んだマイル')?.textContent).toContain('そのまま残る取り消されません')
  expect(dialog.textContent).not.toMatch(/履歴(?:は|が)0|一度も付与/)
  expect((within(dialog).getByRole('button', { name: 'このタグを保管する' }) as HTMLButtonElement).disabled).toBe(true)
}

describe('実一覧から開くタグ保管窓のマイルと履歴案内', () => {
  it.each([
    ['連動なし', {}, {}, false],
    ['他アクションだけ', { otherActionCount: 1 }, {}, false],
    ['取得した本人マイルあり', {}, { configured: true, self: 10 }, true],
    ['取得した紹介者マイルあり', {}, { configured: true, referrer: 20 }, true],
    ['取得した1倍の設定あり', {}, { configured: true, multiplier: 10000 }, true],
    ['古い一覧の設定より取得したfalseを優先', { mileageReward: 10 }, {}, false],
  ] as const)('%sでは現在の根拠でマイル行を分け、履歴保持を1回だけ知らせる', async (_name, fields, values, mileage) => {
    net.dependencies.mockResolvedValue({ success: true, data: impact(values) })
    const dialog = await open({ ...tag, ...fields })
    verify(dialog, mileage)
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル', exact: true }))
    expect(document.querySelector('[data-qa-dialog="tag-delete"]')).toBeNull()
    expect(document.querySelector('tr[data-row-id="tag-1"]')).not.toBeNull()
  })

  it('過去付与の人工履歴があるが現在は連動offでも、履歴保持の説明を失わない', async () => {
    const retainedHistory = { priorAward: { amount: 10, operationKey: 'prior-award' }, currentImpact: impact() }
    net.dependencies.mockResolvedValue({ success: true, data: retainedHistory.currentImpact })
    expect(retainedHistory.priorAward.amount).toBeGreaterThan(0)
    expect(retainedHistory.currentImpact.mileageImpact).toMatchObject({ configured: false, historyPreserved: true })
    verify(await open(), false)
  })

  it.each([
    ['本人', { mileageReward: 10 }, true],
    ['紹介者', { referralMileageReward: 20 }, true],
    ['1倍', { mileageMultiplierBps: 10000 }, true],
    ['設定なし', {}, false],
  ] as const)('未取得は保存済みの%s設定だけを根拠にし、履歴案内と停止を保つ', async (_name, fields, mileage) => {
    net.dependencies.mockReturnValue(new Promise(() => {}))
    verify(await open({ ...tag, ...fields }, 'loading'), mileage)
  })

  it.each([[{}, false], [{ mileageReward: 10 }, true]] as const)('取得失敗でも履歴の説明を残し、既知設定だけでマイル行を決める %j', async (fields, mileage) => {
    net.dependencies.mockRejectedValue(new Error('fixture read failure'))
    const dialog = await open({ ...tag, ...fields }, 'error')
    verify(dialog, mileage)
    expect((within(dialog).getByPlaceholderText('確認用タグ') as HTMLInputElement).disabled).toBe(true)
  })

  it.each([
    ['affiliateOffers', 'アフィリエイトのオファーで使用中のタグは保管できません', '先にオファー側の設定からこのタグを外してください。'],
    ['broadcasts', '有効な参照があるタグは保管できません', '参照中の設定を確認してから操作してください。'],
  ] as const)('%sの停止理由と依頼文を保ち、履歴案内を重複しない', async (kind, reason, instruction) => {
    net.dependencies.mockResolvedValue({ success: true, data: impact({}, kind) })
    const dialog = await open()
    verify(dialog, false)
    expect(within(dialog).getByText(reason)).toBeTruthy()
    expect(dialog.textContent).toContain(instruction)
  })
})
