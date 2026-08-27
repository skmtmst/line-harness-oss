import { describe, expect, it, vi } from 'vitest';
import type { LineAccount } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
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

function account(
  id: string,
  options: { parent?: string | null; tenantId?: string | null } = {},
): LineAccount {
  return {
    id, parent_line_account_id: options.parent ?? null, channel_id: id, name: id,
    channel_access_token: 'token', channel_secret: 'secret', login_channel_id: '1',
    login_channel_secret: 'secret', liff_id: '1-X', is_active: 1, country: null,
    role: null, display_order: 0, token_expires_at: null, og_site_name: null,
    og_default_image_url: null, og_default_description: null, friend_capacity: null,
    capacity_warn_at: null, icon_url: null,
    tenant_id: options.tenantId === undefined ? DEFAULT_TENANT_ID : options.tenantId,
    created_at: '', updated_at: '',
  };
}

const defaultAccounts = [
  account('parent'),
  account('child', { parent: 'parent' }),
  account('grandchild', { parent: 'child' }),
];
const tenantBAccount = account('tenant-b-account', { tenantId: 'tenant-B' });
let accounts = [...defaultAccounts, tenantBAccount];

const staff = (tenantId: string | null = DEFAULT_TENANT_ID) => ({
  id: 's', name: 'S', role: 'admin' as const, readOnly: false,
  assignedLineAccountId: 'parent', canAccessDescendantAccounts: false, tenantId,
});

describe('filterVisibleLineAccounts', () => {
  it('既定統括のスタッフには既定統括の3アカウントだけを返す', () => {
    expect(filterVisibleLineAccounts(accounts, staff()).map((item) => item.id))
      .toEqual(['parent', 'child', 'grandchild']);
  });

  it('tenant-Bのスタッフにはtenant-Bのアカウントだけを返す', () => {
    expect(filterVisibleLineAccounts(accounts, staff('tenant-B')).map((item) => item.id))
      .toEqual(['tenant-b-account']);
  });

  it('tenantIdがNULLのスタッフは既定統括として扱う', () => {
    expect(filterVisibleLineAccounts(accounts, staff(null)).map((item) => item.id))
      .toEqual(['parent', 'child', 'grandchild']);
  });

  it('tenant_idがNULLのアカウントは既定統括から見える', () => {
    const legacy = account('legacy', { tenantId: null });
    expect(filterVisibleLineAccounts([...accounts, legacy], staff()).map((item) => item.id))
      .toContain('legacy');
  });

  it('同じ統括内では担当・親子設定にかかわらず全アカウントを操作できる', () => {
    expect(canAccessLineAccount(accounts, staff(), 'grandchild')).toBe(true);
    expect(canAccessLineAccount(accounts, staff(), 'tenant-b-account')).toBe(false);
  });

  it('既定統括は自分のアカウントと未割当行を閲覧できる', async () => {
    await expect(getVisibleLineAccountScope({} as D1Database, staff())).resolves.toMatchObject({
      allowedAccountIds: ['parent', 'child', 'grandchild'],
      ids: ['parent', 'child', 'grandchild'],
      canSeeUnassigned: true,
    });
  });

  it('既定統括以外は自分のアカウントだけを閲覧し、未割当行を閲覧できない', async () => {
    await expect(getVisibleLineAccountScope({} as D1Database, staff('tenant-B'))).resolves.toMatchObject({
      allowedAccountIds: ['tenant-b-account'],
      canSeeUnassigned: false,
    });
  });

  it('アカウントが0件の統括には空の一覧を返す', async () => {
    await expect(getVisibleLineAccountScope({} as D1Database, staff('tenant-empty'))).resolves.toMatchObject({
      allowedAccountIds: [],
      canSeeUnassigned: false,
    });
  });

  it('保存用の店舗権限範囲はこの工程では閲覧範囲を変えない', async () => {
    const limited = { ...staff(), accountScope: 'accounts', scopedLineAccountIds: ['parent'] };
    await expect(getVisibleLineAccountScope({} as D1Database, limited)).resolves.toMatchObject({
      allowedAccountIds: ['parent', 'child', 'grandchild'],
      ids: ['parent', 'child', 'grandchild'],
    });
  });
});

describe('validateAccountHierarchy', () => {
  it('親・子・孫の3階層を許可する', () => {
    expect(validateAccountHierarchy(defaultAccounts, [])).toBeNull();
  });

  it('4階層目を拒否する', () => {
    expect(validateAccountHierarchy([...defaultAccounts, account('fourth')], [
      { id: 'fourth', parentLineAccountId: 'grandchild' },
    ])).toMatch(/3階層/);
  });

  it('循環を拒否する', () => {
    expect(validateAccountHierarchy(defaultAccounts, [
      { id: 'parent', parentLineAccountId: 'grandchild' },
    ])).toMatch(/循環/);
  });
});
