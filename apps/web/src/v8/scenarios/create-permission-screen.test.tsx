// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity, readStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'

const fixture = vi.hoisted(() => ({ search: 'id=sc-1', account: 'account-a', loading: false }))
const calls = vi.hoisted(() => ({ push: vi.fn(), update: vi.fn(), create: vi.fn(), folderCreate: vi.fn(), read: vi.fn(), draftGet: vi.fn(), draftSave: vi.fn(), draftDelete: vi.fn() }))
// Keep the real shared controls. Retained callbacks simulate an event already queued before identity changes.
const held = vi.hoisted(() => ({ save: undefined as undefined | (() => unknown), draft: undefined as undefined | (() => unknown), cancel: undefined as undefined | (() => unknown), draftClear: undefined as undefined | (() => unknown), folder: undefined as undefined | ((name: string, color: string | null) => Promise<unknown>) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.search), useRouter: () => ({ push: calls.push, replace: vi.fn(), back: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.account, loading: fixture.loading }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => readStaffIdentity()?.role ?? null }))
vi.mock('@/components/templates', async original => {
  const actual = await original<typeof import('@/components/templates')>()
  const text = (value: React.ReactNode): string => React.Children.toArray(value).map(item => React.isValidElement<{ children?: React.ReactNode }>(item) ? text(item.props.children) : String(item)).join('')
  const capture = (value: React.ReactNode): void => {
    React.Children.forEach(value, item => {
      if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => unknown }>(item)) return
      const label = text(item.props.children)
      if (item.props.onClick) {
        if (label.includes('この方式で保存する')) held.save = item.props.onClick
        if (label.includes('あとで決める')) held.draft = item.props.onClick
        if (label === 'キャンセル') held.cancel = item.props.onClick
      }
      capture(item.props.children)
    })
  }
  return { ...actual, CreatePage: (props: React.ComponentProps<typeof actual.CreatePage>) => {
    capture(props.footerActions)
    return <actual.CreatePage {...props} />
  } }
})
vi.mock('@/v8/autosave/public/use-scenario-draft/index', async original => {
  const actual = await original<typeof import('@/v8/autosave/public/use-scenario-draft/index')>()
  return { ...actual, useScenarioDraft: <T,>(options: Parameters<typeof actual.useScenarioDraft<T>>[0]) => {
    const draft = actual.useScenarioDraft(options)
    held.draftClear = draft.clear
    return draft
  } }
})
vi.mock('@/components/shared/folder-select', async original => {
  const { default: FolderSelect, ...rest } = await original<typeof import('@/components/shared/folder-select')>()
  return { ...rest, default: (props: React.ComponentProps<typeof FolderSelect>) => { held.folder = props.onCreate; return <FolderSelect {...props} /> } }
})
vi.mock('@/components/scenarios/scenario-reference-data', () => ({ scenarioReferenceData: { scenario: calls.read, invalidateScenario: vi.fn() } }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    scenarios: { ...actual.api.scenarios, update: calls.update, create: calls.create },
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [{ id: 'folder-a', name: '来店後の案内', color: null }, { id: 'folder-b', name: '更新前の案内', color: null }] }), create: calls.folderCreate },
    scenarioDrafts: { get: calls.draftGet, save: calls.draftSave, delete: calls.draftDelete },
  } }
})
import ScenarioCreateV8 from './create'
import { ApiError } from '@/lib/api'
const base = { id: 'sc-1', name: '春のフォロー', folderId: null, lineAccountId: 'account-a', deliveryMode: 'elapsed' }
const name = () => screen.getByRole('textbox', { name: 'シナリオ名' }) as HTMLInputElement
const save = () => screen.getByRole('button', { name: /この方式で保存する/ })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const proxy = () => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never })
const person = (role: 'owner' | 'admin' | 'staff' | 'viewer', extra: Partial<StaffMember> = {}) => {
  verifiedStaffRole(role)
  rememberStaffIdentity({ ...readStaffIdentity()!, ...extra })
}
const ready = async () => { const view = render(<ScenarioCreateV8 />); await screen.findByDisplayValue(base.name); return view }
const invoke = async (fn: (() => unknown) | undefined) => { expect(fn).toBeTypeOf('function'); await act(async () => { await fn!() }) }
beforeEach(() => {
  forgetSessionSnapshot(); person('owner')
  fixture.search = 'id=sc-1'; fixture.account = 'account-a'; fixture.loading = false
  Object.values(calls).forEach(mock => mock.mockReset())
  held.save = held.draft = held.folder = undefined
  calls.read.mockImplementation(async (id: string) => ({ success: true, data: { ...base, id } }))
  calls.update.mockImplementation(async (_id: string, patch: object) => ({ success: true, data: { ...base, ...patch } }))
  calls.create.mockResolvedValue({ success: true, data: { ...base, id: 'created-1' } })
  calls.folderCreate.mockResolvedValue({ success: true, data: { id: 'folder-new', name: '追加', color: '#008800' } })
  calls.draftGet.mockRejectedValue(new ApiError(404, 'not_found', 'not_found'))
  calls.draftSave.mockImplementation(async (account: string, key: string, body: { content: unknown }) => ({ success: true, data: { key, lineAccountId: account, content: body.content, version: 'v1', updatedAt: new Date().toISOString() } }))
  calls.draftDelete.mockResolvedValue({ success: true })
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })


it.each(['viewer', 'readOnly', 'view_only', 'proxy', 'staff'] as const)('%sでも同じ欄と保存操作を残し、灰色と理由1つで拒む。GETは読む', async kind => {
  if (kind === 'proxy') proxy()
  else if (kind === 'readOnly') person('owner', { readOnly: true })
  else if (kind === 'view_only') person('owner', { roleBundle: 'view_only' })
  else person(kind)
  await ready()
  const button = save()
  expect(button.hasAttribute('data-permission-locked')).toBe(true)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(button.tabIndex).toBe(0)
  fireEvent.focus(button)
  await waitFor(() => expect(screen.getAllByRole('tooltip')).toHaveLength(1))
  expect(screen.getByRole('tooltip').textContent).toBeTruthy()
  expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(name().disabled).toBe(true)
  const modes = screen.getAllByRole('radio') as HTMLInputElement[]
  expect(modes).toHaveLength(2)
  expect(modes.every(mode => mode.disabled)).toBe(true)
  expect(modes[1].checked).toBe(true)
  expect(screen.getAllByRole('img')).toHaveLength(2)
  const folder = screen.getByRole('button', { name: 'シナリオのフォルダ' })
  expect(folder.hasAttribute('data-permission-locked')).toBe(true)
  fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyDown(button, { key: ' ' })
  await invoke(held.save); await invoke(held.draft)
  for (const write of [calls.create, calls.update, calls.folderCreate, calls.draftSave, calls.draftDelete]) expect(write).not.toHaveBeenCalled()
  expect(calls.read).toHaveBeenCalledWith('sc-1')
  expect(calls.push).not.toHaveBeenCalled()
})

it('本人未確定では帯/権限印/拒否文を出さず、保存は普通disabledで0回。確定したownerは編集できる', async () => {
  forgetStaffIdentity()
  await ready()
  expect((save() as HTMLButtonElement).disabled).toBe(true)
  expect(name().disabled).toBe(true)
  expect(document.querySelectorAll('[data-read-only-notice],[data-permission-locked]')).toHaveLength(0)
  await invoke(held.save); await invoke(held.draft)
  expect(screen.queryByText(/本人や権限の確認状態が変わった/)).toBeNull()
  expect(calls.update).not.toHaveBeenCalled()
  act(() => person('owner'))
  expect((save() as HTMLButtonElement).disabled).toBe(false)
  expect(name().disabled).toBe(false)
  expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(0)
  fireEvent.click(save())
  await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1))
})

it('入力不足は権限ロックと分け、名前を入れると理由が消えて保存できる', async () => {
  fixture.search = ''
  render(<ScenarioCreateV8 />)
  expect((save() as HTMLButtonElement).disabled).toBe(true)
  expect(save().hasAttribute('data-permission-locked')).toBe(false)
  const footer = document.querySelector('[data-template-region="footer"]')!
  expect(within(footer as HTMLElement).getByRole('status').textContent).toBe('シナリオ名を入力してください')
  fireEvent.click(save())
  expect(calls.create).not.toHaveBeenCalled()
  fireEvent.change(name(), { target: { value: '新しい案内' } })
  expect((save() as HTMLButtonElement).disabled).toBe(false)
  expect(within(footer as HTMLElement).queryByText('シナリオ名を入力してください')).toBeNull()
  fireEvent.click(save())
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1))
})

it('編集staffは既存フォルダを選べるが、＋行だけ管理者理由で拒む', async () => {
  person('staff', { permissionKeys: ['/scenarios', 'scenario.definition.edit'] })
  await ready()
  await waitFor(() => expect((screen.getByRole('button', { name: 'シナリオのフォルダ' }) as HTMLButtonElement).disabled).toBe(false))
  expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'シナリオのフォルダ' }))
  fireEvent.click(screen.getByRole('button', { name: '更新前の案内' }))
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('sc-1', expect.objectContaining({ folderId: 'folder-b' })))
  fireEvent.click(screen.getByRole('button', { name: 'シナリオのフォルダ' }))
  const add = screen.getByRole('button', { name: '新しいフォルダを作る' })
  expect(add.getAttribute('aria-disabled')).toBe('true')
  expect(add.hasAttribute('data-permission-locked')).toBe(true)
  fireEvent.focus(add)
  await waitFor(() => expect(screen.getAllByRole('tooltip')).toHaveLength(1))
  expect(screen.getByRole('tooltip').textContent).toContain('オーナー')
  fireEvent.click(add)
  expect(document.querySelector('[data-select-menu-panel]')).toBeNull()
  expect(calls.folderCreate).not.toHaveBeenCalled()
})

it('開いていたフォルダ作成窓はrole変更後も残し、確定時に理由を出してAPI0', async () => {
  await ready()
  await waitFor(() => expect((screen.getByRole('button', { name: 'シナリオのフォルダ' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'シナリオのフォルダ' }))
  fireEvent.click(screen.getByRole('button', { name: '新しいフォルダを作る' }))
  const panel = document.querySelector('[data-select-menu-panel]')!
  expect(panel).toBeTruthy()
  const input = panel.querySelector('input')!
  fireEvent.change(input, { target: { value: '新しい分類' } })
  act(() => person('staff', { permissionKeys: ['/scenarios', 'scenario.definition.edit'] }))
  expect(document.querySelector('[data-select-menu-panel]')).toBeTruthy()
  const submit = within(panel as HTMLElement).getByRole('button', { name: /作/ })
  fireEvent.click(submit)
  await waitFor(() => expect(panel.textContent).toContain('フォルダの作成を中止しました'))
  expect((panel.querySelector('input') as HTMLInputElement).value).toBe('新しい分類')
  expect(calls.folderCreate).not.toHaveBeenCalled()
  expect(calls.update).not.toHaveBeenCalled()
})


it('account読込中のownerは権限の帯や印を出さず、普通disabledで保存と入力を止める', async () => {
  fixture.loading = true
  await ready()
  expect(name().disabled).toBe(true)
  expect((save() as HTMLButtonElement).disabled).toBe(true)
  expect(document.querySelectorAll('[data-read-only-notice],[data-permission-locked]')).toHaveLength(0)
  expect(screen.queryByText('シナリオ名を入力してください')).toBeNull()
  await invoke(held.save); await invoke(held.draft)
  expect(calls.update).not.toHaveBeenCalled()
  expect(calls.create).not.toHaveBeenCalled()
})
