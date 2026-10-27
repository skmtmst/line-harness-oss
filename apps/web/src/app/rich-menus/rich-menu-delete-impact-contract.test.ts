import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, api, fetchApi } from '../../lib/api'
import { audienceText, NOT_AVAILABLE } from '../../v8/rich-menus/delete-impact'
import {
  RICH_MENU_DELETE_IMPACT,
  RICH_MENU_DELETE_IMPACT_EMPTY,
  RICH_MENU_DELETE_IMPACT_ERROR,
} from '../../../../../scripts/visual-qa/fixtures.mjs'

const API = readApiSource(new URL('../../lib/api.ts', import.meta.url), 'utf8')

function stubOk() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: null }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('rich menu delete-impact handoff contract', () => {
  test('reads impact before deletion and distinguishes partial, unavailable, and zero', () => {
    // 型だけを number にしても tsc は落ちない（壊して確かめた）ので、型の形は文字で残す。
    expect(API).toContain('export type RichMenuDeleteImpact')
    expect(API).toContain('value: number | null')
    expect(API).toContain("state?: 'available' | 'partial' | 'unavailable'")
    expect(API).toContain("'preexisting_assignments_not_backfilled' | 'assignment_ledger_unavailable' | null")
  })

  test('reads impact from the delete-impact route of the same menu before deletion', async () => {
    const fetch = stubOk()
    await api.richMenuGroups.deleteImpact('group-1')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(new URL(String(url), 'http://localhost').pathname).toBe('/api/rich-menu-groups/group-1/delete-impact')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  test('deletes with a plain DELETE of the menu, without any query', async () => {
    const fetch = stubOk()
    await api.richMenuGroups.delete('group-1')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined]
    const parsed = new URL(String(url), 'http://localhost')
    expect(parsed.pathname).toBe('/api/rich-menu-groups/group-1')
    expect(parsed.search).toBe('')
    expect(init?.method).toBe('DELETE')
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
    expect(RICH_MENU_DELETE_IMPACT.currentAudience.value).toEqual(expect.any(Number))
    expect(RICH_MENU_DELETE_IMPACT_EMPTY.currentAudience).toMatchObject({ value: null, reason: 'assignment_ledger_unavailable' })
    expect(RICH_MENU_DELETE_IMPACT_EMPTY.incomingSwitches).toEqual([])
    expect(RICH_MENU_DELETE_IMPACT_EMPTY.operationalReferences).toEqual([])
    // 未取得の見本は「0 人」と描かれず、未取得の印になる。
    expect(audienceText(RICH_MENU_DELETE_IMPACT_EMPTY.currentAudience as never)).toBe(NOT_AVAILABLE)
    expect(RICH_MENU_DELETE_IMPACT_ERROR).toMatchObject({ success: false })
  })
})
