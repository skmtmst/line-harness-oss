import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const FIXTURES = readFileSync(
  new URL('../../../../../scripts/visual-qa/fixtures.mjs', import.meta.url),
  'utf8',
)

describe('rich menu delete-impact handoff contract', () => {
  test('reads impact before deletion and keeps unavailable audience separate from zero', () => {
    expect(API).toContain('export type RichMenuDeleteImpact')
    expect(API).toContain('value: number | null')
    expect(API).toContain("reason: 'assignment_ledger_unavailable'")
    expect(API).toContain('deleteImpact: (groupId: string)')
    expect(API).toContain('`/api/rich-menu-groups/${groupId}/delete-impact`')
  })

  test('does not expose the old force-delete option', () => {
    const deleteMethod = API.slice(
      API.indexOf('delete: (groupId: string)'),
      API.indexOf('publish: (groupId: string)'),
    )
    expect(deleteMethod).not.toContain('force')
    expect(deleteMethod).not.toContain('?force=true')
  })

  test('ships normal and zero-reference fixtures without inventing an audience count', () => {
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT =')
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT_EMPTY =')
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT_ERROR =')
    expect(FIXTURES).toMatch(/currentAudience: \{ value: null, reason: 'assignment_ledger_unavailable' \}/)
  })
})
