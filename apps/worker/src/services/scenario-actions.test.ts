/*
 * シナリオのアクションを、本物の SQLite に当てて確かめる。
 *
 * 見るのは「実行したか」ではなく「**データがどう変わったか**」。
 * 実行回数だけ見ていると、条件で弾いたつもりが弾けていない、
 * タグが違う人に付いた、といった間違いを素通しする。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { runScenarioActions, runScenarioOp } from './scenario-actions.js'

let db: D1Database
let raw: Database.Database

const SCENARIO = 's1'
const STEP = 'st1'

function addAction(
  id: string,
  actionType: string,
  config: unknown,
  opts: { condition?: unknown; repeat?: boolean; sortOrder?: number; hook?: string } = {},
) {
  raw
    .prepare(
      `INSERT INTO scenario_actions
         (id, scenario_id, hook, step_id, choice_index, sort_order, action_type, config_json, condition_json, repeat_on_refire)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      SCENARIO,
      opts.hook ?? 'step_sent',
      opts.hook === 'scenario_completed' ? null : STEP,
      opts.sortOrder ?? 0,
      actionType,
      JSON.stringify(config),
      opts.condition ? JSON.stringify(opts.condition) : null,
      opts.repeat === false ? 0 : 1,
    )
}

function tagsOf(friendId: string): string[] {
  return raw
    .prepare(`SELECT tag_id FROM friend_tags WHERE friend_id = ? ORDER BY tag_id`)
    .all(friendId)
    .map((r) => (r as { tag_id: string }).tag_id)
}

function fieldValue(friendId: string, fieldId: string): string | null {
  const row = raw
    .prepare(`SELECT value FROM friend_field_values WHERE friend_id = ? AND field_id = ?`)
    .get(friendId, fieldId) as { value: string } | undefined
  return row?.value ?? null
}

beforeEach(() => {
  const created = createTestD1()
  db = created.db
  raw = created.raw

  insertFriend(raw, 'f1', { line_account_id: 'account-1' })
  insertFriend(raw, 'f2', { line_account_id: 'account-2' })

  raw
    .prepare(
      `INSERT INTO scenarios (id, name, trigger_type, delivery_mode) VALUES ('s1','テスト','manual','relative'), ('s2','移動先','manual','relative')`,
    )
    .run()
  raw
    .prepare(
      `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
       VALUES ('st1','s1',1,0,'text','こんにちは'),
              ('st2','s2',1,0,'text','移動先の1通目')`,
    )
    .run()
  raw
    .prepare(
      `INSERT INTO tags (id, name, color, group_id) VALUES ('t1','犬','#000',NULL), ('t2','猫','#000','g1'), ('t3','鳥','#000','g1')`,
    )
    .run()
  raw
    .prepare(`INSERT INTO friend_fields (id, name, field_key, type) VALUES ('fld1','来店','visits','number')`)
    .run()
  raw.prepare(`INSERT INTO common_vars (id, line_account_id, name, var_key, type, value) VALUES ('v1','account-1','在庫','stock','number','10')`).run()
})

describe('タグ操作', () => {
  it('付ける・外す', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual(['t1'])

    raw.prepare(`DELETE FROM scenario_actions`).run()
    addAction('a2', 'tag', { op: 'remove', tagIds: ['t1'] })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual([])
  })

  it('タグフォルダ指定で、中のタグをまとめて付ける', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: [], folderId: 'g1' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual(['t2', 't3'])
  })

  it('対象の友だちにだけ付く', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f2')).toEqual([])
  })
})

describe('条件', () => {
  it('条件に合わない人には実行しない', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] }, {
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 't2' }] },
    })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.skippedByCondition).toBe(1)
    expect(tagsOf('f1')).toEqual([])
  })

  it('条件に合えば実行する', async () => {
    raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('f1','t2')`).run()
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] }, {
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 't2' }] },
    })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual(['t1', 't2'])
  })

  it('壊れた条件はそもそも保存できない（列の CHECK が弾く）', () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] })
    expect(() =>
      raw.prepare(`UPDATE scenario_actions SET condition_json = '{壊れ' WHERE id = 'a1'`).run(),
    ).toThrow(/json_valid/)
  })

  it('それでも読めない条件が入っていたら、実行せず失敗として数える', async () => {
    // CHECK を通る JSON だが、条件の形になっていない（古い行や手で入れた行）。
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] })
    raw.prepare(`UPDATE scenario_actions SET condition_json = '"ただの文字列"' WHERE id = 'a1'`).run()
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.failed).toBe(1)
    expect(tagsOf('f1')).toEqual([])
  })
})

describe('発動2回目以降', () => {
  it('外していれば1度しか実行しない', async () => {
    addAction('a1', 'friend_field', { fieldId: 'fld1', op: 'add', value: '1' }, { repeat: false })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(fieldValue('f1', 'fld1')).toBe('1')
  })

  it('付けていれば毎回実行する', async () => {
    addAction('a1', 'friend_field', { fieldId: 'fld1', op: 'add', value: '1' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(fieldValue('f1', 'fld1')).toBe('2')
  })

  it('1度きりの記録は友だちごとに別（他の人まで止めない）', async () => {
    addAction('a1', 'friend_field', { fieldId: 'fld1', op: 'add', value: '1' }, { repeat: false })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f2', stepId: STEP })
    expect(fieldValue('f2', 'fld1')).toBe('1')
  })
})

describe('友だち情報欄', () => {
  it('代入・加算・減算・消去', async () => {
    addAction('a1', 'friend_field', { fieldId: 'fld1', op: 'set', value: '5' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(fieldValue('f1', 'fld1')).toBe('5')

    raw.prepare(`DELETE FROM scenario_actions`).run()
    addAction('a2', 'friend_field', { fieldId: 'fld1', op: 'sub', value: '2' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(fieldValue('f1', 'fld1')).toBe('3')

    raw.prepare(`DELETE FROM scenario_actions`).run()
    addAction('a3', 'friend_field', { fieldId: 'fld1', op: 'clear', value: '' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(fieldValue('f1', 'fld1')).toBeNull()
  })

  it('数でない値に加算しても落ちない（0とみなす）', async () => {
    raw
      .prepare(`INSERT INTO friend_field_values (friend_id, field_id, value) VALUES ('f1','fld1','あいう')`)
      .run()
    addAction('a1', 'friend_field', { fieldId: 'fld1', op: 'add', value: '3' })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.failed).toBe(0)
    expect(fieldValue('f1', 'fld1')).toBe('3')
  })
})

describe('並び順と失敗', () => {
  it('並び順のとおりに動く（前のアクションの結果を次の条件で使える）', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] }, { sortOrder: 0 })
    addAction('a2', 'tag', { op: 'add', tagIds: ['t2'] }, {
      sortOrder: 1,
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] },
    })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual(['t1', 't2'])
  })

  it('1つ失敗しても残りは動く', async () => {
    addAction('a1', 'common_var', { varKey: 'ないキー', op: 'add', value: '1' }, { sortOrder: 0 })
    addAction('a2', 'tag', { op: 'add', tagIds: ['t1'] }, { sortOrder: 1 })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.failed).toBe(1)
    expect(result.executed).toBe(1)
    expect(tagsOf('f1')).toEqual(['t1'])
  })
})

describe('中身が埋まっていないアクション', () => {
  /*
   * 画面はカードを1枚置いてから埋める作り。埋まっていない状態でも保存
   * できるが、実行はしない。実行しても何も起きないだけだが、設定した
   * つもりで効いていないことに気づけないため。
   */
  it('タグを1つも選んでいないタグ操作は実行しない', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: [] })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.skippedIncomplete).toBe(1)
    expect(result.executed).toBe(0)
    expect(tagsOf('f1')).toEqual([])
  })

  it('項目を選んでいない友だち情報操作は実行しない', async () => {
    addAction('a1', 'friend_field', { fieldId: '', op: 'set', value: '5' })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.skippedIncomplete).toBe(1)
  })

  it('埋まっていないものだけ飛ばして、埋まっているものは動く', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: [] }, { sortOrder: 0 })
    addAction('a2', 'tag', { op: 'add', tagIds: ['t1'] }, { sortOrder: 1 })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.skippedIncomplete).toBe(1)
    expect(result.executed).toBe(1)
    expect(tagsOf('f1')).toEqual(['t1'])
  })

  it('対応マークの null は「外す」なので実行する', async () => {
    raw.prepare(`INSERT INTO support_marks (id, name, color) VALUES ('m1','未対応','#000')`).run()
    raw.prepare(`UPDATE friends SET support_mark_id = 'm1' WHERE id = 'f1'`).run()
    addAction('a1', 'support_mark', { markId: null })
    const result = await runScenarioActions(db, {
      scenarioId: SCENARIO,
      hook: 'step_sent',
      friendId: 'f1',
      stepId: STEP,
    })
    expect(result.executed).toBe(1)
    const row = raw.prepare(`SELECT support_mark_id FROM friends WHERE id = 'f1'`).get() as {
      support_mark_id: string | null
    }
    expect(row.support_mark_id).toBeNull()
  })
})

describe('発火点', () => {
  it('シナリオ完了時のアクションは、通のアクションと混ざらない', async () => {
    addAction('a1', 'tag', { op: 'add', tagIds: ['t1'] }, { hook: 'step_sent' })
    addAction('a2', 'tag', { op: 'add', tagIds: ['t2'] }, { hook: 'scenario_completed' })

    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    expect(tagsOf('f1')).toEqual(['t1'])

    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'scenario_completed', friendId: 'f1' })
    expect(tagsOf('f1')).toEqual(['t1', 't2'])
  })
})

describe('共通情報', () => {
  it('加算・減算がアカウント単位の値に効く', async () => {
    addAction('a1', 'common_var', { varKey: 'stock', op: 'sub', value: '3' })
    await runScenarioActions(db, { scenarioId: SCENARIO, hook: 'step_sent', friendId: 'f1', stepId: STEP })
    const row = raw.prepare(`SELECT value FROM common_vars WHERE var_key = 'stock'`).get() as { value: string }
    expect(row.value).toBe('7')
  })
})

describe('シナリオ操作', () => {
  it('購読を始める', async () => {
    await runScenarioOp(db, 'f1', SCENARIO, { op: 'start', scenarioId: 's2' })
    const row = raw
      .prepare(`SELECT status FROM friend_scenarios WHERE friend_id = 'f1' AND scenario_id = 's2'`)
      .get() as { status: string } | undefined
    expect(row?.status).toBe('active')
  })

  it('割り込みで前のシナリオを控えて、完了時に戻せる', async () => {
    // s1 を読んでいる途中に s2 へ割り込む
    raw
      .prepare(
        `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at)
         VALUES ('e1','f1','s1',0,'active','2026-01-01T00:00:00.000')`,
      )
      .run()

    await runScenarioOp(db, 'f1', 's1', { op: 'start', scenarioId: 's2', rememberPrevious: true })

    const paused = raw
      .prepare(`SELECT status FROM friend_scenarios WHERE friend_id = 'f1' AND scenario_id = 's1'`)
      .get() as { status: string }
    expect(paused.status).toBe('paused')

    const interrupt = raw
      .prepare(`SELECT previous_scenario_id FROM friend_scenarios WHERE friend_id = 'f1' AND scenario_id = 's2'`)
      .get() as { previous_scenario_id: string | null }
    expect(interrupt.previous_scenario_id).toBe('s1')

    const { resumePreviousScenario } = await import('./scenario-actions.js')
    expect(await resumePreviousScenario(db, 'f1', 's2')).toBe(true)

    const resumed = raw
      .prepare(`SELECT status FROM friend_scenarios WHERE friend_id = 'f1' AND scenario_id = 's1'`)
      .get() as { status: string }
    expect(resumed.status).toBe('active')
  })

  it('控えが無ければ、適当なシナリオを再開しない', async () => {
    raw
      .prepare(
        `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at)
         VALUES ('e1','f1','s1',0,'paused','2026-01-01T00:00:00.000'),
                ('e2','f1','s2',0,'completed','2026-01-01T00:00:00.000')`,
      )
      .run()
    const { resumePreviousScenario } = await import('./scenario-actions.js')
    expect(await resumePreviousScenario(db, 'f1', 's2')).toBe(false)
    const still = raw
      .prepare(`SELECT status FROM friend_scenarios WHERE friend_id = 'f1' AND scenario_id = 's1'`)
      .get() as { status: string }
    expect(still.status).toBe('paused')
  })
})
