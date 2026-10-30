import { afterEach, beforeEach, expect, test } from 'vitest';
import { ACCOUNT_STYLES, DEFAULT_TENANT_ID, type AccountStyle } from '@line-crm/shared';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { saveProfile, standardStarter } from '../services/style-setup.js';
import { buildMessage } from '../services/line-message.js';
import { resourceSnapshot, overwriteResource } from '../services/style-starter-resource.js';
import { reminderReplacement } from '../services/style-starter-reminder.js';
import { starterDistributionPlan } from '../services/style-starter-distribution.js';
import { sameStarterSnapshot } from '../services/style-starter-snapshot.js';

let f: ReturnType<typeof createTestD1>;
beforeEach(() => {
  f = createTestD1();
  f.raw.pragma('foreign_keys=OFF');
  f.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','店','fixture','fixture',?)").run(DEFAULT_TENANT_ID);
  f.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','担当','owner','fixture',?)").run(DEFAULT_TENANT_ID);
});
afterEach(() => f.raw.close());

async function seed(style: AccountStyle) {
  await saveProfile(f.db, 'a', DEFAULT_TENANT_ID, 'owner', {
    expectedVersion: 0, style, answers: {
      booking: { mode: 'configured', value: true },
      reminders: { mode: 'configured', value: true },
      content: { mode: 'configured', value: true },
    },
  });
}

test.each(ACCOUNT_STYLES)('%sの見本は挿入直後にLINE用の文字本文になる', async style => {
  await seed(style);
  const expected = standardStarter(style).items.filter(item => item.kind === 'template');
  const rows = f.raw.prepare("SELECT name,message_type,message_content FROM templates WHERE line_account_id='a'").all() as
    Array<{ name: string; message_type: string; message_content: string }>;
  expect(rows.length).toBe(expected.length);
  for (const row of rows) {
    const item = expected.find(value => row.name === '【見本】' + value.name)!;
    const text = item.text ?? item.name;
    expect(row.message_content).toBe(text);
    expect(buildMessage(row.message_type, row.message_content)).toEqual({ type: 'text', text });
  }
  const reminders = f.raw.prepare(`SELECT r.name,s.message_type,s.message_content,v.settings_snapshot FROM reminders r
    JOIN reminder_versions v ON v.reminder_id=r.id JOIN reminder_version_steps s ON s.reminder_version_id=v.id
    WHERE r.line_account_id='a'`).all() as Array<{
      name: string; message_type: string; message_content: string; settings_snapshot: string
    }>;
  expect(reminders.length).toBe(standardStarter(style).items.filter(item => item.kind === 'reminder').length);
  for (const row of reminders) {
    const item = standardStarter(style).items.find(value => row.name === '【見本】' + value.name)!;
    const text = item.text ?? item.name;
    expect(row.message_content).toBe(text);
    expect(JSON.parse(row.settings_snapshot).steps[0].messageContent).toBe(text);
    expect(buildMessage(row.message_type, row.message_content)).toEqual({ type: 'text', text });
  }
});

test('見本の更新も文字の本文を保つ', async () => {
  await seed('salon');
  const target = f.raw.prepare("SELECT id FROM templates WHERE line_account_id='a' LIMIT 1").get() as { id: string };
  await f.db.batch(await overwriteResource(f.db, 'a', target.id,
    { key: 'welcome', kind: 'template', name: 'あいさつ', text: 'こんにちは。' }, '2026-10-30T12:00:00Z'));
  const row = f.raw.prepare('SELECT message_type,message_content FROM templates WHERE id=?').get(target.id) as
    { message_type: string; message_content: string };
  expect(buildMessage(row.message_type, row.message_content)).toEqual({ type: 'text', text: 'こんにちは。' });
  const reminder = f.raw.prepare("SELECT id FROM reminders WHERE line_account_id='a' LIMIT 1").get() as { id: string };
  await f.db.batch(await reminderReplacement(f.db, 'a', reminder.id,
    { key: 'reminder-day-before', kind: 'reminder', name: '前日の案内', text: '明日のご予約です。' }, '2026-10-30T12:00:00Z'));
  const step = f.raw.prepare(`SELECT s.message_content,v.settings_snapshot FROM reminder_version_steps s
    JOIN reminder_versions v ON v.id=s.reminder_version_id WHERE v.reminder_id=? AND v.status='draft'`).get(reminder.id) as
    { message_content: string; settings_snapshot: string };
  expect(step.message_content).toBe('明日のご予約です。');
  expect(JSON.parse(step.settings_snapshot).steps[0].messageContent).toBe('明日のご予約です。');
});

test('本文形式の旧新だけは同じ未編集とみなし、値や公開状態・編集の差を無視しない', () => {
  const snapshot = (content: string, extra = {}) => JSON.stringify({ type: 'text', content, updated: 'fixed', draft: null, published: 0, ...extra });
  const plain = snapshot('こんにちは。'), legacy = snapshot(JSON.stringify({ text: 'こんにちは。' }));
  expect(sameStarterSnapshot('template', plain, legacy)).toBe(true);
  expect(sameStarterSnapshot('template', legacy, plain)).toBe(true);
  expect(sameStarterSnapshot('template', snapshot('編集しました。'), legacy)).toBe(false);
  expect(sameStarterSnapshot('template', snapshot('こんにちは。', { updated: 'edited' }), legacy)).toBe(false);
  expect(sameStarterSnapshot('template', snapshot('こんにちは。', { draft: '編集中' }), legacy)).toBe(false);
  expect(sameStarterSnapshot('template', snapshot('こんにちは。', { published: 1 }), legacy)).toBe(false);
  expect(sameStarterSnapshot('template', snapshot('こんにちは。', { type: 'image' }), legacy)).toBe(false);
  expect(sameStarterSnapshot('template', snapshot('{"text":"こんにちは。","other":1}'), plain)).toBe(false);
  expect(sameStarterSnapshot('template', null, null)).toBe(false);
  expect(sameStarterSnapshot('template', '{broken', plain)).toBe(false);
  expect(sameStarterSnapshot('scenario', plain, legacy)).toBe(false);
});

test('リマインダは型が分かる本文だけを正規化し、期限や公開・別形式を保護する', () => {
  const snapshot = (content: string, type = 'text', offset = -1440) => JSON.stringify({ versions: [{
    id: 'v1', status: 'draft', settings: JSON.stringify({ steps: [{ messageType: type, messageContent: content }] }),
    steps: [{ id: 's1', offset, content }],
  }] });
  const plain = snapshot('明日です。'), legacy = snapshot('{"text":"明日です。"}');
  expect(sameStarterSnapshot('reminder', plain, legacy)).toBe(true);
  expect(sameStarterSnapshot('reminder', legacy, plain)).toBe(true);
  expect(sameStarterSnapshot('reminder', snapshot('編集しました。'), legacy)).toBe(false);
  expect(sameStarterSnapshot('reminder', snapshot('明日です。', 'text', -60), legacy)).toBe(false);
  expect(sameStarterSnapshot('reminder', snapshot('明日です。', 'image'), legacy)).toBe(false);
});

test.each(['current', 'recorded', 'edited'])('旧JSON形の%s対照でも未編集だけをスタイル変更で更新する', async mode => {
  await seed('salon');
  const binding = f.raw.prepare("SELECT target_id,source_snapshot FROM style_starter_items WHERE line_account_id='a' AND item_key='welcome'").get() as
    { target_id: string; source_snapshot: string };
  const welcome = standardStarter('salon').items.find(item => item.key === 'welcome')!;
  if (mode === 'recorded') {
    const snapshot = JSON.parse(binding.source_snapshot);
    snapshot.content = JSON.stringify({ text: welcome.text });
    f.raw.prepare("UPDATE style_starter_items SET source_snapshot=? WHERE line_account_id='a' AND item_key='welcome'").run(JSON.stringify(snapshot));
  } else {
    f.raw.prepare('UPDATE templates SET message_content=? WHERE id=?').run(
      mode === 'edited' ? '店で書き換えました。' : JSON.stringify({ text: welcome.text }), binding.target_id);
  }
  const actual = await resourceSnapshot(f.db, 'a', 'template', binding.target_id);
  const recorded = mode === 'recorded' ? JSON.stringify({ ...JSON.parse(binding.source_snapshot), content: JSON.stringify({ text: welcome.text }) }) : binding.source_snapshot;
  expect(sameStarterSnapshot('template', actual, recorded)).toBe(mode !== 'edited');
  f.raw.prepare(`INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,updated_at)
    VALUES('fixture-set',?,'salon','見本',?,'now')`).run(DEFAULT_TENANT_ID, JSON.stringify(standardStarter('salon')));
  const plan = await starterDistributionPlan(f.db, DEFAULT_TENANT_ID, 'salon', {
    expectedVersion: 1, target: { accountIds: ['a'] },
  });
  expect(plan.accounts[0].items.find(item => item.key === 'welcome')?.action).toBe(mode === 'edited' ? 'notify' : 'overwrite');
  await saveProfile(f.db, 'a', DEFAULT_TENANT_ID, 'owner', { expectedVersion: 1, style: 'consult' });
  const row = f.raw.prepare('SELECT message_content FROM templates WHERE id=?').get(binding.target_id) as { message_content: string };
  expect(row.message_content).toBe(mode === 'edited' ? '店で書き換えました。'
    : standardStarter('consult').items.find(item => item.key === 'welcome')!.text);
});
