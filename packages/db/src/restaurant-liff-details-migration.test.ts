import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { it, expect } from 'vitest';
it('606は既存店に遅刻案内を設定せず、分数・文の上限をDBでも守る',()=>{
  const db=new Database(':memory:');
  try {
    db.exec('CREATE TABLE rt_opening_hours_settings(store_id TEXT PRIMARY KEY); INSERT INTO rt_opening_hours_settings VALUES(\'store\')');
    db.exec(readFileSync(new URL('../migrations/606_restaurant_liff_details.sql',import.meta.url),'utf8'));
    expect(db.prepare('SELECT late_cancel_after_minutes,late_arrival_message FROM rt_opening_hours_settings').get()).toEqual({late_cancel_after_minutes:null,late_arrival_message:null});
    for(const value of [0,1441]) expect(()=>db.prepare('UPDATE rt_opening_hours_settings SET late_cancel_after_minutes=?').run(value)).toThrow(/CHECK/);
    expect(()=>db.prepare('UPDATE rt_opening_hours_settings SET late_arrival_message=?').run('あ'.repeat(1001))).toThrow(/CHECK/);
  } finally {db.close();}
});
