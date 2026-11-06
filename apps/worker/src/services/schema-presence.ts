const presence=new WeakMap<D1Database,Map<string,{present:boolean;checkedAt:number}>>();
/** 段階的な適用中の不在は短期だけ覚え、確認できた表は実行環境の寿命まで共有する。 */
export async function hasDatabaseTable(db:D1Database,table:'rt_store_followup_targets'|'rt_store_followup_preferences'):Promise<boolean>{
 let tables=presence.get(db);if(!tables){tables=new Map();presence.set(db,tables);}
 const saved=tables.get(table);
 if(saved&&(saved.present||Date.now()-saved.checkedAt<5000))return saved.present;
 const present=!!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
 tables.set(table,{present,checkedAt:Date.now()});return present;
}
