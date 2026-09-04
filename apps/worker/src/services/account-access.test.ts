import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  return {
    ...actual,
    getLineAccounts: vi.fn(async () => accounts),
    getStaffById: vi.fn(async (_db: D1Database, id: string) => staffRows.get(id) ?? null),
    getStaffAccountScopeIds: vi.fn(async (_db: D1Database, id: string) => scopeIds.get(id) ?? []),
  };
});

function account(
  id: string,
  options: { parent?: string | null; tenantId?: string | null } = {},
): LineAccount {
  return {
    id, parent_line_account_id: options.parent ?? null, channel_id: id, name: id,
    channel_access_token: 'token', channel_secret: 'secret', login_channel_id: '1',
    login_channel_secret: 'secret', liff_id: '1-X', is_active: 1, is_default: 0,
    archived_at: null, archived_by: null, archived_reason: null, country: null,
    channel_access_token_updated_at: null, channel_secret_updated_at: null,
    login_channel_secret_updated_at: null,
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
let staffRows = new Map<string, { account_scope: 'all' | 'accounts' | null }>();
let scopeIds = new Map<string, string[]>();

const staff = (tenantId: string | null = DEFAULT_TENANT_ID) => ({
  id: 's', name: 'S', role: 'admin' as const, readOnly: false,
  assignedLineAccountId: 'parent', canAccessDescendantAccounts: false, tenantId,
});

describe('filterVisibleLineAccounts', () => {
  beforeEach(() => {
    accounts = [...defaultAccounts, tenantBAccount];
    staffRows = new Map([['s', { account_scope: 'all' }]]);
    scopeIds = new Map();
  });
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

  it("account_scope='all'（NULLを含む）は従来どおり統括内の全店舗と未割当を見られる", async () => {
    staffRows.set('s', { account_scope: null });
    await expect(getVisibleLineAccountScope({} as D1Database, staff())).resolves.toMatchObject({
      allowedAccountIds: ['parent', 'child', 'grandchild'],
      canSeeUnassigned: true,
    });
  });

  it("account_scope='accounts' は紐付いた2店舗だけを見られ、未割当を見られない", async () => {
    staffRows.set('s', { account_scope: 'accounts' });
    scopeIds.set('s', ['parent', 'grandchild']);
    await expect(getVisibleLineAccountScope({} as D1Database, staff())).resolves.toMatchObject({
      allowedAccountIds: ['parent', 'grandchild'],
      ids: ['parent', 'grandchild'],
      canSeeUnassigned: false,
    });
  });

  it("account_scope='accounts' で紐付けが0件なら空のままにする", async () => {
    staffRows.set('s', { account_scope: 'accounts' });
    await expect(getVisibleLineAccountScope({} as D1Database, staff())).resolves.toMatchObject({
      accounts: [],
      allowedAccountIds: [],
      ids: [],
      canSeeUnassigned: false,
    });
  });

  it('別統括の店舗が紐付けに混ざっていても除外する', async () => {
    staffRows.set('s', { account_scope: 'accounts' });
    scopeIds.set('s', ['parent', 'tenant-b-account']);
    await expect(getVisibleLineAccountScope({} as D1Database, staff())).resolves.toMatchObject({
      allowedAccountIds: ['parent'],
      ids: ['parent'],
      canSeeUnassigned: false,
    });
  });

  it('env-ownerはDBの担当範囲にかかわらず従来どおり全部見られる', async () => {
    staffRows.set('env-owner', { account_scope: 'accounts' });
    const owner = { ...staff(), id: 'env-owner' };
    await expect(getVisibleLineAccountScope({} as D1Database, owner)).resolves.toMatchObject({
      allowedAccountIds: ['parent', 'child', 'grandchild'],
      canSeeUnassigned: true,
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
