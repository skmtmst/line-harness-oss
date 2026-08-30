import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCommonVarMap, getCommonVarUsageImpact } from '../src/common-vars';
import { asD1 } from './d1-test-helper';

describe('common variable usage impact', () => {
  it('returns selected-account details while keeping legacy forms safe', async () => {
    const raw = new Database(':memory:');
    raw.exec(readFileSync(join(process.cwd(), 'bootstrap.sql'), 'utf8'));
    raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('a1','c1','A1','t','s'), ('a2','c2','A2','t','s');
      INSERT INTO templates (id, name, message_type, message_content, line_account_id)
      VALUES ('t1','A1テンプレート','text','営業時間は{{var.shop_hours}}','a1'),
             ('t2','A2テンプレート','text','営業時間は{{var.shop_hours}}','a2');
      INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, account_ids)
      VALUES ('b1','予約中','text','{{var.shop_hours}}です','all','scheduled','a1',NULL),
             ('b2','送信済み','text','{{var.shop_hours}}でした','all','sent','a1',NULL),
             ('b3','複数アカウント','text','{{var.shop_hours}}です','multi-account-dedup','draft','a2','["a2","a1"]');
      INSERT INTO scenarios (id, name, trigger_type, line_account_id)
      VALUES ('s1','来店後','manual','a1'), ('s2','別アカウント','manual','a2');
      INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
      VALUES ('ss1','s1',1,0,'text','次は{{var.shop_hours}}'),
             ('ss2','s2',1,0,'text','次は{{var.shop_hours}}');
      INSERT INTO forms (id, name, fields, on_submit_message_content, layout)
      VALUES ('f1','所属未設定フォーム','[]','受付は{{var.shop_hours}}','{}'),
             ('f2','A1フォーム','[]','受付は{{var.shop_hours}}','{}'),
             ('f3','A2フォーム','[]','受付は{{var.shop_hours}}','{}');
      INSERT INTO form_accounts (form_id, line_account_id)
      VALUES ('f2','a1'), ('f3','a2');
    `);

    const impact = await getCommonVarUsageImpact(asD1(raw), 'shop_hours', 'a1');

    expect(impact).toMatchObject({
      total: 7,
      blockingTotal: 6,
      historicalTotal: 1,
      unscopedFormTotal: 1,
      byKind: { template: 1, broadcast: 3, scenario: 1, form: 2 },
    });
    expect(impact.items.map((item) => item.source_id)).toEqual([
      't1', 'b1', 'b2', 'b3', 'ss1', 'f2',
    ]);
    expect(impact.items.some((item) => item.source_name.includes('A2'))).toBe(false);
    expect(impact.items.some((item) => item.source_name.includes('所属未設定'))).toBe(false);
    raw.close();
  });

  it('does not hide a failed scan as zero usages', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({ all: async () => { throw new Error('table unavailable'); } }),
      })),
    } as unknown as D1Database;

    await expect(getCommonVarUsageImpact(db, 'shop_hours', 'a1')).rejects.toThrow('table unavailable');
  });
});

describe('common variable account scope', () => {
  it('returns only values assigned to the requested LINE account', async () => {
    const raw = new Database(':memory:');
    raw.exec(readFileSync(join(process.cwd(), 'bootstrap.sql'), 'utf8'));
    raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('a1','c1','A1','t','s'), ('a2','c2','A2','t','s');
      INSERT INTO common_vars (id, line_account_id, name, var_key, value)
      VALUES
        ('v1','a1','営業時間','hours','10-18'),
        ('v2','a2','電話番号','phone','000'),
        ('legacy',NULL,'所属不明','legacy_key','hidden');
    `);

    await expect(getCommonVarMap(asD1(raw), 'a1')).resolves.toEqual({ hours: '10-18' });
    await expect(getCommonVarMap(asD1(raw), 'a2')).resolves.toEqual({ phone: '000' });
    await expect(getCommonVarMap(asD1(raw), null)).resolves.toEqual({});
    raw.close();
  });
});
