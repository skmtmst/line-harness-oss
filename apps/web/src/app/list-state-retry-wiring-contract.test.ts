import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

const TARGETS = [
  'affiliates/tabs.tsx',
  'booking/menus/page.tsx',
  'form-submissions/page.tsx',
  'friend-add-settings/publish/page.tsx',
  'friends/page.tsx',
  'mileage/action-score-tab.tsx',
  'mileage/page.tsx',
  'nen-members/page.tsx',
  'rich-menus/connections/page.tsx',
  'scenarios/page.tsx',
  'scenarios/results/page.tsx',
  'tags/marks/edit/page.tsx',
  '../components/broadcasts/segment-preset-controls.tsx',
  '../components/friend-fields/field-list.tsx',
  '../components/friend-fields/mark-list.tsx',
  '../components/friend-fields/tags-page-v4.tsx',
  '../components/friends/bulk-run-dialog.tsx',
  '../components/line-notifications/operator-notification-rules.tsx',
  '../components/merged-person/merged-person-detail.tsx',
  '../components/users/users-table.tsx',
] as const

function listStateErrors(source: string) {
  return [...source.matchAll(/<ListState\b[\s\S]*?\/>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('kind="error"'))
}

describe('一覧の取得失敗からその場で読み直せる契約', () => {
  it('対象画面の取得失敗には、共通の再読み込み口を渡す', () => {
    let errorCount = 0

    for (const target of TARGETS) {
      const source = readFileSync(join(HERE, target), 'utf8')
      const errors = listStateErrors(source)
      errorCount += errors.length

      for (const errorState of errors) {
        expect(errorState, `${target} の取得失敗`).toContain('onRetry=')
        expect(errorState, `${target} に古い個別ボタンが残っています`).not.toContain('action=')
      }
    }

    expect(errorCount).toBe(22)
  })

  it('URLだけでは対象を特定できない状態に、直らない再読み込みを出さない', () => {
    const markEdit = readFileSync(join(HERE, 'tags/marks/edit/page.tsx'), 'utf8')
    const connections = readFileSync(join(HERE, 'rich-menus/connections/page.tsx'), 'utf8')

    expect(markEdit).toContain('<ListState kind="empty" description="編集する対応マークが指定されていません。')
    expect(connections).toContain('<ListState kind="empty" title="メニューを特定できませんでした"')
  })
})
