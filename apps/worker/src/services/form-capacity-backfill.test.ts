import { afterEach, beforeEach, expect, test } from 'vitest';
import { claimFormCapacitySlot } from '../../../../packages/db/src/forms.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.prepare("INSERT INTO forms(id,name) VALUES('form','人工フォーム')").run();
  for (let i=0;i<4;i++) fixture.raw.prepare('INSERT INTO form_submissions(id,form_id,data,is_test) VALUES(?,?,?,0)').run(`old-${i}`,'form',JSON.stringify({slot:'午前'}));
  fixture.raw.prepare("INSERT INTO form_submissions(id,form_id,data,is_test) VALUES('test','form','{}',1)").run();
});
afterEach(() => fixture.raw.close());
test('R-FORM03: 後から全体上限5を有効にしても枠のない既存4回答を数える', async () => {
  const accepted = await Promise.all(['new-1','new-2'].map(id => claimFormCapacitySlot(fixture.db,'form','__total__',id,5)));
  expect(accepted.filter(Boolean)).toHaveLength(1);
  const winner=accepted[0]?'new-1':'new-2';
  expect(await claimFormCapacitySlot(fixture.db,'form','__total__',winner,5)).toBe(true);
  fixture.raw.prepare('INSERT INTO form_capacity_claims(form_id,slot_key,submission_id,created_at) VALUES(?,?,?,?)').run('form','__total__','old-0','fixture');
  expect(await claimFormCapacitySlot(fixture.db,'form','__total__','new-3',6)).toBe(true);
});
test.each([false,true])('R-FORM03: 選択肢定員も保存回答と枠を重複なく数える（その他=%s）', async (isOther) => {
  fixture.raw.prepare('UPDATE form_submissions SET data=? WHERE is_test=0').run(JSON.stringify({slot: isOther ? ['自由入力'] : ['午前']}));
  const choice={fieldName:'slot',label:isOther?'その他':'午前',isOther,labels:['午前','その他']};
  const accepted=await Promise.all(['new-1','new-2'].map(id=>claimFormCapacitySlot(fixture.db,'form',`choice:slot:${choice.label}`,id,5,choice)));
  expect(accepted.filter(Boolean)).toHaveLength(1);
});
