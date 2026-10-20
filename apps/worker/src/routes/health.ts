import { logger } from '@line-crm/shared/server';
import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';
import {
  getAccountHealthLogs,
  getLatestRiskLevel,
  getLatestRiskLevels,
  getAccountMigrations,
  getAccountMigrationById,
  createAccountMigration,
  updateAccountMigration,
  isLineAccountTenantActive,
} from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { buildMetadata } from '../lib/build-metadata.js';

const health = new Hono<Env>();

// ========== Liveness ==========
// Public (no auth, see middleware/auth.ts skip list): probed by
// `create-line-harness update` and by the self-update verify phase
// (capabilities advertises `/api/health`). Deliberately dependency-free —
// it exists only to prove the Worker booted and is routing requests.

health.get('/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { status: 'ok', ...buildMetadata(c.env) } });
});
health.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { status: 'ok', ...buildMetadata(c.env) } });
});

// ========== アカウントヘルス ==========

// サイドバーの N+1 解消用。staff 可視範囲のアカウントだけを対象に、
// 最新 riskLevel だけを1回で返す。ログ本文は含めない。
health.get('/api/accounts/health-summary', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const levels = await getLatestRiskLevels(c.env.DB, scope.allowedAccountIds);
    const byId = new Map(levels.map((level) => [level.line_account_id, level.risk_level]));
    const items = scope.allowedAccountIds.map((lineAccountId) => ({
      lineAccountId,
      riskLevel: byId.get(lineAccountId) ?? null,
    }));
    return c.json({
      success: true,
      data: {
        items,
        warningCount: items.filter((item) => item.riskLevel === 'warning').length,
        dangerCount: items.filter((item) => item.riskLevel === 'danger').length,
      },
    });
  } catch (err) {
    logger.error("routes_health_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

health.get('/api/accounts/:id/health', async (c) => {
  try {
    const lineAccountId = c.req.param('id');
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.ids.includes(lineAccountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const [riskLevel, logs] = await Promise.all([
      getLatestRiskLevel(c.env.DB, lineAccountId),
      getAccountHealthLogs(c.env.DB, lineAccountId),
    ]);
    return c.json({
      success: true,
      data: {
        lineAccountId,
        riskLevel,
        logs: logs.map((l) => ({
          id: l.id,
          errorCode: l.error_code,
          errorCount: l.error_count,
          checkPeriod: l.check_period,
          riskLevel: l.risk_level,
          createdAt: l.created_at,
        })),
      },
    });
  } catch (err) {
    logger.error("routes_health_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== アカウント移行 ==========

health.get('/api/accounts/migrations', async (c) => {
  try {
    const items = await getAccountMigrations(c.env.DB);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const visible = items.filter(
      (item) => scope.allowedAccountIds.includes(item.from_account_id)
        && scope.allowedAccountIds.includes(item.to_account_id),
    );
    return c.json({
      success: true,
      data: visible.map((m) => ({
        id: m.id,
        fromAccountId: m.from_account_id,
        toAccountId: m.to_account_id,
        status: m.status,
        migratedCount: m.migrated_count,
        totalCount: m.total_count,
        createdAt: m.created_at,
        completedAt: m.completed_at,
      })),
    });
  } catch (err) {
    logger.error("routes_health_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

health.post('/api/accounts/:id/migrate', requireRole('owner'), inputJsonBoundary({"toAccountId":["string"]}), async (c) => {
  try {
    const fromAccountId = c.req.param('id');
    const body = await c.req.json<{ toAccountId: string }>();
    if (!body.toAccountId) return inputError(c, { success: false, error: 'toAccountId is required' }, 400, ["toAccountId"]);

    const db = c.env.DB;

    /*
     * M020：存在しない移行元で 201 の幽霊行を作っていた。
     * 移行前に可視範囲で有無を見て、無いときは 404 にして作らない。
     * 範囲外も 404 に倒す（詳細口と同じ fail-closed）。
     */
    const scope = await getVisibleLineAccountScope(db, c.get('staff'));
    const source = scope.accounts.find((account) => account.id === fromAccountId);
    const target = scope.accounts.find((account) => account.id === body.toAccountId);
    if (!source || !target || source.is_active !== 1 || target.is_active !== 1
      || source.archived_at || target.archived_at
      || (source.tenant_id ?? DEFAULT_TENANT_ID) !== (target.tenant_id ?? DEFAULT_TENANT_ID)
      || !await isLineAccountTenantActive(db, fromAccountId)
      || !await isLineAccountTenantActive(db, body.toAccountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    // Never include another account's friends in this migration's count.
    const countResult = await db
      .prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`)
      .bind(fromAccountId)
      .first<{ count: number }>();
    const totalCount = countResult?.count ?? 0;

    const migration = await createAccountMigration(db, {
      fromAccountId,
      toAccountId: body.toAccountId,
      totalCount,
    });

    // 移行処理は非同期で実行（実際の移行はUUIDベースなのでユーザーが新アカウントを友だち追加した時に自動マッチされる）
    await updateAccountMigration(db, migration.id, {
      status: 'in_progress',
    });

    return c.json({
      success: true,
      data: {
        id: migration.id,
        fromAccountId: migration.from_account_id,
        toAccountId: migration.to_account_id,
        status: 'in_progress',
        totalCount: migration.total_count,
        createdAt: migration.created_at,
      },
    }, 201);
  } catch (err) {
    logger.error("routes_health_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

health.get('/api/accounts/migrations/:migrationId', async (c) => {
  try {
    const item = await getAccountMigrationById(c.env.DB, c.req.param('migrationId'));
    if (!item) return c.json({ success: false, error: 'Migration not found' }, 404);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(item.from_account_id)
      || !scope.allowedAccountIds.includes(item.to_account_id)) {
      return c.json({ success: false, error: 'Migration not found' }, 404);
    }
    return c.json({
      success: true,
      data: {
        id: item.id,
        fromAccountId: item.from_account_id,
        toAccountId: item.to_account_id,
        status: item.status,
        migratedCount: item.migrated_count,
        totalCount: item.total_count,
        createdAt: item.created_at,
        completedAt: item.completed_at,
      },
    });
  } catch (err) {
    logger.error("routes_health_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { health };
