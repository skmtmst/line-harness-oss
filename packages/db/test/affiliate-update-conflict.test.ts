import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAffiliateById, updateAffiliate, type UpdateAffiliateInput } from '../src/affiliates.js';
import { openSharedD1, type SharedD1 } from './shared-d1-test-helper.js';

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', allowedLineAccountIds: ['account-1'] };
const expected: UpdateAffiliateInput = {
  name: '紹介者', commission_rate: 0, reward_mode: 'fixed', is_active: 1,
  email: null, hold_days: null, payout_cycle: null, notify_on_conversion: 0,
};
let directory: string;
let first: SharedD1;
let second: SharedD1;
let beforeUpdate: (() => Promise<void>) | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'affiliate-conflict-'));
  beforeUpdate = undefined;
  first = openSharedD1(join(directory, 'db.sqlite'), {
    onStatement: async sql => {
      if (sql.startsWith('UPDATE affiliates SET') && beforeUpdate) {
        const run = beforeUpdate;
        beforeUpdate = undefined;
        await run();
      }
    },
  });
  first.raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  first.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_secret, channel_access_token, tenant_id, created_at, updated_at)
    VALUES ('account-1', 'channel-1', '本店', 'secret', 'token', ?, '2026-10-25', '2026-10-25')`).run(scope.tenantId);
  first.raw.prepare(`INSERT INTO affiliates (id, tenant_id, line_account_id, name, code, commission_rate, reward_mode, is_active, email, hold_days, payout_cycle, notify_on_conversion, created_at)
    VALUES ('aff-1', ?, 'account-1', '紹介者', 'code1', 0, 'fixed', 1, NULL, NULL, NULL, 0, '2026-10-25')`).run(scope.tenantId);
  second = openSharedD1(join(directory, 'db.sqlite'));
});
afterEach(() => { first?.close(); second?.close(); rmSync(directory, { recursive: true, force: true }); });

describe('紹介者の比較付き保存', () => {
  it('NULLを含む読み込み値が一致すれば保存できる', async () => {
    const saved = await updateAffiliate(first.db, 'aff-1', { name: '新しい名前', email: 'new@example.com' }, scope, expected);
    expect(saved).toMatchObject({ name: '新しい名前', email: 'new@example.com', hold_days: null });
  });

  it.each([
    { name: '相手の名前' }, { commission_rate: 5 }, { reward_mode: 'none' as const },
    { is_active: 0 }, { email: 'other@example.com' }, { hold_days: 7 },
    { payout_cycle: '月末' }, { notify_on_conversion: 1 },
  ])('編集する各欄の変更 %j を検出し、相手の値を残す', async change => {
    await updateAffiliate(second.db, 'aff-1', change, scope);
    await expect(updateAffiliate(first.db, 'aff-1', { name: '自分の名前' }, scope, expected)).rejects.toThrow('AFFILIATE_VERSION_CONFLICT');
    expect(await getAffiliateById(first.db, 'aff-1', scope)).toMatchObject({ ...expected, ...change });
  });

  it('検査の読み取り後、更新直前に別接続が保存しても上書きしない', async () => {
    beforeUpdate = async () => { await updateAffiliate(second.db, 'aff-1', { email: 'other@example.com' }, scope); };
    await expect(updateAffiliate(first.db, 'aff-1', { reward_mode: 'none', email: 'mine@example.com' }, scope, expected)).rejects.toThrow('AFFILIATE_VERSION_CONFLICT');
    expect(await getAffiliateById(first.db, 'aff-1', scope)).toMatchObject({ reward_mode: 'fixed', email: 'other@example.com' });
  });

  it('最新値で比較し直せば再保存できる', async () => {
    await updateAffiliate(second.db, 'aff-1', { name: '相手の名前' }, scope);
    const latest = await getAffiliateById(first.db, 'aff-1', scope);
    expect(await updateAffiliate(first.db, 'aff-1', { name: '確認後の名前' }, scope, latest!)).toMatchObject({ name: '確認後の名前' });
  });

  it('比較なしの古い呼び出しは今までどおり保存する', async () => {
    await updateAffiliate(second.db, 'aff-1', { name: '相手の名前' }, scope);
    expect(await updateAffiliate(first.db, 'aff-1', { name: '従来の保存' }, scope)).toMatchObject({ name: '従来の保存' });
  });

  it('別店舗と存在しない行は競合にせずnullを返す', async () => {
    expect(await updateAffiliate(first.db, 'aff-1', { name: '不可' }, { ...scope, allowedLineAccountIds: ['other'] }, expected)).toBeNull();
    expect(await updateAffiliate(first.db, 'missing', { name: '不可' }, scope, expected)).toBeNull();
    expect(await getAffiliateById(first.db, 'aff-1', scope)).toMatchObject({ name: '紹介者' });
  });

  it('報酬方式がNULLの旧い行は、画面へ補完された方式と比べる', async () => {
    first.raw.exec("UPDATE affiliates SET reward_mode = NULL");
    expect(await updateAffiliate(first.db, 'aff-1', { name: '更新' }, scope, expected)).toMatchObject({ name: '更新' });
  });
});
