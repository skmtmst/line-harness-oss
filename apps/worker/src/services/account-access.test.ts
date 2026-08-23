import { describe, expect, it, vi } from 'vitest';
import type { LineAccount } from '@line-crm/db';
import {
  canAccessLineAccount,
  filterVisibleLineAccounts,
  getVisibleLineAccountScope,
  validateAccountHierarchy,
} from './account-access.js';

vi.mock('@line-crm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/db')>();
  return { ...actual, getLineAccounts: vi.fn(async () => accounts) };
});

function account(id: string, parent: string | null = null): LineAccount {
  return {
    id, parent_line_account_id: parent, channel_id: id, name: id,
    channel_access_token: 'token', channel_secret: 'secret', login_channel_id: '1',
    login_channel_secret: 'secret', liff_id: '1-X', is_active: 1, country: null,
    role: null, display_order: 0, token_expires_at: null, og_site_name: null,
    og_default_image_url: null, og_default_description: null, friend_capacity: null,
    capacity_warn_at: null, icon_url: null, tenant_id: null, created_at: '', updated_at: '',
  };
}

const accounts = [account('parent'), account('child', 'parent'), account('grandchild', 'child'), account('other')];

describe('filterVisibleLineAccounts', () => {
  it('担当アカウントは既定値として扱い、組織内の全アカウントを返す', () => {
    expect(filterVisibleLineAccounts(accounts, {
      id: 's', name: 'S', role: 'admin', readOnly: false,
      assignedLineAccountId: 'parent', canAccessDescendantAccounts: false,
    }).map((item) => item.id)).toEqual(['parent', 'child', 'grandchild', 'other']);
  });

  it('スタッフも別系統のアカウントを操作できる', async () => {
    const staff = {
      id: 's', name: 'S', role: 'staff' as const, readOnly: false,
      assignedLineAccountId: 'parent', canAccessDescendantAccounts: false,
    };
    expect(canAccessLineAccount(accounts, staff, 'other')).toBe(true);
    await expect(getVisibleLineAccountScope({} as D1Database, staff)).resolves.toMatchObject({
      ids: ['parent', 'child', 'grandchild', 'other'],
      restricted: false,
    });
  });
});

describe('validateAccountHierarchy', () => {
  it('親・子・孫の3階層を許可する', () => {
    expect(validateAccountHierarchy(accounts, [])).toBeNull();
  });

  it('4階層目を拒否する', () => {
    expect(validateAccountHierarchy([...accounts, account('fourth')], [
      { id: 'fourth', parentLineAccountId: 'grandchild' },
    ])).toMatch(/3階層/);
  });

  it('循環を拒否する', () => {
    expect(validateAccountHierarchy(accounts, [
      { id: 'parent', parentLineAccountId: 'grandchild' },
    ])).toMatch(/循環/);
  });
});
