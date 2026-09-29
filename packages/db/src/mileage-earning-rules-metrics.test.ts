import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMileageRule,
  enqueueMileageEvent,
  processPendingMileageEvents,
} from './mileage.js';
import {
  getMileageEarningRulesV6,
  publishMileageEarningRule,
  saveMileageEarningRuleDraft,
} from './mileage-admin-v6.js';

/**
 * R53: 過去30日の付与額が現在の下書き金額で変わる。
 * 履歴は100+200=300マイルでも「2回×下書き1000」で2000と表示されていた。
 * 台帳に残った実際の付与額の合計を返し、下書き金額を変えても
 * 同じ履歴は同じ額になることを固定する。
 */

const packageRoot = join(import.meta.dirname, '..');
const bootstrap = readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  const db = { prepare } as unknown as D1Database;
  (db as unknown as Record<string, unknown>).batch = async (statements: D1PreparedStatement[]) => {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as { run(): Promise<unknown> }).run());
    }
    return results;
  };
  return db;
}

const ACCOUNT = 'account-r53';

function draftWithAmount(amount: number) {
  return {
    name: '予約でたまる',
    eventType: 'booking_created',
    source: null,
    amount,
    initialStatus: 'available',
    validFrom: null,
    validUntil: null,
    expiresAfterDays: null,
    cancellationEventTypes: [],
    targetConditions: null,
    sortOrder: 0,
    notification: { enabled: false, messageTemplate: '' },
  };
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(bootstrap);
  db = asD1(sqlite);
});

describe('R53 この30日の付与額は台帳の実額', () => {
  it('下書き金額を変えても同じ履歴は同じ額', async () => {
    sqlite
      .prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, ?)`)
      .run(ACCOUNT, 'ch-r53', 'R53確認用', 'token', 'secret');
    sqlite
      .prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES (?, ?, ?, ?)`)
      .run('friend-r53', 'U-r53', 'R53 太郎', ACCOUNT);
    const rule = await createMileageRule(db, {
      name: '予約でたまる',
      eventType: 'booking_created',
      amount: 100,
      lineAccountId: ACCOUNT,
    });
    await saveMileageEarningRuleDraft(db, {
      ruleId: rule.id, lineAccountId: ACCOUNT, expectedVersion: null, draft: draftWithAmount(100),
    });
    await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: ACCOUNT, expectedVersion: 1, idempotencyKey: 'r53-first',
    });
    // 100マイル×2回の付与を台帳に残す。
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'evt-r53-1', friendId: 'friend-r53',
    });
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'evt-r53-2', friendId: 'friend-r53',
    });
    const processed = await processPendingMileageEvents(db, { limit: 10 });
    expect(processed.granted).toBe(2);

    // 下書きだけ1000マイルに変えても、履歴の額は200のまま。
    await saveMileageEarningRuleDraft(db, {
      ruleId: rule.id, lineAccountId: ACCOUNT, expectedVersion: 1, draft: draftWithAmount(1000),
    });
    const overview = await getMileageEarningRulesV6(db, { lineAccountId: ACCOUNT, limit: 10, offset: 0 });
    expect(overview.items).toHaveLength(1);
    expect(overview.items[0]?.metrics30d.granted).toBe(2);
    expect(overview.items[0]?.metrics30d.grantedMiles).toBe(200);
  });
});
