import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeLayout, type FormLayout } from '@line-crm/shared';
import { formAvailability } from './form-availability.js';

let sqlite: Database.Database;
let db: D1Database;
beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE form_submissions (id TEXT PRIMARY KEY, form_id TEXT, friend_id TEXT, is_test INTEGER, data TEXT);
    CREATE TABLE form_capacity_claims (form_id TEXT, slot_key TEXT, submission_id TEXT);`);
  db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    return { bind(...args: unknown[]) { return { async first() { return statement.get(...args); } }; } };
  } } as unknown as D1Database;
});
afterEach(() => sqlite.close());
const now = new Date('2026-10-01T14:00:00Z');
function layout(): FormLayout {
  const result = normalizeLayout({ version: 2, header: [], sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', name: 'pick', label: '選択', type: 'radio', choices: [{ id: 'c1', label: '第一', capacity: { enabled: true, limit: 2 } }, { id: 'c2', label: '第二' }] }] }], options: { deadline: { enabled: true, endsAt: '2026-10-01T23:00' }, oncePerFriend: { enabled: true }, totalLimit: { enabled: true, max: 10 } } });
  if (!result) throw new Error('Invalid fixture layout');
  return result;
}
const check = (over: Partial<Parameters<typeof formAvailability>[0]> = {}) => formAvailability({ db, formId: 'f1', layout: layout(), active: true, submitCount: 0, friendId: 'me', now, ...over });
describe('入力を始める前の回答受付状況', () => {
  it('日本時間の締め切り・1人1回・全体の残り件数を返す。境界時刻は受付中', async () => {
    expect(await check({ submitCount: 7 })).toMatchObject({ accepting: true, deadlineAt: '2026-10-01T14:00:00.000Z', oncePerFriend: true, totalRemaining: 3 });
    expect(await check({ now: new Date(now.getTime() + 1) })).toMatchObject({ accepting: false, reason: 'このフォームの回答期限は終了しました' });
  });
  it('本人の本物の回答がある時だけ1回制限で止め、他人・試し回答では止めない', async () => {
    const insert = sqlite.prepare('INSERT INTO form_submissions VALUES (?, ?, ?, ?, ?)');
    insert.run('a', 'f1', 'other', 0, '{}'); insert.run('b', 'f1', 'me', 1, '{}');
    expect((await check()).accepting).toBe(true);
    insert.run('c', 'f1', 'me', 0, '{}');
    expect(await check()).toMatchObject({ accepting: false, reason: 'このフォームは、お一人さま1回までです' });
    expect((await check({ friendId: null })).accepting).toBe(false);
  });
  it('保存済み・確保中を重複せず数え、満席と全体上限を開いた時に知らせる', async () => {
    sqlite.prepare('INSERT INTO form_submissions VALUES (?, ?, ?, ?, ?)').run('a', 'f1', 'other', 0, JSON.stringify({ pick: '第一' }));
    const insert = sqlite.prepare('INSERT INTO form_capacity_claims VALUES (?, ?, ?)');
    insert.run('f1', 'choice:pick:第一', 'a'); insert.run('f1', 'choice:pick:第一', 'in-flight');
    insert.run('f1', '__total__', 'a');
    expect(await check()).toMatchObject({ choices: { pick: { c1: { remaining: 0, full: true } } }, totalRemaining: 9 });
    expect(await check({ submitCount: 10 })).toMatchObject({ accepting: false, totalRemaining: 0 });
  });
  it('5000件を超える古い選択も数える。試しでは本物の枠と回答歴を使わない', async () => {
    const insert = sqlite.prepare('INSERT INTO form_submissions VALUES (?, ?, ?, ?, ?)');
    sqlite.transaction(() => { for (let i = 0; i < 5001; i++) insert.run(String(i), 'f1', 'other', 0, JSON.stringify({ pick: ['第一'] })); })();
    expect((await check()).choices.pick.c1).toEqual({ remaining: 0, full: true });
    expect(await check({ active: false, submitCount: 10, isTest: true })).toMatchObject({ accepting: true, choices: {}, oncePerFriend: false, totalRemaining: null });
  });
});

it('保存済みと送信中の全体枠を足し、同じ回答は二重に数えない', async () => {
  const insert = sqlite.prepare('INSERT INTO form_submissions VALUES (?, ?, ?, ?, ?)');
  insert.run('old', 'f1', 'other', 0, '{}');
  insert.run('new', 'f1', 'other', 0, '{}');
  sqlite.prepare('INSERT INTO form_capacity_claims VALUES (?, ?, ?)').run('f1', '__total__', 'new');
  sqlite.prepare('INSERT INTO form_capacity_claims VALUES (?, ?, ?)').run('f1', '__total__', 'sending');
  expect((await check({ submitCount: 2 })).totalRemaining).toBe(7);
});
it('その他の自由記入も定員に数える', async () => {
  const definition = layout();
  const block = definition.sections[0].blocks[0];
  if (block.kind !== 'input') throw new Error('input required');
  block.choices![0].isOther = true;
  block.choices![0].capacity!.limit = 1;
  sqlite.prepare('INSERT INTO form_submissions VALUES (?, ?, ?, ?, ?)').run('free', 'f1', 'other', 0, JSON.stringify({ pick: '自由に入力した回答' }));
  expect((await check({ layout: definition })).choices.pick.c1).toEqual({ remaining: 0, full: true });
});
