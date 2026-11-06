import { beforeEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ distribute: vi.fn(), result: vi.fn() }))
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: calls }))
import { distributeFolder, folderResultRows, type FolderRun } from './folder-distribution'
import type { DistributionResult } from '@/lib/hq-templates-api'
const task = (id: string): FolderRun => ({ template: { id, name: id, template_type: 'template', revision: 1, description: null, updated_at: '' }, accountIds: ['a', 'b'],
  preflight: { preflightId: `run-${id}`, expiresAt: new Date(Date.now() + 60000).toISOString(), stores: ['a', 'b'].map((accountId) => ({ accountId, accountName: accountId, items: [] })) }, resolutions: [] })
const result = (id: string, failed = false): DistributionResult => ({ runId: `run-${id}`, status: failed ? 'partial' : 'completed', stores: ['a', 'b'].map((accountId) => ({ accountId, status: accountId === 'b' && failed ? 'failed' : 'succeeded', counts: { created: 1, overwritten: 0, aliased: 0 } })) })
beforeEach(() => vi.resetAllMocks())
describe('フォルダの配布は成功を保ち、結果不明を再送しない', () => {
  it('送信前の記録に失敗したらPOSTせず、未配布として保つ', async () => {
    const runs = [task('t1')]
    await expect(distributeFolder(runs, () => { throw new Error('storage full') })).rejects.toThrow('storage full')
    expect(calls.distribute).not.toHaveBeenCalled(); expect(runs[0].runId).toBeUndefined()
  })
  it('先頭の応答が確定するまで次をPOSTしない。番号はPOST前に記録する', async () => {
    const runs = [task('t1'), task('t2')]
    let resolve!: (value: DistributionResult) => void
    calls.distribute.mockImplementationOnce(() => new Promise<DistributionResult>((done) => { resolve = done })).mockResolvedValueOnce(result('t2'))
    const update = vi.fn()
    const pending = distributeFolder(runs, update)
    expect(update.mock.calls[0][0][0].runId).toBe('run-t1')
    expect(calls.distribute).toHaveBeenCalledTimes(1)
    resolve(result('t1')); await pending
    expect(calls.distribute.mock.calls.map((call) => call[0])).toEqual(['t1', 't2'])
  })
  it('POST応答が消えたらGETで復元し、再POSTしない', async () => {
    calls.distribute.mockRejectedValue(new Error('offline')); calls.result.mockResolvedValue(result('t1'))
    const runs = [task('t1')]
    await distributeFolder(runs, () => {}); await distributeFolder(runs, () => {})
    expect(calls.distribute).toHaveBeenCalledTimes(1); expect(calls.result).toHaveBeenCalledWith('t1', 'run-t1')
  })
  it('GETも失敗した行は未確定のまま。再確認はGETだけ、後ろの未配布分は待つ', async () => {
    const runs = [task('t1'), task('t2')]
    calls.distribute.mockRejectedValueOnce(new Error('offline')); calls.result.mockRejectedValueOnce(new Error('offline'))
    await expect(distributeFolder(runs, () => {})).rejects.toThrow('offline')
    expect(runs[0].runId).toBe('run-t1'); expect(runs[1].runId).toBeUndefined()
    calls.result.mockResolvedValue(result('t1')); calls.distribute.mockResolvedValue(result('t2'))
    await distributeFolder(runs, () => {})
    expect(calls.distribute.mock.calls.map((call) => call[0])).toEqual(['t1', 't2'])
  })
  it('runningが返ったら止まり、次の確認で完了してから後続を実行', async () => {
    calls.distribute.mockResolvedValueOnce({ ...result('t1'), status: 'running', stores: result('t1').stores.map((store) => ({ ...store, status: 'pending' })) })
    const runs = [task('t1'), task('t2')]
    await distributeFolder(runs, () => {}); expect(calls.distribute).toHaveBeenCalledTimes(1)
    calls.result.mockResolvedValue(result('t1')); calls.distribute.mockResolvedValue(result('t2'))
    await distributeFolder(runs, () => {}); expect(calls.distribute).toHaveBeenCalledTimes(2)
  })
  it('有効期限切れはPOSTせず、成功した先頭を保つ', async () => {
    const runs = [task('t1'), task('t2')]; runs[1].preflight!.expiresAt = '2000-01-01'
    calls.distribute.mockResolvedValue(result('t1'))
    await expect(distributeFolder(runs, () => {})).rejects.toThrow('有効期限')
    expect(runs[0].result?.status).toBe('completed'); expect(calls.distribute).toHaveBeenCalledTimes(1)
  })
  it('配布番号・アカウント集合の食い違いは成功として扱わない', async () => {
    calls.distribute.mockResolvedValue({ ...result('t1'), runId: 'wrong' }); calls.result.mockResolvedValue({ ...result('t1'), stores: [result('t1').stores[0]] })
    await expect(distributeFolder([task('t1')], () => {})).rejects.toThrow('一致しません')
  })
  it('失敗アカウントだけの再試行結果を重ね、ほかの成功は保つ', () => {
    const first = { ...task('t1'), runId: 'run-t1', result: result('t1', true) }
    const retry = { ...task('t1'), accountIds: ['b'], result: { ...result('t1'), stores: [result('t1').stores[1]] } }
    const rows = folderResultRows([first, retry])
    expect(rows.map((row) => [row.accountId, row.store?.status])).toEqual([['a', 'succeeded'], ['b', 'succeeded']])
  })
})
