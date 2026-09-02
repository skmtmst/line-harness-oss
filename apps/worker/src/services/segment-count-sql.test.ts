/*
 * 絞り込みの件数SQL。
 *
 * 組み立てた SQL を「包んで数える」形にしていること、そして
 * **条件の中に FROM が入っていても壊れないこと**を確かめる。
 *
 * 以前は /^SELECT .+ FROM/ を置き換えて件数SQLを作っていた。`.+` が
 * 貪欲なので、タグの条件（EXISTS (SELECT 1 FROM friend_tags ...)）を
 * 入れると `FROM friend_tags` まで食べてしまい、タグで絞ると常に
 * 400 が返っていた。同じ形に戻らないように、実際に SQLite で数える。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { buildSegmentQuery, type SegmentCondition } from './segment-query.js'

let db: D1Database
let raw: Database.Database

/** 本番の口（routes/broadcasts.ts の /api/segments/count）と同じ組み立て。 */
async function countMatching(
  condition: SegmentCondition,
  accountId?: string,
): Promise<number> {
  const { sql, bindings } = buildSegmentQuery(condition)
  let accountSql = sql
  const accountBindings = [...bindings]
  if (accountId) {
    accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')
    accountBindings.unshift(accountId)
  }
  const countSql = `SELECT COUNT(*) AS count FROM (${accountSql}) q`
  const row = await db
    .prepare(countSql)
    .bind(...accountBindings)
    .first<{ count: number }>()
  return row?.count ?? 0
}

beforeEach(() => {
  const created = createTestD1()
  db = created.db
  raw = created.raw

  insertFriend(raw, 'a', { line_account_id: 'acc1' })
  insertFriend(raw, 'b', { line_account_id: 'acc1' })
  insertFriend(raw, 'c', { line_account_id: 'acc2' })

  raw.prepare(`INSERT INTO tags (id, name, color) VALUES ('t1','犬','#000')`).run()
  raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('a','t1'), ('c','t1')`).run()
})

describe('件数SQL', () => {
  it('条件が FROM を含んでいても数えられる（タグ）', async () => {
    expect(await countMatching({ operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] })).toBe(2)
  })

  it('アカウントで絞っても数えられる', async () => {
    expect(
      await countMatching({ operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] }, 'acc1'),
    ).toBe(1)
  })

  it('条件なしなら全員', async () => {
    expect(await countMatching({ operator: 'AND', rules: [] })).toBe(3)
  })

  it('入れ子の or グループがあっても数えられる', async () => {
    expect(
      await countMatching({
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }],
        groups: [
          {
            operator: 'OR',
            rules: [
              { type: 'tag_exists', value: 't1' },
              { type: 'name', value: { text: 'b', targets: ['display'] } },
            ],
          },
        ],
      }),
    ).toBe(3)
  })

  it('複数の FROM を含む条件でも数えられる', async () => {
    raw
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES ('m1','a','incoming','text','こんにちは','2026-01-05T00:00:00.000')`,
      )
      .run()
    expect(
      await countMatching({
        operator: 'AND',
        rules: [
          { type: 'tag_exists', value: 't1' },
          { type: 'reaction_state', value: 'reply' },
        ],
      }),
    ).toBe(1)
  })
})
