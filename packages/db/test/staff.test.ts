import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getStaffMembers } from '../src/staff.js';

describe('getStaffMembers', () => {
  it('NULLの既存行を既定統括として扱い、指定された統括だけを取得する', async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await getStaffMembers(db, 'tenant-b');

    expect(prepare).toHaveBeenCalledWith(
      'SELECT * FROM staff_members WHERE COALESCE(tenant_id, ?) = ? ORDER BY created_at ASC',
    );
    expect(bind).toHaveBeenCalledWith(DEFAULT_TENANT_ID, 'tenant-b');
    expect(all).toHaveBeenCalledOnce();
  });
});
