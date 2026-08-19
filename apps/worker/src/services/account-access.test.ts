import { describe, expect, it } from 'vitest';
import type { LineAccount } from '@line-crm/db';
import {
  filterVisibleLineAccounts,
  validateAccountHierarchy,
} from './account-access.js';

function account(id: string, parent: string | null = null): LineAccount {
  return {
    id, parent_line_account_id: parent, channel_id: id, name: id,
    channel_access_token: 'token', channel_secret: 'secret', login_channel_id: '1',
    login_channel_secret: 'secret', liff_id: '1-X', is_active: 1, country: null,
    role: null, display_order: 0, token_expires_at: null, og_site_name: null,
    og_default_image_url: null, og_default_description: null, friend_capacity: null,
    capacity_warn_at: null, icon_url: null, created_at: '', updated_at: '',
  };
}

const accounts = [account('parent'), account('child', 'parent'), account('grandchild', 'child'), account('other')];

describe('filterVisibleLineAccounts', () => {
  it('他アカウント権限OFFなら担当アカウントだけを返す', () => {
    expect(filterVisibleLineAccounts(accounts, {
      id: 's', name: 'S', role: 'admin', readOnly: false,
      assignedLineAccountId: 'parent', canAccessDescendantAccounts: false,
    }).map((item) => item.id)).toEqual(['parent']);
  });

  it('他アカウント権限ONなら子・孫を返し、別系統は返さない', () => {
    expect(filterVisibleLineAccounts(accounts, {
      id: 's', name: 'S', role: 'admin', readOnly: false,
      assignedLineAccountId: 'parent', canAccessDescendantAccounts: true,
    }).map((item) => item.id)).toEqual(['parent', 'child', 'grandchild']);
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
