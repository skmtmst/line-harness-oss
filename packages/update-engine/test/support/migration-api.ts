import Database from 'better-sqlite3';
import { afterEach } from 'vitest';
import { migrationBaselineSql } from '../../src/migration-history.js';
const databases: Database.Database[] = [];
afterEach(()=>{ for(const db of databases.splice(0))db.close(); });
/** Keep orchestration tests' provider faults focused on domain SQL, with a real local journal. */
export function migrationApi() {
 const db = new Database(':memory:'); databases.push(db);
 db.exec(migrationBaselineSql(new Map(),'fixture-empty-database'));
 return (init?: RequestInit): Response | undefined => {
  const {sql,params=[]}=JSON.parse(String(init?.body));
  if(!sql.includes('_musubo_migration_history')&&!sql.includes('sqlite_master')&&!sql.includes('_migrations'))return;
  const stmt=db.prepare(sql),results=stmt.reader?stmt.all(...params):[];
  if(!stmt.reader)stmt.run(...params);
  return Response.json({success:true,result:[{success:true,results}]});
 };
}
