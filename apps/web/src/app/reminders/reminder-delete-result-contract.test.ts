import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/reminders/page.tsx'), 'utf8')

describe('V6 リマインダ削除の一部失敗', () => {
  it('全件を1件ずつ試し、成功と失敗を分ける', () => {
    expect(PAGE).toContain("Array<{ reminder: Reminder; succeeded: boolean }>")
    expect(PAGE).toContain('results.push({ reminder, succeeded: result.success })')
    expect(PAGE).toContain('results.push({ reminder, succeeded: false })')
    expect(PAGE).toContain('succeededIds')
    expect(PAGE).toContain('failedReminders')
  })

  it('成功分だけ選択から外し、失敗分は確認画面へ残す', () => {
    expect(PAGE).toContain('for (const id of succeededIds) next.delete(id)')
    expect(PAGE).toContain('setPendingDelete(failedReminders)')
    expect(PAGE).toContain('件を削除できませんでした。状態を読み直してから、もう一度お試しください。')
  })

  it('API内部文言を削除確認へ素通ししない', () => {
    expect(PAGE).not.toContain('caught instanceof Error ? caught.message')
    expect(PAGE).not.toContain('setDeleteError(result.error')
    expect(PAGE).not.toContain('API error:')
  })
})
