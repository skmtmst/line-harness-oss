import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { setFriendFieldValue } from '../src/friend-fields.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.pragma('recursive_triggers = ON');
  raw.exec("INSERT INTO friends(id,line_user_id,real_name) VALUES ('f','Uf','以前の名前')");
});
afterEach(() => raw.close());

test('623は既存の本名を残し、7つの個人情報欄へ対応する', () => {
  for (const trigger of ['fixed_name_value_insert','fixed_name_value_update','fixed_name_value_delete','fixed_name_friend_insert','fixed_name_friend_update','friend_field_value_source_clear','fixed_friend_field_definition_guard']) {
    raw.exec(`DROP TRIGGER ${trigger}`);
  }
  raw.exec("DROP TABLE friend_fixed_fields; DELETE FROM friend_field_values; DELETE FROM friend_fields WHERE id LIKE 'fixed-%'");
  raw.exec(readFileSync(new URL('../migrations/623_form_fixed_friend_fields.sql', import.meta.url), 'utf8'));
  expect(raw.prepare('SELECT COUNT(*) n FROM friend_fixed_fields fx JOIN friend_fields f ON fx.field_id=f.id WHERE f.is_personal=1').get()).toEqual({ n: 7 });
  expect(raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='f' AND field_id='fixed-name'").get()).toEqual({ value: '以前の名前' });
  expect(raw.pragma('foreign_key_check')).toEqual([]);
});

test('本名と固定の名前は双方向で同期し、削除も同期する', async () => {
  const db = asD1(raw);
  await setFriendFieldValue(db, { friendId:'f', fieldId:'fixed-name', value:'フォームの名前', updatedBy:'form', sourceType:'form', sourceId:'form' });
  expect(raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({ real_name:'フォームの名前' });
  expect(raw.prepare("SELECT source_type,source_id FROM friend_field_values WHERE friend_id='f' AND field_id='fixed-name'").get()).toEqual({ source_type:'form', source_id:'form' });
  raw.exec("UPDATE friends SET real_name='手動の名前' WHERE id='f'");
  expect(raw.prepare("SELECT value,source_type FROM friend_field_values WHERE friend_id='f' AND field_id='fixed-name'").get()).toEqual({ value:'手動の名前', source_type:null });
  await setFriendFieldValue(db, { friendId:'f', fieldId:'fixed-name', value:null, updatedBy:'owner' });
  expect(raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({ real_name:null });
});

test('別の移行元の記録は残し、手動で書き換えたフォーム回答の出どころだけ消す', () => {
  raw.exec("INSERT INTO friend_field_values(friend_id,field_id,value,updated_by,source_type,source_id) VALUES ('f','fixed-email','a@example.test','migration','field_migration','run')");
  raw.exec("UPDATE friend_field_values SET value='b@example.test',updated_by='migration' WHERE field_id='fixed-email'");
  expect(raw.prepare("SELECT source_type,source_id FROM friend_field_values WHERE field_id='fixed-email'").get()).toEqual({ source_type:'field_migration', source_id:'run' });
  raw.exec("UPDATE friend_field_values SET source_type='form',source_id='form',updated_by='form' WHERE field_id='fixed-email'");
  raw.exec("UPDATE friend_field_values SET value='c@example.test',updated_by='owner' WHERE field_id='fixed-email'");
  expect(raw.prepare("SELECT source_type,source_id FROM friend_field_values WHERE field_id='fixed-email'").get()).toEqual({ source_type:null, source_id:null });
});

test('基本の定義を変えたり消したりして自動保存先を失えない', () => {
  expect(() => raw.exec("UPDATE friend_fields SET name='別名' WHERE id='fixed-name'")).toThrow('FIXED_FRIEND_FIELD_IMMUTABLE');
  expect(() => raw.exec("UPDATE friend_fields SET is_personal=0 WHERE id='fixed-email'")).toThrow('FIXED_FRIEND_FIELD_IMMUTABLE');
  expect(() => raw.exec("DELETE FROM friend_fields WHERE id='fixed-age'")).toThrow(/FOREIGN KEY/);
});
