/*
  #1000 追加詳細監査(DETAIL-11/12)の回帰テスト。
  再現検査を正常動作の期待へ変えて固定したもの。
  元の検査: audit-reports/2026-09-20-detail-f26b550/evidence/tests/
    apps/web/src/components/events/audit-bulk.test.ts
*/
import { it, expect, vi, afterEach } from 'vitest'
// api.ts は import 時に NEXT_PUBLIC_API_URL を要求する。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
})
import {
  BULK_SLOT_LIMIT,
  BULK_SLOT_MAX_RANGE_DAYS,
  BulkSlotRangeError,
  generateBulkSlots,
} from './bulk-slot-generator'
import { eventsApi, EventSlotsPartialError } from '@/lib/api'

afterEach(() => vi.unstubAllGlobals())

/**
 * client_key 冪等に対応したサーバーの模擬。同じ event 内で client_key が
 * 一致する枠は既存行を返し、新しく挿入しない(DETAIL-11 のサーバー契約)。
 */
function stubIdempotentServer(failOnCall?: number) {
  const store = new Map<string, Record<string, unknown>>()
  const sent: Array<Array<Record<string, unknown>>> = []
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { slots: Array<Record<string, unknown>> }
    sent.push(body.slots)
    if (sent.length === failOnCall) {
      return new Response(JSON.stringify({ error: 'simulated failure' }), { status: 500 })
    }
    const items = body.slots.map((s) => {
      const key = s.client_key as string | undefined
      const existing = key ? [...store.values()].find((x) => x.client_key === key) : undefined
      if (existing) return { ...existing, deduplicated: true }
      const row = { ...s, id: `slot-${store.size}` }
      store.set(row.id as string, row)
      return { ...row, deduplicated: false }
    })
    return new Response(JSON.stringify({
      items,
      created_count: items.filter((x) => !x.deduplicated).length,
      deduplicated_count: items.filter((x) => x.deduplicated).length,
    }), { status: 201 })
  })
  return { store, sent }
}

it('D11: 400成功+1失敗→再試行しても登録総数は401で増えない', async () => {
  const generated = generateBulkSlots({
    start_date: '2026-01-01', end_date: '2027-02-05',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_patterns: [{ start: '10:00', end: '11:00' }],
    capacity: 10,
  })
  expect(generated.length).toBe(401)
  const operationId = 'op-audit-11'
  const keyed = generated.map((s, i) => ({ ...s, client_key: `${operationId}:${i}` }))

  // 2口目(401件目)だけ失敗させる。
  const { store } = stubIdempotentServer(2)
  await expect(eventsApi.createSlots('account-a', 'event-1', keyed)).rejects.toThrow('400件まで')
  expect(store.size).toBe(400)

  // 同じキーで全部送り直しても、成功済みの400件は二重登録されない。
  const res = await eventsApi.createSlots('account-a', 'event-1', keyed)
  expect(store.size).toBe(401)
  expect(res.items).toHaveLength(401)
})

it('D11: 部分失敗のエラーは作成済みの件数を保持する', async () => {
  const generated = generateBulkSlots({
    start_date: '2026-01-01', end_date: '2027-02-05',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_patterns: [{ start: '10:00', end: '11:00' }],
    capacity: 10,
  })
  const keyed = generated.map((s, i) => ({ ...s, client_key: `op-x:${i}` }))
  stubIdempotentServer(2)

  const failure = await eventsApi
    .createSlots('account-a', 'event-1', keyed)
    .catch((e: unknown) => e)
  expect(failure).toBeInstanceOf(EventSlotsPartialError)
  expect((failure as EventSlotsPartialError).completed).toHaveLength(400)

  // 残りだけ再送する画面側の契約: completed以降を切り出して送る。
  const { store } = stubIdempotentServer()
  const remaining = keyed.slice((failure as EventSlotsPartialError).completed.length)
  expect(remaining).toHaveLength(1)
  await eventsApi.createSlots('account-a', 'event-1', remaining)
  expect(store.size).toBe(1)
})

it('D12: 見積もり上限を超える期間は501件を生成せずに中断する', async () => {
  // 10年分は期間上限(731日)を超えるので、生成せず例外で止める。
  expect(() =>
    generateBulkSlots({
      start_date: '2026-01-01', end_date: '2035-12-31',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      time_patterns: [{ start: '10:00', end: '11:00' }],
      capacity: 1,
    }),
  ).toThrow(BulkSlotRangeError)

  // 期間内でも件数が上限を超える場合は BULK_SLOT_LIMIT+1 件で打ち切る。
  const start = performance.now()
  const truncated = generateBulkSlots({
    start_date: '2026-01-01', end_date: '2027-12-31',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_patterns: [{ start: '10:00', end: '11:00' }],
    capacity: 1,
  })
  expect(truncated.length).toBe(BULK_SLOT_LIMIT + 1)
  console.log(JSON.stringify({
    audit: 'bulk-generation-fixed',
    slots: truncated.length,
    milliseconds: Number((performance.now() - start).toFixed(2)),
    note: 'generation stops at limit+1; previously allocated the full 2-year set',
  }))

  // 上限ちょうどの正当な入力は従来どおり全件生成できる。
  // 2026-01-01から2027-05-15までの毎日 = ちょうど500日分。
  const exact = generateBulkSlots({
    start_date: '2026-01-01', end_date: '2027-05-15',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_patterns: [{ start: '10:00', end: '11:00' }],
    capacity: 1,
  })
  expect(exact.length).toBe(BULK_SLOT_LIMIT)
})

it('D12: 期間上限ちょうどは許可、上限+1日は拒否する', () => {
  const end = new Date(Date.UTC(2026, 0, 1) + (BULK_SLOT_MAX_RANGE_DAYS - 1) * 86_400_000)
    .toISOString().slice(0, 10)
  const ok = generateBulkSlots({
    start_date: '2026-01-01', end_date: end,
    weekdays: [], time_patterns: [], capacity: null,
  })
  expect(ok).toEqual([])
  const over = new Date(Date.UTC(2026, 0, 1) + BULK_SLOT_MAX_RANGE_DAYS * 86_400_000)
    .toISOString().slice(0, 10)
  expect(() =>
    generateBulkSlots({
      start_date: '2026-01-01', end_date: over,
      weekdays: [1], time_patterns: [{ start: '10:00', end: '11:00' }], capacity: null,
    }),
  ).toThrow(BulkSlotRangeError)
})
