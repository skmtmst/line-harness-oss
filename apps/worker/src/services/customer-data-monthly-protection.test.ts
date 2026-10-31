import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { monthlyFixture, monthlyContract } from '../test-utils/monthly-ledger.js';
import { deleteCustomerData } from './customer-data-deletion.js';
let f:ReturnType<typeof monthlyFixture>;
const target=(id='f')=>({kind:'friend_data' as const,id,friendId:id,accountId:'a',lineUserId:id==='f'?'Uf':'Uf2'});
beforeEach(()=>{f=monthlyFixture();});
afterEach(()=>f.raw.close());
it('月謝の固定契約がある本人は削除の意図やR2の前に止め、契約と本人を残す',async()=>{
  await monthlyContract(f);const remove=vi.fn();
  await expect(deleteCustomerData({DB:f.db,IMAGES:{delete:remove}},target(),'o')).rejects.toMatchObject({status:409,code:'deletion_schema_approval_required'});
  expect(remove).not.toHaveBeenCalled();expect(f.raw.prepare('SELECT count(*) n FROM operation_audit').get()).toEqual({n:0});
  expect(f.raw.prepare("SELECT id FROM friends WHERE id='f'").get()).toEqual({id:'f'});
  expect(f.raw.prepare('SELECT friend_id FROM booking_monthly_contracts').get()).toEqual({friend_id:'f'});
});
it('月謝の契約が無い別の本人は今までどおり削除できる',async()=>{
  await monthlyContract(f);const remove=vi.fn();
  expect(await deleteCustomerData({DB:f.db,IMAGES:{delete:remove}},target('f2'),'o')).toMatchObject({deleted:true});
  expect(f.raw.prepare("SELECT id FROM friends WHERE id='f2'").get()).toBeUndefined();
  expect(f.raw.prepare('SELECT friend_id FROM booking_monthly_contracts').get()).toEqual({friend_id:'f'});
});
