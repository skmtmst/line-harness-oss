import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { processDueRichMenuSchedules } from './rich-menu-schedule-executor.js'

function setupSqlite() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, channel_access_token TEXT, is_active INTEGER DEFAULT 1, archived_at TEXT);
    CREATE TABLE staff_members (id TEXT PRIMARY KEY);
    CREATE TABLE rich_menu_groups (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      publishing_at TEXT,
      is_default_for_all INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '2026-09-06T00:00:00+09:00'
    );
    CREATE TABLE rich_menu_pages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
      line_richmenu_id TEXT,
      updated_at TEXT NOT NULL DEFAULT '2026-09-06T00:00:00+09:00'
    );
    CREATE TABLE rich_menu_assignments (
      id TEXT PRIMARY KEY,
      friend_id TEXT NOT NULL,
      line_account_id TEXT NOT NULL,
      group_id TEXT,
      version_id TEXT,
      line_richmenu_id TEXT,
      reason_kind TEXT,
      reason_event_id TEXT,
      assigned_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      line_user_id TEXT
    );
    INSERT INTO line_accounts VALUES ('account-1', 'token', 1, NULL);
    INSERT INTO rich_menu_groups VALUES ('menu-1', 'account-1', 'draft', NULL, 0, '2026-09-06T00:00:00+09:00');
    INSERT INTO rich_menu_groups VALUES ('restore-1', 'account-1', 'published', NULL, 0, '2026-09-07T00:00:00+09:00');
    INSERT INTO rich_menu_pages VALUES ('p1', 'menu-1', NULL, '2026-09-06T00:00:00+09:00');
    INSERT INTO rich_menu_pages VALUES ('r1', 'restore-1', NULL, '2026-09-06T00:00:00+09:00');
  `)
  const dbDir = join(import.meta.dirname, '../../../../packages/db/migrations')
  sqlite.exec(readFileSync(join(dbDir, '291_rich_menu_schedules.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '342_rich_menu_schedule_execution.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '344_rich_menu_schedule_publications.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '355_rich_menu_schedule_lease.sql'), 'utf8'))
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

function insertSchedule(sqlite: Database.Database, overrides: Record<string, unknown> = {}) {
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
    requested_by_staff_id: 'env-owner',
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

describe('executor 実D1失敗注入（#621 再修正）', () => {
  let sqlite: Database.Database
  let db: D1Database
  const now = new Date('2026-09-10T01:00:00.000Z')

  beforeEach(() => {
    sqlite = setupSqlite()
    db = asD1(sqlite)
    deletedLineMenus.length = 0
    unlinkedSchedules.length = 0
  })

  const deletedLineMenus: Array<{ pageId: string; newRichMenuId: string }> = []
  const unlinkedSchedules: string[] = []

  function depsWithLine(publishMock: ReturnType<typeof vi.fn>, restoreMock?: ReturnType<typeof vi.fn>) {
    return {
      getGroupWithPages: async (_db: unknown, groupId: string) => {
        if (groupId === 'menu-1') {
          return { id: 'menu-1', account_id: 'account-1', status: sqlite.prepare(`SELECT status FROM rich_menu_groups WHERE id = 'menu-1'`).get() as never, pages: [{ id: 'p1' }] } as never
        }
        if (groupId === 'restore-1') {
          return { id: 'restore-1', account_id: 'account-1', status: 'published', pages: [{ id: 'r1' }] } as never
        }
        return null
      },
      getLineAccount: async () => ({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: null }),
      getRequestingStaff: async () => null,
      isStaffAllowedForAccount: async () => true,
      publishSnapshot: publishMock,
      restoreToGroup: restoreMock ?? vi.fn().mockResolvedValue([]),
      deleteLineMenus: async (_schedule: unknown, menus: Array<{ pageId: string; newRichMenuId: string }>) => {
        deletedLineMenus.push(...menus)
      },
      unlinkIndividualLinks: async (schedule: { id: string }) => {
        unlinkedSchedules.push(schedule.id)
        return 0
      },
    }
  }

  test('claim直後・LINE前停止のstale再開は必ず公開する（0回で完了にしない）', async () => {
    insertSchedule(sqlite, { id: 'stale-crash' })
    // run Aがclaim直後に停止（LINE前）。publishingのまま残る。
    sqlite.prepare(`UPDATE rich_menu_schedules SET status = 'publishing', started_run_id = 'run-A', attempt_count = 1, updated_at = '2026-09-10T00:00:00+09:00' WHERE id = 'stale-crash'`).run()
    // stale回収でscheduledへ戻る。
    sqlite.prepare(`UPDATE rich_menu_schedules SET status = 'scheduled', updated_at = '2026-09-10T00:05:00+09:00' WHERE id = 'stale-crash'`).run()

    const publishMock = vi.fn().mockResolvedValue([{ pageId: 'p1', newRichMenuId: 'line-p1' }])
    const result = await processDueRichMenuSchedules(db, depsWithLine(publishMock) as never, { now, runIdPrefix: 'runB' })
    // 必ずLINEを1回呼ぶ。0回でcompletedは誤り。
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(result.succeeded).toBe(1)
    const row = sqlite.prepare(`SELECT status FROM rich_menu_schedules WHERE id = 'stale-crash'`).get() as { status: string }
    expect(row.status).toBe('completed')
  })

  test('run A/B fencing：古いrunは新しいclaim後に書けない（実D1）', async () => {
    insertSchedule(sqlite, { id: 'fence-1' })
    const { claimRichMenuSchedule, recordRichMenuScheduleSuccess } = await import('@line-crm/db')
    expect(await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-A', now.toISOString())).toBe(true)
    const before = sqlite.prepare(`SELECT lease_expires_at FROM rich_menu_schedules WHERE id = 'fence-1'`).get() as { lease_expires_at: string }
    // lease期限内は回収されない。
    expect(await (await import('@line-crm/db')).reclaimStalePublishingSchedule(db, 'fence-1', 'account-1', now.toISOString())).toBe(false)
    expect(before.lease_expires_at).toBe(new Date(now.getTime() + 10 * 60_000).toISOString())
    // lease期限切れ（11分後）で回収される。
    const { reclaimStalePublishingSchedule } = await import('@line-crm/db')
    const expired = new Date(now.getTime() + 11 * 60_000).toISOString()
    expect(await reclaimStalePublishingSchedule(db, 'fence-1', 'account-1', expired)).toBe(true)
    expect(await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-B', expired)).toBe(true)
    // 古いrun Aは書けない。
    expect(await recordRichMenuScheduleSuccess(db, 'fence-1', 'account-1', 'run-A', 'completed')).toBe(false)
    // 新しいrun Bは書ける。
    expect(await recordRichMenuScheduleSuccess(db, 'fence-1', 'account-1', 'run-B', 'completed')).toBe(true)
  })

  test('LINE成功後D1失敗の再試行はjournalで二重公開しない（実D1）', async () => {
    insertSchedule(sqlite, { id: 'journal-1' })
    const publishMock = vi.fn().mockResolvedValue([{ pageId: 'p1', newRichMenuId: 'line-p1' }])
    // 1回目：LINE成功＋DB成功まで完走。
    const first = await processDueRichMenuSchedules(db, depsWithLine(publishMock) as never, { now, runIdPrefix: 'run1' })
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(first.succeeded).toBe(1)
    const pubs = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedule_publications WHERE schedule_id = 'journal-1'`).get() as { count: number }
    expect(pubs.count).toBe(1)
    // 2回目：別予約として同じjournalを参照する状況を再現。
    // journal済みの予約をscheduledへ戻してもLINEを作り直さない。
    insertSchedule(sqlite, { id: 'journal-2', idempotency_key: 'key-2' })
    sqlite.prepare(`INSERT INTO rich_menu_schedule_publications (schedule_id, kind, page_id, line_richmenu_id, run_id, created_at) VALUES ('journal-2', 'publish', 'p1', 'line-p1', 'run-old', '2026-09-10T00:00:00+09:00')`).run()
    publishMock.mockClear()
    const second = await processDueRichMenuSchedules(db, depsWithLine(publishMock) as never, { now, runIdPrefix: 'run2' })
    // journal-2はLINEなしで完了。journal-1はcompleted済みのため対象外。
    expect(publishMock).not.toHaveBeenCalled()
    expect(second.succeeded).toBe(1)
  })

  test('journal保存前のD1失敗は作ったLINEを消してから失敗に戻す（実D1・失敗注入）', async () => {
    insertSchedule(sqlite, { id: 'compensate-1' })
    const publishMock = vi.fn().mockResolvedValue([{ pageId: 'p1', newRichMenuId: 'line-first' }])
    // journalのINSERTだけを1回失敗させる（LINE成功後・journal前のD1失敗を再現）。
    let armed = true
    const sabotaged = {
      prepare: (query: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stmt = (db as any).prepare(query)
        return {
          ...stmt,
          bind: (...params: unknown[]) => {
            const bound = stmt.bind(...params)
            return {
              ...bound,
              run: async () => {
                if (armed && query.includes('INSERT OR IGNORE INTO rich_menu_schedule_publications')) {
                  armed = false
                  throw new Error('injected journal D1 failure')
                }
                return bound.run()
              },
            }
          },
        }
      },
      batch: (stmts: unknown[]) => (db as unknown as { batch: (s: unknown[]) => Promise<unknown[]> }).batch(stmts),
    } as unknown as D1Database
    const failed = await processDueRichMenuSchedules(sabotaged, depsWithLine(publishMock) as never, { now, runIdPrefix: 'runC' })
    expect(publishMock).toHaveBeenCalledTimes(1)
    // 作った分を消してから一時失敗へ戻る。再試行の二重公開にならない。
    expect(deletedLineMenus).toEqual([{ pageId: 'p1', newRichMenuId: 'line-first' }])
    expect(failed.retried).toBe(1)
    // journalが残っていないため再試行はLINEを作り直して完了する（前回分は消し済み）。
    // 一時失敗の再試行時刻（+1分）を過ぎた時刻で起こす。
    const later = new Date(now.getTime() + 2 * 60_000)
    const recovered = await processDueRichMenuSchedules(db, depsWithLine(publishMock) as never, { now: later, runIdPrefix: 'runD' })
    expect(publishMock).toHaveBeenCalledTimes(2)
    expect(recovered.succeeded).toBe(1)
    expect(deletedLineMenus).toHaveLength(1)
    const pubs = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedule_publications WHERE schedule_id = 'compensate-1'`).get() as { count: number }
    expect(pubs.count).toBe(1)
  })

  test('復元claim後の停止はlease切れで再開し個別解除まで完走する（実D1・停止再開）', async () => {
    insertSchedule(sqlite, {
      id: 'restore-crash', mode: 'period', status: 'published',
      starts_at: '2026-09-09T01:00:00.000Z', ends_at: '2026-09-10T01:00:00.000Z',
      restore_group_id: 'restore-1', started_run_id: 'run-start',
    })
    // run-Aが復元claim直後に停止。lease付きでrestoringのまま残る。
    const { claimRichMenuScheduleRestore, reclaimStaleRestoringSchedule } = await import('@line-crm/db')
    expect(await claimRichMenuScheduleRestore(db, 'restore-crash', 'account-1', 'run-A', now.toISOString())).toBe(true)
    // lease期限内は再開されない。
    expect(await reclaimStaleRestoringSchedule(db, 'restore-crash', 'account-1', now.toISOString())).toBe(false)
    // 期限切れでpublishedへ戻り、run-Bが復元を完走する。
    const expired = new Date(now.getTime() + 11 * 60_000).toISOString()
    expect(await reclaimStaleRestoringSchedule(db, 'restore-crash', 'account-1', expired)).toBe(true)
    const restoreMock = vi.fn().mockResolvedValue([{ pageId: 'r1', newRichMenuId: 'line-r1' }])
    const result = await processDueRichMenuSchedules(
      db, depsWithLine(vi.fn().mockResolvedValue([]), restoreMock) as never,
      { now: new Date(expired), runIdPrefix: 'runB' },
    )
    expect(restoreMock).toHaveBeenCalledTimes(1)
    expect(unlinkedSchedules).toContain('restore-crash')
    expect(result.restored).toBe(1)
    const row = sqlite.prepare(`SELECT status FROM rich_menu_schedules WHERE id = 'restore-crash'`).get() as { status: string }
    expect(row.status).toBe('completed')
  })

  test('期間終了時は個別割当の解除対象を特定してD1行を消す（実D1・割当復元）', async () => {
    sqlite.prepare(`INSERT INTO friends VALUES ('f1', 'account-1', 'U111')`).run()
    sqlite.prepare(`INSERT INTO friends VALUES ('f2', 'account-1', 'U222')`).run()
    sqlite.prepare(`INSERT INTO friends VALUES ('f3', 'account-1', NULL)`).run()
    sqlite.prepare(`INSERT INTO rich_menu_assignments VALUES ('a1', 'f1', 'account-1', 'menu-1', NULL, 'line-old', 'tag_bulk_apply', NULL, '2026-09-09', '2026-09-09')`).run()
    sqlite.prepare(`INSERT INTO rich_menu_assignments VALUES ('a2', 'f2', 'account-1', 'menu-1', NULL, 'line-old', 'tag_bulk_apply', NULL, '2026-09-09', '2026-09-09')`).run()
    sqlite.prepare(`INSERT INTO rich_menu_assignments VALUES ('a3', 'f3', 'account-1', 'menu-1', NULL, 'line-old', 'tag_bulk_apply', NULL, '2026-09-09', '2026-09-09')`).run()
    sqlite.prepare(`INSERT INTO rich_menu_assignments VALUES ('a9', 'f1', 'account-1', 'other-group', NULL, 'line-x', 'tag_bulk_apply', NULL, '2026-09-09', '2026-09-09')`).run()
    const { listScheduleGroupIndividualLinks } = await import('@line-crm/db')
    // LINEユーザーIDのある2人だけが解除対象。IDなし・別メニューは含めない。
    // (a9は同じf1だが別groupのため対象外。f1のmenu-1行が対象。)
    const targets = await listScheduleGroupIndividualLinks(db, 'account-1', 'menu-1')
    expect(targets).toEqual([
      { friendId: 'f1', lineUserId: 'U111' },
      { friendId: 'f2', lineUserId: 'U222' },
    ])
    insertSchedule(sqlite, {
      id: 'restore-assign', mode: 'period', status: 'published',
      starts_at: '2026-09-09T01:00:00.000Z', ends_at: '2026-09-10T01:00:00.000Z',
      restore_group_id: 'restore-1', started_run_id: 'run-start',
    })
    const restoreMock = vi.fn().mockResolvedValue([{ pageId: 'r1', newRichMenuId: 'line-r1' }])
    const result = await processDueRichMenuSchedules(
      db, depsWithLine(vi.fn().mockResolvedValue([]), restoreMock) as never, { now, runIdPrefix: 'runA' },
    )
    expect(result.restored).toBe(1)
    expect(unlinkedSchedules).toContain('restore-assign')
    const left = sqlite.prepare(`SELECT id FROM rich_menu_assignments WHERE group_id = 'menu-1'`).all() as unknown[]
    expect(left).toHaveLength(0)
    const other = sqlite.prepare(`SELECT id FROM rich_menu_assignments WHERE group_id = 'other-group'`).all() as unknown[]
    expect(other).toHaveLength(1)
  })
})
