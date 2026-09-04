import { describe, expect, test } from 'vitest';

import { getDashboardOverview, getFriendStats, getInboxStats, getListStats } from '../src/dashboard.js';

type Query = { sql: string; binds: unknown[] };

function recordingDb(queries: Query[]): D1Database {
  return {
    prepare(sql: string) {
      const query = { sql, binds: [] as unknown[] };
      queries.push(query);
      const statement = {
        bind(...binds: unknown[]) {
          query.binds = binds;
          return statement;
        },
        async first<T>() { return {} as T; },
        async all<T>() { return { results: [] as T[], success: true, meta: {} }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const scope = { allowedAccountIds: ['account-a', 'account-b'], includeUnassigned: false } as const;

function expectScoped(queries: Query[], fragment: string): void {
  const matches = queries.filter(({ sql }) => sql.includes(fragment));
  expect(matches.length).toBeGreaterThan(0);
  expect(matches.every(({ sql }) => sql.includes('IN (?, ?)'))).toBe(true);
  expect(matches.every(({ binds }) => binds.includes('account-a') && binds.includes('account-b'))).toBe(true);
}

describe('tenant-scoped dashboard aggregations', () => {
  test('getDashboardOverview scopes every account-owned dashboard query and preserves bind order', async () => {
    const queries: Query[] = [];
    await getDashboardOverview(recordingDb(queries), 'last7', scope);

    expect(queries.length).toBeGreaterThanOrEqual(17);
    const accountQueries = queries.filter(({ sql }) => !sql.includes('friend_daily_snapshots'));
    expect(accountQueries.every(({ sql }) => sql.includes('IN (?, ?)'))).toBe(true);
    expect(accountQueries.every(({ binds }) => {
      const a = binds.indexOf('account-a');
      return a >= 0 && binds[a + 1] === 'account-b';
    })).toBe(true);

    const migrations = queries.find(({ sql }) => sql.includes('FROM account_migrations'));
    expect(migrations?.binds).toEqual(['account-a', 'account-b', 'account-a', 'account-b']);
    const broadcasts = queries.find(({ sql }) => sql.includes('FROM broadcasts b'));
    expect(broadcasts?.binds.slice(-4)).toEqual(['account-a', 'account-b', 'account-a', 'account-b']);
  });

  test('getFriendStats scopes friend totals, monthly additions, unanswered and resolved chats', async () => {
    const queries: Query[] = [];
    await getFriendStats(recordingDb(queries), scope);

    expectScoped(queries, 'FROM friends WHERE');
    const inbox = queries.find(({ sql }) => sql.includes('FROM chats c') && sql.includes('AS unanswered'));
    expect(inbox?.sql).toContain('f.line_account_id IN (?, ?)');
    expect(inbox?.binds).toEqual(['account-a', 'account-b']);
  });

  test('getInboxStats scopes waiting, assigned, incoming and first-reply aggregations', async () => {
    const queries: Query[] = [];
    await getInboxStats(recordingDb(queries), 'operator-1', scope);

    expectScoped(queries, "c.status = 'unread'");
    expectScoped(queries, "c.status = 'in_progress'");
    expectScoped(queries, 'GROUP BY c.operator_id');
    expectScoped(queries, "direction = 'incoming'");
    expectScoped(queries, 'first_replied_at IS NOT NULL');
  });

  test('getInboxStats returns unread totals per assignee without turning unassigned into an id', async () => {
    const queries: Query[] = [];
    const db = recordingDb(queries);
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql) as D1PreparedStatement & {
        all: <T>() => Promise<D1Result<T>>;
      };
      if (sql.includes('GROUP BY c.operator_id')) {
        statement.all = async <T>() => ({
          results: [
            { operator_id: null, operator_name: null, unread: 2 },
            { operator_id: 'operator-1', operator_name: 'Kenta', unread: 3 },
          ] as T[],
          success: true,
          meta: {},
        } as D1Result<T>);
      }
      return statement;
    }) as D1Database['prepare'];

    const stats = await getInboxStats(db, 'operator-1', scope);

    expect(stats.assigneeUnread).toEqual([
      { operatorId: null, operatorName: null, unread: 2 },
      { operatorId: 'operator-1', operatorName: 'Kenta', unread: 3 },
    ]);
  });

  test('getListStats passes the scope into friend, message, scenario and reminder counts', async () => {
    const queries: Query[] = [];
    await getListStats(recordingDb(queries), scope);

    expectScoped(queries, 'FROM friend_tags ft JOIN friends f');
    expectScoped(queries, 'FROM scenarios WHERE');
    expectScoped(queries, 'FROM reminders WHERE');
    expectScoped(queries, "source = 'scenario'");
    expectScoped(queries, "source = 'reminder'");
    expectScoped(queries, 'LEFT JOIN support_mark_scopes sms');
    expectScoped(queries, 'FROM operation_audit oa');
    const marks = queries.find(({ sql }) => sql.includes('LEFT JOIN support_mark_scopes sms'));
    expect(marks?.sql).toContain('sm.archived_at IS NULL');
  });
});
