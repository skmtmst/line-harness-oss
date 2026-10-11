import { expect, test } from 'vitest';
import { idChunks, sqlIdSet } from '../src/id-queries.js';
test.each([0,1,51,100,101,200,1001])('IDを%s件渡しても追加の変数を含めて100以内', size=>{
 const ids=Array.from({length:size},(_,i)=>String(i));
 for(const copies of [1,2,3]) for(const reserved of [0,2,17]) {
  const chunks=idChunks(ids,reserved,copies);
  expect(chunks.flat()).toEqual(ids);
  for(const chunk of chunks) expect(chunk.length*copies+reserved).toBeLessThanOrEqual(100);
 }
 expect(JSON.parse(sqlIdSet(ids).binds[0])).toEqual(ids);
});
