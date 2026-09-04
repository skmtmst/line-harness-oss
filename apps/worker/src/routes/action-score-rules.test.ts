import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getStaffByApiKey: vi.fn().mockResolvedValue(null),
  getActionScoreBands: vi.fn(),
  getActionScoreRuleConfiguration: vi.fn(),
  publishActionScoreRuleDraft: vi.fn(),
  saveActionScoreRuleDraft: vi.fn(),
  stopActionScoreRules: vi.fn(),
  testActionScoreRuleBundle: vi.fn(),
  ActionScoreRuleValidationError: class ActionScoreRuleValidationError extends Error {
    constructor(public readonly code: string, message: string, public readonly field?: string) {
      super(message);
    }
  },
};
vi.mock('@line-crm/db', () => dbMocks);

const accountAccessMocks = { getVisibleLineAccountScope: vi.fn() };
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { authMiddleware } = await import('../middleware/auth.js');
const { actionScoreRules } = await import('./action-score-rules.js');
type Env = import('../index.js').Env;

const env = { DB: {} as D1Database, API_KEY: 'owner-key' } as unknown as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', actionScoreRules);
  return instance;
}

function call(path: string, init?: RequestInit) {
  return app().request(path, {
    ...init,
    headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json', ...init?.headers },
  }, env);
}

function callAs(token: string, path: string, init?: RequestInit) {
  return app().request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  }, env);
}

const configuration = {
  rules: [{
    id: 'reply', name: '返信', eventType: 'message_received', source: 'line_webhook',
    operation: 'delta', value: 8, frequency: { kind: 'per_day', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  }],
  bands: { min: 0, max: 100, normalMin: 30, highMin: 70 },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  accountAccessMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['account-1'] });
  dbMocks.getActionScoreRuleConfiguration.mockResolvedValue({
    configured: false, status: 'not_configured', currentDraftVersionId: null,
    editableVersion: { ...configuration, id: null, versionNumber: 1 }, publishedVersion: null,
  });
  dbMocks.getActionScoreBands.mockResolvedValue(configuration.bands);
  dbMocks.saveActionScoreRuleDraft.mockResolvedValue({ currentDraftVersionId: 'draft-1' });
  dbMocks.publishActionScoreRuleDraft.mockResolvedValue({ status: 'published' });
  dbMocks.stopActionScoreRules.mockResolvedValue({ status: 'stopped' });
  dbMocks.testActionScoreRuleBundle.mockReturnValue({ scoreBefore: 20, scoreAfter: 28, matched: [] });
});

describe('V6 action score rule API', () => {
  it('requires a selected authorized account for reads', async () => {
    expect((await call('/api/action-scores/rules')).status).toBe(400);
    expect((await call('/api/action-scores/rules?accountId=hidden')).status).toBe(404);
    expect(dbMocks.getActionScoreRuleConfiguration).not.toHaveBeenCalled();

    const response = await call('/api/action-scores/rules?accountId=account-1');
    expect(response.status).toBe(200);
    expect(dbMocks.getActionScoreRuleConfiguration).toHaveBeenCalledWith(env.DB, 'account-1');
  });

  it('returns score bands only for the selected authorized account', async () => {
    const hidden = await call('/api/action-scores/bands?accountId=hidden');
    expect(hidden.status).toBe(404);
    expect(dbMocks.getActionScoreBands).not.toHaveBeenCalled();

    const response = await call('/api/action-scores/bands?accountId=account-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: configuration.bands });
    expect(dbMocks.getActionScoreBands).toHaveBeenCalledWith(env.DB, 'account-1');
  });

  it('lets mileage staff view rules but not change them', async () => {
    dbMocks.getStaffByApiKey.mockResolvedValue({
      id: 'staff-1', name: '担当者', role: 'staff', access_level: 'full', permission_keys: '["/mileage"]',
    });
    expect((await callAs('staff-key', '/api/action-scores/rules?accountId=account-1')).status).toBe(200);
    const update = await callAs('staff-key', '/api/action-scores/rules/draft', {
      method: 'PATCH', body: JSON.stringify({ accountId: 'account-1', configuration }),
    });
    expect(update.status).toBe(403);
    expect(dbMocks.saveActionScoreRuleDraft).not.toHaveBeenCalled();
  });

  it('saves a draft with optimistic version information and account scope', async () => {
    const response = await call('/api/action-scores/rules/draft', {
      method: 'PATCH',
      body: JSON.stringify({ accountId: 'account-1', expectedDraftVersionId: 'draft-1', configuration }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.saveActionScoreRuleDraft).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-1', expectedDraftVersionId: 'draft-1', configuration, createdBy: 'env-owner',
    }));
  });

  it('tests without publishing or writing the score ledger', async () => {
    const response = await call('/api/action-scores/rules/test', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'account-1', configuration, currentScore: 20,
        eventType: 'message_received', source: 'line_webhook',
      }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.testActionScoreRuleBundle).toHaveBeenCalledWith(configuration, expect.objectContaining({
      currentScore: 20, eventType: 'message_received', source: 'line_webhook',
    }));
    expect(dbMocks.publishActionScoreRuleDraft).not.toHaveBeenCalled();
  });

  it('requires the explicit confirmation header before publishing', async () => {
    const body = JSON.stringify({ accountId: 'account-1', draftVersionId: 'draft-1' });
    const rejected = await call('/api/action-scores/rules/publish', { method: 'POST', body });
    expect(rejected.status).toBe(428);
    expect(dbMocks.publishActionScoreRuleDraft).not.toHaveBeenCalled();

    const accepted = await call('/api/action-scores/rules/publish', {
      method: 'POST', body, headers: { 'X-Confirm-Irreversible': 'action-score-rules-publish' },
    });
    expect(accepted.status).toBe(200);
    expect(dbMocks.publishActionScoreRuleDraft).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', draftVersionId: 'draft-1', publishedBy: 'env-owner',
    });
  });

  it('stops only the selected authorized account', async () => {
    const hidden = await call('/api/action-scores/rules/stop', {
      method: 'POST', body: JSON.stringify({ accountId: 'hidden' }),
    });
    expect(hidden.status).toBe(404);
    expect(dbMocks.stopActionScoreRules).not.toHaveBeenCalled();

    const response = await call('/api/action-scores/rules/stop', {
      method: 'POST', body: JSON.stringify({ accountId: 'account-1' }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.stopActionScoreRules).toHaveBeenCalledWith(env.DB, 'account-1');
  });

  it('returns a conflict when another operator has replaced the draft', async () => {
    dbMocks.saveActionScoreRuleDraft.mockRejectedValueOnce(
      new dbMocks.ActionScoreRuleValidationError('version_conflict', '下書きを読み直してください'),
    );
    const response = await call('/api/action-scores/rules/draft', {
      method: 'PATCH', body: JSON.stringify({ accountId: 'account-1', configuration }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'version_conflict',
      error: '下書きを読み直してください',
    });
  });

  it('returns field-aware validation errors without leaking internals', async () => {
    dbMocks.saveActionScoreRuleDraft.mockRejectedValueOnce(
      new dbMocks.ActionScoreRuleValidationError('bands_invalid', '境界を確認してください', 'bands'),
    );
    const response = await call('/api/action-scores/rules/draft', {
      method: 'PATCH', body: JSON.stringify({ accountId: 'account-1', configuration }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false, code: 'bands_invalid', field: 'bands' });
  });

  it.each([
    'draft_not_found',
    'published_version_required',
    'published_version_missing',
  ])('returns 404 for missing rule state %s', async (code) => {
    dbMocks.saveActionScoreRuleDraft.mockRejectedValueOnce(
      new dbMocks.ActionScoreRuleValidationError(code, '対象の版が見つかりません'),
    );

    const response = await call('/api/action-scores/rules/draft', {
      method: 'PATCH', body: JSON.stringify({ accountId: 'account-1', configuration }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      code,
      error: '対象の版が見つかりません',
    });
  });

  it('returns a generic 500 without leaking unexpected storage errors', async () => {
    dbMocks.getActionScoreRuleConfiguration.mockRejectedValueOnce(
      new Error('D1 internal details'),
    );

    const response = await call('/api/action-scores/rules?accountId=account-1');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'スコアのルールを処理できませんでした',
    });
  });
});
