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
  getFriendFieldListSummary: vi.fn(),
  getFriendFieldValuesForMigration: vi.fn(),
  getFriendFieldsWithValues: vi.fn(),
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
    'select',
    'multi_select',
    'checkbox',
    'url',
    'tel',
    'email',
  ],
};
vi.mock('@line-crm/db', () => mocks);
const accountMocks = {
  getVisibleLineAccountScope: vi.fn().mockResolvedValue({ allowedAccountIds: ['account-1'] }),
};
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: accountMocks.getVisibleLineAccountScope,
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
};

beforeEach(() => {
  vi.clearAllMocks();
  accountMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['account-1'] });
  mocks.getFriendFields.mockResolvedValue([FIELD]);
  mocks.getFriendFieldsForScope.mockResolvedValue([{ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 }]);
  mocks.getFriendFieldById.mockResolvedValue(FIELD);
  mocks.getFriendFieldByIdForScope.mockResolvedValue({ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 });
  mocks.createFriendField.mockResolvedValue(FIELD);
  mocks.createFriendFieldForScope.mockResolvedValue({ ...FIELD, line_account_id: 'account-1', tenant_id: 'tenant-1', is_inherited: 0 });
  mocks.updateFriendField.mockResolvedValue(FIELD);
  mocks.countFriendFieldValues.mockResolvedValue(0);
  mocks.countFriendFieldValuesForScope.mockResolvedValue(0);
  mocks.getFriendFieldListSummary.mockResolvedValue({ total: 1, inUse: 0, registeredFriends: 0, formLinks: null, updatedThisMonth: 0 });
  mocks.getFriendFieldValuesForMigration.mockResolvedValue([]);
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
