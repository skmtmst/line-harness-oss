import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getRichMenuGroupWithPages } from '@line-crm/db';
import { asD1 } from '@line-crm/db/test/d1-test-helper.js';
import { buildLineRichMenuPayload, type PageInput } from './rich-menu-publisher.js';

it('読取順が画像順になってもLINE用の面の座標と動きの集合を変えない', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account','channel','店舗','','');
      INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size)
      VALUES ('menu','account','画像と動き','メニュー','large');
      INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id)
      VALUES ('page','menu',0,'ページ','alias');
      INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent,label)
      VALUES ('z-left','page',0,0,1250,1686,'uri','{"uri":"https://example.test/left"}','url','左の名前'),
        ('a-right','page',1250,0,1250,1686,'uri','{"uri":"https://example.test/right"}','url','右の名前');`);
    const group = (await getRichMenuGroupWithPages(asD1(raw), 'menu'))!;
    const page = group.pages[0];
    const input: PageInput = { id: page.id, orderIndex: page.order_index, name: page.name,
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: page.areas.map(area => ({ id: area.id, label: area.label, intent: area.intent,
        bounds: { x: area.bounds_x, y: area.bounds_y, width: area.bounds_width, height: area.bounds_height },
        actionType: area.action_type, actionData: area.actionData })) };
    const payload = buildLineRichMenuPayload({ id: group.id, size: group.size,
      chatBarText: group.chat_bar_text, isDefaultForAll: false, pages: [input] }, input);
    const areas = payload.areas as Array<{ bounds: { x: number }; action: unknown }>;
    expect([...areas].sort((a, b) => a.bounds.x - b.bounds.x)).toEqual([
      { bounds: { x: 0, y: 0, width: 1250, height: 1686 }, action: { type: 'uri', uri: 'https://example.test/left' } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 1686 }, action: { type: 'uri', uri: 'https://example.test/right' } },
    ]);
    expect(input.areas.map(area => area.id).sort()).toEqual(['a-right', 'z-left']);
  } finally {
    raw.close();
  }
});
