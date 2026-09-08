import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  claimRichMenuSchedule,
  claimRichMenuScheduleRestore,
  classifyRichMenuScheduleError,
  findPublishedRestoreCandidate,
  getStalePublishingSchedules,
  getStaleRestoringSchedules,
  nextRichMenuScheduleRetryAt,
  reclaimStalePublishingSchedule,
  reclaimStaleRestoringSchedule,
  recordRichMenuScheduleSuccess,
} from '../src/rich-menu-schedules.js'

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    INSERT INTO line_accounts VALUES ('account-1');
    INSERT INTO line_accounts VALUES ('account-2');
    INSERT INTO rich_menu_groups VALUES ('menu-1', 'account-1');
    INSERT INTO rich_menu_groups VALUES ('menu-2', 'account-2');
    INSERT INTO rich_menu_groups VALUES ('restore-1', 'account-1');
  `)
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/291_rich_menu_schedules.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/342_rich_menu_schedule_execution.sql'), 'utf8'))
  return sqlite
}

function insertSchedule(
  sqlite: Database.Database,
  overrides: Record<string, string | number | null> = {},
) {
  const row = {
    id: 'schedule-1',
    group_id: 'menu-1',
    account_id: 'account-1',
    mode: 'scheduled',
    starts_at: '2026-09-10T01:00:00.000Z',
    ends_at: null,
    restore_group_id: null,
    definition_snapshot: '{}',
    idempotency_key: 'key-1',
    requested_by_staff_id: 'staff-1',
    created_at: '2026-09-06',
    updated_at: '2026-09-06',
    ...overrides,
  }
  sqlite.prepare(`INSERT INTO rich_menu_schedules
    (id, group_id, account_id, mode, starts_at, ends_at, restore_group_id,
     definition_snapshot, idempotency_key, requested_by_staff_id, created_at, updated_at)
    VALUES (@id, @group_id, @account_id, @mode, @starts_at, @ends_at, @restore_group_id,
            @definition_snapshot, @idempotency_key, @requested_by_staff_id, @created_at, @updated_at)`).run(row)
}

describe('342 rich menu schedule execution', () => {
  let sqlite: Database.Database

  beforeEach(() => {
    sqlite = setup()
  })

  test('再試行用の列が既定値付きで足される', () => {
    insertSchedule(sqlite)
    expect(sqlite.prepare(`SELECT attempt_count, next_retry_at, last_error_code
      FROM rich_menu_schedules WHERE id = 'schedule-1'`).get()).toEqual({
      attempt_count: 0,
      next_retry_at: null,
      last_error_code: null,
    })
  })

  test('JST入力をUTC保存し、時刻到来の境界でdueが変わる', () => {
    // 画面の datetime-local「2026-09-10T10:00+09:00」は UTC の 01:00Z として保存する。
    const stored = new Date('2026-09-10T10:00:00+09:00').toISOString()
    expect(stored).toBe('2026-09-10T01:00:00.000Z')
    insertSchedule(sqlite, { starts_at: stored })

    const dueBefore = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedules
      WHERE status = 'scheduled' AND starts_at <= ?
        AND (next_retry_at IS NULL OR next_retry_at <= ?)`).get('2026-09-10T00:59:59.000Z', '2026-09-10T00:59:59.000Z')
    const dueAt = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedules
      WHERE status = 'scheduled' AND starts_at <= ?
        AND (next_retry_at IS NULL OR next_retry_at <= ?)`).get(stored, stored)
    expect(dueBefore).toEqual({ count: 0 })
    expect(dueAt).toEqual({ count: 1 })
  })

  test('排他取得は1行だけが publishing へ変わる', () => {
    insertSchedule(sqlite)
    const claimed = sqlite.prepare(`UPDATE rich_menu_schedules
        SET status = 'publishing', attempt_count = attempt_count + 1
        WHERE id = 'schedule-1' AND account_id = 'account-1' AND status = 'scheduled'`).run()
    expect(claimed.changes).toBe(1)
    // 二重起動の2本目は status が変わっているため取れない。
    const second = sqlite.prepare(`UPDATE rich_menu_schedules
        SET status = 'publishing' WHERE id = 'schedule-1' AND status = 'scheduled'`).run()
    expect(second.changes).toBe(0)
  })

  test('別アカウントの同じ実行キーは別の予約として残る', () => {
    insertSchedule(sqlite, { id: 'schedule-1', group_id: 'menu-1', account_id: 'account-1', idempotency_key: 'same-key' })
    insertSchedule(sqlite, { id: 'schedule-2', group_id: 'menu-2', account_id: 'account-2', idempotency_key: 'same-key' })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM rich_menu_schedules').get()).toEqual({ count: 2 })
  })

  test('実行前の取消だけが cancelled へ変わる', () => {
    insertSchedule(sqlite)
    expect(sqlite.prepare(`UPDATE rich_menu_schedules SET status = 'cancelled'
      WHERE id = 'schedule-1' AND status = 'scheduled'`).run().changes).toBe(1)
    expect(sqlite.prepare(`UPDATE rich_menu_schedules SET status = 'cancelled'
      WHERE id = 'schedule-1' AND status = 'scheduled'`).run().changes).toBe(0)
  })

  test('期間モードの復元対象は終了時刻を過ぎた published だけ', () => {
    insertSchedule(sqlite, {
      id: 'period-1', mode: 'period', starts_at: '2026-09-10T01:00:00.000Z',
      ends_at: '2026-09-30T14:59:00.000Z', restore_group_id: 'restore-1',
    })
    sqlite.prepare(`UPDATE rich_menu_schedules SET status = 'published' WHERE id = 'period-1'`).run()
    const before = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedules
      WHERE status = 'published' AND mode = 'period' AND ends_at <= ?`).get('2026-09-30T14:58:59.000Z')
    const at = sqlite.prepare(`SELECT COUNT(*) AS count FROM rich_menu_schedules
      WHERE status = 'published' AND mode = 'period' AND ends_at <= ?`).get('2026-09-30T14:59:00.000Z')
    expect(before).toEqual({ count: 0 })
    expect(at).toEqual({ count: 1 })
  })

  test('一時失敗と恒久失敗を分ける', () => {
    expect(classifyRichMenuScheduleError(new Error('fetch failed')).retryable).toBe(true)
    expect(classifyRichMenuScheduleError(new Error('LINE 429 rate limit')).retryable).toBe(true)
    expect(classifyRichMenuScheduleError(new Error('page menu-1 has no image')).retryable).toBe(false)
    expect(classifyRichMenuScheduleError(new Error('restoreGroupId must be a published menu')).retryable).toBe(false)
  })

  test('再試行時刻は回数が増えるほど延びる', () => {
    const now = new Date('2026-09-10T01:00:00.000Z')
    const first = nextRichMenuScheduleRetryAt(now, 1)
    const third = nextRichMenuScheduleRetryAt(now, 3)
    expect(new Date(third).getTime()).toBeGreaterThan(new Date(first).getTime())
    expect(first).toBe(new Date(now.getTime() + 60_000).toISOString())
  })

  test('停止・権限喪失は恒久失敗として要対応に残る', () => {
    expect(classifyRichMenuScheduleError(new Error('account_inactive: line account is stopped')).retryable).toBe(false)
    expect(classifyRichMenuScheduleError(new Error('account_archived: line account is archived')).retryable).toBe(false)
    expect(classifyRichMenuScheduleError(new Error('staff_inactive: requester is disabled')).retryable).toBe(false)
    expect(classifyRichMenuScheduleError(new Error('staff_forbidden: requester lost account visibility')).retryable).toBe(false)
  })
})

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
    definition_snapshot: '{}',
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

describe('342 remand: attempt独立・run追跡・stale回収・戻し先確定', () => {
  let sqlite: Database.Database
  let db: D1Database

  beforeEach(() => {
    sqlite = setup()
    // groupsにstatus/updated_atを足して候補選択の順序を固定する。
    sqlite.exec(`ALTER TABLE rich_menu_groups ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`)
    sqlite.exec(`ALTER TABLE rich_menu_groups ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-09-06T00:00:00+09:00'`)
    sqlite.prepare(`UPDATE rich_menu_groups SET status = 'published', updated_at = '2026-09-07T00:00:00+09:00' WHERE id = 'restore-1'`).run()
    db = asD1(sqlite)
  })

  test('開始成功(期間)はattemptを0へ戻しendedを空ける', async () => {
    insertFullSchedule(sqlite, { id: 'period-1', mode: 'period', ends_at: '2026-09-30T14:59:00.000Z', restore_group_id: 'restore-1', status: 'publishing', attempt_count: 4 } as never)
    sqlite.prepare(`UPDATE rich_menu_schedules SET attempt_count = 4, started_run_id = 'run-start' WHERE id = 'period-1'`).run()
    await recordRichMenuScheduleSuccess(db, 'period-1', 'account-1', 'run-start', 'published')
    const row = sqlite.prepare(`SELECT status, attempt_count, ended_run_id, started_run_id FROM rich_menu_schedules WHERE id = 'period-1'`).get() as Record<string, unknown>
    expect(row).toMatchObject({ status: 'published', attempt_count: 0, ended_run_id: null, started_run_id: 'run-start' })
  })

  test('開始で4回使っても復元は0から再試行できる', async () => {
    insertFullSchedule(sqlite, { id: 'period-2', mode: 'period', ends_at: '2026-09-30T14:59:00.000Z', restore_group_id: 'restore-1', status: 'published', attempt_count: 0 } as never)
    sqlite.prepare(`UPDATE rich_menu_schedules SET attempt_count = 0, started_run_id = 'run-start' WHERE id = 'period-2'`).run()
    // 復元claimで+1されても上限5まで余裕がある。
    const claimed = await claimRichMenuScheduleRestore(db, 'period-2', 'account-1', 'run-restore')
    expect(claimed).toBe(true)
    const row = sqlite.prepare(`SELECT attempt_count, started_run_id, ended_run_id, status FROM rich_menu_schedules WHERE id = 'period-2'`).get() as Record<string, unknown>
    expect(row).toMatchObject({ attempt_count: 1, started_run_id: 'run-start', status: 'restoring' })
    expect(row.ended_run_id).toBe('run-restore')
  })

  test('復元claimはstartedを上書きせずendedへ書く', async () => {
    insertFullSchedule(sqlite, { id: 'period-3', mode: 'period', ends_at: '2026-09-30T14:59:00.000Z', status: 'published', started_run_id: 'run-start' })
    await claimRichMenuScheduleRestore(db, 'period-3', 'account-1', 'run-restore')
    const row = sqlite.prepare(`SELECT started_run_id, ended_run_id FROM rich_menu_schedules WHERE id = 'period-3'`).get() as Record<string, unknown>
    expect(row).toEqual({ started_run_id: 'run-start', ended_run_id: 'run-restore' })
  })

  test('staleなpublishingはscheduledへ戻り再試行できる', async () => {
    insertFullSchedule(sqlite, { id: 'stale-1', status: 'publishing', updated_at: '2026-09-10T00:00:00+09:00' })
    const stale = await getStalePublishingSchedules(db, '2026-09-10T00:30:00+09:00', 20)
    expect(stale.map((row) => row.id)).toContain('stale-1')
    const reclaimed = await reclaimStalePublishingSchedule(db, 'stale-1', 'account-1', '2026-09-10T00:30:00+09:00')
    expect(reclaimed).toBe(true)
    const row = sqlite.prepare(`SELECT status FROM rich_menu_schedules WHERE id = 'stale-1'`).get() as { status: string }
    expect(row.status).toBe('scheduled')
    // 新しいclaimは取れる(二重実行しない条件付きUPDATEのため古いclaimはもう無い)。
    const claimed = await claimRichMenuSchedule(db, 'stale-1', 'account-1', 'run-new', '2026-09-10T01:00:00.000Z')
    expect(claimed).toBe(true)
  })

  test('新しいpublishingはstale回収されない', async () => {
    insertFullSchedule(sqlite, { id: 'fresh-1', status: 'publishing', updated_at: '2026-09-10T00:29:00+09:00' })
    const stale = await getStalePublishingSchedules(db, '2026-09-10T00:10:00+09:00', 20)
    expect(stale.map((row) => row.id)).not.toContain('fresh-1')
    const reclaimed = await reclaimStalePublishingSchedule(db, 'fresh-1', 'account-1', '2026-09-10T00:10:00+09:00')
    expect(reclaimed).toBe(false)
  })

  test('staleなrestoringはpublishedへ戻る', async () => {
    insertFullSchedule(sqlite, { id: 'stale-r', status: 'restoring', updated_at: '2026-09-10T00:00:00+09:00' })
    const stale = await getStaleRestoringSchedules(db, '2026-09-10T00:30:00+09:00', 20)
    expect(stale.map((row) => row.id)).toContain('stale-r')
    expect(await reclaimStaleRestoringSchedule(db, 'stale-r', 'account-1', '2026-09-10T00:30:00+09:00')).toBe(true)
    const row = sqlite.prepare(`SELECT status FROM rich_menu_schedules WHERE id = 'stale-r'`).get() as { status: string }
    expect(row.status).toBe('published')
  })

  test('前のメニューに戻すは予約時点の公開中メニューに確定する', async () => {
    const candidate = await findPublishedRestoreCandidate(db, 'account-1', 'menu-1')
    expect(candidate?.id).toBe('restore-1')
    // 予約対象自身は除外される。対象以外に公開中が無ければnull。
    const none = await findPublishedRestoreCandidate(db, 'account-1', 'restore-1')
    // menu-1はdraftのため候補なし。
    expect(none).toBeNull()
  })
})
