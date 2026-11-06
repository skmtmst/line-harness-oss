import { readFileSync,readdirSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect,it } from 'vitest';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const deletion=/\b(?:DELETE\s+FROM|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+["`\[]?rt_store_followup_targets\b/i;
function sourceFiles(dir:string):string[]{
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const file=resolve(dir,entry.name);
  if(entry.isDirectory())return /^(test|tests|test-utils|__tests__|fixtures)$/.test(entry.name)?[]:sourceFiles(file);
  return /(?:\.[cm]?[jt]sx?|\.sql)$/.test(file)&&! /\.(test|spec)\./.test(file)?[file]:[];
 });
}
it('来店フォローの管理履歴は実物を停止しても対応表へ保持し、製品から物理削除しない',()=>{
 const files=['apps/worker/src','packages/db/src','packages/db/migrations'].flatMap(dir=>sourceFiles(resolve(root,dir)));
 expect(files.length).toBeGreaterThan(100);
 expect(files.some(file=>file.endsWith('.sql'))).toBe(true);
 expect(files.filter(file=>deletion.test(readFileSync(file,'utf8'))).map(file=>relative(root,file))).toEqual([]);
});
it('削除の大文字小文字や改行・引用符を変えても禁止する',()=>{
 for(const sql of ['DELETE FROM rt_store_followup_targets','delete\nfrom "rt_store_followup_targets"','DROP TABLE rt_store_followup_targets','drop table if exists `rt_store_followup_targets`'])expect(deletion.test(sql)).toBe(true);
 expect(deletion.test('UPDATE rt_store_followup_targets SET enabled=0')).toBe(false);
});
