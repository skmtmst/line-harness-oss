/*
 * タグ条件の入れ子の FROM を正規表現で誤って除去しないよう、集計 SQL を副問い合わせに包んで数える。
 * 実 SQLite に条件を通し、正しい件数を得られることを確かめる。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { buildSegmentQuery } from './segment-query.js';
import { type SegmentCondition } from '@line-crm/shared';

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
