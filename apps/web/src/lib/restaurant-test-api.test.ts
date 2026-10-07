import { beforeEach, it, expect, vi } from 'vitest';
const transport=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./api',()=>({fetchApi:transport.request}));
import { restaurantTestApi } from './restaurant-test-api';
beforeEach(()=>{transport.request.mockReset();transport.request.mockResolvedValue({success:true,data:{version:2}});});
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
