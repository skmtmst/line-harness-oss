import { beforeEach, it, expect, vi } from 'vitest';
const transport=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./api',()=>({fetchApi:transport.request}));
import { restaurantTestApi } from './restaurant-test-api';
beforeEach(()=>{transport.request.mockReset();transport.request.mockResolvedValue({success:true,data:{version:2}});});
it('店の組の読取りと店舗1件の切替は同じ選択アカウントへ送る', async () => {
  await restaurantTestApi.storeGroups('account/a');
  const settings = { referralEnabled: false, maxDistance: 0 };
  await restaurantTestApi.updateStoreGroupMember('account/a', 'group/a', 'store/b', settings);
  expect(transport.request.mock.calls[0][0]).toBe('/api/restaurant-test/store-groups?account_id=account%2Fa');
  expect(transport.request.mock.calls[1]).toEqual(['/api/restaurant-test/store-groups/group%2Fa/members/store%2Fb?account_id=account%2Fa', { method: 'PATCH', body: JSON.stringify(settings) }]);
});
it('遅刻案内の省略・設定・解除を店舗のAPIへそのまま渡す',async()=>{
  const body={storeId:'store',hours:[],expectedVersion:1};
  await restaurantTestApi.saveOpeningHours('account',body);
  await restaurantTestApi.saveOpeningHours('account',{...body,lateArrivalPolicy:{cancelAfterMinutes:15,message:'15分で取消'}});
  await restaurantTestApi.saveOpeningHours('account',{...body,lateArrivalPolicy:null});
  const calls=transport.request.mock.calls;
  expect(calls[0][0]).toContain('/api/restaurant-test/opening-hours?account_id=account');
  expect(JSON.parse(calls[0][1].body)).not.toHaveProperty('lateArrivalPolicy');
  expect(JSON.parse(calls[1][1].body).lateArrivalPolicy).toEqual({cancelAfterMinutes:15,message:'15分で取消'});
  expect(JSON.parse(calls[2][1].body).lateArrivalPolicy).toBeNull();
});
