import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { hasSavedFeatureConfiguration } from '../src/account-settings.js';
it('requires saved valid feature configuration for the selected account', async () => {
  const raw = new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db = asD1(raw);
  expect(await hasSavedFeatureConfiguration(db,'a')).toBe(false);
  const save = (value:string) => raw.prepare(`INSERT INTO account_settings (id,line_account_id,key,value) VALUES ('s','a','feature.settings_bundle_v1',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`).run(value);
  save(JSON.stringify({version:1,data:{features:{friends:true}}}));
  expect(await hasSavedFeatureConfiguration(db,'a')).toBe(true);expect(await hasSavedFeatureConfiguration(db,'b')).toBe(false);
  for(const value of ['bad',JSON.stringify({version:0,data:{features:{friends:true}}}),JSON.stringify({version:1,data:{features:{friends:'yes'}}})]) {
    save(value);expect(await hasSavedFeatureConfiguration(db,'a')).toBe(false);
  }
});
