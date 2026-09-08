import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  claimRichMenuSchedule,
  listScheduleGroupIndividualLinks,
  reclaimStalePublishingSchedule,
  recordRichMenuScheduleSuccess,
} from '@line-crm/db'
import {
  createRichMenuShells,
  deleteRichMenuShells,
  restorePreSwitchDefault,
  restorePreSwitchLive,
  switchRichMenuLive,
} from '../lib/rich-menu-publisher.js'
import { processDueRichMenuSchedules } from './rich-menu-schedule-executor.js'

type FakeLine = {
  menus: Map<string, { name: string }>;
  aliases: Map<string, string>;
  defaultId: string | null;
  seq: number;
  calls: { create: number; upsert: number; setDefault: number; clear: number; del: number; getDefault: number };
  failUpsertOn: number;
  createRichMenu(payload: unknown): Promise<{ richMenuId: string }>;
  uploadRichMenuImage(richMenuId: string, image: Uint8Array, contentType: string): Promise<void>;
  deleteRichMenuAlias(aliasId: string): Promise<void>;
  createRichMenuAlias(aliasId: string, richMenuId: string): Promise<void>;
  upsertRichMenuAlias(aliasId: string, richMenuId: string): Promise<void>;
  deleteRichMenu(richMenuId: string): Promise<void>;
  setDefaultRichMenu(richMenuId: string): Promise<void>;
  clearDefaultRichMenu(): Promise<void>;
  getCurrentDefaultRichMenuId(): Promise<string | null>;
  linkRichMenuBulk(richMenuId: string, userIds: string[]): Promise<void>;
};

function makeFakeLine(): FakeLine {
  const line: FakeLine = {
    menus: new Map(),
    aliases: new Map(),
    defaultId: null,
    seq: 0,
    calls: { create: 0, upsert: 0, setDefault: 0, clear: 0, del: 0, getDefault: 0 },
    failUpsertOn: 0,
    async createRichMenu(payload: unknown) {
      line.calls.create += 1;
      const id = `line-new-${++line.seq}`;
      line.menus.set(id, { name: String((payload as { name?: unknown }).name ?? id) });
      return { richMenuId: id };
    },
    async uploadRichMenuImage() {},
    async deleteRichMenuAlias(aliasId: string) {
      line.aliases.delete(aliasId);
    },
    async createRichMenuAlias(aliasId: string, richMenuId: string) {
      line.aliases.set(aliasId, richMenuId);
    },
    async upsertRichMenuAlias(aliasId: string, richMenuId: string) {
      line.calls.upsert += 1;
      if (line.failUpsertOn > 0 && line.calls.upsert === line.failUpsertOn) {
        throw new Error('LINE updateRichMenuAlias failed: 500');
      }
      line.aliases.set(aliasId, richMenuId);
    },
    async deleteRichMenu(richMenuId: string) {
      line.calls.del += 1;
      line.menus.delete(richMenuId);
    },
    async setDefaultRichMenu(richMenuId: string) {
      line.calls.setDefault += 1;
      if (!line.menus.has(richMenuId)) throw new Error(`LINE setDefaultRichMenu failed: 404`);
      line.defaultId = richMenuId;
    },
    async clearDefaultRichMenu() {
      line.calls.clear += 1;
      line.defaultId = null;
    },
    async getCurrentDefaultRichMenuId() {
      line.calls.getDefault += 1;
      return line.defaultId;
    },
    async linkRichMenuBulk() {},
  };
  return line;
}

const fakeR2 = {
  async get(_key: string) {
    return { body: new Uint8Array([1, 2, 3]) };
  },
};

function setupSqlite() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, channel_access_token TEXT, is_active INTEGER DEFAULT 1, archived_at TEXT);
    CREATE TABLE staff_members (id TEXT PRIMARY KEY);
    CREATE TABLE rich_menu_groups (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      size TEXT NOT NULL DEFAULT 'large',
      chat_bar_text TEXT NOT NULL DEFAULT '',
      is_default_for_all INTEGER NOT NULL DEFAULT 0,
      publishing_at TEXT,
      updated_at TEXT NOT NULL DEFAULT '2026-09-06T00:00:00+09:00'
    );
    CREATE TABLE rich_menu_pages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      image_r2_key TEXT,
      image_content_type TEXT,
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
  `)
  const dbDir = join(import.meta.dirname, '../../../../packages/db/migrations')
  sqlite.exec(readFileSync(join(dbDir, '291_rich_menu_schedules.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '342_rich_menu_schedule_execution.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '344_rich_menu_schedule_publications.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '355_rich_menu_schedule_lease.sql'), 'utf8'))
  sqlite.exec(readFileSync(join(dbDir, '365_rich_menu_schedule_default_pin.sql'), 'utf8'))
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

/** 指定文に一致するprepareをN回だけ失敗させるD1失敗注入。 */
function failingDb(db: D1Database, match: RegExp, times = 1): D1Database {
  let remaining = times
  const failer = () => {
    throw new Error('injected D1 failure')
  }
  return {
    ...(db as unknown as Record<string, unknown>),
    prepare: (query: string) => {
      if (remaining > 0 && match.test(query)) {
        remaining -= 1
        return { bind: failer, run: failer, first: failer, all: failer }
      }
      return (db as { prepare(query: string): unknown }).prepare(query)
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

function insertGroup(
  sqlite: Database.Database,
  group: { id: string; status?: string; isDefault?: boolean; pages: Array<{ id: string; order?: number; lineId?: string | null }> },
) {
  sqlite.prepare(`INSERT INTO rich_menu_groups
    (id, account_id, name, status, size, chat_bar_text, is_default_for_all, publishing_at, updated_at)
    VALUES (?, 'account-1', ?, ?, 'large', 'test', ?, NULL, '2026-09-06T00:00:00+09:00')`).run(
    group.id, group.id, group.status ?? 'draft', group.isDefault ? 1 : 0,
  )
  for (const page of group.pages) {
    sqlite.prepare(`INSERT INTO rich_menu_pages
      (id, group_id, order_index, name, image_r2_key, image_content_type, line_richmenu_id, updated_at)
      VALUES (?, ?, ?, ?, 'img-key', 'image/jpeg', ?, '2026-09-06T00:00:00+09:00')`).run(
      page.id, group.id, page.order ?? 0, page.id, page.lineId ?? null,
    )
  }
}

/** 予約スナップショット(GroupInput形)。 areas空の素直なメニュー。 */
function snapshotFor(groupId: string, pages: string[], isDefault: boolean) {
  return JSON.stringify({
    id: groupId,
    size: 'large',
    chatBarText: 'test',
    isDefaultForAll: isDefault,
    pages: pages.map((id, orderIndex) => ({
      id,
      orderIndex,
      name: id,
      imageR2Key: 'img-key',
      imageContentType: 'image/jpeg',
      lineRichmenuId: null,
      areas: [],
    })),
  })
}

function scheduleRow(sqlite: Database.Database, id: string) {
  return sqlite.prepare(`SELECT * FROM rich_menu_schedules WHERE id = ?`).get(id) as Record<string, unknown>
}

function depsFor(sqlite: Database.Database, db: D1Database, line: FakeLine, unlinked: string[]) {
  return {
    getGroupWithPages: async (_db: unknown, groupId: string) => {
      const group = sqlite.prepare(`SELECT * FROM rich_menu_groups WHERE id = ?`).get(groupId) as Record<string, unknown> | undefined
      if (!group) return null
      const pages = sqlite.prepare(`SELECT * FROM rich_menu_pages WHERE group_id = ? ORDER BY order_index`).all(groupId)
      return { ...group, pages } as never
    },
    getLineAccount: async () => ({ id: 'account-1', channel_access_token: 'token', is_active: 1, archived_at: null }),
    getRequestingStaff: async () => null,
    isStaffAllowedForAccount: async () => true,
    createLineShells: async (snapshot: unknown) => {
      const { shells } = await createRichMenuShells(snapshot as never, line as never, fakeR2 as never)
      const oldById = new Map(
        ((snapshot as { pages: Array<{ id: string; lineRichmenuId: string | null }> }).pages ?? []).map((page) => [page.id, page.lineRichmenuId ?? null]),
      )
      return shells.map((shell) => ({
        pageId: shell.pageId,
        orderIndex: shell.orderIndex,
        newRichMenuId: shell.newRichMenuId,
        oldLineRichMenuId: oldById.get(shell.pageId) ?? null,
      }))
    },
    createRestoreShells: async (restoreGroup: never) => {
      const group = restoreGroup as unknown as {
        id: string; is_default_for_all: number;
        pages: Array<{ id: string; order_index: number; name: string; image_r2_key: string | null; image_content_type: string | null; line_richmenu_id: string | null }>;
      }
      const input = {
        id: group.id,
        size: 'large',
        chatBarText: 'test',
        isDefaultForAll: group.is_default_for_all === 1,
        formBaseUrl: null,
        pages: group.pages.map((page) => ({
          id: page.id,
          orderIndex: page.order_index,
          name: page.name,
          imageR2Key: page.image_r2_key,
          imageContentType: page.image_content_type,
          lineRichMenuId: page.line_richmenu_id,
          areas: [],
        })),
      }
      const { shells } = await createRichMenuShells(input as never, line as never, fakeR2 as never)
      const oldById = new Map(input.pages.map((page) => [page.id, page.lineRichMenuId ?? null]))
      return shells.map((shell) => ({
        pageId: shell.pageId,
        orderIndex: shell.orderIndex,
        newRichMenuId: shell.newRichMenuId,
        oldLineRichMenuId: oldById.get(shell.pageId) ?? null,
      }))
    },
    readCurrentDefaultId: async () => line.getCurrentDefaultRichMenuId(),
    switchLiveTo: async ({ groupId, setDefault, shells }: { groupId: string; setDefault: boolean; shells: Array<{ pageId: string; orderIndex: number; newRichMenuId: string; oldLineRichMenuId: string | null }> }) => {
      await switchRichMenuLive(line as never, {
        id: groupId,
        size: 'large',
        chatBarText: '',
        isDefaultForAll: setDefault,
        pages: shells.map((shell) => ({
          id: shell.pageId,
          orderIndex: shell.orderIndex,
          name: '',
          imageR2Key: null,
          imageContentType: null,
          lineRichMenuId: shell.oldLineRichMenuId,
          areas: [],
        })),
      } as never, shells.map((shell) => ({
        pageId: shell.pageId,
        orderIndex: shell.orderIndex,
        newRichMenuId: shell.newRichMenuId,
      })))
    },
    compensateSwitchToPrevious: async ({ groupId, prev, newIds }: { groupId: string; prev: unknown; newIds: string[] }) => {
      const unrestored = await restorePreSwitchLive(line as never, groupId, prev as never)
      await restorePreSwitchDefault(line as never, prev as never, newIds)
      return unrestored
    },
    deleteLineShells: async (_schedule: unknown, ids: string[]) => {
      await deleteRichMenuShells(line as never, ids)
    },
    restoreCapturedDefault: async (_schedule: unknown, lineId: string) => {
      const current = await line.getCurrentDefaultRichMenuId()
      if (current === lineId) return
      try {
        await line.setDefaultRichMenu(lineId)
      } catch (error) {
        if (error instanceof Error && /setDefaultRichMenu failed: 404/.test(error.message)) {
          throw new Error(`no_restore_target: pinned default menu ${lineId} was deleted`)
        }
        throw error
      }
    },
    clearAccountDefault: async (schedule: { group_id: string }) => {
      const pages = sqlite.prepare(`SELECT line_richmenu_id FROM rich_menu_pages WHERE group_id = ?`).all(schedule.group_id) as Array<{ line_richmenu_id: string | null }>
      const own = new Set(pages.map((page) => page.line_richmenu_id).filter((id): id is string => !!id))
      const current = await line.getCurrentDefaultRichMenuId()
      if (current && own.has(current)) {
        await line.clearDefaultRichMenu()
      }
    },
    unlinkIndividualLinks: async (schedule: { id: string; account_id: string; group_id: string }) => {
      const targets = await listScheduleGroupIndividualLinks(db, schedule.account_id, schedule.group_id)
      for (const target of targets) unlinked.push(target.lineUserId)
      return targets.length
    },
  }
}

const T0 = new Date('2026-09-10T01:00:00.000Z')
const T0_ISO = '2026-09-10T01:00:00.000Z'

describe('executor 段階公開（実D1 + fake LINE）', () => {
  let sqlite: Database.Database
  let db: D1Database
  let line: FakeLine
  let unlinked: string[]

  beforeEach(() => {
    sqlite = setupSqlite()
    db = asD1(sqlite)
    line = makeFakeLine()
    unlinked = []
  })

  test('正常系：作る→journal→切替→反映→旧削除で完了する', async () => {
    insertGroup(sqlite, { id: 'menu-1', isDefault: true, pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, { id: 'ok-1', definition_snapshot: snapshotFor('menu-1', ['p1'], true) })

    const result = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: T0 })
    expect(result).toMatchObject({ processed: 1, succeeded: 1 })
    // LINEは切替わっている。
    expect(line.aliases.get('lhx-menu-1-0')).toMatch(/^line-new-/)
    expect(line.defaultId).toBe(line.aliases.get('lhx-menu-1-0'))
    // DBへ反映されている。
    const page = sqlite.prepare(`SELECT line_richmenu_id FROM rich_menu_pages WHERE id = 'p1'`).get() as { line_richmenu_id: string }
    expect(page.line_richmenu_id).toBe(line.aliases.get('lhx-menu-1-0'))
    expect((sqlite.prepare(`SELECT status FROM rich_menu_groups WHERE id = 'menu-1'`).get() as { status: string }).status).toBe('published')
    expect(scheduleRow(sqlite, 'ok-1').status).toBe('completed')
    // journalは1行だけ。
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM rich_menu_schedule_publications`).get() as { n: number }).n).toBe(1)
  })

  test('journal失敗：新メニューだけ消し、既存alias/defaultを変えない', async () => {
    insertGroup(sqlite, { id: 'menu-1', isDefault: true, pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, { id: 'jfail-1', definition_snapshot: snapshotFor('menu-1', ['p1'], true) })

    const result = await processDueRichMenuSchedules(
      failingDb(db, /INTO rich_menu_schedule_publications/), depsFor(sqlite, db, line, unlinked) as never, { now: T0 },
    )
    expect(result).toMatchObject({ retried: 1 })
    // 作りかけは消え、liveは何も変わらない。
    expect(line.menus.size).toBe(0)
    expect(line.aliases.size).toBe(0)
    expect(line.defaultId).toBeNull()
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM rich_menu_schedule_publications`).get() as { n: number }).n).toBe(0)
    const row = scheduleRow(sqlite, 'jfail-1')
    expect(row.status).toBe('scheduled')
    expect(row.next_retry_at).not.toBeNull()
    // 再試行で完了する。
    const retry = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T01:05:00.000Z') })
    expect(retry).toMatchObject({ succeeded: 1 })
    expect(scheduleRow(sqlite, 'jfail-1').status).toBe('completed')
  })

  test('切替途中失敗：旧alias/defaultへ補償し、新メニューを片付ける', async () => {
    insertGroup(sqlite, {
      id: 'menu-1',
      status: 'draft',
      isDefault: true,
      pages: [
        { id: 'a', order: 0, lineId: 'line-old-a' },
        { id: 'b', order: 1, lineId: 'line-old-b' },
      ],
    })
    line.menus.set('line-old-a', { name: 'old-a' })
    line.menus.set('line-old-b', { name: 'old-b' })
    line.aliases.set('lhx-menu-1-0', 'line-old-a')
    line.aliases.set('lhx-menu-1-1', 'line-old-b')
    line.defaultId = 'line-old-a'
    line.failUpsertOn = 2
    insertSchedule(sqlite, { id: 'comp-1', definition_snapshot: snapshotFor('menu-1', ['a', 'b'], true) })

    const result = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: T0 })
    expect(result).toMatchObject({ retried: 1 })
    // 旧へ戻っている。
    expect(line.aliases.get('lhx-menu-1-0')).toBe('line-old-a')
    expect(line.aliases.get('lhx-menu-1-1')).toBe('line-old-b')
    expect(line.defaultId).toBe('line-old-a')
    // 新メニューは消え、journalも消えている。
    expect([...line.menus.keys()].sort()).toEqual(['line-old-a', 'line-old-b'])
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM rich_menu_schedule_publications`).get() as { n: number }).n).toBe(0)
    expect(scheduleRow(sqlite, 'comp-1').status).toBe('scheduled')
  })

  test('切替後停止→再開：作り直さずjournalで終わらせる', async () => {
    insertGroup(sqlite, { id: 'menu-1', isDefault: true, pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, { id: 'resume-1', definition_snapshot: snapshotFor('menu-1', ['p1'], true) })

    // 反映の1手目で停止した想定。切替は済み、DB反映だけ残る。
    const first = await processDueRichMenuSchedules(
      failingDb(db, /UPDATE rich_menu_pages SET line_richmenu_id/), depsFor(sqlite, db, line, unlinked) as never, { now: T0 },
    )
    expect(first).toMatchObject({ retried: 1 })
    expect(line.calls.create).toBe(1)
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM rich_menu_schedule_publications`).get() as { n: number }).n).toBe(1)

    const second = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T01:05:00.000Z') })
    expect(second).toMatchObject({ succeeded: 1 })
    // 作り直しはしない。
    expect(line.calls.create).toBe(1)
    expect(scheduleRow(sqlite, 'resume-1').status).toBe('completed')
    const page = sqlite.prepare(`SELECT line_richmenu_id FROM rich_menu_pages WHERE id = 'p1'`).get() as { line_richmenu_id: string }
    expect(page.line_richmenu_id).toBe(line.aliases.get('lhx-menu-1-0'))
  })

  test('lease takeover：期限内は作らず、期限切れで回収して進む', async () => {
    insertGroup(sqlite, { id: 'menu-1', isDefault: true, pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, { id: 'take-1', definition_snapshot: snapshotFor('menu-1', ['p1'], true) })
    const { acquirePublishLease } = await import('@line-crm/db')
    expect(await acquirePublishLease(db, 'menu-1', 'run-A', T0_ISO)).toBe(true)

    const first = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: T0 })
    expect(first).toMatchObject({ retried: 1 })
    expect(line.calls.create).toBe(0)

    // 11分後：期限切れを回収して進む。
    const second = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T01:11:00.000Z') })
    expect(second).toMatchObject({ succeeded: 1 })
    expect(line.calls.create).toBe(1)
    expect(scheduleRow(sqlite, 'take-1').status).toBe('completed')
  })

  test('期間終了：外部で変わったdefaultでも固定値へ戻す', async () => {
    line.menus.set('line-old', { name: 'old' })
    line.defaultId = 'line-old'
    insertGroup(sqlite, { id: 'menu-1', status: 'draft', isDefault: true, pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, {
      id: 'ext-1', mode: 'period', ends_at: '2026-09-10T02:00:00.000Z',
      definition_snapshot: snapshotFor('menu-1', ['p1'], true),
    })

    const published = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: T0 })
    expect(published).toMatchObject({ succeeded: 1 })
    expect(scheduleRow(sqlite, 'ext-1').restore_default_state).toBe('captured')
    expect(scheduleRow(sqlite, 'ext-1').restore_default_line_id).toBe('line-old')

    // 期間中に管理画面の外でdefaultが変わる。
    line.menus.set('line-external', { name: 'external' })
    line.defaultId = 'line-external'
    sqlite.prepare(`UPDATE rich_menu_schedules SET ends_at = ? WHERE id = 'ext-1'`).run(T0_ISO)

    const restored = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T03:00:00.000Z') })
    expect(restored).toMatchObject({ restored: 1 })
    expect(line.defaultId).toBe('line-old')
    expect(scheduleRow(sqlite, 'ext-1').status).toBe('completed')
  })

  test('固定メニュー削除済み：解除せず恒久失敗に残す', async () => {
    line.menus.set('line-other', { name: 'other' })
    line.defaultId = 'line-other'
    insertGroup(sqlite, { id: 'menu-1', status: 'published', isDefault: true, pages: [{ id: 'p1', lineId: 'line-new-9' }] })
    line.menus.set('line-new-9', { name: 'new-9' })
    insertSchedule(sqlite, { id: 'gone-1', mode: 'period', status: 'published', started_run_id: 'run-S', ends_at: T0_ISO })
    sqlite.prepare(`UPDATE rich_menu_schedules SET restore_default_state = 'captured', restore_default_line_id = 'line-gone' WHERE id = 'gone-1'`).run()

    const result = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T03:00:00.000Z') })
    expect(result).toMatchObject({ failed: 1 })
    // 勝手に解除しない。
    expect(line.defaultId).toBe('line-other')
    expect(line.calls.clear).toBe(0)
    expect(scheduleRow(sqlite, 'gone-1').status).toBe('failed')
  })

  test('no_default：終了時に表示を外す', async () => {
    insertGroup(sqlite, { id: 'menu-1', status: 'published', isDefault: true, pages: [{ id: 'p1', lineId: 'line-new-9' }] })
    line.menus.set('line-new-9', { name: 'new-9' })
    line.defaultId = 'line-new-9'
    sqlite.prepare(`INSERT INTO friends VALUES ('f1', 'account-1', 'U111')`).run()
    sqlite.prepare(`INSERT INTO rich_menu_assignments VALUES ('a1', 'f1', 'account-1', 'menu-1', NULL, 'line-new-9', 'tag_bulk_apply', NULL, 'x', 'x')`).run()
    insertSchedule(sqlite, { id: 'nodef-1', mode: 'period', status: 'published', started_run_id: 'run-S', ends_at: T0_ISO })
    sqlite.prepare(`UPDATE rich_menu_schedules SET restore_default_state = 'no_default', restore_default_line_id = NULL WHERE id = 'nodef-1'`).run()

    const result = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T03:00:00.000Z') })
    expect(result).toMatchObject({ restored: 1 })
    expect(line.defaultId).toBeNull()
    expect(scheduleRow(sqlite, 'nodef-1').status).toBe('completed')
    expect(unlinked).toEqual(['U111'])
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM rich_menu_assignments`).get() as { n: number }).n).toBe(0)
  })

  test('明示の戻し先：現内容を段階公開で戻す', async () => {
    insertGroup(sqlite, { id: 'menu-1', status: 'draft', isDefault: false, pages: [{ id: 'p1' }] })
    insertGroup(sqlite, { id: 'restore-1', status: 'published', isDefault: false, pages: [{ id: 'r1' }] })
    insertSchedule(sqlite, {
      id: 'exp-1', mode: 'period', restore_group_id: 'restore-1', ends_at: '2026-09-10T02:00:00.000Z',
      definition_snapshot: snapshotFor('menu-1', ['p1'], false),
    })

    const published = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: T0 })
    expect(published).toMatchObject({ succeeded: 1 })
    expect(scheduleRow(sqlite, 'exp-1').status).toBe('published')

    sqlite.prepare(`UPDATE rich_menu_schedules SET ends_at = ? WHERE id = 'exp-1'`).run(T0_ISO)
    const restored = await processDueRichMenuSchedules(db, depsFor(sqlite, db, line, unlinked) as never, { now: new Date('2026-09-10T03:00:00.000Z') })
    expect(restored).toMatchObject({ restored: 1 })
    // 戻し先のaliasが新IDを向く。
    const restoreAlias = line.aliases.get('lhx-restore--0')
    expect(restoreAlias).toMatch(/^line-new-/)
    expect(scheduleRow(sqlite, 'exp-1').status).toBe('completed')
    expect((sqlite.prepare(`SELECT status FROM rich_menu_groups WHERE id = 'menu-1'`).get() as { status: string }).status).toBe('draft')
  })

  test('run A/B fencing：古いrunは新しいclaim後に書けない（実D1）', async () => {
    insertGroup(sqlite, { id: 'menu-1', pages: [{ id: 'p1' }] })
    insertSchedule(sqlite, { id: 'fence-1' })
    expect(await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-A', T0_ISO)).toBe(true)
    expect(await reclaimStalePublishingSchedule(db, 'fence-1', 'account-1', T0_ISO)).toBe(false)
    const expired = new Date(T0.getTime() + 11 * 60_000).toISOString()
    expect(await reclaimStalePublishingSchedule(db, 'fence-1', 'account-1', expired)).toBe(true)
    expect(await claimRichMenuSchedule(db, 'fence-1', 'account-1', 'run-B', expired)).toBe(true)
    expect(await recordRichMenuScheduleSuccess(db, 'fence-1', 'account-1', 'run-A', 'completed')).toBe(false)
    expect(await recordRichMenuScheduleSuccess(db, 'fence-1', 'account-1', 'run-B', 'completed')).toBe(true)
  })
})
