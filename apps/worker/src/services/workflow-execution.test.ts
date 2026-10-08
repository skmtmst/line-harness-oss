import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {acquireWorkflow} from './workflow-execution.js';
import {workflowLineClient} from './workflow-line-client.js';
import {getWorkflowStep} from '@line-crm/db';
import type {LineClient} from '@line-crm/line-sdk';
let item:SqliteD1;
const ref={scopeId:'line:a',processKind:'line_event',subjectId:'event'};
beforeEach(()=>{item=createTestD1();item.raw.exec('CREATE TABLE effects(n INTEGER);INSERT INTO effects VALUES(0)')});
afterEach(()=>item.raw.close());
describe('PKG67 shared workflow recovery',()=>{
 it('replays a frozen read/write plan after interruption without repeating increments',async()=>{
  const one=(await acquireWorkflow(item.db,ref))!;
  await one.step('done',async()=>{await one.mutationDb('done').prepare('UPDATE effects SET n=n+1').run()});
  let interrupted=true;
  const work=async(execution:NonNullable<Awaited<ReturnType<typeof acquireWorkflow>>>)=>execution.step('partial',async()=>{
    const db=execution.mutationDb('partial');
    const before=await db.prepare('SELECT n FROM effects').first<{n:number}>();
    if(before!.n===1)await db.prepare('UPDATE effects SET n=n+10').run();
    if(interrupted){interrupted=false;throw new Error('crash after database mutation')}
    await db.prepare('UPDATE effects SET n=n+100').run();
  });
  await expect(work(one)).rejects.toThrow();await one.fail();
  const two=(await acquireWorkflow(item.db,ref))!;
  const done=vi.fn();await two.step('done',done);await work(two);await two.complete();
  expect(done).not.toHaveBeenCalled();expect(item.raw.prepare('SELECT n FROM effects').get()).toEqual({n:111});
  expect((await getWorkflowStep(item.db,{...ref,stepKey:'__run'}))!.status).toBe('succeeded');
 });
 it('uses the same push UUID and original payload after a lost acknowledgement',async()=>{
  const one=(await acquireWorkflow(item.db,ref))!;
  const send=vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(undefined);
  const client=workflowLineClient({pushMessage:send} as unknown as LineClient,one);
  await expect(client.pushMessage('U1',[{type:'text',text:'original'}])).rejects.toThrow();
  const retry=workflowLineClient({pushMessage:send} as unknown as LineClient,one);
  await retry.pushMessage('U1',[{type:'text',text:'changed'}]);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  await retry.pushMessage('U1',[{type:'text',text:'third'}]);
  // Separate calls are separate effects; a replay creates a fresh wrapper for the same event.
  const replay=workflowLineClient({pushMessage:send} as unknown as LineClient,one);
  await replay.pushMessage('U1',[{type:'text',text:'original'}]);
  expect(send).toHaveBeenCalledTimes(3);
 });
 it('never uses a reply token twice after a lost response and never stores the token',async()=>{
  const one=(await acquireWorkflow(item.db,ref))!;
  const send=vi.fn().mockRejectedValue(new Error('lost response'));
  const client=workflowLineClient({replyMessage:send} as unknown as LineClient,one);
  await expect(client.replyMessage('private-reply-token',[{type:'text',text:'answer'}])).rejects.toThrow();
  const replay=workflowLineClient({replyMessage:send} as unknown as LineClient,one);
  await expect(replay.replyMessage('new-private-token',[{type:'text',text:'answer'}])).rejects.toThrow('reply_unknown');
  expect(send).toHaveBeenCalledOnce();
  expect(JSON.stringify(item.raw.prepare('SELECT input_json,result_json FROM workflow_steps').all())).not.toContain('private');
 });
 it('rejects mutation RETURNING from an expired owner without changing domain data',async()=>{
  const one=(await acquireWorkflow(item.db,ref))!;
  item.raw.prepare("UPDATE workflow_steps SET lease_expires_at=0 WHERE step_key='__run'").run();
  const two=(await acquireWorkflow(item.db,ref))!;
  await expect(one.db.prepare('UPDATE effects SET n=n+1 RETURNING n').first()).rejects.toThrow();
  expect(await two.db.prepare('UPDATE effects SET n=n+1 RETURNING n').first()).toEqual({n:1});
 });
 it('caps a repeatedly failing root instead of replaying forever',async()=>{
  for(let n=0;n<2;n++){const e=(await acquireWorkflow(item.db,ref,{maxAttempts:2}))!;await e.fail()}
  expect(await acquireWorkflow(item.db,ref,{maxAttempts:2})).toBeNull();
  expect((await getWorkflowStep(item.db,{...ref,stepKey:'__run'}))!.status).toBe('exhausted');
 });
});
