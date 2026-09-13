import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  createRichMenuScheduleAtomic,
  detectSnapshotPageDrift,
  getRichMenuScheduleById,
  getSchedulePublications,
  recordRichMenuSchedulePermanentFailure,
  recordRichMenuScheduleRestoreSuccess,
  recordRichMenuScheduleRestoreTransientFailure,
  recordRichMenuScheduleSuccess,
  recordRichMenuScheduleTransientFailure,
  recordSchedulePublications,
  snapshotPageIds,
} from '../src/rich-menu-schedules.js'

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE rich_menu_groups (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      publishing_at TEXT,
      updated_at TEXT NOT NULL DEFAULT '2026-09-06T00:00:00+09:00'
    );
    INSERT INTO line_accounts VALUES ('account-1');
    INSERT INTO rich_menu_groups VALUES ('menu-1', 'account-1', 'draft', NULL, '2026-09-06T00:00:00+09:00');
    INSERT INTO rich_menu_groups VALUES ('restore-1', 'account-1', 'published', NULL, '2026-09-07T00:00:00+09:00');
  `)
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/291_rich_menu_schedules.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/342_rich_menu_schedule_execution.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/344_rich_menu_schedule_publications.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/355_rich_menu_schedule_lease.sql'), 'utf8'))
  return sqlite
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const build = (...params: unknown[]) => {
        const stmt = sqlite.prepare(query)
        return {
          async run() {
            const info = stmt.run(...params)
            return { success: true, meta: { changes: info.changes } }
          },
          async first<T>() {
            return (stmt.get(...params) as T) ?? null
          },
          async all<T>() {
            return { results: (stmt.all(...params) as T[]), success: true, meta: {} }
          },
        }
      }
      return {
        bind: (...params: unknown[]) => build(...params),
        run: () => build().run(),
        first: <T,>() => build().first<T>(),
        all: <T,>() => build().all<T>(),
      }
    },
    batch: async (stmts: unknown[]) => {
      for (const stmt of stmts as Array<{ run: () => Promise<unknown> }>) await stmt.run()
      return []
    },
  } as unknown as D1Database
}

function insertFullSchedule(sqlite: Database.Database, overrides: Record<string, string | number | null> = {}) {
  const row = {
    id: 'schedule-1',
    group_id: 'menu-1',
    account_id: 'account-1',
    mode: 'scheduled',
    starts_at: '2026-09-10T01:00:00.000Z',
    ends_at: null,
    restore_group_id: null,
    definition_snapshot: JSON.stringify({ pages: [{ id: 'p1' }] }),
    status: 'scheduled',
    idempotency_key: 'key-1',
    requested_by_staff_id: 'staff-1',
    started_run_id: null,
    ended_run_id: null,
    last_error_code: null,
    created_at: '2026-09-06T00:00:00+09:00',
    updated_at: '2026-09-06T00:00:00+09:00',
    ...overrides,
  }
  sqlite.prepare(`INSERT INTO rich_menu_schedules
    (id, group_id, account_id, mode, starts_at, ends_at, restore_group_id,
     definition_snapshot, status, idempotency_key, requested_by_staff_id,
     started_run_id, ended_run_id, last_error_code, created_at, updated_at)
    VALUES (@id, @group_id, @account_id, @mode, @starts_at, @ends_at, @restore_group_id,
            @definition_snapshot, @status, @idempotency_key, @requested_by_staff_id,
            @started_run_id, @ended_run_id, @last_error_code, @created_at, @updated_at)`).run(row)
}

describe('344 remand: lease fencing・journal・冪等・drift（実D1）', () => {
  let sqlite: Database.Database
  let db: D1Database

  beforeEach(() => {
    sqlite = setup()
    db = asD1(sqlite)
  })

  test('claim直後・LINE前停止の再開はfencingで新しいrunが取れる', async () => {
    insertFullSchedule(sqlite, { id: 'stale-crash' })
    // run Aがclaim直後に停止（publishingのまま）。
    expect(await claimRichMenuSchedule(db, 'stale-crash', 'account-1', 'run-A', '2026-09-10T01:00:00.000Z')).toBe(true)
    // lease期限内は回収されない。
    const { reclaimStalePublishingSchedule } = await import('../src/rich-menu-schedules.js')
    expect(await reclaimStalePublishingSchedule(db, 'stale-crash', 'account-1', '2026-09-10T01:00:00.000Z')).toBe(false)
    // lease期限切れ（11分後）でscheduledへ戻る（run IDは残る）。
    const expired = '2026-09-10T01:11:00.000Z'
    expect(await reclaimStalePublishingSchedule(db, 'stale-crash', 'account-1', expired)).toBe(true)
    // run Bが新しくclaimできる。古いrun Aのまま完成させない。
    expect(await claimRichMenuSchedule(db, 'stale-crash', 'account-1', 'run-B', expired)).toBe(true)
    const fresh = await getRichMenuScheduleById(db, 'stale-crash', 'account-1')
    expect(fresh?.started_run_id).toBe('run-B')
    expect(fresh?.status).toBe('publishing')
  })

  test('stale run Aはrun B claim後に成功・失敗を書けない', async () => {
    insertFullSchedule(sqlite, { id: 'fence-1' })
    await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-A', '2026-09-10T01:00:00.000Z')
    const { reclaimStalePublishingSchedule } = await import('../src/rich-menu-schedules.js')
    await reclaimStalePublishingSchedule(db, 'fence-1', 'account-1', '2026-09-10T01:11:00.000Z')
    await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-B', '2026-09-10T01:11:00.000Z')
    // 古いrun Aの成功記録は失敗する。
    expect(await recordRichMenuScheduleSuccess(db, 'fence-1', 'account-1', 'run-A', 'completed')).toBe(false)
    expect(await recordRichMenuScheduleTransientFailure(db, 'fence-1', 'account-1', 'run-A', 'fetch failed', '2026-09-10T01:01:00.000Z')).toBe(false)
    expect(await recordRichMenuSchedulePermanentFailure(db, 'fence-1', 'account-1', 'run-A', 'fetch failed')).toBe(false)
    // 新しいrun Bは書ける。
    expect(await recordRichMenuScheduleTransientFailure(db, 'fence-1', 'account-1', 'run-B', 'fetch failed', '2026-09-10T01:01:00.000Z')).toBe(true)
    const row = sqlite.prepare(`SELECT status FROM rich_menu_schedules WHERE id = 'fence-1'`).get() as { status: string }
    expect(row.status).toBe('scheduled')
  })

  test('復元のstale runもfencingで弾く', async () => {
    insertFullSchedule(sqlite, { id: 'fence-r', mode: 'period', ends_at: '2026-09-30T00:00:00.000Z', restore_group_id: 'restore-1', status: 'published', started_run_id: 'run-start' })
    await claimRichMenuScheduleRestore(db, 'fence-r', 'account-1', 'run-A', '2026-09-10T01:00:00.000Z')
    const { reclaimStaleRestoringSchedule } = await import('../src/rich-menu-schedules.js')
    await reclaimStaleRestoringSchedule(db, 'fence-r', 'account-1', '2026-09-10T01:11:00.000Z')
    await claimRichMenuScheduleRestore(db, 'fence-r', 'account-1', 'run-B', '2026-09-10T01:11:00.000Z')
    expect(await recordRichMenuScheduleRestoreSuccess(db, 'fence-r', 'account-1', 'run-A')).toBe(false)
    expect(await recordRichMenuScheduleRestoreTransientFailure(db, 'fence-r', 'account-1', 'run-A', 'fetch failed', '2026-09-10T01:01:00.000Z')).toBe(false)
    expect(await recordRichMenuScheduleRestoreSuccess(db, 'fence-r', 'account-1', 'run-B')).toBe(true)
  })

  test('LINE成功後D1失敗の再実行はjournal照合で作り直さない', async () => {
    insertFullSchedule(sqlite, { id: 'journal-1' })
    await claimRichMenuSchedule(db, 'journal-1', 'account-1', 'run-A', '2026-09-10T01:00:00.000Z')
    // LINE成功をjournalへ残した直後にD1失敗（成功記録前に停止）した想定。
    await recordSchedulePublications(db, 'journal-1', 'publish', 'run-A', [
      { pageId: 'p1', lineRichMenuId: 'line-p1' },
    ])
    // 再実行のrun Bはjournalを見てLINEを作り直さない。
    const pubs = await getSchedulePublications(db, 'journal-1', 'publish')
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toMatchObject({ page_id: 'p1', line_richmenu_id: 'line-p1' })
    // journalの二重記録は増えない。
    await recordSchedulePublications(db, 'journal-1', 'publish', 'run-B', [
      { pageId: 'p1', lineRichMenuId: 'line-p1-dup' },
    ])
    const pubs2 = await getSchedulePublications(db, 'journal-1', 'publish')
    expect(pubs2).toHaveLength(1)
    expect(pubs2[0].line_richmenu_id).toBe('line-p1')
  })

  test('同じIdempotency-Key・同じ内容の同時2要求は1行だけ作る', async () => {
    const base = {
      groupId: 'menu-1',
      accountId: 'account-1',
      mode: 'scheduled' as const,
      startsAt: '2026-09-10T01:00:00.000Z',
      endsAt: null,
      restoreGroupId: null,
      definitionSnapshot: JSON.stringify({ pages: [{ id: 'p1' }] }),
      idempotencyKey: 'same-key',
      requestedByStaffId: 'staff-1',
      now: '2026-09-06T00:00:00+09:00',
    }
    const first = await createRichMenuScheduleAtomic(db, { ...base, id: 'id-1' })
    const second = await createRichMenuScheduleAtomic(db, { ...base, id: 'id-2' })
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('existing')
    if (second.outcome === 'existing') {
      expect(second.id).toBe('id-1')
    }
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM rich_menu_schedules').get() as { count: number }
    expect(count.count).toBe(1)
  })

  test('同じkey・異なる内容は成功扱いにせずconflictを返す', async () => {
    const base = {
      groupId: 'menu-1',
      accountId: 'account-1',
      mode: 'scheduled' as const,
      startsAt: '2026-09-10T01:00:00.000Z',
      endsAt: null,
      restoreGroupId: null,
      definitionSnapshot: JSON.stringify({ pages: [{ id: 'p1' }] }),
      idempotencyKey: 'dup-key',
      requestedByStaffId: 'staff-1',
      now: '2026-09-06T00:00:00+09:00',
    }
    expect((await createRichMenuScheduleAtomic(db, { ...base, id: 'id-1' })).outcome).toBe('created')
    const second = await createRichMenuScheduleAtomic(db, {
      ...base,
      id: 'id-2',
      startsAt: '2026-09-11T01:00:00.000Z',
    })
    expect(second.outcome).toBe('conflict')
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM rich_menu_schedules').get() as { count: number }
    expect(count.count).toBe(1)
  })

  test('予約後のページ削除はdriftとして検出する', async () => {
    const snapshot = { pages: [{ id: 'p1' }, { id: 'p2' }] }
    expect(snapshotPageIds(snapshot)).toEqual(['p1', 'p2'])
    // p2が消えた。
    expect(detectSnapshotPageDrift(snapshot, ['p1'])).toMatch(/snapshot drift/)
    // 全部残っていればnull。
    expect(detectSnapshotPageDrift(snapshot, ['p1', 'p2'])).toBeNull()
    // 空snapshotは公開不可。
    expect(detectSnapshotPageDrift({ pages: [] }, ['p1'])).toMatch(/no pages/)
  })
})
