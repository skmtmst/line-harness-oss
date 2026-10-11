import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { idChunks, sqlIdSet } from '../src/id-queries.js';
test.each([0,1,51,100,101,200,1001])('IDを%s件渡しても追加の変数を含めて100以内', size=>{
 const ids=Array.from({length:size},(_,i)=>String(i));
 for(const copies of [1,2,3]) for(const reserved of [0,2,17]) {
  const chunks=idChunks(ids,reserved,copies);
  expect(chunks.flat()).toEqual(ids);
  for(const chunk of chunks) expect(chunk.length*copies+reserved).toBeLessThanOrEqual(100);
 }
 const scope=sqlIdSet(ids), raw=new Database(':memory:');
 try {expect(raw.prepare(scope.sql).all(...scope.binds).map(row=>(row as {value:string}).value)).toEqual(ids);} finally {raw.close();}
});

test('空のID範囲は値の束縛を要求せず、INは0件・NOT INは全件になる', () => {
 const raw=new Database(':memory:');
 try {
  const scope=sqlIdSet([]);
  expect(raw.prepare(`SELECT 1 AS id WHERE 'a' IN (${scope.sql})`).all()).toEqual([]);
  expect(raw.prepare(`SELECT 1 AS id WHERE 'a' NOT IN (${scope.sql})`).all()).toEqual([{id:1}]);
 } finally {raw.close();}
});
