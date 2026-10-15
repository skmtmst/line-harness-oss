import type { SqliteD1 } from './d1-sqlite.js';

export function seedAssignmentFixture(db: SqliteD1) {
  db.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES
    ('a','試験店','a','test','test'),('b','別店','b','test','test');
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES ('s1','a','甲','甲'),('s2','a','乙','乙'),('other','b','別','別');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,concurrent_capacity) VALUES('m','a','相談',30,0,100);
    UPDATE tenants SET feature_packs='["restaurant"]' WHERE id='00000000-0000-4000-8000-000000000001';
    INSERT INTO rt_organizations(id,account_id,tenant_id,name) VALUES('org','a','00000000-0000-4000-8000-000000000001','試験');
    INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','a','店','test'),('other-store','org','b','別店','other');
    INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES
      ('t1','store','t1','卓1','table',1,2),('t2','store','t2','卓2','table',1,2),
      ('big','store','big','大卓','table',1,6),('other-table','other-store','other','別卓','table',1,2);`);
}
