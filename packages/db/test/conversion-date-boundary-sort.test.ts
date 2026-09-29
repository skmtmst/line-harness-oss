import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getConversionEvents, getConversionReport } from '../src/conversions.js';
import { listConversionDefinitions } from '../src/conversion-definitions.js';
import { applyConversionTestSchema } from './conversion-test-schema.js';
import { asD1 } from './d1-test-helper.js';

const scope = { allowedAccountIds: ['account-a'], includeUnassigned: false };
const range = { from: '2026-09-01 00:00:00', to: '2026-09-30 23:59:59', timeZone: 'Asia/Tokyo' as const };

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  applyConversionTestSchema(sqlite);
  sqlite.exec(`
    INSERT INTO conversion_points
      (id, name, event_type, value, line_account_id, status, created_at, updated_at)
    VALUES
      ('point-low',  '低単価',   'purchase', 1000, 'account-a', 'active', '2026-08-01T00:00:00.000+09:00', '2026-09-10T00:00:00.000+09:00'),
      ('point-high', '高単価',   'purchase', 9000, 'account-a', 'active', '2026-08-02T00:00:00.000+09:00', '2026-09-01T00:00:00.000+09:00'),
      ('point-mid',  '中単価',   'purchase', 5000, 'account-a', 'active', '2026-08-03T00:00:00.000+09:00', '2026-09-05T00:00:00.000+09:00'),
      ('point-mid2', '中単価2',  'purchase', 5000, 'account-a', 'active', '2026-08-04T00:00:00.000+09:00', '2026-09-08T00:00:00.000+09:00'),
      ('point-none', '単価なし', 'purchase', NULL, 'account-a', 'active', '2026-08-05T00:00:00.000+09:00', '2026-09-09T00:00:00.000+09:00');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, value_snapshot, created_at)
    VALUES
      ('ev-prev',  'point-low', 'friend-1', 1000, '2026-09-14T12:00:00.000+09:00'),
      ('ev-start', 'point-low', 'friend-1', 1000, '2026-09-15T00:00:00.000+09:00'),
      ('ev-end',   'point-low', 'friend-2', 1000, '2026-09-15T23:59:59.999+09:00'),
      ('ev-next',  'point-low', 'friend-1', 1000, '2026-09-16T00:00:00.000+09:00');
  `);
  return sqlite;
}

describe('終了日の境界', () => {
  it('一覧が終了日当日の成果を含め、前日と翌日を除く', async () => {
    const events = await getConversionEvents(asD1(setup()), {
      scope, startDate: '2026-09-15', endDate: '2026-09-15',
    });
    expect(events.map((e) => e.id)).toEqual(['ev-end', 'ev-start']);
  });

  it('endDate だけの一覧も当日の終端まで含む', async () => {
    const events = await getConversionEvents(asD1(setup()), { scope, endDate: '2026-09-15' });
    expect(events.map((e) => e.id)).toEqual(['ev-end', 'ev-start', 'ev-prev']);
  });

  it('集計も終了日当日の成果を数え、前日と翌日を除く', async () => {
    const report = await getConversionReport(asD1(setup()), {
      startDate: '2026-09-15', endDate: '2026-09-15',
    });
    expect(report.find((r) => r.conversionPointId === 'point-low'))
      .toMatchObject({ totalCount: 2, totalValue: 2000 });
  });
});

describe('単価順ソート', () => {
  it('value_desc は成果1件あたりの単価の降順で、同額は更新日時の新しい順、単価なしは末尾', async () => {
    const result = await listConversionDefinitions(asD1(setup()), {
      scope, range, cursor: 0, limit: 20, sort: 'value_desc',
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'point-high', 'point-mid2', 'point-mid', 'point-low', 'point-none',
    ]);
  });
});
