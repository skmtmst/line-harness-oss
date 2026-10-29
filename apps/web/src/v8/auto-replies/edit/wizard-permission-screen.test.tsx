// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DELIVERY_FEATURE_POLICIES, deliveryPermissionKey } from '@line-crm/shared'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { getPageAction } from '@/test-utils/page-action'
const net = vi.hoisted(() => ({
  query: 'id=synthetic-rule&step=priority',
  patch: undefined as undefined | ((part: Partial<import('./wizard-model').WizardForm>) => void), getDraft: vi.fn(), me: vi.fn(), validateDraft: vi.fn(), list: vi.fn(), conflicts: vi.fn(), saveDraft: vi.fn(),
  testDraft: vi.fn(), publishDraft: vi.fn(), friends: vi.fn(), liveStatus: 'draft', wide: false,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: (url: string) => { net.query = url.split('?')[1] }, push: vi.fn() }), useSearchParams: () => new URLSearchParams(net.query) }))
vi.mock('./wizard-basic-step', async importOriginal => {
  const actual = await importOriginal<typeof import('./wizard-basic-step')>()
  return { ...actual, WizardBasicStep: (props: React.ComponentProps<typeof actual.WizardBasicStep>) => {
    net.patch = props.patch
    return <actual.WizardBasicStep {...props} />
  } }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'synthetic-account', accounts: [{ id: 'synthetic-account' }] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false, status: 'ready' }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => !net.wide }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ default: () => null, useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      staff: { me: net.me },
      autoReplies: {
        getDraft: net.getDraft,
        get: async () => ({ success: true, data: { isActive: net.liveStatus === 'published', lifecycleStatus: net.liveStatus } }),
        list: net.list, conflicts: net.conflicts, validateDraft: net.validateDraft, saveDraft: net.saveDraft,
        testDraft: net.testDraft, publishDraft: net.publishDraft,
      },
      templates: { list: async () => ({ success: true, data: [] }) },
      folders: { list: async () => ({ success: true, data: [] }) },
      friends: { list: net.friends },
    },
  }
})

const SETTINGS = {
  keyword: '予約', matchType: 'contains', responseType: 'text', responseContent: '承りました', templateId: null,
  lineAccountId: 'synthetic-account', activeFrom: null, activeUntil: null, cooldownMinutes: null, skipWhenOperatorActive: false,
  priority: 5, messageKinds: null, receiveSources: ['line'], friendConditions: null, actions: null, responseWeekdays: null,
  responseHolidayRule: null, oncePerFriend: false, keywords: null, respondToAll: false, name: '予約の受付',
  keywordMatchMode: 'any', folderId: null, internalMemo: null, replyDelaySeconds: null, unmatchedAction: null,
}
const draft = (settings: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    autoReplyId: 'synthetic-rule', versionId: 'v1', versionNumber: 1, status: 'draft', settings: { ...SETTINGS, ...settings },
    lastTestStatus: null, lastTestedAt: null, publishedAt: null, matchedLast28Days: null,
  },
})
const otherRule = {
  id: 'rule-top', name: '先に動くルール', isActive: true, lifecycleStatus: 'published', priority: 1,
  createdAt: '2026-09-01T00:00:00.000Z', keyword: '予約', activeFrom: null, activeUntil: null,
}


import Page from './wizard'
const proxy = (mode: 'read' | 'write') => ({ impersonation: { id: 'proxy', tenantId: 'tenant', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' as const })
const restrict = (kind: string) => {
  if (kind === 'read-proxy') rememberSessionSnapshot(proxy('read'))
  else rememberStaffIdentity({ ...readStaffIdentity()!, role: 'staff', permissionKeys: [], permissionViewKeys: [DELIVERY_FEATURE_POLICIES.autoReplies.key], ...(kind === 'readOnly' ? { readOnly: true } : kind === 'view_only' ? { roleBundle: 'view_only' as const } : {}) })
}
beforeEach(() => {
  verifiedStaffRole('owner'); forgetSessionSnapshot(); vi.clearAllMocks()
  net.query = 'id=synthetic-rule&step=basic'; net.liveStatus = 'published'; net.wide = true
  net.me.mockImplementation(() => new Promise(() => {}))
  net.getDraft.mockResolvedValue(draft({ internalMemo: '保存したメモ', cooldownMinutes: 60 }))
  net.validateDraft.mockResolvedValue({ success: true, data: { errors: [], warnings: [], conflicts: [] } })
  net.list.mockResolvedValue({ success: true, data: [otherRule] })
  net.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
  net.saveDraft.mockResolvedValue({ ...draft(), data: { ...draft().data, versionNumber: 2 } })
  net.friends.mockResolvedValue({ success: true, data: { items: [{ id: 'friend-1', displayName: '試す友だち' }], total: 1 } })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })
const mount = async (step = 'basic') => { net.query = `id=synthetic-rule&step=${step}`; const view = render(<Page />); await act(async () => {}); return view }
const move = async (view: ReturnType<typeof render>, step: string) => { net.query = `id=synthetic-rule&step=${step}`; view.rerender(<Page />); await act(async () => {}) }
const noWrites = () => { expect(net.saveDraft).not.toHaveBeenCalled(); expect(net.publishDraft).not.toHaveBeenCalled(); expect(net.testDraft).not.toHaveBeenCalled() }

it.each(['readOnly', 'view_only', 'staff-no-key', 'read-proxy'])('%sは保存済みの同じ入力・型・選択を読めて、変更だけを止める', async kind => {
  restrict(kind)
  const view = await mount()
  expect(screen.queryByText('自動応答の作成・変更はできません')).toBeNull()
  const name = screen.getByLabelText(/ルール名/) as HTMLInputElement
  expect(name.value).toBe('予約の受付'); expect(name.disabled).toBe(true)
  expect((screen.getByLabelText('社内メモ') as HTMLInputElement).value).toBe('保存したメモ')
  expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(getPageAction({ name: '下書きとして保存' }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(getPageAction({ name: '下書きとして保存' })); noWrites()
  await move(view, 'trigger')
  expect((screen.getByRole('textbox', { name: '反応する言葉を足す' }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('radio', { name: /言葉で反応する/ }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('button', { name: '完全一致' }) as HTMLButtonElement).disabled).toBe(true)
  await move(view, 'response')
  const content = screen.getByRole('textbox', { name: '返す文' }) as HTMLTextAreaElement
  expect(content.value).toBe('承りました'); expect(content.getAttribute('aria-disabled')).toBe('true'); expect(content.getAttribute('contenteditable')).toBe('false')
  expect((screen.getByRole('spinbutton', { name: 'あける時間（分）' }) as HTMLInputElement).value).toBe('60')
  expect((screen.getByRole('switch', { name: '同じ人へ続けて返さない' }) as HTMLButtonElement).disabled).toBe(true)
  const insert = screen.getByRole('button', { name: '名前', exact: true })
  expect(insert.getAttribute('aria-disabled')).toBe('true'); fireEvent.click(insert)
  expect(content.value).toBe('承りました')
  expect(screen.getByRole('button', { name: '行うことを足す' }).getAttribute('aria-disabled')).toBe('true')
  noWrites()
})

it('本人未確認は帯も権限理由も出さず、同じ保存と入力を普通のdisabledにする', async () => {
  forgetStaffIdentity()
  const view = await mount()
  expect(document.querySelector('[data-read-only-notice]')).toBeNull()
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
  expect((screen.getByLabelText(/ルール名/) as HTMLInputElement).disabled).toBe(true)
  const save = getPageAction({ name: '下書きとして保存' }) as HTMLButtonElement
  expect(save.disabled).toBe(true); fireEvent.click(save); noWrites()
  await act(async () => { verifiedStaffRole('owner') })
  expect((screen.getByLabelText(/ルール名/) as HTMLInputElement).disabled).toBe(false)
  fireEvent.change(screen.getByLabelText(/ルール名/), { target: { value: '許可確定後の名前' } })
  await act(async () => { fireEvent.click(getPageAction({ name: '下書きとして保存' })) })
  expect(net.saveDraft).toHaveBeenCalledTimes(1)
  expect(net.saveDraft.mock.lastCall?.[1].name).toBe('許可確定後の名前')
  expect(view.container.querySelector('[data-read-only-notice]')).toBeNull()
})

it.each(['readOnly', 'view_only', 'staff-no-key', 'read-proxy', 'unknown'])('%sでは言葉の削除を止め、許可が確定した後だけ手元の下書きから外せる', async kind => {
  if (kind === 'unknown') forgetStaffIdentity()
  else restrict(kind)
  await mount('trigger')
  const remove = screen.getByRole('button', { name: '「予約」を外す' }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  fireEvent.click(remove)
  expect(screen.getByRole('button', { name: '「予約」を外す' })).toBe(remove)
  noWrites()
  if (kind === 'unknown') {
    expect(document.querySelector('[data-read-only-notice]')).toBeNull()
    expect(document.querySelector('[data-permission-locked]')).toBeNull()
  }
  await act(async () => { verifiedStaffRole('owner'); rememberSessionSnapshot(proxy('write')) })
  expect(remove.disabled).toBe(false)
  fireEvent.click(remove)
  expect(screen.queryByRole('button', { name: '「予約」を外す' })).toBeNull()
  noWrites()
})

it('見る人は順番と友だち検索を読めて、確認の未取得を0件や重なりなしにしない', async () => {
  restrict('readOnly')
  const view = await mount('priority')
  expect(net.list).toHaveBeenCalled(); expect(net.friends).toHaveBeenCalled()
  expect(screen.getAllByText('先に動くルール').length).toBeGreaterThan(0)
  expect(screen.getAllByText('権限のため確認結果を表示できません。設定の閲覧はできます。')).toHaveLength(1)
  expect(screen.queryByText('重なりなし')).toBeNull()
  expect(screen.queryByText('同時に当たるルールはありません。')).toBeNull()
  expect(screen.getByRole('button', { name: '上へ', exact: true }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.change(screen.getByRole('searchbox', { name: '友だちを名前で探す' }), { target: { value: '検索' } })
  await waitFor(() => expect(net.friends).toHaveBeenLastCalledWith(expect.objectContaining({ search: '検索' })))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /次へ/ })) })
  view.rerender(<Page />); await act(async () => {})
  expect(net.query).toContain('step=confirm')
  expect(screen.getAllByText('権限のため確認結果を表示できません。設定の閲覧はできます。')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: '設定の確認' })).toBeTruthy()
  expect(net.conflicts).not.toHaveBeenCalled(); expect(net.validateDraft).not.toHaveBeenCalled(); noWrites()
})

it('許可を戻しても、切替前に始まった確認結果を新しい結果へ混ぜない', async () => {
  let resolve!: (value: unknown) => void
  net.validateDraft.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await mount('confirm')
  expect(net.validateDraft).toHaveBeenCalledTimes(1)
  await act(async () => { rememberSessionSnapshot(proxy('read')) })
  expect(screen.getByText('権限のため確認結果を表示できません。設定の閲覧はできます。')).toBeTruthy()
  await act(async () => { rememberSessionSnapshot(proxy('write')) })
  expect(net.validateDraft).toHaveBeenCalledTimes(2)
  await act(async () => { resolve({ success: true, data: { errors: ['古い切替前の結果'], warnings: [], conflicts: [] } }) })
  expect(screen.queryByText('古い切替前の結果')).toBeNull()
  expect(document.body.textContent).toContain('重なる自動応答はありません')
})

it('初期の新規作成を閲覧の代理ログインで開始せず、保存済みの閲覧と区別する', async () => {
  rememberSessionSnapshot(proxy('read')); net.query = ''
  render(<Page />); await act(async () => {})
  expect(screen.queryByLabelText(/ルール名/)).toBeNull()
  expect(screen.getByText(/ここでは作れません/)).toBeTruthy()
  noWrites()
})

it.each(['priority', 'confirm'])('本人確認中の%sでは確認不可を権限拒否と決めつけない', async step => {
  forgetStaffIdentity(); await mount(step)
  expect(document.querySelector('[data-read-only-notice]')).toBeNull()
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
  expect(screen.queryByText('権限のため確認結果を表示できません。設定の閲覧はできます。')).toBeNull()
  expect(net.conflicts).not.toHaveBeenCalled(); expect(net.validateDraft).not.toHaveBeenCalled(); noWrites()
})

it('試し送り中にreadへ切替えて戻しても、切替前の遅い結果を採用しない', async () => {
  let resolve!: (value: unknown) => void
  net.testDraft.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await mount('priority')
  fireEvent.change(screen.getByRole('textbox', { name: '届いたメッセージ' }), { target: { value: '試す' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '試す', exact: true })) })
  expect(net.testDraft).toHaveBeenCalledTimes(1)
  await act(async () => { rememberSessionSnapshot(proxy('read')) })
  await act(async () => { rememberSessionSnapshot(proxy('write')) })
  await act(async () => { resolve({ success: true, data: { draftWon: false, winner: { autoReplyId: 'other', name: '切替前の古い勝者' }, candidates: [], staleTest: false } }) })
  expect(screen.queryByText(/切替前の古い勝者/)).toBeNull()
  expect(screen.getByText('試した結果：まだ試していません')).toBeTruthy()
})

it('入力部品が保持した変更口も、閲覧へ切替わった後は値を変えず、許可が戻れば変えられる', async () => {
  await mount()
  const heldPatch = net.patch!
  await act(async () => { rememberSessionSnapshot(proxy('read')); heldPatch({ ruleName: '拒否中の変更' }) })
  expect((screen.getByLabelText(/ルール名/) as HTMLInputElement).value).toBe('予約の受付')
  noWrites()
  await act(async () => { rememberSessionSnapshot(proxy('write')); heldPatch({ ruleName: '許可された変更' }) })
  expect((screen.getByLabelText(/ルール名/) as HTMLInputElement).value).toBe('許可された変更')
})
