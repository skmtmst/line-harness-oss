import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getRichMenuGroupWithPages, saveRichMenuGroupDraft } from '../src/rich-menus/index.js';
import { asD1 } from './d1-test-helper.js';

it('保存した面を画像の上から左の順に読み直し、名前と動きは同じ位置に保つ', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account','channel','店舗','','');
      INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,default_page_id)
      VALUES ('menu','account','6つの動き','メニュー','large','page-1');
      INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id)
      VALUES ('page-2','menu',1,'2枚目','alias-2'),('page-1','menu',0,'1枚目','alias-1');`);
    const ids = ['90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000006'];
    const areas = ids.map((id, index) => ({ id, label: `名前${index + 1}`, x: index % 3 * 833,
      y: Math.floor(index / 3) * 843, data: { uri: `https://example.test/${index + 1}` } }));
    const insert = raw.prepare(`INSERT INTO rich_menu_areas
      (id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent,label)
      VALUES (?,'page-1',?,?,833,843,'uri',?,'url',?)`);
    for (const area of [...areas].reverse()) insert.run(area.id, area.x, area.y, JSON.stringify(area.data), area.label);

    const result = await getRichMenuGroupWithPages(asD1(raw), 'menu');
    expect(result?.pages.map(page => page.id)).toEqual(['page-1', 'page-2']);
    expect(result?.default_page_id).toBe('page-1');
    expect(result?.pages[0].areas.map(area => ({ id: area.id, label: area.label,
      x: area.bounds_x, y: area.bounds_y, data: area.actionData }))).toEqual(areas);
    expect(result?.pages[1].areas).toEqual([]);
    const saved = await saveRichMenuGroupDraft(asD1(raw), 'menu', {
      expectedVersion: result!.version,
      meta: {},
      pages: result!.pages.map(page => ({ id: page.id, name: page.name, orderIndex: page.order_index,
        areas: page.areas.map(area => ({ id: area.id, boundsX: area.bounds_x, boundsY: area.bounds_y,
          boundsWidth: area.bounds_width, boundsHeight: area.bounds_height, actionType: area.action_type,
          actionData: area.actionData, intent: area.intent, label: area.label })) })),
    });
    expect(saved.ok).toBe(true);
    const reopened = await getRichMenuGroupWithPages(asD1(raw), 'menu');
    expect(reopened?.pages[0].areas.map(area => ({ id: area.id, label: area.label,
      x: area.bounds_x, y: area.bounds_y, data: area.actionData }))).toEqual(areas);
  } finally {
    raw.close();
  }
});

it('内側が1px重なるページは従来順を保ち、別ページの並べ替えは止めない', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account','channel','店舗','','');
      INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size)
      VALUES ('menu','account','自由な形','メニュー','large');
      INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id)
      VALUES ('overlap','menu',0,'重なる面','alias-1'),('separate','menu',1,'別の面','alias-2');
      INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data)
      VALUES ('z-left','overlap',0,0,100,100,'message','{"text":"左"}'),
        ('a-right','overlap',99,0,100,100,'message','{"text":"右"}'),
        ('z-second-left','separate',0,0,100,100,'message','{"text":"左"}'),
        ('a-second-right','separate',100,0,100,100,'message','{"text":"右"}');`);
    const result = await getRichMenuGroupWithPages(asD1(raw), 'menu');
    expect(result?.pages[0].areas.map(area => area.id)).toEqual(['a-right', 'z-left']);
    expect(result?.pages[1].areas.map(area => area.id)).toEqual(['z-second-left', 'a-second-right']);
  } finally {
    raw.close();
  }
});
