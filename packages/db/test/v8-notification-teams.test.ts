import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { saveOperatorNotificationTeam,operatorRuleRecipientIds,archiveOperatorNotificationTeam } from '../src/operator-notification-teams.js';
it('scopes membership, updates atomically and resolves current members without fallback',async()=>{
  const raw=new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db=asD1(raw);
  for(const id of ['a','b'])raw.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,'token','secret')`).run(id,id,id);
  for(const id of ['one','two'])raw.prepare(`INSERT INTO staff_members(id,name,email,api_key,role,is_active,account_scope,assigned_line_account_id) VALUES(?,?,?,?,'staff',1,'accounts','a')`).run(id,id,id+'@example.test',id+'-key');
  const team=(await saveOperatorNotificationTeam(db,{lineAccountId:'a',name:'Ops',staffIds:['one','one']}))!;
  expect(team.staffIds).toEqual(['one']);
  await expect(saveOperatorNotificationTeam(db,{lineAccountId:'b',name:'No',staffIds:['one']})).rejects.toThrow('invalid_team_members');
  expect(await saveOperatorNotificationTeam(db,{id:team.id,lineAccountId:'a',name:'Changed',staffIds:['two'],expectedVersion:1})).toMatchObject({version:2});
  expect(await saveOperatorNotificationTeam(db,{id:team.id,lineAccountId:'a',name:'Stale',staffIds:['one'],expectedVersion:1})).toBeNull();
  expect(await operatorRuleRecipientIds(db,'a',{teamId:team.id,recipientIds:['one']})).toEqual(['two']);
  expect(await operatorRuleRecipientIds(db,'b',{teamId:team.id})).toEqual([]);
  expect(await archiveOperatorNotificationTeam(db,team.id,'a',2)).toBe(true);
  expect(await operatorRuleRecipientIds(db,'a',{teamId:team.id,recipientIds:['one']})).toEqual([]);
});
