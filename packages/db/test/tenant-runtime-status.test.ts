import { describe, expect, it, vi } from 'vitest';
import {
  activeTenantLineAccountSql,
  getLineAccountTenantStatus,
} from '../src/line-accounts.js';

describe('tenant runtime status', () => {
  it('dispatcher用SQLはLINEアカウントからactive統括だけを許可する', () => {
    const sql = activeTenantLineAccountSql('delivery.line_account_id');
    expect(sql).toContain('tenant_gate_account.id = delivery.line_account_id');
    expect(sql).toContain("tenant_gate_tenant.status = 'active'");
    expect(sql).toContain('00000000-0000-4000-8000-000000000001');
  });

  it('SQL識別子以外を埋め込ませない', () => {
    expect(() => activeTenantLineAccountSql('x); DROP TABLE tenants;--')).toThrow(
      'Invalid line account SQL expression',
    );
  });

  it('存在しないアカウントはfail-closedでarchivedとして扱う', async () => {
    const first = vi.fn().mockResolvedValue(null);
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    expect(await getLineAccountTenantStatus(db, 'missing')).toBe('archived');
    expect(first).toHaveBeenCalledOnce();
  });
});
