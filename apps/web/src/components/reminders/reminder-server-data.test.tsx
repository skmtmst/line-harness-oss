import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReminderValidationResult } from '@line-crm/shared'
import { reminderAudienceCounts } from './reminder-publish-flow'

const FLOW = readFileSync(join(process.cwd(), 'src/components/reminders/reminder-publish-flow.tsx'), 'utf8')
const ISSUE_469 = readFileSync(join(process.cwd(), 'src/app/reminders/edit/issue469-reminder-screens.tsx'), 'utf8')
const LIST_PAGE = readFileSync(join(process.cwd(), 'src/app/reminders/page.tsx'), 'utf8')

describe('リマインダ公開フローの実データ表示', () => {
  it('TargetStage は validate 応答の対象人数を表示へ渡す', () => {
    const validation: ReminderValidationResult = {
      valid: true,
      checks: [],
      audience: { matched: 17, excluded: 3 },
    }
    expect(reminderAudienceCounts(validation)).toEqual({ matched: 17, excluded: 3, total: 20 })

    expect(FLOW).toContain("value={countLabel(audience.total, '人')}")
    expect(FLOW).toContain("value={countLabel(audience.matched, '人')}")
    expect(FLOW).toContain("value={countLabel(audience.excluded, '人')}")
    expect(FLOW).not.toContain('426人')
  })

  it('口にないテスト値は表示例と明記し、固定の履歴を出さない', () => {
    for (const source of [FLOW, ISSUE_469]) {
      expect(source).toContain('テストで使う値（表示例）')
      expect(source).not.toContain('8/23 01:30')
      expect(source).not.toContain('Kenta Kawano')
    }
  })

  it('一覧は共通のサーバー一覧とページ送りを使い、取得後に切り出さない', () => {
    expect(LIST_PAGE).toContain('useOffsetServerList')
    expect(LIST_PAGE).toContain("query.set('q', deferredNameQuery)")
    expect(LIST_PAGE).toContain('page={reminderList.page}')
    expect(LIST_PAGE).not.toContain('filtered.slice(')
  })
})
