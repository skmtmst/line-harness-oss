import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RETENTION_TABLES, purgeTablesChildFirst } from './data-retention-tables.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(readFileSync(join(import.meta.dirname, '../bootstrap.sql'), 'utf8'));
  db.pragma('foreign_keys = ON');
  db.exec(`
    INSERT INTO tenants(id,name) VALUES ('t','HQ'),('other','Other');
    INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES ('a','A','ca','x','x','t'),('b','B','cb','x','x','other');
    INSERT INTO mileage_programs(id,code,name,status,created_at,updated_at)
      VALUES ('default','default','Miles','active','2026-01-01','2026-01-01');
    INSERT INTO hq_templates(id,tenant_id,template_type,catalog_type,name) VALUES ('reward-hq','t','template','mileage_reward','Reward'),('menu-hq','t','template','booking_menu','Menu');
    INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash)
      VALUES ('reward-v1','t','reward-hq',1,'{}','r1'),('reward-v2','t','reward-hq',2,'{}','r2'),('menu-v1','t','menu-hq',1,'{}','m1');
    INSERT INTO mileage_rewards(id,line_account_id,program_id,name,reward_kind,hq_template_id,hq_template_version_id)
      VALUES ('reward','a','default','Reward','coupon','reward-hq','reward-v1');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,hq_template_id,hq_template_version_id)
      VALUES ('menu','a','Menu',60,1000,'menu-hq','menu-v1');
  `);
});
afterEach(() => db.close());

describe('統括カタログの再配布の記録', () => {
  it('景品の本体と版の変更をそれぞれ店側の変更として記録する', () => {
    db.prepare("UPDATE mileage_rewards SET name='店の景品' WHERE id='reward'").run();
    expect(db.prepare("SELECT hq_customized FROM mileage_rewards WHERE id='reward'").pluck().get()).toBe(1);
    db.prepare("UPDATE mileage_rewards SET hq_customized=0 WHERE id='reward'").run();
    db.prepare("INSERT INTO mileage_reward_versions(id,reward_id,version_number,status,required_miles) VALUES ('rv','reward',1,'draft',100)").run();
    expect(db.prepare("SELECT hq_customized FROM mileage_rewards WHERE id='reward'").pluck().get()).toBe(1);
    db.prepare("UPDATE mileage_rewards SET hq_customized=0 WHERE id='reward'").run();
    db.prepare("UPDATE mileage_reward_versions SET required_miles=120 WHERE id='rv'").run();
    expect(db.prepare("SELECT hq_customized FROM mileage_rewards WHERE id='reward'").pluck().get()).toBe(1);
  });

  it('店と統括元の境界を守り、見送った版を記録できる', () => {
    expect(() => db.prepare("UPDATE mileage_rewards SET line_account_id='b',hq_template_id='reward-hq',hq_template_version_id='reward-v1' WHERE id='reward'").run()).toThrow('hq_origin_account_mismatch');
    expect(() => db.prepare("INSERT INTO hq_catalog_update_decisions(id,tenant_id,line_account_id,template_id,template_version_id,reward_id,decision) VALUES ('bad','t','b','reward-hq','reward-v2','reward','pending')").run()).toThrow('hq_origin_account_mismatch');
    db.prepare("INSERT INTO hq_catalog_update_decisions(id,tenant_id,line_account_id,template_id,template_version_id,reward_id,decision) VALUES ('d','t','a','reward-hq','reward-v2','reward','pending')").run();
    db.prepare("UPDATE hq_catalog_update_decisions SET decision='kept',decided_at='2026-11-05T00:00:00Z' WHERE id='d'").run();
    expect(db.prepare("SELECT template_version_id,decision FROM hq_catalog_update_decisions WHERE id='d'").get()).toEqual({ template_version_id: 'reward-v2', decision: 'kept' });
    expect(() => db.prepare("UPDATE hq_catalog_update_decisions SET template_version_id='reward-v1' WHERE id='d'").run()).toThrow('hq_catalog_decision_identity_immutable');
    expect(() => db.prepare("UPDATE hq_catalog_update_decisions SET decision='pending',decided_at=NULL WHERE id='d'").run()).toThrow('hq_catalog_decision_final_immutable');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('判断記録は統括の削除に含まれ、ひな形と店より先に消す', () => {
    expect(RETENTION_TABLES.hq_catalog_update_decisions).toEqual({ category: 'purge', scope: { by: 'tenant', column: 'tenant_id' } });
    const order = purgeTablesChildFirst();
    expect(order.indexOf('hq_catalog_update_decisions')).toBeLessThan(order.indexOf('hq_templates'));
    expect(order.indexOf('hq_catalog_update_decisions')).toBeLessThan(order.indexOf('mileage_rewards'));
  });
});
