import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createReminderStep,
  createReminderWithDraftVersion,
  enrollFriendInReminder,
  enrollFriendsInReminderOnce,
  getPendingReminderDeliveries,
  getReminderDraftVersion,
  getReminderPublishedVersion,
  parseReminderVersionSettings,
  publishReminderDraftVersion,
  recordReminderDraftTest,
  saveReminderDraftVersion,
  type ReminderDraftSettings,
} from '../src/reminders.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query)
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} }
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null
      },
      async run<T>() {
        const info = statement.run(...params)
        return { success: true, meta: { changes: info.changes }, results: [] } as T
      },
      raw: async () => [],
    }) as unknown as D1PreparedStatement
    return make([])
  }
  return {
    prepare,
    batch: async <T = unknown>(statements: D1PreparedStatement[]) =>
      Promise.all(statements.map((statement) => statement.run<T>())),
  } as unknown as D1Database
}

function settings(content: string): ReminderDraftSettings {
  return {
    name: '予約前のお知らせ',
    description: '前日に送る',
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    triggerFieldId: null,
    repeatYearly: false,
    triggerOffsetMinutes: null,
    sendAtTime: null,
    targetTagId: null,
    folderId: null,
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: true,
      daysAfterTarget: 7,
      friendBlocked: true,
    },
    steps: [{
      stableStepId: 'day-before',
      offsetMinutes: 0,
      messageType: 'text',
      messageContent: content,
      offsetDays: -1,
      sendAtTime: '18:00',
    }],
  }
}

describe('V6 リマインダの公開版', () => {
  let sqlite: Database.Database
  let db: D1Database

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'))
    db = asD1(sqlite)
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-1', 'U1', 'account-1', '田中さくら');
    `)
  })

  afterEach(() => sqlite.close())

  async function testAndPublish(reminderId: string) {
    const draft = await getReminderDraftVersion(db, reminderId)
    await recordReminderDraftTest(db, draft!.id, { succeeded: true, staffId: 'staff-1' })
    return publishReminderDraftVersion(db, reminderId, 'staff-1')
  }

  it('PKG28: 1001件を500件ずつ巡回し、公開版の読込をまとめ、未来と配信済みの区別を保つ', async () => {
    const created=await createReminderWithDraftVersion(db,settings('旧版の未来の通知'));
    const published=await testAndPublish(created.reminder.id);
    for(let index=0;index<1001;index++)sqlite.prepare(`INSERT INTO friend_reminders
      (id,friend_id,reminder_id,target_date,reminder_version_id) VALUES(?,'friend-1',?,'2027-01-01T00:00:00+09:00',?)`)
      .run('page-'+String(index).padStart(4,'0'),created.reminder.id,published.id);
    sqlite.exec("INSERT INTO friend_reminder_deliveries(id,friend_reminder_id,reminder_step_id) VALUES('delivered','page-0000','day-before')");
    await saveReminderDraftVersion(db,created.reminder.id,settings('新版'));
    await testAndPublish(created.reminder.id);
    let reads=0;
    const counted={prepare:(sql:string)=>{reads++;return db.prepare(sql)},batch:db.batch.bind(db)} as D1Database;
    const first=await getPendingReminderDeliveries(counted);
    expect(reads).toBeLessThanOrEqual(5);
    expect(first).toHaveLength(499);expect(first[0].steps[0].message_content).toBe('旧版の未来の通知');
    const second=await getPendingReminderDeliveries(counted),third=await getPendingReminderDeliveries(counted);
    expect(second).toHaveLength(500);expect(third).toHaveLength(1);
    expect(new Set([...first,...second,...third].map(row=>row.id)).size).toBe(1000);
    expect(await getPendingReminderDeliveries(counted)).toHaveLength(499);
  });

  it('既存登録は旧版を維持し、新規登録だけ新版へ進める', async () => {
    const created = await createReminderWithDraftVersion(db, settings('明日のご予約です'))
    const version1 = await testAndPublish(created.reminder.id)
    const first = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-01T10:00:00.000Z',
      sourceKind: 'booking',
      sourceId: 'booking-1',
      sourceEventId: 'booking:booking-1',
    })

    const nextSettings = settings('明後日のご予約です')
    nextSettings.deliveryMode = 'countdown'
    const draft2 = await saveReminderDraftVersion(db, created.reminder.id, nextSettings)
    expect(draft2.version_number).toBe(2)
    expect((await getReminderPublishedVersion(db, created.reminder.id))?.id).toBe(version1.id)
    expect(parseReminderVersionSettings(draft2).steps[0].messageContent).toBe('明後日のご予約です')

    const version2 = await testAndPublish(created.reminder.id)
    const second = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-02T10:00:00.000Z',
      sourceKind: 'event',
      sourceEventId: 'event:booking-2',
    })

    expect(first.reminder_version_id).toBe(version1.id)
    expect(second.reminder_version_id).toBe(version2.id)
    expect(sqlite.prepare('SELECT status FROM reminder_versions WHERE id = ?').get(version1.id))
      .toEqual({ status: 'superseded' })
    const pending = await getPendingReminderDeliveries(db)
    expect(pending.find((row) => row.id === first.id)?.steps[0].message_content).toBe('明日のご予約です')
    expect(pending.find((row) => row.id === second.id)?.steps[0].message_content).toBe('明後日のご予約です')
    expect(pending.find((row) => row.id === first.id)?.delivery_mode).toBe('time')
    expect(pending.find((row) => row.id === second.id)?.delivery_mode).toBe('countdown')
  })

  it('公開済みの設定・通知・状態を後戻りさせない', async () => {
    const created = await createReminderWithDraftVersion(db, settings('明日のご予約です'))
    const published = await testAndPublish(created.reminder.id)

    expect(() => sqlite.prepare(
      `UPDATE reminder_versions SET settings_snapshot = '{}' WHERE id = ?`,
    ).run(published.id)).toThrow('published reminder versions are immutable')
    expect(() => sqlite.prepare(
      `UPDATE reminder_version_steps SET message_content = '書き換え' WHERE reminder_version_id = ?`,
    ).run(published.id)).toThrow('published reminder version steps are immutable')
    expect(() => sqlite.prepare(
      `UPDATE reminder_versions SET status = 'draft' WHERE id = ?`,
    ).run(published.id)).toThrow('published reminder version status cannot move backwards')
  })

  it('旧APIで作った定義も最初の登録時に公開版へ固定する', async () => {
    sqlite.exec(`
      INSERT INTO reminders
        (id, name, line_account_id, is_active, trigger_type, delivery_mode)
      VALUES ('legacy-reminder', '誕生日', 'account-1', 1, 'friend_field', 'countdown');
    `)
    await createReminderStep(db, {
      reminderId: 'legacy-reminder',
      offsetMinutes: -60,
      messageType: 'text',
      messageContent: 'お誕生日のお知らせ',
    })
    const enrollment = await enrollFriendInReminder(db, {
      reminderId: 'legacy-reminder',
      friendId: 'friend-1',
      targetDate: '2026-09-10T00:00:00+09:00',
      sourceKind: 'friend_field',
    })

    expect(enrollment.reminder_version_id).toBe('reminder-version-legacy-legacy-reminder')
    expect((await getPendingReminderDeliveries(db))[0].steps[0].message_content)
      .toBe('お誕生日のお知らせ')
  })

  // FORM-15: 空欄・暦に無い日付の登録予定は入口で止める。
  // 届くものが無い行を残さないため。
  it.each(['', '   ', 'not-a-date', '2026-02-30'])(
    '起点日が日付として読めない(%s)と登録を断る',
    async (targetDate) => {
      await expect(
        enrollFriendInReminder(db, {
          reminderId: 'any',
          friendId: 'friend-1',
          targetDate,
        }),
      ).rejects.toThrow('REMINDER_INVALID_TARGET_DATE')
    },
  )

  it('日時つきの起点日は従来どおり受け付ける', async () => {
    const created = await createReminderWithDraftVersion(db, settings('明日のご予約です'))
    await testAndPublish(created.reminder.id)
    await expect(
      enrollFriendInReminder(db, {
        reminderId: created.reminder.id,
        friendId: 'friend-1',
        targetDate: '2026-09-10T00:00:00+09:00',
      }),
    ).resolves.toBeTruthy()
  })
  it('PKG25: 情報欄のまとめ登録も公開版を固定し、次の公開で既存の本文・時刻を変えない', async () => {
    const created = await createReminderWithDraftVersion(db, settings('First'));
    await recordReminderDraftTest(db, created.version.id, { succeeded: true, staffId: null });
    const first = await publishReminderDraftVersion(db, created.reminder.id, null);
    expect(await enrollFriendsInReminderOnce(db, created.reminder.id,
      [{ friendId: 'friend-1', targetDate: '2030-10-08T00:00:00+09:00' }])).toBe(1);
    const nextSettings = settings('Second'); nextSettings.steps[0].offsetDays = -2;
    const second = await saveReminderDraftVersion(db, created.reminder.id, nextSettings);
    await recordReminderDraftTest(db, second.id, { succeeded: true, staffId: null });
    await publishReminderDraftVersion(db, created.reminder.id, null);
    const pending = await getPendingReminderDeliveries(db);
    expect(pending[0].reminder_version_id).toBe(first.id);
    expect(pending[0].steps[0]).toMatchObject({ message_content: 'First', offset_days: -1 });
  });

})
