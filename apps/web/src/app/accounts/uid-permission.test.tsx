// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { deferred } from '@/test-utils/race'

const fixture = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), dryRun: vi.fn(), decide: vi.fn(), execute: vi.fn(), rollback: vi.fn(), me: vi.fn() }))
vi.mock('@/lib/api', async load => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: fixture.detail, api: { ...actual.api,
    staff: { ...actual.api.staff, me: fixture.me },
    lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [{ id: 'from', name: '移行元' }, { id: 'to', name: '移行先' }] }) },
    friendMigrations: { ...actual.api.friendMigrations, list: fixture.list, dryRun: fixture.dryRun, decide: fixture.decide, execute: fixture.execute, rollback: fixture.rollback },
  } }
})
const { useUidMigration: useLegacy } = await import('./use-uid-migration')
const { useUidMigration: useCurrent } = await import('@/v8/friends/migrations/use-uid-migration')
const item = { id: 'item', oldUid: 'OLD', newUid: 'NEW', evidenceType: 'operator_csv', classification: 'review', decision: 'pending', result: 'pending' } as const
const run = { id: 'run', createdBy: 'owner-1', fromAccountId: 'from', toAccountId: 'to', status: 'ready', counts: { total: 1, auto: 0, review: 1, unmatched: 0, conflict: 0, applied: 0, failed: 0 }, unresolved: 0, items: [item] }
const identity = (id = 'owner-2', role = 'owner', extra = {}) => ({ id, role, permissionKeys: [], ...extra } as unknown as StaffMember)
function mode(value: 'read' | 'write') {
  rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: value } as never })
}
const csv = 'old_uid,new_uid\nOLD,NEW\n'
const file = (text: () => Promise<string> = async () => csv, name = '対応表.csv') => ({ name, text } as File)
beforeEach(() => {
  vi.clearAllMocks()
  rememberStaffIdentity(identity())
  forgetSessionSnapshot()
  fixture.me.mockResolvedValue({ success: false, error: 'まだ確認できません' })
  fixture.list.mockResolvedValue({ success: true, data: [run] })
  fixture.detail.mockImplementation(async (path: string) => ({ success: true, data: { ...run, id: path.includes('/other?') ? 'other' : 'run' } }))
  for (const write of [fixture.dryRun, fixture.decide, fixture.execute, fixture.rollback]) write.mockResolvedValue({ success: false, error: '検査用の拒否' })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); vi.restoreAllMocks() })

for (const [entry, useMigration] of [['旧入口', useLegacy], ['友だち入口', useCurrent]] as const) {
  describe(entry, () => {
    it('移行先の初期値は未選択で、読み直しても勝手に決めない', async () => {
      const { result } = renderHook(() => useMigration())
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.toAccountId).toBe('')
      expect(result.current.dryRunBlockedReason).toMatch(/移行先/)
      await act(async () => { await result.current.load() })
      expect(result.current.toAccountId).toBe('')
      act(() => result.current.setToAccountId('to'))
      await act(async () => { await result.current.load() })
      expect(result.current.toAccountId).toBe('to')
    })

    it('CSVの選択と解析が済むまで直接呼ばれたテスト移行も送らない', async () => {
      const { result } = await mount()
      expect(result.current.dryRunBlockedReason).toMatch(/CSV/)
      await act(async () => { await result.current.createDryRun() })
      expect(fixture.dryRun).not.toHaveBeenCalled()
      const text = deferred<string>()
      let pending!: Promise<void>
      await act(async () => { pending = result.current.onUidFile([file(() => text.promise)]) })
      expect(result.current.dryRunBlockedReason).toMatch(/読み込んでいます/)
      await act(async () => { await result.current.createDryRun() })
      expect(fixture.dryRun).not.toHaveBeenCalled()
      await act(async () => { text.resolve(csv); await pending })
      expect(result.current.dryRunBlockedReason).toBeNull()
      await act(async () => { await result.current.createDryRun() })
      expect(fixture.dryRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fromAccountId: 'from', toAccountId: 'to', mappings: [{ oldUid: 'OLD', newUid: 'NEW', evidenceType: 'operator_csv' }] }))
    })

    async function mount() {
      const hook = renderHook(() => useMigration())
      await waitFor(() => expect(hook.result.current.status).toBe('ready'))
      // 対象選択の安全とは分け、権限と競合を試す操作は行き先を明示する。
      act(() => hook.result.current.setToAccountId('to'))
      return hook
    }
    it.each([
      ['閲覧のみ', identity('viewer', 'viewer')],
      ['担当者', identity('staff-1', 'staff')],
      ['owner/readOnly', identity('owner-2', 'owner', { readOnly: true })],
      ['owner/view_only', identity('owner-2', 'owner', { roleBundle: 'view_only' })],
    ])('%sは保持された全書込を拒み、履歴のGETは残す', async (_label, denied) => {
      const { result } = await mount()
      await act(async () => { await result.current.onUidFile([file()]) })
      const before = result.current
      act(() => rememberStaffIdentity(denied))
      await act(async () => { await before.createDryRun(); await before.decide(item, 'link'); await before.execute(); await before.rollback(); await result.current.load() })
      expect(fixture.dryRun).not.toHaveBeenCalled(); expect(fixture.decide).not.toHaveBeenCalled()
      expect(fixture.execute).not.toHaveBeenCalled(); expect(fixture.rollback).not.toHaveBeenCalled()
      expect(fixture.list.mock.calls.length).toBeGreaterThan(1)
      expect(fixture.detail.mock.calls.length).toBeGreaterThan(1)
    })

    it('read代理ownerも保持された書込を拒み、writeに戻して明示操作なら許可する', async () => {
      const { result } = await mount()
      await act(async () => { await result.current.onUidFile([file()]) })
      const retained = result.current
      act(() => mode('read'))
      await act(async () => { await retained.createDryRun(); await retained.decide(item, 'link'); await retained.execute(); await retained.rollback() })
      expect(fixture.dryRun).not.toHaveBeenCalled(); expect(fixture.decide).not.toHaveBeenCalled(); expect(fixture.execute).not.toHaveBeenCalled(); expect(fixture.rollback).not.toHaveBeenCalled()
      act(() => mode('write'))
      await act(async () => { await result.current.decide(item, 'link') })
      expect(fixture.decide).toHaveBeenCalledExactlyOnceWith('run', 'item', 'link')
    })

    it('管理者は判断と登録を保存でき、本移行と切り戻しはowner専用のまま', async () => {
      rememberStaffIdentity(identity('admin-1', 'admin'))
      const { result } = await mount()
      expect(result.current.canDecide).toBe(true)
      await act(async () => { await result.current.decide(item, 'link') })
      expect(fixture.decide).toHaveBeenCalledTimes(1)
      await act(async () => { await result.current.onUidFile([file()]) })
      await act(async () => { await result.current.createDryRun() })
      expect(fixture.dryRun).toHaveBeenCalledTimes(1)
      await act(async () => { await result.current.execute(); await result.current.rollback() })
      expect(fixture.execute).not.toHaveBeenCalled(); expect(fixture.rollback).not.toHaveBeenCalled()
    })

    it('本人未確定は理由無し・可否falseで、保持された書込も0', async () => {
      const { result } = await mount()
      await act(async () => { await result.current.onUidFile([file()]) })
      const retained = result.current
      act(() => forgetStaffIdentity())
      expect(result.current.me).toBeNull()
      expect(result.current.managerLockReason).toBeUndefined()
      expect(result.current.ownerLockReason).toBeUndefined()
      expect(result.current.canDecide).toBe(false)
      await act(async () => { await retained.createDryRun(); await retained.decide(item, 'link'); await retained.execute(); await retained.rollback() })
      expect(fixture.dryRun).not.toHaveBeenCalled(); expect(fixture.decide).not.toHaveBeenCalled(); expect(fixture.execute).not.toHaveBeenCalled(); expect(fixture.rollback).not.toHaveBeenCalled()
    })

    it('ownerの登録は1回。SHA計算の間のread→write往復では遅い登録を再開しない', async () => {
      const { result } = await mount()
      await act(async () => { await result.current.onUidFile([file()]) })
      const digest = deferred<ArrayBuffer>()
      vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(digest.promise)
      let pending!: Promise<void>
      await act(async () => { pending = result.current.createDryRun() })
      act(() => { mode('read'); mode('write') })
      await act(async () => { digest.resolve(new Uint8Array(32).buffer); await pending })
      expect(fixture.dryRun).not.toHaveBeenCalled()
      expect(result.current.message).toMatch(/権限.*中止/)
      await act(async () => { await result.current.createDryRun() })
      expect(fixture.dryRun).toHaveBeenCalledTimes(1)
    })

    it('CSV読込中の権限切替は対応表を反映せず、中止した理由を知らせる', async () => {
      const { result } = await mount()
      const text = deferred<string>()
      let pending!: Promise<void>
      await act(async () => { pending = result.current.onUidFile([file(() => text.promise)]) })
      act(() => { mode('read'); mode('write') })
      await act(async () => { text.resolve(csv); await pending })
      expect(result.current.mappings).toEqual([])
      expect(result.current.message).toMatch(/権限.*中止/)
      expect(fixture.dryRun).not.toHaveBeenCalled()
      await act(async () => { await result.current.onUidFile([file()]); })
      expect(result.current.mappings).toHaveLength(1)
    })

    it('CSVのA→B逆順でも名前・対応表はBだけを登録する', async () => {
      const { result } = await mount()
      const slow = deferred<string>()
      await act(async () => { void result.current.onUidFile([file(() => slow.promise, 'a.csv')]) })
      await act(async () => { await result.current.onUidFile([file(async () => 'old_uid,new_uid\nB1,B2\n', 'b.csv')]) })
      await act(async () => slow.resolve('old_uid,new_uid\nA1,A2\n'))
      expect(result.current.mappings).toEqual([{ oldUid: 'B1', newUid: 'B2', evidenceType: 'operator_csv' }])
      await act(async () => result.current.createDryRun())
      expect(fixture.dryRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sourceFilename: 'b.csv', mappings: [{ oldUid: 'B1', newUid: 'B2', evidenceType: 'operator_csv' }] }))
    })

    it('権限往復後のBが読めたら、遅いAの中止案内で新しい知らせを上書きしない', async () => {
      const { result } = await mount()
      const slow = deferred<string>()
      let pending!: Promise<void>
      await act(async () => { pending = result.current.onUidFile([file(() => slow.promise, 'a.csv')]) })
      act(() => { mode('read'); mode('write') })
      await act(async () => { await result.current.onUidFile([file(async () => 'old_uid,new_uid\nB1,B2\n', 'b.csv')]) })
      expect(result.current.message).toBeNull()
      await act(async () => { slow.resolve(csv); await pending })
      expect(result.current.file?.name).toBe('b.csv')
      expect(result.current.mappings).toEqual([{ oldUid: 'B1', newUid: 'B2', evidenceType: 'operator_csv' }])
      expect(result.current.message).toBeNull()
    })

    it('ownerでも作成者本人へ切替後は保持した本移行を拒む', async () => {
      const { result } = await mount()
      const execute = result.current.execute
      act(() => rememberStaffIdentity(identity('owner-1')))
      await act(async () => execute())
      expect(fixture.execute).not.toHaveBeenCalled()
    })

    it('別ownerの明示実行は1回、同じ瞬間の二重呼出しは増やさない', async () => {
      const { result } = await mount()
      const response = deferred<{ success: false; error: string }>()
      fixture.execute.mockReturnValueOnce(response.promise)
      let pending!: Promise<void>
      await act(async () => { const execute = result.current.execute; pending = execute(); await execute() })
      expect(fixture.execute).toHaveBeenCalledExactlyOnceWith('run')
      await act(async () => { response.resolve({ success: false, error: '検査用の拒否' }); await pending })
    })

    it('状態が準備中なら切り戻さず、完了なら本移行を再実行せず切り戻しだけ許可する', async () => {
      const { result } = await mount()
      await act(async () => { await result.current.rollback() })
      expect(fixture.rollback).not.toHaveBeenCalled()
      fixture.detail.mockResolvedValueOnce({ success: true, data: { ...run, status: 'completed', counts: { ...run.counts, applied: 1 } } })
      await act(async () => { await result.current.loadDetail('run', 0, '', false) })
      await act(async () => { await result.current.execute() })
      expect(fixture.execute).not.toHaveBeenCalled()
      await act(async () => { await result.current.rollback() })
      expect(fixture.rollback).toHaveBeenCalledExactlyOnceWith('run')
    })

    it.each(['completed', 'executing'] as const)('%sの履歴では判断を書き換えない', async status => {
      const { result } = await mount()
      fixture.detail.mockResolvedValueOnce({ success: true, data: { ...run, status } })
      await act(async () => { await result.current.loadDetail('run', 0, '', false) })
      await act(async () => { await result.current.decide(item, 'link') })
      expect(fixture.decide).not.toHaveBeenCalled()
    })

    it('一括判断は自分の再読取だけを引き継ぎ、2件を1回ずつ保存する', async () => {
      fixture.detail.mockResolvedValue({ success: true, data: { ...run, counts: { ...run.counts, total: 2, review: 2 }, items: [item, { ...item, id: 'item-2' }] } })
      const { result } = await mount()
      fixture.decide.mockResolvedValue({ success: true, data: { unresolved: 0 } })
      await act(async () => { await result.current.decideMany([item, { ...item, id: 'item-2' }], 'link') })
      expect(fixture.decide.mock.calls).toEqual([['run', 'item', 'link'], ['run', 'item-2', 'link']])
    })

    it('単発の古い判断は、自身の保存後でも自動で新しい世代を引き継がない', async () => {
      const { result } = await mount()
      fixture.decide.mockResolvedValue({ success: true, data: { unresolved: 0 } })
      const retained = result.current.decide
      await act(async () => { await retained(item, 'link') })
      await act(async () => { await retained({ ...item, id: 'item-2' }, 'link') })
      expect(fixture.decide).toHaveBeenCalledTimes(1)
    })

    it.each(['read', 'read-write'] as const)('一括判断の途中の%s切替で残りは保存せず、読取は続ける', async transition => {
      fixture.detail.mockResolvedValue({ success: true, data: { ...run, counts: { ...run.counts, total: 2, review: 2 }, items: [item, { ...item, id: 'item-2' }] } })
      const { result } = await mount()
      const reads = fixture.detail.mock.calls.length
      fixture.decide.mockImplementationOnce(async () => { mode('read'); if (transition === 'read-write') mode('write'); return { success: true, data: { unresolved: 0 } } })
      await act(async () => { await result.current.decideMany([item, { ...item, id: 'item-2' }], 'link') })
      expect(fixture.decide).toHaveBeenCalledTimes(1)
      expect(fixture.detail.mock.calls.length).toBeGreaterThan(reads)
      expect(result.current.message).toMatch(/権限.*中止/)
    })

    it.each(['run', 'filter'] as const)('一括判断のPATCH待ちに外部%sが変われば、前の画面へ戻さず残り0', async change => {
      const { result } = await mount()
      const response = deferred<{ success: true; data: { unresolved: number } }>()
      fixture.decide.mockReturnValueOnce(response.promise)
      let pending!: Promise<void>
      await act(async () => { pending = result.current.decideMany([item, { ...item, id: 'item-2' }], 'link') })
      if (change === 'run') await act(async () => { await result.current.loadDetail('other', 0, '', false) })
      else await act(async () => { result.current.onFilterChange('run', 'review', true) })
      const reads = fixture.detail.mock.calls.length
      await act(async () => { response.resolve({ success: true, data: { unresolved: 0 } }); await pending })
      expect(fixture.decide).toHaveBeenCalledTimes(1)
      expect(fixture.detail).toHaveBeenCalledTimes(reads)
      expect(result.current.message).toMatch(/1件目で止めました。理由：表示内容/)
      if (change === 'run') expect(result.current.active?.id).toBe('other')
      else { expect(result.current.classification).toBe('review'); expect(result.current.pendingOnly).toBe(true) }
    })

    it('一括判断の1件目が拒否されたら、残りを勝手に送らない', async () => {
      const { result } = await mount()
      await act(async () => { await result.current.decideMany([item, { ...item, id: 'item-2' }], 'link') })
      expect(fixture.decide).toHaveBeenCalledTimes(1)
      expect(result.current.message).toMatch(/1件目で止めました。理由：/)
    })

    it('別の履歴へ移ったら前の本移行callbackは使えない', async () => {
      const { result } = await mount()
      const execute = result.current.execute
      await act(async () => { await result.current.loadDetail('other', 0, '', false) })
      expect(result.current.active?.id).toBe('other')
      await act(async () => execute())
      expect(fixture.execute).not.toHaveBeenCalled()
    })
  })
}
