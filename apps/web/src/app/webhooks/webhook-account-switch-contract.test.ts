import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
const read = (name: string) => readFileSync(new URL(`../../v8/webhooks/${name}.tsx`, import.meta.url), 'utf8')
const shell = read('shell')
const pages = [read('incoming'), read('outgoing')]
describe('現役Webhook画面のLINEアカウント境界', () => {
  test('取得結果はアカウントと世代が同じ時だけ反映する', () => {
    expect(shell).toContain('const generation = ++generationRef.current')
    expect(shell).toContain('generationRef.current !== generation || accountRef.current !== accountId')
  })
  test('一覧の取得元と現在のアカウントが違う操作は拒む', () => {
    for (const src of pages) { expect(src).toContain('loadedAccountId !== accountId'); expect(src).toContain('LINEアカウントの一覧を読み直してください') }
  })
  test('切替後は古い書き込みの結果や秘密値を表示しない', () => {
    for (const src of pages) { expect(src).toContain('if (accountRef.current !== accountId) return'); expect(src).toContain('setDeleteTarget(null)'); expect(src).toContain('setRotateTarget(null)'); expect(src).toContain('accountScopeRef.current === scope') }
  })
  test('更新失敗は状態を戻し、削除失敗で窓を閉じない', () => {
    for (const src of pages) { expect(src).toContain('状態は変わっていません'); expect(src).toContain('if (!res.success)'); expect(src).toContain('if (!res.success) throw new Error(res.error)'); expect(src).toContain('setDeleteError('); expect(src).toContain('setOptimisticActive(') }
  })
})
