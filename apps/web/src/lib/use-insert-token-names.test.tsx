// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const load = vi.hoisted(() => vi.fn())
vi.mock('./template-references', async importOriginal => ({ ...await importOriginal<typeof import('./template-references')>(), loadTemplateReferences: load }))
import { useInsertTokenNames } from './use-insert-token-names'

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('選んだアカウントの実名だけを出し、遅れた以前の答えは戻さない', async () => {
  const pending: Record<string, (value: unknown) => void> = {}
  load.mockImplementation((id: string) => new Promise(resolve => { pending[id] = resolve }))
  const { result, rerender } = renderHook(({ id }: { id: string | null }) => useInsertTokenNames(id), { initialProps: { id: 'account-a' as string | null } })
  rerender({ id: 'account-b' })
  expect(result.current).toEqual({ fields: {}, vars: {} })
  await act(async () => { pending['account-a']({ friendFields: [], commonVars: [{ varKey: 'business_hours', name: '前の店の営業時間' }] }) })
  expect(result.current).toEqual({ fields: {}, vars: {} })
  await act(async () => { pending['account-b']({ friendFields: [{ fieldKey: 'pet_name', name: 'ペットの名前' }], commonVars: [{ varKey: 'business_hours', name: '営業時間' }] }) })
  expect(result.current).toEqual({ fields: { pet_name: 'ペットの名前' }, vars: { business_hours: '営業時間' } })
  rerender({ id: null })
  expect(result.current).toEqual({ fields: {}, vars: {} })
  expect(load.mock.calls.map(call => call[0])).toEqual(['account-a', 'account-b'])
})

it('読み込めない時は古い名前を使わず、表示側の名称未確認の口へ戻す', async () => {
  load.mockResolvedValueOnce({ friendFields: [], commonVars: [{ varKey: 'business_hours', name: '前の店の営業時間' }] }).mockRejectedValueOnce(new Error('読込失敗'))
  const { result, rerender } = renderHook(({ id }) => useInsertTokenNames(id), { initialProps: { id: 'account-a' } })
  await act(async () => { await Promise.resolve() })
  expect(result.current.vars).toEqual({ business_hours: '前の店の営業時間' })
  rerender({ id: 'account-b' })
  expect(result.current).toEqual({ fields: {}, vars: {} })
  await act(async () => { await Promise.resolve() })
  expect(result.current).toEqual({ fields: {}, vars: {} })
})

it('統括など所属が無い表示では、店の差し込み名を要求しない', () => {
  const { result } = renderHook(() => useInsertTokenNames(null))
  expect(result.current).toEqual({ fields: {}, vars: {} })
  expect(load).not.toHaveBeenCalled()
})

it('所属を解除して同じアカウントへ戻っても、取り直す前の名前を再表示しない', async () => {
  load.mockResolvedValueOnce({ friendFields: [], commonVars: [{ varKey: 'hours', name: '以前の営業時間' }] }).mockImplementationOnce(() => new Promise(() => {}))
  const { result, rerender } = renderHook(({ id }: { id: string | null }) => useInsertTokenNames(id), { initialProps: { id: 'account-a' as string | null } })
  await act(async () => { await Promise.resolve() })
  expect(result.current.vars).toEqual({ hours: '以前の営業時間' })
  rerender({ id: null })
  rerender({ id: 'account-a' })
  expect(result.current).toEqual({ fields: {}, vars: {} })
})
