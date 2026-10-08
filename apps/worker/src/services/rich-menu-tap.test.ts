import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { handleRichMenuTap } from './rich-menu-tap.js';
import type { LineClient } from '@line-crm/line-sdk';

const resources: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const resource of resources.splice(0)) resource.raw.close(); });

function fixture() {
  const sql = createTestD1({ foreignKeys: true }); resources.push(sql);
  sql.raw.exec(`
    INSERT INTO tenants(id,name) VALUES ('tenant','Tenant');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id)
      VALUES ('account','Account','channel','token','secret','tenant','liff'),('other','Other','other-channel','token','secret','tenant','other-liff');
    INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','U1','Friend','account');
    INSERT INTO scenarios(id,name,trigger_type,line_account_id,is_active,current_published_version_id)
      VALUES ('scenario','案内','manual','account',1,'scenario-v1');
    INSERT INTO scenario_versions(
      id,scenario_id,version_number,delivery_mode,steps_snapshot,actions_snapshot,status,
      published_at,created_at,updated_at
    ) VALUES (
      'scenario-v1','scenario',1,'relative','[]','[]','published',
      '2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'
    );
    INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,status) VALUES ('group','account','Menu','Open','large','published');
    INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id) VALUES ('page','group',0,'Page','alias');
    INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent)
      VALUES ('area','page',0,0,100,100,'message','{"text":"案内を見る","scenarioId":"scenario"}','text');
  `);
  return sql;
}

describe('rich-menu scenario side effect', () => {
  test('starts the destination scenario for the tapped friend', async () => {
    const f = fixture();
    const result = await handleRichMenuTap(f.db, {} as LineClient, { id: 'friend', line_user_id: 'U1' }, 'area', { lineAccountId: 'account' });
    expect(result.target?.scenarioId).toBe('scenario');
    expect(f.raw.prepare("SELECT scenario_id,status FROM friend_scenarios WHERE friend_id='friend'").get()).toMatchObject({ scenario_id: 'scenario' });
  });

  test('rejects an area from another LINE account', async () => {
    const f = fixture();
    expect(await handleRichMenuTap(f.db, {} as LineClient, { id: 'friend', line_user_id: 'U1' }, 'area', { lineAccountId: 'other' })).toEqual({ target: null, replyTokenConsumed: false });
    expect(f.raw.prepare("SELECT COUNT(*) AS count FROM friend_scenarios WHERE friend_id='friend'").get()).toEqual({ count: 0 });
  });
});


describe('W43 リッチメニューの構造本文と履歴（実SQL）', () => {
  test.each(['valid', 'missing', 'invalid'] as const)('%s: 安全な本文だけを送信して結果を記録する', async (kind) => {
    const f = fixture();
    const value = '引用"\n改行\\日本語 {{var.unknown}}';
    if (kind !== 'missing') f.raw.prepare(`INSERT INTO common_vars (id, line_account_id, name, var_key, type, value)
      VALUES ('cv-json', 'account', '案内', 'hours', 'long_text', ?)`).run(value);
    const content = kind === 'invalid' ? '{"text":"{{var.hours}}"' : JSON.stringify({ type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '{{var.hours}}' }] } });
    f.raw.prepare(`INSERT INTO templates (id, name, message_type, message_content, line_account_id)
      VALUES ('tpl-json', '案内', 'flex', ?, 'account')`).run(content);
    f.raw.exec(`UPDATE rich_menu_areas SET intent = 'template', template_id = 'tpl-json', action_data = '{}' WHERE id = 'area'`);
    const pushMessage = vi.fn(async (_to: string, _messages: unknown[]) => undefined);
    await handleRichMenuTap(f.db, { pushMessage } as unknown as LineClient,
      { id: 'friend', line_user_id: 'U1' }, 'area', { lineAccountId: 'account' });
    const logs = f.raw.prepare(`SELECT content, message_type FROM messages_log WHERE friend_id = 'friend'`).all() as { content: string; message_type: string }[];
    if (kind === 'valid') {
      expect(pushMessage.mock.calls[0]?.[1][0]).toMatchObject({ type: 'flex', contents: { body: { contents: [{ text: value }] } } });
      expect(logs).toHaveLength(1);
      expect(logs[0].message_type).toBe('flex');
      expect(JSON.parse(logs[0].content)).toMatchObject({ body: { contents: [{ text: value }] } });
    } else {
      expect(pushMessage).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    }
    expect(f.raw.prepare(`SELECT var_key, reason FROM common_var_resolution_failures`).all())
      .toEqual(kind === 'missing' ? [{ var_key: 'hours', reason: 'missing' }] : []);
  });
});


test('PKG47: 同じWebhookのタップ再送は加点せず、次のタップは加点する', async () => {
  const f = fixture();
  f.raw.exec(`UPDATE rich_menu_areas SET score_change = 10 WHERE id='area'`);
  const tap = (sourceEventId: string) => handleRichMenuTap(f.db, {} as LineClient,
    { id: 'friend', line_user_id: 'U1' }, 'area', { lineAccountId: 'account', sourceEventId });
  await tap('event-1'); await tap('event-1'); await tap('event-2');
  expect(f.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score: 20 });
  expect(f.raw.prepare('SELECT COUNT(*) n, SUM(score_change) total FROM friend_scores').get()).toEqual({ n: 2, total: 20 });
});
