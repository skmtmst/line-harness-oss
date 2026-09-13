import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare } from 'miniflare';
import { saveBookingAdminSettings } from '@line-crm/db';

type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let mf: Miniflare;
let native: RealD1;

async function applyBootstrap(db: RealD1): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements = sql
    .split('\n')
    .reduce<string[]>((out, line) => {
      const last = out.length - 1;
      out[last] = out[last] ? `${out[last]}\n${line}` : line;
      if (line.trimEnd().endsWith(';')) out.push('');
      return out;
    }, [''])
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50).map((statement) => db.prepare(statement)));
  }
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  native = await mf.getD1Database('DB');
  await applyBootstrap(native);
  await native.batch([
    native.prepare(`INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-d1', 'channel-d1', 'D1店', 'token', 'secret')`),
    native.prepare(`INSERT INTO booking_settings (id, line_account_id)
      VALUES ('settings-d1', 'account-d1')`),
    native.prepare(`INSERT INTO booking_business_hours
      (id, booking_settings_id, weekday, start_time, end_time, capacity)
      VALUES ('hours-d1', 'settings-d1', 1, '09:00', '18:00', 2)`),
  ]);
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

const common = {
  lineAccountId: 'account-d1',
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic' as const,
  holdMinutes: 15,
  slotGranularityMinutes: 15 as const,
};

test('実D1で週全体保存・古い版拒否・途中失敗rollbackを保つ', async () => {
  const businessHours = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    intervals: weekday === 1 ? [{ start: '10:00', end: '17:00', capacity: 3 }] : [],
  }));
  await expect(saveBookingAdminSettings(native, {
    ...common, expectedVersion: 1, businessHours,
  })).resolves.toMatchObject({
    status: 'updated', item: { version: 2, businessHoursConfigured: true },
  });

  await expect(saveBookingAdminSettings(native, {
    ...common,
    expectedVersion: 1,
    businessHours: businessHours.map((day) => day.weekday === 1
      ? { weekday: 1, intervals: [{ start: '08:00', end: '20:00', capacity: 9 }] }
      : day),
  })).resolves.toEqual({ status: 'conflict', currentVersion: 2 });

  await expect(saveBookingAdminSettings(native, {
    ...common,
    expectedVersion: 2,
    businessHours: [{
      weekday: 1,
      intervals: [{ start: '11:00', end: '16:00', capacity: 0 }],
    }],
  })).rejects.toThrow();

  expect(await native.prepare(`SELECT start_time, end_time, capacity
    FROM booking_business_hours WHERE booking_settings_id = 'settings-d1'`).all())
    .toMatchObject({ results: [{ start_time: '10:00', end_time: '17:00', capacity: 3 }] });
  expect(await native.prepare(`SELECT version, business_hours_configured
    FROM booking_settings WHERE id = 'settings-d1'`).first())
    .toEqual({ version: 2, business_hours_configured: 1 });
}, 30_000);
