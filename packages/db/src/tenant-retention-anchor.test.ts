import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTenantRetention,
  markExpiredTrialRetentionAnchors,
  requestTenantDataPurge,
} from './tenant-data-retention.js';
import { updateTenantBilling } from './tenant-billing.js';

/*
 * ★V6 36-2 退会後の顧客データ削除の「起点」。
 *
 * 保存期限を数え始める時刻(retention_anchor_at)がずれると、削除が
 * 早すぎるか、いつまでも始まらないかのどちらかになる。解約の後にも
 * Stripeからは invoice.voided や期末の subscription.updated が届くので、
 * その度に起点が後ろへ動かないことまで確かめる。
 */

const packageRoot = join(import.meta.dirname, '..');

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
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

describe('顧客データの保存起点', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite
      .prepare(`INSERT INTO tenants (id, name, plan_status) VALUES (?, ?, 'active')`)
      .run('t1', '統括 t1');
    db = asD1(sqlite);
  });

  it('解約が反映されると起点が入る', async () => {
    expect((await getTenantRetention(db, 't1'))?.retention_anchor_at).toBeNull();

    await updateTenantBilling(db, 't1', { plan_status: 'canceled' });

    const after = await getTenantRetention(db, 't1');
    expect(after?.plan_status).toBe('canceled');
    expect(after?.retention_anchor_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/);
  });

  it('解約後に課金の更新が来ても起点は動かない', async () => {
    await updateTenantBilling(db, 't1', { plan_status: 'canceled' });
    const first = (await getTenantRetention(db, 't1'))?.retention_anchor_at;
    expect(first).not.toBeNull();

    // 期末の subscription.updated。plan_status は canceled のまま届く。
    await updateTenantBilling(db, 't1', {
      plan_status: 'canceled',
      current_period_ends_at: '2026-07-01T09:00:00.000+09:00',
    });
    // 請求の取り消しだけが届く場合。plan_status が入らない更新でも動かさない。
    await updateTenantBilling(db, 't1', { stripe_subscription_id: null });

    expect((await getTenantRetention(db, 't1'))?.retention_anchor_at).toBe(first);
  });

  it('契約が戻ると削除の予定が取り消される', async () => {
    await updateTenantBilling(db, 't1', { plan_status: 'canceled' });
    await requestTenantDataPurge(db, 't1');
    sqlite.prepare(`UPDATE tenants SET data_purged_at = ? WHERE id = ?`).run('2026-06-01T09:00:00.000+09:00', 't1');

    await updateTenantBilling(db, 't1', { plan_status: 'active' });

    const after = await getTenantRetention(db, 't1');
    expect(after?.retention_anchor_at).toBeNull();
    expect(after?.purge_requested_at).toBeNull();
    expect(after?.data_purged_at).toBeNull();
  });

  it('無料体験が終わった統括には、体験終了の時刻が起点として入る', async () => {
    sqlite
      .prepare(`UPDATE tenants SET plan_status = 'trialing', trial_ends_at = ? WHERE id = ?`)
      .run('2026-03-01T09:00:00.000+09:00', 't1');

    const anchored = await markExpiredTrialRetentionAnchors(db, '2026-06-01T09:00:00.000+09:00');

    expect(anchored).toBe(1);
    expect((await getTenantRetention(db, 't1'))?.retention_anchor_at).toBe(
      '2026-03-01T09:00:00.000+09:00',
    );
  });

  it('無料体験の途中では起点を入れない', async () => {
    sqlite
      .prepare(`UPDATE tenants SET plan_status = 'trialing', trial_ends_at = ? WHERE id = ?`)
      .run('2026-07-01T09:00:00.000+09:00', 't1');

    const anchored = await markExpiredTrialRetentionAnchors(db, '2026-06-01T09:00:00.000+09:00');

    expect(anchored).toBe(0);
    expect((await getTenantRetention(db, 't1'))?.retention_anchor_at).toBeNull();
  });
});
