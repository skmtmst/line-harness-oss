import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, fetchApi } from '../../lib/api'
import { readFileSync } from 'node:fs'

const API = readApiSource(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const FIXTURES = readFileSync(
  new URL('../../../../../scripts/visual-qa/fixtures.mjs', import.meta.url),
  'utf8',
)

afterEach(() => vi.unstubAllGlobals())

describe('rich menu delete-impact handoff contract', () => {
  test('reads impact before deletion and distinguishes partial, unavailable, and zero', () => {
    expect(API).toContain('export type RichMenuDeleteImpact')
    expect(API).toContain('value: number | null')
    expect(API).toContain("state?: 'available' | 'partial' | 'unavailable'")
    expect(API).toContain("'preexisting_assignments_not_backfilled' | 'assignment_ledger_unavailable' | null")
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

  test('keeps the fresh 409 impact available without showing its message directly', async () => {
    const impact = { currentAudience: { value: 3, reason: null }, references: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, data: impact, error: {
      code: 'RICH_MENU_IN_USE', message: 'D1_ERROR: SELECT private_value FROM customer',
      requestId: 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0', fieldErrors: [],
    } }), { status: 409 })))
    const error = await fetchApi('/api/rich-menu-groups/group', { method: 'DELETE' }).catch(error => error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'RICH_MENU_IN_USE', data: impact })
    expect(error.message).not.toMatch(/D1_ERROR|SELECT|private_value|customer/)
  })

  test('ships normal and zero-reference fixtures without inventing an audience count', () => {
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT =')
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT_EMPTY =')
    expect(FIXTURES).toContain('export const RICH_MENU_DELETE_IMPACT_ERROR =')
    expect(FIXTURES).toMatch(/currentAudience: \{ value: null, reason: 'assignment_ledger_unavailable' \}/)
  })
})
