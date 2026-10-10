import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { runActionRows, type ScenarioActionRow } from './scenario-actions.js'

let db: D1Database
let raw: Database.Database
function action(config: Record<string, unknown>, id = 'event-action'): ScenarioActionRow {
  return { id, scenario_id: 'unused', hook: 'step_sent', step_id: null, choice_index: null,
    sort_order: 0, action_type: 'event_booking', config_json: JSON.stringify(config), condition_json: null, repeat_on_refire: 1 }
}
async function run(config: Record<string, unknown>, sourceEventId = 'trigger-1') {
  return runActionRows(db, [action(config), { ...action({ tagIds: ['tag'], op: 'add' }, 'after'), action_type: 'tag' }], 'f1', { accountId: 'a', sourceEventId })
}
function bookings() { return raw.prepare('SELECT friend_id, slot_id, status FROM event_bookings ORDER BY slot_id').all() }

beforeEach(() => {
  ({ db, raw } = createTestD1())
  raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('a','a','A','',''), ('b','b','B','','');`)
  insertFriend(raw, 'f1', { line_account_id: 'a' })
  insertFriend(raw, 'f2', { line_account_id: 'a' })
  raw.exec(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag','後続','a');
    INSERT INTO events (id,line_account_id,name,is_published,lifecycle_status,max_bookings_per_friend,reminder_day_before_enabled,reminder_hours_before)
      VALUES ('e','a','相談会',1,'published',NULL,1,1), ('foreign','b','別店',1,'published',NULL,0,NULL);
    INSERT INTO event_slots (id,event_id,starts_at,ends_at,capacity,sort_order) VALUES
      ('past','e','2020-01-01T01:00:00Z','2020-01-01T02:00:00Z',10,0),
      ('early','e','2099-01-01T01:00:00Z','2099-01-01T02:00:00Z',1,9),
      ('later','e','2099-01-02T01:00:00Z','2099-01-02T02:00:00Z',10,1),
      ('foreign-slot','foreign','2099-01-01T01:00:00Z','2099-01-01T02:00:00Z',10,0);`)
})
afterEach(() => { raw.close(); vi.restoreAllMocks() })

function seed(id: string, friend = 'f2', slot = 'early', event = 'e') {
  raw.prepare(`INSERT INTO event_bookings (id,line_account_id,event_id,slot_id,friend_id,status,requested_at,identity_key) VALUES (?,'a',?,?,?,'confirmed','2026-01-01T00:00:00Z',?)`).run(id,event,slot,friend,`solo:${friend}`)
}
function followed() { expect(raw.prepare('SELECT tag_id FROM friend_tags WHERE friend_id=?').all('f1')).toEqual([{ tag_id: 'tag' }]) }

describe('B-179 イベントの行うこと', () => {
  it('表示順でなく、次の空いている回へ申し込み、同じ出来事の再実行は重複しない', async () => {
    expect((await run({ eventId: 'e' })).failed).toBe(0)
    await run({ eventId: 'e' })
    expect(bookings()).toEqual([{ friend_id: 'f1', slot_id: 'early', status: 'confirmed' }])
    expect(raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({ n: 2 })
    followed()
  })
  it('満席の回を飛ばし、次の回に申し込む（待ちの仮押さえも空きから引く）', async () => {
    raw.exec(`INSERT INTO event_waitlist (id,line_account_id,event_id,slot_id,friend_id,identity_key,status,party_size,created_at,updated_at) VALUES ('held','a','e','early','f2','solo:f2','offered',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
    await run({ eventId: 'e', op: 'register' })
    expect(bookings()).toEqual([{ friend_id: 'f1', slot_id: 'later', status: 'confirmed' }])
  })
  it('回を選んでいるなら、その回を使う', async () => {
    await run({ eventId: 'e', slotId: 'later' })
    expect(bookings()).toEqual([{ friend_id: 'f1', slot_id: 'later', status: 'confirmed' }])
  })
  it.each([{ slotId: 'early' }, {}])('空きがないと理由を残し、後続の処理は続ける（%j）', async (extra) => {
    seed('full')
    raw.exec(`UPDATE event_slots SET capacity=0 WHERE id='later'`)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await run({ eventId: 'e', ...extra })).failed).toBe(1)
    expect(bookings()).toHaveLength(1)
    expect(log.mock.calls.flat().map(String).join(' ')).toContain('空きがありません')
    followed()
  })
  it('指定回が満席でも別の回へ勝手に申し込まない', async () => {
    seed('full')
    expect((await run({ eventId: 'e', slotId: 'early' })).failed).toBe(1)
    expect(bookings()).toHaveLength(1)
  })
  it('承認が必要なイベントは承認待ちにし、確定の知らせを予約しない', async () => {
    raw.exec(`UPDATE events SET requires_approval=1 WHERE id='e'`)
    await run({ eventId: 'e' })
    expect(bookings()).toEqual([{ friend_id: 'f1', slot_id: 'early', status: 'requested' }])
    expect(raw.prepare('SELECT approval_expires_at FROM event_bookings').get()).toEqual({ approval_expires_at: expect.any(String) })
    expect(raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({ n: 0 })
  })
  it('申し込みの取り消しはその人・そのイベントの全ての申込だけを止め、知らせと空き待ちも更新する', async () => {
    await run({ eventId: 'e', slotId: 'early' })
    await run({ eventId: 'e', slotId: 'later' }, 'trigger-2')
    seed('other-friend', 'f2', 'later')
    seed('other-event', 'f1', 'foreign-slot', 'foreign')
    expect((await run({ eventId: 'e', op: 'cancel' }, 'cancel-1')).failed).toBe(0)
    expect(bookings()).toEqual([
      { friend_id: 'f1', slot_id: 'early', status: 'cancelled' },
      { friend_id: 'f1', slot_id: 'foreign-slot', status: 'confirmed' },
      { friend_id: 'f1', slot_id: 'later', status: 'cancelled' },
      { friend_id: 'f2', slot_id: 'later', status: 'confirmed' },
    ])
    expect(raw.prepare(`SELECT COUNT(*) n FROM event_booking_reminders WHERE status='pending'`).get()).toEqual({ n: 0 })
    expect(raw.prepare('SELECT COUNT(*) n FROM event_waitlist_promotion_jobs').get()).toEqual({ n: 2 })
  })
  it('取消対象がなければ理由を残して後続へ進む', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await run({ eventId: 'e', op: 'cancel' })).failed).toBe(1)
    expect(log.mock.calls.flat().map(String).join(' ')).toContain('申し込みがありません')
    followed()
  })
  it('別アカウントのイベントや別イベントの回は使えない', async () => {
    expect((await run({ eventId: 'foreign' })).failed).toBe(1)
    expect((await run({ eventId: 'e', slotId: 'foreign-slot' })).failed).toBe(1)
    expect(bookings()).toHaveLength(0)
  })
  it('友だちごとの上限を超えない', async () => {
    raw.exec(`UPDATE events SET max_bookings_per_friend=1 WHERE id='e'`)
    await run({ eventId: 'e' })
    expect((await run({ eventId: 'e' }, 'another-trigger')).failed).toBe(1)
    expect(bookings()).toHaveLength(1)
  })
})

it('同時に最後の1席へ申し込んでも定員を超えない', async () => {
  raw.exec("UPDATE event_slots SET capacity=0 WHERE id='later'")
  const rows = [action({ eventId: 'e' })]
  const result = await Promise.all(['f1','f2'].map(friendId => runActionRows(db, rows, friendId, { accountId: 'a', sourceEventId: 'same-trigger' })))
  expect(bookings()).toHaveLength(1)
  expect(result.map(r => r.executed).sort()).toEqual([0,1])
})

it('同じ取消を再送しても知らせの取消と空き待ちを二重に登録しない', async () => {
  await run({ eventId: 'e' })
  await run({ eventId: 'e', op: 'cancel' }, 'cancel-1')
  expect((await run({ eventId: 'e', op: 'cancel' }, 'cancel-1')).failed).toBe(0)
  expect(raw.prepare('SELECT COUNT(*) n FROM event_waitlist_promotion_jobs').get()).toEqual({ n: 1 })
})

it('イベントの下書きにも申込・取消・指定回を保存でき、別店の参照を拒む', async () => {
  const { saveScenarioDraft } = await import('./scenario-v6-contract.js')
  raw.exec(`INSERT INTO scenarios (id,line_account_id,name,trigger_type,delivery_mode) VALUES ('scenario','a','案内','manual','relative')`)
  const draftAction = { id: 'act', hook: 'scenario_completed', stepId: null, choiceKey: null, type: 'event_booking', params: { eventId: 'e', slotId: 'later', op: 'cancel' }, condition: null, onFailure: 'continue', sortOrder: 0 }
  await saveScenarioDraft(db, { scenarioId: 'scenario', lineAccountId: 'a', expectedVersion: 0, afterActions: [draftAction], staffId: 'owner' })
  expect(JSON.parse((raw.prepare('SELECT after_actions_json FROM scenario_drafts').get() as { after_actions_json: string }).after_actions_json)).toEqual([draftAction])
  await expect(saveScenarioDraft(db, { scenarioId: 'scenario', lineAccountId: 'a', expectedVersion: 1, afterActions: [{ ...draftAction, params: { eventId: 'foreign' } }], staffId: 'owner' })).rejects.toThrow()
  await expect(saveScenarioDraft(db, { scenarioId: 'scenario', lineAccountId: 'a', expectedVersion: 1, afterActions: [{ ...draftAction, params: { eventId: 'e', slotId: 'foreign-slot' } }], staffId: 'owner' })).rejects.toThrow()
})
