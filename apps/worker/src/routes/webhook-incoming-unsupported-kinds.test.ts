/*
 * R404: 受信設定が実行未対応の種類を保存できてしまい、詳細は「接続済み」と返す。
 *
 * 落ち方（直前）: friend_field・reminder・conversion・mileage_rule・
 *   score_rule・operator_notification の直接指定が保存200になり、
 *   詳細の actionExecution.state は connected。試しも実実行も失敗する。
 * 通り方（直後）: 保存時点で理由つき400。詳細は needs_attention と理由を返す。
 *   実行できる直接指定（tag・support_mark・template・scenario・
 *   outgoing_webhook）と共通アクションは従来どおり保存・接続済み。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';
import {
  getIncomingWebhookById,
  updateIncomingWebhookConfig,
} from '@line-crm/db';
import { canAccessAllLineAccounts } from '../services/account-access.js';

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@line-crm/db')>()),
  getIncomingWebhookById: vi.fn(),
  updateIncomingWebhookConfig: vi.fn(),
  countIncomingWebhookUnmatched: vi.fn(async () => 0),
}));
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/account-access.js')>()),
  canAccessAllLineAccounts: vi.fn(),
}));

const ACCOUNT_ID = 'account-1';

function setupApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: 'Staff', role: 'owner', readOnly: false, tenantId: 'tenant-a' });
    return next();
  });
  app.route('/', webhooks);
  return app;
}

/* 名づけ参照（incomingActionDisplayName）は実DB層を使わない空応答で足りる。 */
const stubStatement = () => ({
  bind: () => ({
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  }),
});
const baseEnv = {
  DB: { prepare: (_sql: string) => stubStatement() },
} as Record<string, unknown>;

beforeEach(() => {
  vi.mocked(canAccessAllLineAccounts).mockResolvedValue(true);
  vi.mocked(updateIncomingWebhookConfig).mockResolvedValue({
    status: 'updated',
    item: { id: 'iwh-1', version: 2 } as never,
  });
});

function configBody(refKind: string) {
  return {
    expectedVersion: 1,
    identityMatching: { methods: [], onNotFound: 'do_nothing' },
    actions: [{ refKind, refId: 'ref-a', refVersionId: null }],
  };
}

describe('R404 実行未対応の受信処理は保存時点で止める', () => {
  test.each([
    'friend_field',
    'reminder',
    'conversion',
    'mileage_rule',
    'score_rule',
    'operator_notification',
  ])('直接指定の %s は理由つき400で保存しない', async (refKind) => {
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configBody(refKind)),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(updateIncomingWebhookConfig).not.toHaveBeenCalled();
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('直接');
  });

  test.each(['tag', 'support_mark', 'template', 'scenario', 'outgoing_webhook', 'common_action'])(
    '実行できる %s は従来どおり保存できる',
    async (refKind) => {
      const res = await setupApp().request(
        `/api/webhooks/incoming/iwh-1/config?lineAccountId=${ACCOUNT_ID}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configBody(refKind)),
        },
        baseEnv,
      );
      expect(res.status).toBe(200);
      expect(updateIncomingWebhookConfig).toHaveBeenCalled();
    },
  );

  test('未対応の種類が残る詳細は接続済みにせず理由を返す', async () => {
    vi.mocked(getIncomingWebhookById).mockResolvedValue({
      id: 'iwh-1',
      name: '外部連携1',
      source_type: 'custom',
      is_active: 1,
      version: 2,
      identity_match_json: '{"methods":[],"onNotFound":"do_nothing"}',
      action_refs_json: '[{"refKind":"reminder","refId":"ref-a","refVersionId":null}]',
      latest_masked_sample_json: null,
      latest_received_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    } as never);
    const res = await setupApp().request(
      `/api/webhooks/incoming/iwh-1?lineAccountId=${ACCOUNT_ID}`,
      { method: 'GET' },
      baseEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { actionExecution: { state: string; reason: string | null } };
    };
    expect(body.data.actionExecution.state).toBe('needs_attention');
    expect(body.data.actionExecution.reason).toContain('リマインダ');
  });
});
