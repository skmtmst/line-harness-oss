import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

let testDb: ReturnType<typeof createTestD1>;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
  ).run();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('配信枠の取得と判定', () => {
  it.each([
    { quota: 'fail', consumption: 'ok', tenant: false, status: 'unknown', summary: '配信上限を確認できませんでした' },
    { quota: 'unlimited', consumption: 'ok', tenant: false, status: 'unknown', summary: '配信上限を確認できませんでした' },
    { quota: 'limited', consumption: 'fail', tenant: false, status: 'unknown', summary: '配信上限を確認できませんでした' },
    { quota: 'limited', consumption: 'ok', tenant: false, status: 'normal', summary: '今月の配信枠に余裕があります' },
    { quota: 'fail', consumption: 'ok', tenant: true, status: 'unknown', summary: '配信上限を確認できませんでした' },
    { quota: 'limited', consumption: 'fail', tenant: true, status: 'unknown', summary: '配信上限を確認できませんでした' },
    { quota: 'unlimited', consumption: 'ok', tenant: true, status: 'normal', summary: '今月の配信枠に余裕があります' },
    { quota: 'unlimited', consumption: 'fail', tenant: true, status: 'normal', summary: '今月の配信枠に余裕があります' },
    { quota: 'limited', consumption: 'high', tenant: false, status: 'warning', summary: '今月の配信枠が少なくなっています' },
  ])('配信枠の取得状態を区別する: $quota / $consumption / tenant=$tenant', async ({ quota, consumption, tenant, status, summary }) => {
    if (tenant) {
      testDb.raw.prepare("INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', 'light', 'active')").run();
      testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/quota/consumption')) return consumption === 'fail' ? new Response(null, { status: 503 }) : Response.json({ totalUsage: consumption === 'high' ? 850 : 10 });
      return quota === 'fail' ? new Response(null, { status: 503 }) : Response.json(quota === 'unlimited' ? { type: 'none' } : { type: 'limited', value: 1000 });
    }));
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    const checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T05:00:00.000Z' });
    const item = checked.run.results.find((entry) => entry.checkKey === 'message_quota');
    expect(item).toMatchObject({ status, summary, source: 'line_messaging_api' });
    if (status === 'unknown') expect(item?.value?.sendable ?? null).toBeNull();
  });
  it.each([
    { plan: 'light', line: 'fail', used: 4250, planned: 0, status: 'warning' },
    { plan: 'light', line: 'fail', used: 4800, planned: 0, status: 'danger' },
    { plan: 'light', line: 'fail', used: 4800, planned: 500, status: 'danger' },
    { plan: 'light', line: 'fail', used: 3000, planned: 3000, status: 'danger' },
    { plan: 'light', line: 'fail', used: 3000, planned: 1000, status: 'unknown' },
    { plan: 'unknown-plan', line: 'low', used: 0, planned: 0, status: 'unknown' },
    { plan: 'unknown-plan', line: 'high', used: 0, planned: 0, status: 'warning' },
    { plan: 'unknown-plan', line: 'high', used: 0, planned: 500, status: 'danger' },
    { plan: 'light', line: 'large', used: 3000, planned: 3000, status: 'danger' },
    { plan: 'light', line: 'sixty', used: 0, planned: 500, status: 'danger' },
  ])('片側不明の $plan / $line / $used / $planned を判定する', async ({ plan, line, used, planned, status }) => {
    testDb.raw.prepare("INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', ?, 'active')").run(plan);
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    testDb.raw.prepare("INSERT INTO friends (id, line_account_id, line_user_id, display_name) VALUES ('f-1', 'account-1', 'U-f1', '友人1')").run();
    const add = testDb.raw.prepare("INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at) VALUES (?, 'f-1', 'outgoing', 'text', '{}', 'account-1', '2026-09-10T10:00:00')");
    for (let n = 0; n < used; n += 1) add.run(`m-${n}`);
    if (planned) testDb.raw.prepare("INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, scheduled_at, created_at, line_account_id, total_count) VALUES ('bc', '予定', 'text', '{}', 'all', 'scheduled', '2026-09-16T01:00:00Z', '2026-09-15T01:00:00Z', 'account-1', ?)").run(planned);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/quota/consumption')
      ? Response.json({ totalUsage: line === 'high' ? 850 : line === 'sixty' ? 600 : 10 })
      : line === 'fail' ? new Response(null, { status: 503 }) : Response.json({ type: 'limited', value: line === 'large' ? 10000 : 1000 })));
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    const checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T05:00:00.000Z' });
    const item = checked.run.results.find((entry) => entry.checkKey === 'message_quota');
    expect(item).toMatchObject({ status });
    if (line === 'fail' || plan === 'unknown-plan') expect(item?.value?.sendable).toBeNull();
    if ((line === 'fail' && planned === 3000) || (plan === 'light' && (line === 'large' || line === 'sixty'))) {
      expect(item?.summary).toBe('予定済みの配信を送ると、今月の配信枠を超える見込みです');
    }
  });
  it('配信枠の失敗を挟んでも受領済みの注意を維持する', async () => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (fail) return new Response(null, { status: 503 });
      return String(input).endsWith('/quota/consumption') ? Response.json({ totalUsage: 850 }) : Response.json({ type: 'limited', value: 1000 });
    }));
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    const run = (now: string) => runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now });
    await run('2026-09-15T05:00:00Z');
    testDb.raw.prepare("UPDATE operation_alerts SET status = 'acknowledged', acknowledged_by_id = 'owner-1' WHERE line_account_id = 'account-1' AND check_key = 'message_quota'").run();
    fail = true;
    await run('2026-09-15T05:05:00Z');
    fail = false;
    await run('2026-09-15T05:10:00Z');
    expect(testDb.raw.prepare("SELECT status, severity, acknowledged_by_id FROM operation_alerts WHERE line_account_id = 'account-1' AND check_key = 'message_quota'").get()).toMatchObject({ status: 'acknowledged', severity: 'warning', acknowledged_by_id: 'owner-1' });
  });
  it.each(['exempt', 'trialing'])('プラン未設定の %s は LINE の枠で判定する', async (planStatus) => {
    testDb.raw.prepare("INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', NULL, ?)").run(planStatus);
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/quota/consumption')
      ? Response.json({ totalUsage: 10 }) : Response.json({ type: 'limited', value: 1000 })));
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    const checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T05:00:00.000Z' });
    expect(checked.run.results.find((item) => item.checkKey === 'message_quota')).toMatchObject({ status: 'normal', value: { sendable: 990 } });
  });
});
