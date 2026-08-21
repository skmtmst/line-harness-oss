/*
 * シナリオの開始のきっかけ。
 *
 * ここを間違えると、**始まるはずのシナリオが始まらない**か、
 * **始まってはいけない人に配信が流れる**。どちらも気づきにくいので、
 * 本物の SQLite に当てて「誰のどれが始まるか」で見る。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1 } from '../test-utils/d1-sqlite.js'
import {
  getFriendAddScenarioIds,
  getTagAddedScenarioIds,
  getScenarioTriggers,
  addScenarioTrigger,
  removeScenarioTrigger,
} from '@line-crm/db'

let db: D1Database
let raw: Database.Database

beforeEach(() => {
  const created = createTestD1()
  db = created.db
  raw = created.raw

  raw
    .prepare(
      `INSERT INTO scenarios (id, name, trigger_type, delivery_mode, is_active) VALUES
         ('s-add','友だち追加で始まる','friend_add','absolute_time',1),
         ('s-tag','タグで始まる','tag_added','absolute_time',1),
         ('s-both','どちらでも始まる','manual','absolute_time',1),
         ('s-off','止めてある','friend_add','absolute_time',0),
         ('s-none','外から呼ぶだけ','manual','absolute_time',1)`,
    )
    .run()
  raw.prepare(`INSERT INTO tags (id, name, color) VALUES ('t1','犬','#000'), ('t2','猫','#000')`).run()
})

describe('友だち追加で始まるシナリオ', () => {
  it('きっかけが付いているものだけ返す', async () => {
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    expect(await getFriendAddScenarioIds(db)).toEqual(['s-add'])
  })

  it('止めてあるシナリオは返さない', async () => {
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    await addScenarioTrigger(db, 's-off', 'friend_add', null)
    expect(await getFriendAddScenarioIds(db)).toEqual(['s-add'])
  })

  it('きっかけが1つも無ければ空（外から呼ぶだけのシナリオ）', async () => {
    expect(await getFriendAddScenarioIds(db)).toEqual([])
  })
})

describe('タグが付いたときに始まるシナリオ', () => {
  it('そのタグに紐づくものだけ返す', async () => {
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    expect(await getTagAddedScenarioIds(db, 't1')).toEqual(['s-tag'])
    expect(await getTagAddedScenarioIds(db, 't2')).toEqual([])
  })

  it('1本のシナリオを複数のタグから始められる', async () => {
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't2')
    expect(await getTagAddedScenarioIds(db, 't1')).toEqual(['s-tag'])
    expect(await getTagAddedScenarioIds(db, 't2')).toEqual(['s-tag'])
  })

  it('止めてあるシナリオは返さない', async () => {
    raw.prepare(`UPDATE scenarios SET is_active = 0 WHERE id = 's-tag'`).run()
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    expect(await getTagAddedScenarioIds(db, 't1')).toEqual([])
  })
})

describe('1本に複数のきっかけ', () => {
  it('友だち追加とタグの両方を持てる（これまでは片方だけだった）', async () => {
    await addScenarioTrigger(db, 's-both', 'friend_add', null)
    await addScenarioTrigger(db, 's-both', 'tag_added', 't1')

    expect(await getFriendAddScenarioIds(db)).toContain('s-both')
    expect(await getTagAddedScenarioIds(db, 't1')).toContain('s-both')

    const triggers = await getScenarioTriggers(db, 's-both')
    expect(triggers.map((t) => t.kind).sort()).toEqual(['friend_add', 'tag_added'])
  })
})

describe('二重登録', () => {
  it('同じきっかけを2回足しても1つにしかならない', async () => {
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    expect(await getScenarioTriggers(db, 's-add')).toHaveLength(1)
    // 2つ入っていると、友だち追加のたびに同じシナリオを2回開始しようとする。
    expect(await getFriendAddScenarioIds(db)).toEqual(['s-add'])
  })

  it('同じタグを2回足しても1つ', async () => {
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    expect(await getScenarioTriggers(db, 's-tag')).toHaveLength(1)
  })

  it('タグが違えば別のきっかけとして入る', async () => {
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't1')
    await addScenarioTrigger(db, 's-tag', 'tag_added', 't2')
    expect(await getScenarioTriggers(db, 's-tag')).toHaveLength(2)
  })
})

describe('外す', () => {
  it('外すと始まらなくなる', async () => {
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    const [trigger] = await getScenarioTriggers(db, 's-add')
    await removeScenarioTrigger(db, 's-add', trigger.id)
    expect(await getFriendAddScenarioIds(db)).toEqual([])
  })

  it('他のシナリオのきっかけは消せない', async () => {
    await addScenarioTrigger(db, 's-add', 'friend_add', null)
    const [trigger] = await getScenarioTriggers(db, 's-add')
    await removeScenarioTrigger(db, 's-tag', trigger.id)
    expect(await getScenarioTriggers(db, 's-add')).toHaveLength(1)
  })
})

describe('131 の移し替え', () => {
  it('もとの trigger_type / trigger_tag_id がそのまま移っている', () => {
    // bootstrap.sql は 131 まで当てたあとの状態。そこへ入れた行は
    // 移し替えの対象外なので、移し替えの SQL を同じ形で流して確かめる。
    raw
      .prepare(
        `INSERT OR IGNORE INTO scenario_triggers (id, scenario_id, kind, tag_id)
         SELECT lower(hex(randomblob(16))), id, trigger_type,
                CASE WHEN trigger_type = 'tag_added' THEN trigger_tag_id ELSE NULL END
           FROM scenarios
          WHERE trigger_type IN ('friend_add','tag_added')
            AND (trigger_type != 'tag_added' OR trigger_tag_id IS NOT NULL)`,
      )
      .run()

    const kinds = raw
      .prepare(`SELECT scenario_id, kind FROM scenario_triggers ORDER BY scenario_id`)
      .all() as Array<{ scenario_id: string; kind: string }>

    // friend_add の2本は移る。tag_added はタグ未設定なので移らない
    // （移すと「タグ無しで始まる」意味不明な行になる）。manual は対象外。
    expect(kinds).toEqual([
      { scenario_id: 's-add', kind: 'friend_add' },
      { scenario_id: 's-off', kind: 'friend_add' },
    ])
  })
})
