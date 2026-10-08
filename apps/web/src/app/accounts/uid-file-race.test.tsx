// @vitest-environment happy-dom
/*
 * 監査 WEB316：対応表CSVを A→B と選び直したとき、遅い A の読み取りで
 * B の対応表を置き換えない。テスト移行は B の名前・中身・対応表をそろえて送る。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred, stubFetchNotFound } from '@/test-utils/race'

const fixture = vi.hoisted(() => ({ dryRun: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, friendMigrations: { ...actual.api.friendMigrations, dryRun: fixture.dryRun } } }
})

const { useUidMigration } = await import('./use-uid-migration')

beforeEach(() => {
  stubFetchNotFound()
  fixture.dryRun.mockReset()
  fixture.dryRun.mockResolvedValue({ success: false, error: 'stop' })
})
afterEach(() => vi.unstubAllGlobals())

function slowFile(name: string, text: Promise<string>): File {
  return { name, text: () => text } as unknown as File
}
function quickFile(name: string, body: string): File {
  return { name, text: () => Promise.resolve(body) } as unknown as File
}

describe('対応表CSVの選び直し（WEB316）', () => {
  it('A の読み取りが B の後に終わっても、対応表は B のまま', async () => {
    const { result } = renderHook(() => useUidMigration())
    const slowA = deferred<string>()
    const fileB = quickFile('b.csv', 'old_uid,new_uid\nUB1,UB2\n')
    await act(async () => { void result.current.onUidFile([slowFile('a.csv', slowA.promise)]) })
    await act(async () => { await result.current.onUidFile([fileB]) })
    await act(async () => { slowA.resolve('old_uid,new_uid\nUA1,UA2\nUA3,UA4\n') })
    expect(result.current.mappings).toEqual([{ oldUid: 'UB1', newUid: 'UB2', evidenceType: 'operator_csv' }])

    act(() => {
      result.current.setFromAccountId('acc-a')
      result.current.setToAccountId('acc-b')
    })
    await act(async () => { await result.current.createDryRun() })
    expect(fixture.dryRun).toHaveBeenCalledWith(expect.objectContaining({
      sourceFilename: 'b.csv',
      mappings: [{ oldUid: 'UB1', newUid: 'UB2', evidenceType: 'operator_csv' }],
    }))
  })
})
