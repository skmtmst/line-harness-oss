import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHqTemplate, getHqTemplate, listHqTemplates } from '../src/hq-templates.js';
import { asD1 } from './d1-test-helper.js';
let sql: Database.Database;
beforeEach(() => { sql = new Database(':memory:'); sql.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8')); });
afterEach(() => sql.close());
test('logical attribute types preserve existing backing types and immutable identity', async () => {
  for (const type of ['friend_field', 'mark'] as const) {
    const row = await createHqTemplate(asD1(sql), { id: type, tenantId: 't', type, name: type });
    expect(row.template_type).toBe(type);
    expect((await listHqTemplates(asD1(sql), 't', type)).map(r => r.id)).toEqual([type]);
    expect(() => sql.prepare('UPDATE hq_templates SET friend_attribute_type=NULL WHERE id=?').run(type)).toThrow('HQ_TYPE_IMMUTABLE');
  }
  for (const type of ['tag', 'template', 'rich_menu', 'form', 'scenario'] as const) {
    await createHqTemplate(asD1(sql), { id: type, tenantId: 't', type, name: type });
    expect((await getHqTemplate(asD1(sql), 't', type))?.template_type).toBe(type);
  }
});
test('SQL rejects invalid attribute values and combinations, with foreign keys preserved', () => {
  sql.pragma('foreign_keys=ON');
  const insert = sql.prepare('INSERT INTO hq_templates(id,tenant_id,template_type,extended_type,friend_attribute_type,name) VALUES(?,?,?,?,?,?)');
  expect(() => insert.run('bad', 't', 'tag', null, 'other', 'bad')).toThrow();
  expect(() => insert.run('bad', 't', 'form', null, 'mark', 'bad')).toThrow('HQ_TYPE_INVALID');
  expect(() => insert.run('bad', 't', 'template', 'scenario', 'mark', 'bad')).toThrow('HQ_TYPE_INVALID');
  insert.run('ok', 't', 'tag', null, 'mark', 'mark');
  sql.exec("INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES('v','t','ok',1,'{}','h')");
  expect(sql.pragma('foreign_key_check')).toEqual([]);
});
