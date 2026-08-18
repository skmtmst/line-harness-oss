import { describe, it, expect, vi, beforeEach } from 'vitest';

// 管理画面から誰も入れなくなる操作を、サーバー側で断れているか。
// 一度これが通ると画面からは復旧できない（無効化された人を有効に戻せる人が
// いなくなる）ので、db層はモックにして経路だけを厳密に見る。
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  getStaffMembers: vi.fn(),
  getStaffById: vi.fn(),
  getStaffByInviteTokenHash: vi.fn(),
  createStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
  deleteStaffMember: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {} as D1Database,
  API_KEY,
} as unknown as import('../index.js').Env['Bindings'];

type Row = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  access_level: 'full' | 'read_only';
  is_active: number;
  line_user_id: string | null;
};

function row(over: Partial<Row> & { id: string }): Row {
  return {
    name: over.id, role: 'admin', access_level: 'full', is_active: 1, line_user_id: null,
    ...over,
  };
}

function send(path: string, method: 'PATCH' | 'DELETE', body?: unknown) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      method,
      headers: new Headers({ Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateStaffMember.mockImplementation(async (_db: unknown, id: string) => row({ id }));
  dbMocks.deleteStaffMember.mockResolvedValue(undefined);
});

describe('最後の管理者を締め出さない', () => {
  it('他に有効な管理者がいなければ無効化を断る', async () => {
    const only = row({ id: 'only-admin' });
    dbMocks.getStaffById.mockResolvedValue(only);
    dbMocks.getStaffMembers.mockResolvedValue([
      only,
      row({ id: 'viewer', access_level: 'read_only' }),
      row({ id: 'staff', role: 'staff' }),
      row({ id: 'disabled', is_active: 0 }),
    ]);

    const res = await send('/api/staff/only-admin', 'PATCH', { isActive: false });

    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('管理者が一人もいなくなります');
    expect(dbMocks.updateStaffMember).not.toHaveBeenCalled();
  });

  it('他に有効な管理者がいれば無効化できる', async () => {
    const target = row({ id: 'admin-a' });
    dbMocks.getStaffById.mockResolvedValue(target);
    dbMocks.getStaffMembers.mockResolvedValue([target, row({ id: 'admin-b' })]);

    const res = await send('/api/staff/admin-a', 'PATCH', { isActive: false });

    expect(res.status).toBe(200);
    expect(dbMocks.updateStaffMember).toHaveBeenCalledWith(
      env.DB, 'admin-a', expect.objectContaining({ is_active: 0 }),
    );
  });

  it('役割の格下げでも最後の管理者は守る', async () => {
    const only = row({ id: 'only-admin' });
    dbMocks.getStaffById.mockResolvedValue(only);
    dbMocks.getStaffMembers.mockResolvedValue([only]);

    const res = await send('/api/staff/only-admin', 'PATCH', { role: 'viewer' });

    expect(res.status).toBe(400);
    expect(dbMocks.updateStaffMember).not.toHaveBeenCalled();
  });

  it('最後の管理者は削除もできない', async () => {
    const only = row({ id: 'only-admin' });
    dbMocks.getStaffById.mockResolvedValue(only);
    dbMocks.getStaffMembers.mockResolvedValue([only]);

    const res = await send('/api/staff/only-admin', 'DELETE');

    expect(res.status).toBe(400);
    expect(dbMocks.deleteStaffMember).not.toHaveBeenCalled();
  });

  it('管理者でない人の無効化は素通しする', async () => {
    const target = row({ id: 'staff-a', role: 'staff' });
    dbMocks.getStaffById.mockResolvedValue(target);
    dbMocks.getStaffMembers.mockResolvedValue([target]);

    const res = await send('/api/staff/staff-a', 'PATCH', { isActive: false });

    expect(res.status).toBe(200);
    expect(dbMocks.getStaffMembers).not.toHaveBeenCalled();
  });
});

describe('LINE連携の解除', () => {
  it('lineLinked:false で連携だけ外す', async () => {
    const target = row({ id: 'admin-a', line_user_id: 'U1' });
    dbMocks.getStaffById.mockResolvedValue(target);
    dbMocks.getStaffMembers.mockResolvedValue([target, row({ id: 'admin-b' })]);

    const res = await send('/api/staff/admin-a', 'PATCH', { lineLinked: false });

    expect(res.status).toBe(200);
    expect(dbMocks.updateStaffMember).toHaveBeenCalledWith(
      env.DB, 'admin-a', expect.objectContaining({ line_user_id: null, line_linked_at: null }),
    );
  });

  it('連携に触れない更新では line_user_id を送らない', async () => {
    const target = row({ id: 'admin-a', line_user_id: 'U1' });
    dbMocks.getStaffById.mockResolvedValue(target);
    dbMocks.getStaffMembers.mockResolvedValue([target, row({ id: 'admin-b' })]);

    await send('/api/staff/admin-a', 'PATCH', { name: '新しい名前' });

    expect(dbMocks.updateStaffMember).toHaveBeenCalledWith(
      env.DB, 'admin-a', expect.objectContaining({ line_user_id: undefined }),
    );
  });
});

describe('存在しない相手', () => {
  it('404を返し、更新はしない', async () => {
    dbMocks.getStaffById.mockResolvedValue(null);

    const res = await send('/api/staff/missing', 'PATCH', { isActive: true });

    expect(res.status).toBe(404);
    expect(dbMocks.updateStaffMember).not.toHaveBeenCalled();
  });
});
