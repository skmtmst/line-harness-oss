// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { deferred } from '@/test-utils/race'
import { pickEntity } from '@/components/shared/entity-picker-test-helpers'

const fixture = vi.hoisted(() => ({ runs: [] as object[], me: vi.fn(), write: vi.fn(), get: vi.fn(), download: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends/migrations' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/api', async load => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: fixture.get, api: { ...actual.api,
    staff: { ...actual.api.staff, me: fixture.me },
    lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [{ id: 'from', name: '移行元' }, { id: 'to', name: '移行先' }] }) },
    friendMigrations: { ...actual.api.friendMigrations, list: async () => ({ success: true, data: fixture.runs }), dryRun: fixture.write, decide: fixture.write, execute: fixture.write, rollback: fixture.write },
  } }
})
const { default: Legacy } = await import('./migration')
const { default: Current } = await import('@/v8/friends/migrations/uid')
const item = { id: 'item', oldUid: 'OLD', newUid: 'NEW', evidenceType: 'operator_csv', classification: 'review', decision: 'pending', result: 'pending' }
const run = { id: 'run', createdBy: 'owner-1', purpose: '確認用の移行', createdAt: '2026-10-29T00:00:00Z', fromAccountId: 'from', toAccountId: 'to', status: 'ready', counts: { total: 1, auto: 0, review: 1, unmatched: 0, conflict: 0, applied: 0, failed: 0 }, unresolved: 0, items: [item] }
const identity = (role: string, id = 'owner-2') => ({ id, role, permissionKeys: [] } as unknown as StaffMember)
const csvFile = () => Object.assign(new File(['old_uid,new_uid\nOLD,NEW\n'], '対応表.csv', { type: 'text/csv' }), { text: async () => 'old_uid,new_uid\nOLD,NEW\n' })
let pendingMe: ReturnType<typeof deferred<{ success: false; error: string }>>

beforeEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot(); vi.clearAllMocks()
  const BaseURL = URL
  vi.stubGlobal('URL', class extends BaseURL { static createObjectURL = () => 'blob:uid-fixture'; static revokeObjectURL = () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { fixture.download(this.download) })
  fixture.runs = []; pendingMe = deferred(); fixture.me.mockReturnValue(pendingMe.promise)
  fixture.get.mockResolvedValue({ success: true, data: run })
  fixture.write.mockResolvedValue({ success: false, error: '検査用の拒否' })
})
afterEach(async () => { cleanup(); pendingMe.resolve({ success: false, error: '確認終了' }); await Promise.resolve(); forgetStaffIdentity(); forgetSessionSnapshot(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

for (const [entry, Page] of [['旧入口', Legacy], ['友だち入口', () => <Current initialRunId={null} />]] as const) {
  describe(entry, () => {
    async function prepareValidRegistration() {
      await pickEntity('移行先アカウント', '移行先')
      await act(async () => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [csvFile()] } }))
      await screen.findByRole('button', { name: '「対応表.csv」を外す' })
    }
    it.each(['viewer', 'staff', 'read-proxy'] as const)('%sも同じ入力と灰色の登録を保ち、書込0・帯1', async role => {
      rememberStaffIdentity(identity(role === 'read-proxy' ? 'owner' : role))
      if (role === 'read-proxy') rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never })
      const { container } = render(<Page />)
      await screen.findByRole('button', { name: 'テスト移行を実行' })
      for (const name of ['移行元アカウント', '移行先アカウント', 'CSVをアップロード', 'テスト移行を実行']) {
        const control = screen.getByRole('button', { name }) as HTMLButtonElement
        expect(control.disabled).toBe(false)
        expect(control.getAttribute('aria-disabled')).toBe('true')
        expect(control.hasAttribute('data-permission-locked')).toBe(true)
        fireEvent.click(control)
      }
      const purpose = screen.getByDisplayValue('友だち情報と配信停止状態を新しいアカウントへ引き継ぐ') as HTMLInputElement
      expect(purpose.disabled).toBe(true)
      const purposeGroup = screen.getByRole('group', { name: '利用目的' })
      fireEvent.focus(purposeGroup)
      expect(screen.getByRole('tooltip').textContent).toBe(document.getElementById(purpose.getAttribute('aria-describedby')!)?.textContent)
      fireEvent.blur(purposeGroup)
      expect(container.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [csvFile()] } })
      expect(screen.queryByRole('button', { name: '「対応表.csv」を外す' })).toBeNull()
      expect(fixture.write).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'CSVのひな形をダウンロード' }))
      expect(fixture.download).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/UID対応表のひな形.*\.csv$/))
      expect(fixture.write).not.toHaveBeenCalled()
    })

    if (entry === '友だち入口') it('正規ownerの一括判断は2件とも1回ずつ保存する', async () => {
      rememberStaffIdentity(identity('owner'))
      const second = { ...item, id: 'item-2', oldUid: 'OLD-2', newUid: 'NEW-2' }
      const batch = { ...run, status: 'review', unresolved: 2, counts: { ...run.counts, total: 2, review: 2 }, items: [item, second] }
      fixture.runs = [batch]; fixture.get.mockResolvedValue({ success: true, data: batch })
      fixture.write.mockResolvedValue({ success: true, data: { unresolved: 0 } })
      render(<Page />)
      fireEvent.click(await screen.findByRole('button', { name: '要確認をまとめて「結び付ける」' }))
      fireEvent.click(await screen.findByRole('button', { name: '結び付ける' }))
      await waitFor(() => expect(fixture.write).toHaveBeenCalledTimes(2))
      expect(fixture.write.mock.calls).toEqual([['run', 'item', 'link'], ['run', 'item-2', 'link']])
    })

    it('一覧がreadyでも本人未取得なら帯と権限印0、登録と入力は普通disabledで書込0', async () => {
      const { container } = render(<Page />)
      const create = await screen.findByRole('button', { name: 'テスト移行を実行' }) as HTMLButtonElement
      expect(create.disabled).toBe(true)
      expect(container.querySelectorAll('[data-read-only-notice]')).toHaveLength(0)
      expect(container.querySelectorAll('[data-permission-locked]')).toHaveLength(0)
      expect((screen.getByRole('button', { name: '移行元アカウント' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(create)
      expect(fixture.write).not.toHaveBeenCalled()
      act(() => rememberStaffIdentity(identity('owner')))
      await waitFor(() => expect((screen.getByRole('button', { name: '移行先アカウント' }) as HTMLButtonElement).disabled).toBe(false))
      await prepareValidRegistration()
      await waitFor(() => expect(create.disabled).toBe(false))
      expect(container.querySelectorAll('[data-read-only-notice]')).toHaveLength(0)
    })

    it('ownerが選んだCSVの×もread代理への切替で理由付きになり、ファイルを消さず読取を保つ', async () => {
      rememberStaffIdentity(identity('owner'))
      const { container } = render(<Page />)
      await screen.findByRole('button', { name: 'テスト移行を実行' })
      await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [csvFile()] } }))
      const remove = screen.getByRole('button', { name: '「対応表.csv」を外す' }) as HTMLButtonElement
      act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never }))
      expect(remove.disabled).toBe(false)
      expect(remove.getAttribute('aria-disabled')).toBe('true')
      fireEvent.focus(remove)
      expect(screen.getByRole('tooltip').textContent).toMatch(/代理ログイン/)
      fireEvent.click(remove)
      expect(screen.getByRole('button', { name: '「対応表.csv」を外す' })).toBe(remove)
      expect(fixture.write).not.toHaveBeenCalled()
      act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'write' } as never }))
      fireEvent.click(remove)
      expect(screen.queryByRole('button', { name: '「対応表.csv」を外す' })).toBeNull()
    })

    it('adminは登録と判断の欄を使え、owner専用の本移行は理由付きで拒む', async () => {
      rememberStaffIdentity(identity('admin')); fixture.runs = [run]
      render(<Page />)
      const execute = await screen.findByRole('button', { name: '本移行へ進む' }) as HTMLButtonElement
      expect(execute.disabled).toBe(false)
      expect(execute.getAttribute('aria-disabled')).toBe('true')
      const explanation = document.getElementById(execute.getAttribute('aria-describedby')!)?.textContent
      expect(explanation).toMatch(/オーナー/)
      if (entry === '友だち入口') {
        const bulk = screen.getByRole('button', { name: '要確認をまとめて「結び付ける」' })
        expect(bulk.hasAttribute('data-permission-locked')).toBe(false)
        const create = screen.getByRole('button', { name: '新しい移行を作る' })
        expect(create.hasAttribute('data-permission-locked')).toBe(false)
        fireEvent.click(create)
      }
      await prepareValidRegistration()
      for (const name of ['移行元アカウント', '移行先アカウント', 'CSVをアップロード', 'テスト移行を実行', 'OLD の引き継ぎ方']) {
        const control = screen.getByRole('button', { name }) as HTMLButtonElement
        expect(control.disabled).toBe(false)
        expect(control.hasAttribute('data-permission-locked')).toBe(false)
      }
      const choice = screen.getByRole('button', { name: 'OLD の引き継ぎ方' })
      fireEvent.click(choice)
      fireEvent.click(within(await screen.findByRole('option', { name: '結び付ける' })).getByRole('button'))
      await waitFor(() => expect(fixture.write).toHaveBeenCalledExactlyOnceWith('run', 'item', 'link'))
    })

    it.each(['completed', 'failed'] as const)('adminの%sでは結果・履歴・帯の切り戻しをすべて灰色で拒む', async status => {
      rememberStaffIdentity(identity('admin'))
      const completed = { ...run, status, rollbackable: true, counts: { ...run.counts, applied: 1 } }
      fixture.runs = [completed]; fixture.get.mockResolvedValue({ success: true, data: completed })
      render(<Page />)
      await waitFor(() => expect(screen.getAllByRole('button', { name: /^(この移行を)?切り戻す$/ }).length).toBe(entry === '旧入口' ? 2 : 1))
      for (const button of screen.getAllByRole('button', { name: /^(この移行を)?切り戻す$/ })) {
        expect((button as HTMLButtonElement).disabled).toBe(false)
        expect(button.getAttribute('aria-disabled')).toBe('true')
        fireEvent.focus(button)
        expect(screen.getByRole('tooltip').textContent).toMatch(/オーナー/)
        fireEvent.blur(button)
        fireEvent.click(button)
      }
      expect(fixture.write).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('作成者本人は権限ロックにせず状態理由を示し、確認も本移行も起動しない', async () => {
      rememberStaffIdentity(identity('owner', 'owner-1')); fixture.runs = [run]
      render(<Page />)
      const execute = await screen.findByRole('button', { name: '本移行へ進む' }) as HTMLButtonElement
      expect(execute.disabled).toBe(true)
      expect(execute.hasAttribute('data-permission-locked')).toBe(false)
      expect(screen.getAllByRole('status').some(note => note.textContent?.includes('別のowner'))).toBe(true)
      fireEvent.click(execute)
      expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull()
      expect(fixture.write).not.toHaveBeenCalled()
    })

    it.each(['execute', 'rollback'] as const)('開いた%s確認はread代理でも残り、確定0・writeへ戻して明示確定1', async action => {
      rememberStaffIdentity(identity('owner'))
      const state = action === 'rollback' ? { ...run, status: 'completed', rollbackable: true, counts: { ...run.counts, applied: 1 } } : run
      fixture.runs = [state]; fixture.get.mockResolvedValue({ success: true, data: state })
      render(<Page />)
      const openerName = action === 'execute' ? '本移行へ進む' : entry === '旧入口' ? 'この移行を切り戻す' : '切り戻す'
      fireEvent.click(await screen.findByRole('button', { name: openerName }))
      let dialog!: HTMLElement
      await waitFor(() => { dialog = document.querySelector('[role="dialog"],[role="alertdialog"]') as HTMLElement; expect(dialog).toBeTruthy() })
      const confirm = within(dialog).getByRole('button', { name: action === 'execute' ? '本移行を実行' : '切り戻す' })
      act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never }))
      expect(dialog.isConnected).toBe(true)
      expect(confirm.getAttribute('aria-disabled')).toBe('true')
      expect(within(dialog).queryByText(/^(本移行の実行|切り戻し)はownerの権限が必要です。$/)).toBeNull()
      fireEvent.click(confirm); expect(fixture.write).not.toHaveBeenCalled()
      act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'write' } as never }))
      await act(async () => fireEvent.click(confirm))
      await waitFor(() => expect(fixture.write).toHaveBeenCalledTimes(1))
    })

    if (entry === '友だち入口') it('一括・新規の入口と開いた一括確認もread代理で理由付き拒否し、窓は残る', async () => {
      rememberStaffIdentity(identity('owner')); fixture.runs = [run]
      render(<Page />)
      fireEvent.click(await screen.findByRole('button', { name: '要確認をまとめて「結び付ける」' }))
      const dialog = document.querySelector('[role="dialog"],[role="alertdialog"]') as HTMLElement
      const confirm = within(dialog).getByRole('button', { name: '結び付ける' })
      act(() => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never }))
      expect(dialog.isConnected).toBe(true)
      expect(confirm.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(confirm)
      for (const label of ['要確認をまとめて「結び付ける」', '新しい移行を作る']) {
        const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!
        expect(button.getAttribute('aria-disabled')).toBe('true')
        expect(button.disabled).toBe(false)
      }
      expect(fixture.write).not.toHaveBeenCalled()
    })

    it('閲覧のみでも対応表の選択欄と本移行の入口を灰色で保ち、詳細は保存せず読める', async () => {
      rememberStaffIdentity(identity('viewer')); fixture.runs = [run]
      render(<Page />)
      const execute = await screen.findByRole('button', { name: '本移行へ進む' })
      const choice = screen.getByRole('button', { name: 'OLD の引き継ぎ方' })
      expect(choice.getAttribute('aria-disabled')).toBe('true')
      expect(execute.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(execute); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull()
      const detail = entry === '旧入口' ? screen.getByRole('button', { name: '詳細' }) : screen.getByRole('button', { name: 'OLD' })
      fireEvent.click(detail)
      await screen.findByRole('button', { name: 'この組合せを承認' })
      for (const name of ['この組合せを承認', '除外する']) {
        const control = screen.getByRole('button', { name }) as HTMLButtonElement
        expect(control.disabled).toBe(false)
        expect(control.getAttribute('aria-disabled')).toBe('true')
        fireEvent.focus(control)
        expect(screen.getByRole('tooltip').textContent).toMatch(/閲覧/)
        fireEvent.click(control)
        fireEvent.blur(control)
      }
      expect(fixture.write).not.toHaveBeenCalled()
      expect(fixture.get).toHaveBeenCalled()
    })
  })
}
