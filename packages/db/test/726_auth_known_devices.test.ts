import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { purgeTablesChildFirst, tenantScopeCondition } from '../src/data-retention-tables.js';
let db:Database.Database;
afterEach(()=>db?.close());
it('726 preserves known hashes and makes device history staff-scoped and unique without raw personal fields',()=>{
 db=new Database(':memory:');db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));db.pragma('foreign_keys=ON');
 db.exec(`DROP TABLE auth_known_devices; INSERT INTO staff_members(id,name,role,api_key) VALUES ('actor','Fixture','owner','fixture-unused');
 INSERT INTO admin_sessions(token_hash,staff_id,device_hash,expires_at,created_at) VALUES ('session-a','actor','fixture-hash','2999-01-01','2026-01-01'),('session-b','actor','fixture-hash','2999-01-01','2026-02-01');`);
 db.exec(readFileSync(new URL('../migrations/726_auth_known_devices.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT * FROM auth_known_devices').all()).toEqual([{staff_id:'actor',device_hash:'fixture-hash',first_seen_at:'2026-01-01',last_seen_at:'2026-02-01'}]);
 expect(()=>db.exec("INSERT INTO auth_known_devices VALUES ('actor','fixture-hash','a','a')")).toThrow();
 expect(()=>db.exec("INSERT INTO auth_known_devices VALUES ('other','another-hash','a','a')")).toThrow();
 expect(db.prepare('PRAGMA table_info(auth_known_devices)').all().map((r:any)=>r.name)).toEqual(['staff_id','device_hash','first_seen_at','last_seen_at']);
 expect(tenantScopeCondition('auth_known_devices')).toContain('staff_members');
 expect(purgeTablesChildFirst().indexOf('auth_known_devices')).toBeLessThan(purgeTablesChildFirst().indexOf('staff_members'));
 db.exec("DELETE FROM admin_sessions;DELETE FROM staff_members WHERE id='actor'");expect(db.prepare('SELECT COUNT(*) n FROM auth_known_devices').get()).toEqual({n:0});
});
