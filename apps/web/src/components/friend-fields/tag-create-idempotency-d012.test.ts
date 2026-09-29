// @vitest-environment happy-dom
/*
 * D012: タグ作成の要求ごとに Idempotency-Key（見分け札）を付ける。
 * 二度押し・通信の再送で同じタグが2つできないようにする布石。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

const seen = vi.hoisted(() => ({ headers: [] as Array<Record<string, string>>, bodies: [] as string[] }))

vi.stubGlobal('fetch', async (_input: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
  seen.headers.push({ ...(init?.headers ?? {}) })
  seen.bodies.push(String(init?.body ?? ''))
  return new Response(JSON.stringify({ success: true, data: { tag: { id: 't-new' } } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
})

afterEach(() => {
  seen.headers = []
  seen.bodies = []
})

describe('D012 タグ作成の要求キー', () => {
  test('Idempotency-Key を UUID 形式で付け、要求ごとに変える', async () => {
    const { api } = await import('@/lib/api')
    const body = {
      name: 'リピーター',
      groupId: null,
      isStarred: false,
      manualAssignmentAllowed: true,
      reapplyPolicy: 'first_only',
      linkedEnabled: false,
      mileage: { self: 0, referrer: 0, multiplier: null, priority: 0 },
      actions: [],
    } as Parameters<typeof api.tags.createDefinition>[1]
    await api.tags.createDefinition('a1', body)
    await api.tags.createDefinition('a1', body)

    expect(seen.headers.length).toBe(2)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
    expect(seen.headers[0]['Idempotency-Key']).toMatch(uuid)
    expect(seen.headers[1]['Idempotency-Key']).toMatch(uuid)
    expect(seen.headers[0]['Idempotency-Key']).not.toBe(seen.headers[1]['Idempotency-Key'])
  })
})
