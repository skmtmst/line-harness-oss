/*
 * 条件ビルダーで増やした絞り込みを、本物の SQLite に当てて確かめる。
 *
 * 組み立てた SQL の文字列を見るテストにはしない。文字列が想定どおりでも
 * 意味が違えば配信先がずれる。**誰が残るか**で見る。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { buildSegmentQuery, matchesCondition, type SegmentCondition } from './segment-query.js'

let db: D1Database
let raw: Database.Database

async function idsMatching(condition: SegmentCondition): Promise<string[]> {
  const { sql, bindings } = buildSegmentQuery(condition)
  const rows = await db.prepare(sql).bind(...bindings).all<{ id: string }>()
  return rows.results.map((r) => r.id).sort()
}

beforeEach(() => {
  const created = createTestD1()
  db = created.db
  raw = created.raw

  insertFriend(raw, 'a', { display_name: '田中 太郎', real_name: '田中太郎', created_at: '2026-01-10T10:00:00.000' })
  insertFriend(raw, 'b', { display_name: '鈴木 花子', private_memo: 'VIP のお客様', created_at: '2026-02-10T10:00:00.000' })
  insertFriend(raw, 'c', { display_name: 'Carol', status_message: 'よろしく', created_at: '2026-03-10T10:00:00.000' })

  raw.prepare(`INSERT INTO tags (id, name, color) VALUES ('t1','犬','#000000'), ('t2','猫','#000000')`).run()
  raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('a','t1'), ('a','t2'), ('b','t1')`).run()

  raw
    .prepare(
      `INSERT INTO friend_fields (id, name, field_key, type) VALUES ('f1','来店回数','visit_count','number')`,
    )
    .run()
  raw
    .prepare(
      `INSERT INTO friend_field_values (friend_id, field_id, value) VALUES ('a','f1','12'), ('b','f1','3')`,
    )
    .run()
})

describe('タグ', () => {
  it('全部含む人だけを返す（いずれか1つ、とは違う）', async () => {
    expect(await idsMatching({ operator: 'AND', rules: [{ type: 'tag_all', value: ['t1', 't2'] }] })).toEqual(['a'])
    expect(await idsMatching({ operator: 'OR', rules: [{ type: 'tag_exists', value: 't1' }] })).toEqual(['a', 'b'])
  })

  it('全部含む人を除外する', async () => {
    expect(
      await idsMatching({ operator: 'AND', rules: [{ type: 'tag_not_all', value: ['t1', 't2'] }] }),
    ).toEqual(['b', 'c'])
  })

  it('タグが空の配列なら組み立てを断る（全員一致を作らせない）', () => {
    expect(() => buildSegmentQuery({ operator: 'AND', rules: [{ type: 'tag_all', value: [] }] })).toThrow()
  })
})

describe('名前', () => {
  it('半角スペース区切りはいずれかに一致（OR）', async () => {
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '田中 鈴木', targets: ['display'] } }],
      }),
    ).toEqual(['a', 'b'])
  })

  it('探す欄を選べる', async () => {
    // real_name にしか入っていない形で探す
    raw.prepare(`UPDATE friends SET display_name = 'ニックネーム' WHERE id = 'a'`).run()
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '田中太郎', targets: ['real'] } }],
      }),
    ).toEqual(['a'])
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '田中太郎', targets: ['display'] } }],
      }),
    ).toEqual([])
  })
})

describe('友だち情報欄', () => {
  it('数の比較は文字列ではなく数として行う', async () => {
    // 文字列比較なら '12' < '3' になり a が落ちる
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'friend_field', value: { fieldId: 'f1', op: 'gte', text: '10' } }],
      }),
    ).toEqual(['a'])
  })

  it('登録なしは、行が無い人も拾う', async () => {
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'friend_field', value: { fieldId: 'f1', op: 'not_exists' } }],
      }),
    ).toEqual(['c'])
  })
})

describe('登録日', () => {
  it('日付だけを渡しても、その日の終わりまで含む', async () => {
    expect(
      await idsMatching({
        operator: 'AND',
        rules: [{ type: 'registered_at', value: { from: '2026-02-01', to: '2026-02-10' } }],
      }),
    ).toEqual(['b'])
  })

  it('from も to も無ければ組み立てを断る', () => {
    expect(() =>
      buildSegmentQuery({ operator: 'AND', rules: [{ type: 'registered_at', value: {} }] }),
    ).toThrow()
  })
})

describe('and と or の入れ子', () => {
  it('親が AND、子グループが OR として効く', async () => {
    // 「犬タグがある」かつ「(名前が田中 または 来店3回)」
    const ids = await idsMatching({
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 't1' }],
      groups: [
        {
          operator: 'OR',
          rules: [
            { type: 'name', value: { text: '田中', targets: ['display'] } },
            { type: 'friend_field', value: { fieldId: 'f1', op: 'equals', text: '3' } },
          ],
        },
      ],
    })
    expect(ids).toEqual(['a', 'b'])
  })

  it('空のグループは足さない（OR で全員一致にならない）', async () => {
    const ids = await idsMatching({
      operator: 'AND',
      rules: [{ type: 'tag_all', value: ['t1', 't2'] }],
      groups: [{ operator: 'OR', rules: [] }],
    })
    expect(ids).toEqual(['a'])
  })
})

describe('matchesCondition', () => {
  it('一覧に出る人と、1人ずつの判定が一致する', async () => {
    const condition: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 't1' }],
    }
    const listed = await idsMatching(condition)
    for (const id of ['a', 'b', 'c']) {
      expect(await matchesCondition(db, id, condition)).toBe(listed.includes(id))
    }
  })

  it('条件が null / 空なら全員あてはまる（絞り込みなしの意味）', async () => {
    expect(await matchesCondition(db, 'c', null)).toBe(true)
    expect(await matchesCondition(db, 'c', { operator: 'AND', rules: [] })).toBe(true)
  })
})
