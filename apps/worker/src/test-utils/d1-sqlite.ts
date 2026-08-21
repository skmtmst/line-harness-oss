/*
 * テスト用の D1 もどき。
 *
 * better-sqlite3 を D1Database の形にかぶせる。手書きのモックだと
 * 「SQL が正しいか」を確かめられない。条件ビルダーやアクションのように
 * **SQL そのものが仕様**のものは、本物の SQLite に当てないと意味がない。
 *
 * 実装しているのは実際に使っている口だけ（prepare / bind / first / all / run）。
 * batch や exec は使っていないので置いていない。
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PKG_ROOT = join(__dirname, '../../../../packages/db')

export interface SqliteD1 {
  db: D1Database
  raw: Database.Database
}

function isSelect(sql: string): boolean {
  return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)
}

function wrap(raw: Database.Database, sql: string, args: unknown[]) {
  const normalized = args.map((a) => {
    if (a === undefined) return null
    if (typeof a === 'boolean') return a ? 1 : 0
    return a as never
  })
  return {
    first: async <T = unknown>(): Promise<T | null> => {
      const row = raw.prepare(sql).get(...normalized)
      return (row as T) ?? null
    },
    all: async <T = unknown>(): Promise<{ results: T[] }> => {
      const rows = raw.prepare(sql).all(...normalized)
      return { results: rows as T[] }
    },
    run: async () => {
      const info = raw.prepare(sql).run(...normalized)
      return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
    },
  }
}

/** bootstrap.sql を流した空のDBを作る。 */
export function createTestD1(): SqliteD1 {
  const raw = new Database(':memory:')
  raw.exec(readFileSync(join(DB_PKG_ROOT, 'bootstrap.sql'), 'utf8'))
  // 参照整合性は本番の D1 と同じく既定で切っておく。ここだけ厳しくすると
  // テストのためだけに余分な行を用意することになり、読みにくくなる。
  raw.pragma('foreign_keys = OFF')

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => wrap(raw, sql, args),
      ...(isSelect(sql) ? wrap(raw, sql, []) : wrap(raw, sql, [])),
    }),
  } as unknown as D1Database

  return { db, raw }
}

/** 友だちを1人作る。テストで要る列だけ埋める。 */
export function insertFriend(
  raw: Database.Database,
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  const row: Record<string, unknown> = {
    id,
    line_user_id: `U${id}`,
    display_name: id,
    is_following: 1,
    created_at: '2026-01-01T00:00:00.000',
    updated_at: '2026-01-01T00:00:00.000',
    ...overrides,
  }
  const cols = Object.keys(row)
  raw
    .prepare(
      `INSERT INTO friends (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    )
    .run(...cols.map((c) => row[c] as never))
}
