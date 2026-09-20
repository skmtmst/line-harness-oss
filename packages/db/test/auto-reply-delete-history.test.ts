import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deleteAutoReply, getAutoReplyById, getAutoReplyHitCountSince } from '../src/auto-replies.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query)
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = statement.run(...params)
              return { success: true, results: [], meta: { changes: result.changes } }
            },
            async first<T>() {
              return (statement.get(...params) as T) ?? null
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('自動応答を削除した後の実行履歴', () => {
  it('削除は行を残して deleted_at を記録し、過去に当たった記録も残す（N-085）', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'))
    sqlite.prepare(
      `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content)
       VALUES ('rule-1', '予約', 'contains', 'text', 'ご予約ですね')`,
    ).run()
    sqlite.prepare(
      `INSERT INTO auto_reply_hits (id, auto_reply_id, matched_keyword)
       VALUES ('hit-1', 'rule-1', '予約')`,
    ).run()

    await deleteAutoReply(asD1(sqlite), 'rule-1', 'staff-1')

    const row = sqlite.prepare(
      `SELECT is_active, deleted_at, deleted_by_staff_id FROM auto_replies WHERE id = 'rule-1'`,
    ).get() as { is_active: number; deleted_at: string | null; deleted_by_staff_id: string | null }
    expect(row.is_active).toBe(0)
    expect(row.deleted_at).not.toBeNull()
    expect(row.deleted_by_staff_id).toBe('staff-1')
    expect(sqlite.prepare('SELECT auto_reply_id FROM auto_reply_hits').get()).toEqual({ auto_reply_id: 'rule-1' })
    // 削除済みは通常の取得対象から外れる。
    await expect(getAutoReplyById(asD1(sqlite), 'rule-1')).resolves.toBeNull()
  })

  it('公開前確認の一致数は指定日時より後だけを数える', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'))
    sqlite.prepare(
      `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content)
       VALUES ('rule-1', '予約', 'contains', 'text', 'ご予約ですね')`,
    ).run()
    const insert = sqlite.prepare(
      `INSERT INTO auto_reply_hits (id, auto_reply_id, matched_keyword, hit_at)
       VALUES (?, 'rule-1', '予約', ?)`,
    )
    insert.run('hit-old', '2026-07-01T00:00:00.000Z')
    insert.run('hit-new-1', '2026-08-20T00:00:00.000Z')
    insert.run('hit-new-2', '2026-08-25T00:00:00.000Z')

    await expect(
      getAutoReplyHitCountSince(asD1(sqlite), 'rule-1', '2026-08-01T00:00:00.000Z'),
    ).resolves.toBe(2)
  })
})
