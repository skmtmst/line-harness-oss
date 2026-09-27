import { describe, expect, it, vi } from 'vitest'

/*
 * R15 の実行時フィルタの再発防止。
 *
 * 対象ステージで付けた条件は、公開後にきっかけが起きたとき
 * (予約・イベント・個別相談) の登録でも効く。条件に外れる友だちは
 * 登録しない。条件が無い従来の行は従来どおり登録する。
 * 判定で転んだ1件が予約全体を止めないことも固定する。
 */

const CONDITION = {
  operator: 'AND',
  rules: [{ type: 'tag_exists', value: 'tag-1' }],
  groups: [],
}

function versionRow(condition: unknown) {
  return {
    id: 'version-1',
    reminder_id: 'reminder-1',
    version_number: 1,
    status: 'published',
    settings_snapshot: JSON.stringify({
      name: '予約前のお知らせ',
      lineAccountId: 'account-1',
      triggerType: 'booking',
      deliveryMode: 'time',
      stopConditions: {
        bookingCancelled: true,
        supportMarkCompleted: false,
        daysAfterTarget: null,
        friendBlocked: true,
      },
      steps: [],
      targetCondition: condition,
    }),
    last_test_status: 'succeeded',
    last_tested_at: '2026-09-03T10:00:00.000Z',
    last_tested_by_staff_id: 'staff-1',
    published_at: '2026-09-03T11:00:00.000Z',
    published_by_staff_id: 'staff-1',
    created_at: '2026-09-03T09:00:00.000Z',
    updated_at: '2026-09-03T11:00:00.000Z',
  }
}

const RULE = {
  id: 'reminder-1',
  trigger_type: 'booking',
  trigger_offset_minutes: 0,
  send_at_time: null,
  target_tag_id: null,
  trigger_event_id: null,
  current_published_version_id: 'version-1',
}

interface FakeOptions {
  /** 公開版の条件。'none' は公開版なし (従来行)。 */
  publishedCondition: unknown | 'none'
  /** 友だちが条件に当てはまるか。'throw' は判定の失敗。 */
  matches: boolean | 'throw'
}

function fakeDb(options: FakeOptions) {
  const inserts: string[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          void params
          const first = async () => {
            if (sql.includes('line_account_id FROM friends')) {
              return { line_account_id: 'account-1' }
            }
            // 条件判定の SQL 自体が friend_tags を含むので、判定を先に見る。
            if (sql.includes('SELECT 1 AS ok FROM friends f')) {
              if (options.matches === 'throw') throw new Error('D1 gone')
              return options.matches ? { ok: 1 } : null
            }
            if (sql.includes('FROM friend_tags')) return null
            if (sql.includes('reminder_versions')) {
              return options.publishedCondition === 'none'
                ? null
                : versionRow(options.publishedCondition)
            }
            if (sql.includes('FROM friend_reminders')) return null
            if (sql.includes('SELECT * FROM reminders')) {
              return {
                id: 'reminder-1',
                lifecycle_status: 'published',
                line_account_id: 'account-1',
                current_published_version_id: 'version-1',
              }
            }
            return null
          }
          const all = async () => {
            if (sql.includes('FROM reminders')) return { results: [RULE] }
            return { results: [] }
          }
          const run = async () => {
            inserts.push(sql)
            return { meta: { changes: 1 } }
          }
          return { first, all, run }
        },
      }
    },
  } as unknown as D1Database
  return { db, inserts }
}

const INPUT = {
  triggerType: 'booking' as const,
  friendId: 'friend-1',
  startsAtIso: '2026-10-01T10:00:00+09:00',
  sourceId: 'booking-1',
  sourceEventId: 'event-1',
  lineAccountId: 'account-1',
}

describe('公開版の対象条件で登録を絞る', () => {
  it('条件が無い公開版は従来どおり登録する', async () => {
    const { enrollByTrigger } = await import('./reminder-trigger.js')
    const { db, inserts } = fakeDb({ publishedCondition: null, matches: false })
    const enrolled = await enrollByTrigger(db, INPUT)
    expect(enrolled).toBe(1)
    expect(inserts.some((sql) => sql.includes('INSERT INTO friend_reminders'))).toBe(true)
  })

  it('公開版が無い従来行は従来どおり登録する', async () => {
    const { enrollByTrigger } = await import('./reminder-trigger.js')
    const { db, inserts } = fakeDb({ publishedCondition: 'none', matches: false })
    const enrolled = await enrollByTrigger(db, INPUT)
    expect(enrolled).toBe(1)
    expect(inserts.some((sql) => sql.includes('INSERT INTO friend_reminders'))).toBe(true)
  })

  it('条件に当てはまる友だちは登録する', async () => {
    const { enrollByTrigger } = await import('./reminder-trigger.js')
    const { db, inserts } = fakeDb({ publishedCondition: CONDITION, matches: true })
    const enrolled = await enrollByTrigger(db, INPUT)
    expect(enrolled).toBe(1)
    expect(inserts.some((sql) => sql.includes('INSERT INTO friend_reminders'))).toBe(true)
  })

  it('条件に外れる友だちは登録しない', async () => {
    const { enrollByTrigger } = await import('./reminder-trigger.js')
    const { db, inserts } = fakeDb({ publishedCondition: CONDITION, matches: false })
    const enrolled = await enrollByTrigger(db, INPUT)
    expect(enrolled).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('判定で転んでも例外を投げず、その1件だけ登録しない', async () => {
    const { enrollByTrigger } = await import('./reminder-trigger.js')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { db, inserts } = fakeDb({ publishedCondition: CONDITION, matches: 'throw' })
      const enrolled = await enrollByTrigger(db, INPUT)
      expect(enrolled).toBe(0)
      expect(inserts).toHaveLength(0)
      expect(quiet).toHaveBeenCalled()
    } finally {
      quiet.mockRestore()
    }
  })
})
