import { afterEach, describe, expect, test } from 'vitest';
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
