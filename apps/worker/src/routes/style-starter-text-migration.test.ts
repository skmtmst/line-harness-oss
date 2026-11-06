import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { resourceSnapshot } from '../services/style-starter-resource.js';

const migration = readFileSync(new URL('../../../../packages/db/migrations/742_style_starter_text_body.sql', import.meta.url), 'utf8');
let f: ReturnType<typeof createTestD1>;
beforeEach(() => { f = createTestD1(); f.raw.pragma('foreign_keys=OFF'); });
afterEach(() => f.raw.close());

test('未編集の見本の本文と同じ過去版だけを直し、対象外と指紋を保ち再実行は0件', async () => {
  const wrapped = JSON.stringify({ text: 'こんにちは。' });
  const cases = [
    ['eligible', 'text', wrapped, 1],
    ['plain', 'text', 'こんにちは。', 1],
    ['extra', 'text', '{"text":"こんにちは。","extra":1}', 1],
    ['broken', 'text', '{broken', 1],
    ['array', 'text', '["こんにちは。"]', 1],
    ['number', 'text', '{"text":1}', 1],
    ['image', 'image', wrapped, 1],
    ['not-sample', 'text', wrapped, 0],
    ['unbound', 'text', wrapped, 1],
    ['wrong-kind', 'text', wrapped, 1],
    ['edited-name', 'text', wrapped, 1],
    ['edited-body', 'text', wrapped, 1],
    ['edited-draft', 'text', wrapped, 1],
    ['edited-published', 'text', wrapped, 1],
    ['edited-time', 'text', wrapped, 1],
    ['unknown-snapshot', 'text', wrapped, 1],
    ['wrong-account', 'text', wrapped, 1],
  ] as const;
  for (const [id, type, content, sample] of cases) {
    f.raw.prepare('INSERT INTO templates(id,line_account_id,name,message_type,message_content) VALUES(?,?,?,?,?)')
      .run(id, 'a', '【見本】あいさつ', type, content);
    const snapshot = await resourceSnapshot(f.db, 'a', 'template', id);
    if (id !== 'unbound') f.raw.prepare(`INSERT INTO style_starter_items(line_account_id,style,item_key,kind,target_id,is_sample,set_version,applied_at,source_snapshot)
      VALUES(?,'salon',?,'template',?,?,1,'fixed',?)`)
      .run(id === 'wrong-account' ? 'b' : 'a', id, id, sample, id === 'unknown-snapshot' ? null : snapshot);
    f.raw.prepare('INSERT INTO template_versions(id,template_id,version_number,message_type,message_content) VALUES(?,?,1,?,?)')
      .run('version-' + id, id, type, content);
  }
  f.raw.prepare("UPDATE style_starter_items SET kind='scenario' WHERE item_key='wrong-kind'").run();
  f.raw.prepare("UPDATE templates SET name='店の名前' WHERE id='edited-name'").run();
  f.raw.prepare("UPDATE templates SET message_content=? WHERE id='edited-body'").run(JSON.stringify({ text: '店の本文' }));
  f.raw.prepare("UPDATE templates SET draft_message_content='店の下書き' WHERE id='edited-draft'").run();
  f.raw.prepare("UPDATE templates SET published_version=9 WHERE id='edited-published'").run();
  f.raw.prepare("UPDATE templates SET updated_at='edited' WHERE id='edited-time'").run();
  f.raw.prepare(`INSERT INTO template_versions(id,template_id,version_number,message_type,message_content)
    VALUES('different-history','eligible',2,'text',?)`).run(JSON.stringify({ text: '以前の別の本文' }));
  f.raw.prepare(`INSERT INTO template_versions(id,template_id,version_number,message_type,message_content)
    VALUES('image-history','eligible',3,'image',?)`).run(wrapped);
  const rows = () => ({
    templates: f.raw.prepare('SELECT * FROM templates ORDER BY id').all(),
    versions: f.raw.prepare('SELECT * FROM template_versions ORDER BY id').all(),
    bindings: f.raw.prepare('SELECT * FROM style_starter_items ORDER BY item_key').all(),
  });
  const before = rows();
  const changes = () => (f.raw.prepare('SELECT total_changes() n').get() as { n: number }).n;
  const start = changes();
  f.raw.transaction(() => f.raw.exec(migration))();
  expect(changes() - start).toBe(2);
  const after = rows();
  expect(after).toEqual({
    templates: before.templates.map(row => {
      const value = row as { id: string };
      return value.id === 'eligible' ? { ...value, message_content: 'こんにちは。' } : value;
    }),
    versions: before.versions.map(row => {
      const value = row as { id: string };
      return value.id === 'version-eligible' ? { ...value, message_content: 'こんにちは。' } : value;
    }),
    bindings: before.bindings,
  });
  const second = changes();
  f.raw.transaction(() => f.raw.exec(migration))();
  expect(changes() - second).toBe(0);
  expect(rows()).toEqual(after);
});
