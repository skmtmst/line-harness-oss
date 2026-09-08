import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getFriendFields: vi.fn(),
  getFriendFieldsForScope: vi.fn(),
  getFriendFieldById: vi.fn(),
  getFriendFieldByIdForScope: vi.fn(),
  createFriendField: vi.fn(),
  createFriendFieldForScope: vi.fn(),
  updateFriendField: vi.fn(),
  deleteFriendField: vi.fn(),
  countFriendFieldValues: vi.fn(),
  countFriendFieldValuesForScope: vi.fn(),
  countFriendFieldValuesForScopes: vi.fn(),
  getFriendFieldListSummary: vi.fn(),
  getFriendFieldUsageForScope: vi.fn(),
  getFriendFieldValuesForMigration: vi.fn(),
  createFieldMigrationPreview: vi.fn(),
  getFieldMigrationRun: vi.fn(),
  getFieldMigrationRunByToken: vi.fn(),
  getFieldMigrationRunByIdempotencyKey: vi.fn(),
  getFieldMigrationItems: vi.fn(),
  queueFieldMigration: vi.fn(),
  markFieldMigrationStale: vi.fn(),
  executeFieldMigration: vi.fn(),
  getFriendFieldsWithValues: vi.fn(),
  getFriendById: vi.fn(),
  setFriendFieldValue: vi.fn(),
  recordLoginAudit: vi.fn(),
  validateFieldKey: (key: unknown) =>
    typeof key === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(key) && key !== 'name'
      ? { ok: true as const }
      : { ok: false as const, error: 'bad key' },
  FRIEND_FIELD_TYPES: [
    'text',
    'textarea',
    'number',
    'date',
    'datetime',
    'select',
    'multi_select',
    'checkbox',
    'url',
    'tel',
    'email',
    'image',
    'pdf',
  ],
  getFolderById: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);
const accountMocks = {
  getVisibleLineAccountScope: vi.fn().mockResolvedValue({ allowedAccountIds: ['account-1'] }),
  canAccessAllLineAccounts: vi.fn().mockResolvedValue(true),
};
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: accountMocks.getVisibleLineAccountScope,
  canAccessAllLineAccounts: accountMocks.canAccessAllLineAccounts,
}));

const { friendFields } = await import('./friend-fields.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false, tenantId: 'tenant-1' });
    return next();
  });
  app.route('/', friendFields);
  return app;
}

const env = { DB: {} as D1Database };

function req(
  app: ReturnType<typeof makeApp>,
  path: string,
  method: string,
  body?: unknown,
) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const FIELD = {
  id: 'ff-1',
  folder_id: null,
  name: 'ペットの名前',
  field_key: 'pet_name',
  type: 'text',
  options_json: null,
  default_value: null,
  source: 'manual',
  ec_field_path: null,
  ec_is_master: 0,
  is_personal: 0,
  is_starred: 0,
  display_order: 0,
  created_at: '2026-08-16',
  updated_at: '2026-08-16',
  status: 'active',
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  accountMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['account-1'] });
  accountMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  mocks.getFriendById.mockResolvedValue({ id: 'f-1', line_account_id: 'account-1' });
  mocks.getFriendFields.mockResolvedValue([FIELD]);
  mocks.getFriendFieldsForScope.mockResolvedValue([{ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 }]);
  mocks.getFriendFieldById.mockResolvedValue(FIELD);
  mocks.getFriendFieldByIdForScope.mockResolvedValue({ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 });
  mocks.createFriendField.mockResolvedValue(FIELD);
  mocks.createFriendFieldForScope.mockResolvedValue({ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 });
  mocks.updateFriendField.mockResolvedValue(FIELD);
  mocks.countFriendFieldValues.mockResolvedValue(0);
  mocks.countFriendFieldValuesForScope.mockResolvedValue(0);
  mocks.countFriendFieldValuesForScopes.mockResolvedValue(new Map());
  mocks.getFriendFieldListSummary.mockResolvedValue({ total: 1, inUse: 0, registeredFriends: 0, formLinks: null, updatedThisMonth: 0 });
  mocks.getFriendFieldUsageForScope.mockResolvedValue([]);
  mocks.getFriendFieldValuesForMigration.mockResolvedValue([]);
  mocks.createFieldMigrationPreview.mockResolvedValue(undefined);
  mocks.getFieldMigrationRun.mockResolvedValue(null);
  mocks.getFieldMigrationRunByToken.mockResolvedValue(null);
  mocks.getFieldMigrationRunByIdempotencyKey.mockResolvedValue(null);
  mocks.getFieldMigrationItems.mockResolvedValue([]);
  mocks.queueFieldMigration.mockResolvedValue(true);
  mocks.markFieldMigrationStale.mockResolvedValue(undefined);
  mocks.executeFieldMigration.mockResolvedValue(undefined);
  mocks.getFolderById.mockResolvedValue({ id: 'folder-1', kind: 'friend_field' });
  mocks.getFriendFieldsWithValues.mockResolvedValue([{ ...FIELD, value: null, updated_by: null }]);
});

describe('項目の作成', () => {
  it('差し込み名の形が正しければ作れる', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: 'ペットの名前',
      fieldKey: 'pet_name',
      type: 'text',
    });
    expect(res.status).toBe(201);
  });

  it('差し込み名の形が違えば422', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: 'x',
      fieldKey: 'ペット',
      type: 'text',
    });
    expect(res.status).toBe(422);
    expect(mocks.createFriendFieldForScope).not.toHaveBeenCalled();
  });

  it('知らない種類は422', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: 'x',
      fieldKey: 'x',
      type: 'rating',
    });
    expect(res.status).toBe(422);
  });

  it('選択肢は文字列の配列だけ', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: 'x',
      fieldKey: 'x',
      type: 'select',
      options: [1, 2],
    });
    expect(res.status).toBe(422);
  });

  it('差し込み名が重複したら409', async () => {
    mocks.createFriendFieldForScope.mockRejectedValue(new Error('UNIQUE constraint failed'));
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: 'x',
      fieldKey: 'dup',
      type: 'text',
    });
    expect(res.status).toBe(409);
  });

  it.each(['datetime', 'image', 'pdf'])('V6の%s項目を作れる', async (type) => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: type,
      fieldKey: `field_${type}`,
      type,
    });
    expect(res.status).toBe(201);
    expect(mocks.createFriendFieldForScope).toHaveBeenCalledWith(
      env.DB,
      expect.anything(),
      expect.objectContaining({ type }),
    );
  });

  it('選択肢を不変ID付きで保存する', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: '都道府県', fieldKey: 'prefecture', type: 'select', options: ['東京', '大阪'], defaultValue: '東京',
    });
    expect(res.status).toBe(201);
    const input = mocks.createFriendFieldForScope.mock.calls.at(-1)?.[2] as { optionsJson: string; defaultValue: string };
    const options = JSON.parse(input.optionsJson) as Array<{ id: string; label: string }>;
    expect(options.map((item) => item.label)).toEqual(['東京', '大阪']);
    expect(options.every((item) => item.id.length > 0)).toBe(true);
    expect(input.defaultValue).toBe(options[0].id);
  });

  it('画像・PDFの既定値と本文差し込みを拒否する', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: '本人確認', fieldKey: 'identity_file', type: 'pdf', defaultValue: 'media-1', allowTextInsertion: true,
    });
    expect(res.status).toBe(422);
    expect(mocks.createFriendFieldForScope).not.toHaveBeenCalled();
  });

  it('staffは定義を作れない', async () => {
    const res = await req(makeApp('staff'), '/api/friend-fields?lineAccountId=account-1', 'POST', {
      name: '項目', fieldKey: 'field', type: 'text',
    });
    expect(res.status).toBe(403);
  });
});

describe('LINEアカウントの境界', () => {
  it('選択中アカウントが無ければ一覧を返さない', async () => {
    const res = await req(makeApp(), '/api/friend-fields', 'GET');
    expect(res.status).toBe(400);
    expect(mocks.getFriendFieldsForScope).not.toHaveBeenCalled();
  });

  it('担当外アカウントは存在を明かさず404', async () => {
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-2', 'GET');
    expect(res.status).toBe(404);
    expect(mocks.getFriendFieldsForScope).not.toHaveBeenCalled();
  });

  it('使用人数・回答フォーム数・使用先を実データから返す', async () => {
    mocks.countFriendFieldValuesForScopes.mockResolvedValue(new Map([['ff-1', 3]]));
    mocks.getFriendFieldUsageForScope.mockResolvedValue([
      { kind: 'form', id: 'form-1', name: '申込フォーム', fieldId: 'ff-1', switchable: true },
      { kind: 'reminder', id: 'reminder-1', name: '誕生日通知', fieldId: 'ff-1', switchable: true },
    ]);
    const res = await req(makeApp(), '/api/friend-fields?lineAccountId=account-1&withUsage=1', 'GET');
    const body = await res.json() as { data: Array<{ usageCount: number; formUsageCount: number; displayTargets: string[] }> };
    expect(body.data[0]).toMatchObject({
      usageCount: 3, formUsageCount: 1, displayTargets: ['申込フォーム', '誕生日通知'],
    });
    /* 件数は一括集計の1回だけ。項目ごとの count は呼ばない(N+1にしない)。 */
    expect(mocks.countFriendFieldValuesForScopes).toHaveBeenCalledTimes(1);
    expect(mocks.countFriendFieldValuesForScope).not.toHaveBeenCalled();
  });
});

describe('項目の更新', () => {
  it('種類は変えられない', async () => {
    // 既に入っている値の意味が変わる（「犬」が数値項目になる等）。
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'PATCH', { type: 'number' });
    expect(res.status).toBe(422);
    expect(mocks.updateFriendField).not.toHaveBeenCalled();
  });

  it('差し込み名も変えられない', async () => {
    // テンプレートの差し込みが黙って空になる。
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'PATCH', { fieldKey: 'other' });
    expect(res.status).toBe(422);
  });

  it('同じ値を送るぶんには通る', async () => {
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'PATCH', {
      type: 'text',
      fieldKey: 'pet_name',
      name: '新しい名前',
    });
    expect(res.status).toBe(200);
  });

  it('保存中にversionが変わったら409', async () => {
    mocks.updateFriendField.mockResolvedValue(null);
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'PATCH', {
      version: 1, name: '新しい名前',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('項目の削除', () => {
  it('値が入っていれば人数を返して止める', async () => {
    mocks.countFriendFieldValuesForScope.mockResolvedValue(12);
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { usageCount: number; code: string };
    expect(body).toMatchObject({ usageCount: 12, code: 'IN_USE' });
    expect(mocks.deleteFriendField).not.toHaveBeenCalled();
  });

  it('force=1 でも値があれば消さない', async () => {
    mocks.countFriendFieldValuesForScope.mockResolvedValue(12);
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1&force=1', 'DELETE');
    expect(res.status).toBe(409);
    expect(mocks.deleteFriendField).not.toHaveBeenCalled();
  });

  it('使われていなければそのまま消せる', async () => {
    const res = await req(makeApp(), '/api/friend-fields/ff-1?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(200);
  });
});

describe('項目移行の事前確認', () => {
  it('選択中アカウントの値だけを種類に合わせて数える', async () => {
    mocks.getFriendFieldValuesForMigration.mockResolvedValue([
      { friend_id: 'friend-1', value: '090-1234-5678' },
      { friend_id: 'friend-2', value: '電話なし' },
      { friend_id: 'friend-3', value: '' },
    ]);
    const res = await req(
      makeApp(),
      '/api/friend-fields/ff-1/migration-preview?lineAccountId=account-1',
      'POST',
      { targetType: 'tel' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        summary: { total: number; convertible: number; review: number; invalid: number };
        rows: Array<{ friendId: string; status: string }>;
      };
    };
    expect(body.data.summary).toEqual({ total: 3, convertible: 1, review: 1, invalid: 1 });
    expect(body.data.rows).toEqual([
      expect.objectContaining({ friendId: 'friend-2', status: 'review' }),
      expect.objectContaining({ friendId: 'friend-3', status: 'invalid' }),
    ]);
    expect(mocks.getFriendFieldValuesForMigration).toHaveBeenCalledWith(
      env.DB,
      'ff-1',
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
    );
  });

  it('存在しない種類は422で止める', async () => {
    const res = await req(
      makeApp(),
      '/api/friend-fields/ff-1/migration-preview?lineAccountId=account-1',
      'POST',
      { targetType: 'rating' },
    );
    expect(res.status).toBe(422);
    expect(mocks.getFriendFieldValuesForMigration).not.toHaveBeenCalled();
  });

  it('実在しない日付を自動変換しない', async () => {
    mocks.getFriendFieldValuesForMigration.mockResolvedValue([
      { friend_id: 'friend-1', value: '2026-02-31' },
    ]);
    const res = await req(
      makeApp(),
      '/api/friend-fields/ff-1/migration-preview?lineAccountId=account-1',
      'POST',
      { targetType: 'date' },
    );
    const body = (await res.json()) as { data: { summary: { review: number }; rows: Array<{ reason: string }> } };
    expect(body.data.summary.review).toBe(1);
    expect(body.data.rows[0].reason).toContain('存在する日付');
  });

  it('実在する移行先を指定すると期限付きtokenと使用先を保存する', async () => {
    const target = { ...FIELD, id: 'ff-2', field_key: 'pet_name_new', type: 'tel', version: 2 };
    mocks.getFriendFieldByIdForScope.mockImplementation(async (_db: unknown, id: string) =>
      id === 'ff-2' ? target : { ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 });
    mocks.getFriendFieldValuesForMigration.mockResolvedValue([{ friend_id: 'friend-1', value: '090-1234-5678' }]);
    mocks.getFriendFieldUsageForScope.mockResolvedValue([
      { kind: 'form', id: 'form-1', name: '申込フォーム', fieldId: 'ff-1', switchable: true },
    ]);
    const res = await req(makeApp(), '/api/friend-fields/ff-1/migration-preview?lineAccountId=account-1', 'POST', {
      targetFieldId: 'ff-2',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { runId: string; previewToken: string; usageTargets: unknown[] } };
    expect(body.data.runId).toBeTruthy();
    expect(body.data.previewToken).toBeTruthy();
    expect(body.data.usageTargets).toHaveLength(1);
    expect(mocks.createFieldMigrationPreview).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      sourceFieldId: 'ff-1', targetFieldId: 'ff-2', targetVersion: 2,
    }));
  });
});

describe('項目移行の実行と照会', () => {
  const RUN = {
    id: 'run-1', tenant_id: 'tenant-1', line_account_id: 'account-1',
    source_field_id: 'ff-1', target_field_id: 'ff-2', source_version: 1, target_version: 1,
    preview_token_hash: 'hash', preview_snapshot_hash: 'snapshot',
    preview_expires_at: '2999-01-01T00:00:00.000Z', idempotency_key: null, status: 'previewed',
    usage_targets_json: '[]', total_count: 1, convertible_count: 1, review_count: 0, invalid_count: 0,
    processed_count: 0, succeeded_count: 0, failed_count: 0, error_message: null,
    created_by: 'u-1', created_at: '2026-09-07', started_at: null, completed_at: null,
    rollback_deadline: null, updated_at: '2026-09-07',
  };

  it('Idempotency-Keyなしでは実行しない', async () => {
    const res = await req(makeApp(), '/api/friend-fields/ff-1/migrations?lineAccountId=account-1', 'POST', {
      previewToken: 'token',
    });
    expect(res.status).toBe(422);
    expect(mocks.queueFieldMigration).not.toHaveBeenCalled();
  });

  it('同じ冪等キーは同じrunIdを返す', async () => {
    mocks.getFieldMigrationRunByIdempotencyKey.mockResolvedValue(RUN);
    const app = makeApp();
    const res = await app.fetch(new Request(
      'https://example.com/api/friend-fields/ff-1/migrations?lineAccountId=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-key' }, body: JSON.stringify({ previewToken: 'token' }) },
    ), env);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ data: { runId: 'run-1' } });
  });

  it('担当外の実行履歴は404にする', async () => {
    const res = await req(makeApp(), '/api/field-migrations/run-1?lineAccountId=account-1', 'GET');
    expect(res.status).toBe(404);
  });

  it('staffは移行を実行できない', async () => {
    const app = makeApp('staff');
    const res = await app.fetch(new Request(
      'https://example.com/api/friend-fields/ff-1/migrations?lineAccountId=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key' }, body: JSON.stringify({ previewToken: 'token' }) },
    ), env);
    expect(res.status).toBe(403);
  });

  it('プレビュー後に値が変わったら409にする', async () => {
    mocks.getFieldMigrationRunByToken.mockResolvedValue(RUN);
    mocks.getFriendFieldByIdForScope.mockImplementation(async (_db: unknown, id: string) => ({
      ...FIELD, id, field_key: id === 'ff-2' ? 'target' : 'pet_name', type: id === 'ff-2' ? 'number' : 'text',
      line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0,
    }));
    mocks.getFriendFieldValuesForMigration.mockResolvedValue([{ friend_id: 'friend-new', value: '99' }]);
    const app = makeApp();
    const res = await app.fetch(new Request(
      'https://example.com/api/friend-fields/ff-1/migrations?lineAccountId=account-1',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'new-key' }, body: JSON.stringify({ previewToken: 'token' }) },
    ), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PREVIEW_STALE' });
    expect(mocks.markFieldMigrationStale).toHaveBeenCalledWith(env.DB, 'run-1');
  });

  it('進捗・行別理由・切戻し期限を返す', async () => {
    mocks.getFieldMigrationRun.mockResolvedValue({ ...RUN, status: 'partial', rollback_deadline: '2026-10-07T00:00:00.000Z' });
    mocks.getFieldMigrationItems.mockResolvedValue([{ run_id: 'run-1', friend_id: 'friend-1', source_value: '不明', converted_value: null, status: 'review', reason: '数値として確認できません', migrated_at: null }]);
    const res = await req(makeApp(), '/api/field-migrations/run-1?lineAccountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: {
      runId: 'run-1', status: 'partial', rollbackDeadline: '2026-10-07T00:00:00.000Z',
      rows: [{ friendId: 'friend-1', reason: '数値として確認できません' }],
    } });
  });
});

describe('個人情報の項目', () => {
  const personal = { ...FIELD, id: 'ff-2', name: '電話番号', is_personal: 1, value: '090' };

  it('スタッフには返さない', async () => {
    mocks.getFriendFieldsWithValues.mockResolvedValue([
      { ...FIELD, value: null, updated_by: null },
      { ...personal, updated_by: null },
    ]);
    const res = await req(makeApp('staff'), '/api/friends/f-1/fields', 'GET');
    const body = (await res.json()) as {
      data: { items: Array<{ id: string }>; hiddenPersonalCount: number };
    };
    expect(body.data.items.map((i) => i.id)).toEqual(['ff-1']);
    // 「見えない項目がある」ことは伝える。何があるかは伝えない。
    expect(body.data.hiddenPersonalCount).toBe(1);
    expect(mocks.recordLoginAudit).not.toHaveBeenCalled();
  });

  it('管理者には返し、見たことを記録する', async () => {
    mocks.getFriendFieldsWithValues.mockResolvedValue([{ ...personal, updated_by: null }]);
    const res = await req(makeApp('admin'), '/api/friends/f-1/fields', 'GET');
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    expect(body.data.items).toHaveLength(1);
    expect(mocks.recordLoginAudit).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ action: 'view_personal', adminUserId: 'u-1' }),
    );
  });

  it('値が空なら記録しない', async () => {
    // 「項目があること」を見ただけでは閲覧にあたらない。
    mocks.getFriendFieldsWithValues.mockResolvedValue([
      { ...personal, value: null, updated_by: null },
    ]);
    await req(makeApp('admin'), '/api/friends/f-1/fields', 'GET');
    expect(mocks.recordLoginAudit).not.toHaveBeenCalled();
  });
});

describe('友だちのLINEアカウント境界', () => {
  it.each(['GET', 'PUT'] as const)('担当外の友だちへ %s で到達できない', async (method) => {
    mocks.getFriendById.mockResolvedValue({ id: 'f-other', line_account_id: 'account-2' });
    accountMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await req(
      makeApp('admin'),
      '/api/friends/f-other/fields',
      method,
      method === 'PUT' ? { values: { 'ff-1': '秘密' } } : undefined,
    );
    expect(res.status).toBe(404);
    expect(mocks.getFriendFieldsWithValues).not.toHaveBeenCalled();
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
  });
});

describe('値のまとめて更新', () => {
  it('EC が正の項目は書き換えず、理由を返す', async () => {
    // 黙って無視すると「保存したのに戻る」という形で表に出る。
    mocks.getFriendFields.mockResolvedValue([{ ...FIELD, id: 'ff-9', ec_is_master: 1, name: '本名' }]);
    const res = await req(makeApp(), '/api/friends/f-1/fields', 'PUT', {
      values: { 'ff-9': 'テスト' },
    });
    const body = (await res.json()) as { data: { updated: number }; warnings: string[] };
    expect(body.data.updated).toBe(0);
    expect(body.warnings[0]).toContain('本名');
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
  });

  it('知らない項目は無視して続ける', async () => {
    const res = await req(makeApp(), '/api/friends/f-1/fields', 'PUT', {
      values: { 'ff-1': 'ポチ', 'ghost': 'x' },
    });
    const body = (await res.json()) as { data: { updated: number }; warnings: string[] };
    expect(body.data.updated).toBe(1);
    expect(body.warnings).toHaveLength(1);
  });
});

describe('一括変更', () => {
  it('対象が空なら400', async () => {
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: [],
      fieldId: 'ff-1',
      value: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('1000人を超えたら422', async () => {
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: Array.from({ length: 1001 }, (_, i) => `f-${i}`),
      fieldId: 'ff-1',
      value: 'x',
    });
    expect(res.status).toBe(422);
  });

  it('EC が正の項目は一括でも変えられない', async () => {
    mocks.getFriendFieldById.mockResolvedValue({ ...FIELD, ec_is_master: 1 });
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-1'],
      fieldId: 'ff-1',
      value: 'x',
    });
    expect(res.status).toBe(409);
  });

  it('通常の項目は人数ぶん書き込む', async () => {
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-1', 'f-2'],
      fieldId: 'ff-1',
      value: 'ポチ',
    });
    expect(res.status).toBe(200);
    expect(mocks.setFriendFieldValue).toHaveBeenCalledTimes(2);
  });
});

describe('一括変更のアカウント境界（N-043）', () => {
  const FRIEND_OF = (id: string, line_account_id: string | null) => ({ id, line_account_id });

  function useAccountBoundary() {
    mocks.getFriendById.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 'f-ghost') return null;
      if (id === 'f-other' || id === 'f-other-2') return FRIEND_OF(id, 'account-2');
      return FRIEND_OF(id, 'account-1');
    });
    accountMocks.canAccessAllLineAccounts.mockImplementation(
      async (_db: unknown, _staff: unknown, accountIds: Array<string | null>) =>
        accountIds.every((accountId) => accountId === 'account-1'),
    );
  }

  it('同一アカウントのみなら成功する', async () => {
    useAccountBoundary();
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-1', 'f-2'],
      fieldId: 'ff-1',
      value: 'ポチ',
    });
    expect(res.status).toBe(200);
    expect(mocks.setFriendFieldValue).toHaveBeenCalledTimes(2);
    expect(accountMocks.canAccessAllLineAccounts).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ id: 'u-1' }),
      ['account-1', 'account-1'],
    );
  });

  it('同一・他アカウント混在は部分更新せず404で、存在と値を漏らさない', async () => {
    useAccountBoundary();
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-1', 'f-other'],
      fieldId: 'ff-1',
      value: '秘密の値',
    });
    expect(res.status).toBe(404);
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('account-2');
    expect(text).not.toContain('秘密の値');
  });

  it('全部が他アカウントでも404で更新しない', async () => {
    useAccountBoundary();
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-other', 'f-other-2'],
      fieldId: 'ff-1',
      value: '秘密の値',
    });
    expect(res.status).toBe(404);
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('account-2');
  });

  it('存在しない友だち混じりは404で更新しない', async () => {
    useAccountBoundary();
    const res = await req(makeApp(), '/api/friend-fields/bulk', 'POST', {
      friendIds: ['f-1', 'f-ghost'],
      fieldId: 'ff-1',
      value: 'ポチ',
    });
    expect(res.status).toBe(404);
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('f-ghost');
  });

  it('同じ一括更新を二重実行しても可視なら2回とも成功する', async () => {
    useAccountBoundary();
    const body = { friendIds: ['f-1', 'f-2'], fieldId: 'ff-1', value: 'ポチ' };
    const first = await req(makeApp(), '/api/friend-fields/bulk', 'POST', body);
    const second = await req(makeApp(), '/api/friend-fields/bulk', 'POST', body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.setFriendFieldValue).toHaveBeenCalledTimes(4);
  });
});
