import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { inputJsonBoundary } from '../lib/input-errors.js';
import { denyReadOnly, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { retentionPolicyFromValue, type RetentionPolicy } from '../services/retention-policy.js';
import { readRetentionSetting, saveRetentionSetting } from '../services/retention-settings.js';
import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';

export const personalDataRetention = new Hono<Env>();
const path = '/api/account-settings/personal-data-retention';

personalDataRetention.get(path, requireRole('owner', 'admin'), async c => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: '店を選んでください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'この店の設定は読めません' }, 403);
  }
  try {
    return c.json({ success: true, data: await readRetentionSetting(c.env.DB, accountId) });
  } catch {
    return c.json({ success: false, error: '保存期限の設定を確認できません', code: 'RETENTION_POLICY_INVALID' }, 503);
  }
});

personalDataRetention.put(path, requireRole('owner', 'admin'), denyReadOnly(), inputJsonBoundary(), async c => {
  const body = await c.req.json<{ accountId?: unknown; expectedVersion?: unknown; policy?: unknown }>();
  if (typeof body.accountId !== 'string' || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
    return c.json({ success: false, error: '店と読み込んだ版を指定してください' }, 422);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: 'この店の設定は変えられません' }, 403);
  }
  let policy: RetentionPolicy;
  try {
    policy = retentionPolicyFromValue(body.policy);
  } catch {
    return c.json({ success: false, error: '保存日数は1〜3650日の整数で、実行と保留はオンかオフで指定してください' }, 422);
  }
  if (!await sensitiveStepUpSatisfied(c, 'privacy.retention')) {
    return stepUpRequiredResponse(c, '保存期限を変える前に本人確認してください');
  }
  const version = Number(body.expectedVersion);
  const saved = await saveRetentionSetting(c.env.DB, {
    accountId: body.accountId, expectedVersion: version, policy, actor: c.get('staff'),
  });
  if (!saved) return c.json({ success: false, error: 'ほかの人が先に保存しました。読み直してください', code: 'SAVE_CONFLICT' }, 409);
  return c.json({ success: true, data: { version: version + 1, policy } });
});
