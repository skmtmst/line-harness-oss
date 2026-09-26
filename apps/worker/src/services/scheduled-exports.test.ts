import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const db = {
  getLineAccounts: vi.fn(),
};
vi.mock('@line-crm/db', () => db);

const { processDueScheduledExports } = await import('./scheduled-exports.js');

const first = vi.fn();
const run = vi.fn(async () => ({ meta: { changes: 1 } }));
const bind = vi.fn((..._args: unknown[]) => ({ first, run }));
const prepare = vi.fn((..._args: unknown[]) => ({ bind }));
const env = { DB: { prepare } as unknown as D1Database } as Env['Bindings'];

const ACCOUNT = { id: 'acc-1', is_active: 1 };

describe('processDueScheduledExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getLineAccounts.mockResolvedValue([ACCOUNT]);
  });

  it('その日分が無いアカウントへ友だちCSVの書き出し履歴を作る', async () => {
    // 1回目の first（既存確認）は無し、2回目（件数）は100件。
    first.mockResolvedValueOnce(null).mockResolvedValueOnce({ count: 100 });
    const result = await processDueScheduledExports(env, { now: '2026-09-27T15:00:00Z' });
    expect(result).toMatchObject({ generated: 1, skipped: 0, failed: 0 });
    // INSERT文が走り、'system'/'定期実行' で記録される（SQLリテラル）
    const insertSql = prepare.mock.calls.map((c) => String(c[0])).find((s) => s.includes('INSERT INTO friend_export_jobs'));
    expect(insertSql).toContain("'system', '定期実行'");
  });

  it('同じ日(JST)に二重には作らない', async () => {
    first.mockResolvedValueOnce({ id: 'already' });
    const result = await processDueScheduledExports(env, { now: '2026-09-27T15:00:00Z' });
    expect(result).toMatchObject({ generated: 0, skipped: 1, failed: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it('JSTで日付を区切る（UTCが前日でも当日扱い）', async () => {
    // 2026-09-27T16:00Z = 9/28 01:00 JST → キーは '2026-09-28'
    first.mockResolvedValueOnce(null).mockResolvedValueOnce({ count: 0 });
    await processDueScheduledExports(env, { now: '2026-09-27T16:00:00Z' });
    const checkCall = bind.mock.calls[0];
    expect(checkCall?.[1]).toBe('2026-09-28');
  });

  it('止まっているアカウントは対象にしない', async () => {
    db.getLineAccounts.mockResolvedValue([{ id: 'acc-off', is_active: 0 }]);
    const result = await processDueScheduledExports(env, { now: '2026-09-27T15:00:00Z' });
    expect(result).toMatchObject({ generated: 0, skipped: 0, failed: 0 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('1件の失敗で他のアカウントを止めない', async () => {
    db.getLineAccounts.mockResolvedValue([ACCOUNT, { id: 'acc-2', is_active: 1 }]);
    first
      .mockResolvedValueOnce(null)              // acc-1 既存なし
      .mockResolvedValueOnce({ count: 10 })     // acc-1 件数
      .mockResolvedValueOnce(null)              // acc-2 既存なし
      .mockResolvedValueOnce({ count: 5 });     // acc-2 件数
    run.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ meta: { changes: 1 } });
    const result = await processDueScheduledExports(env, { now: '2026-09-27T15:00:00Z' });
    expect(result).toMatchObject({ generated: 1, skipped: 0, failed: 1 });
  });
});
