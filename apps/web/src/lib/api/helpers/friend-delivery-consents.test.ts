import {beforeEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../../api',()=>({fetchApi:transport.request}));
import {friendDeliveryConsentsApi} from './friend-delivery-consents';
beforeEach(()=>transport.request.mockReset());
it('友だち・目的・読込版を配信停止のAPIへ渡す',async()=>{
 await friendDeliveryConsentsApi.list('friend/a');
 const body={state:'revoked' as const,reason:'本人希望',expectedVersion:2};
 await friendDeliveryConsentsApi.save('friend/a','marketing',body);
 expect(transport.request.mock.calls).toEqual([
  ['/api/friends/friend%2Fa/delivery-consents'],
  ['/api/friends/friend%2Fa/delivery-consents/marketing',{method:'PUT',body:JSON.stringify(body)}],
 ]);
});
it('変更履歴の目的・カーソル・表示件数を同じ友だちの口へ渡す',async()=>{
 const {friendDeliveryConsentHistoryApi}=await import('./friend-delivery-consents');
 await friendDeliveryConsentHistoryApi.list('friend/a',{purpose:'marketing',cursor:'20',limit:10});
 expect(transport.request).toHaveBeenLastCalledWith('/api/friends/friend%2Fa/delivery-consents/history?purpose=marketing&cursor=20&limit=10');
});
