import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('../../api',()=>({fetchApi:vi.fn(async()=>({success:true,data:[]}))}));
import {fetchApi} from '../../api';
import {bookingEntitlementsApi as api} from './booking-entitlements';
beforeEach(()=>vi.clearAllMocks());
it('管理の読取・付与・調整・履歴に店/対象/再送キーと正しい本文を渡す',async()=>{
 const grant={friendId:'f',kind:'ticket' as const,name:'券',remaining:3,validFrom:'2026-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',reason:'現金'};
 await api.list('a /','f /');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/entitlements?account_id=a%20%2F&friend_id=f%20%2F');
 await api.grant('a',grant,'key');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/entitlements?account_id=a',{method:'POST',headers:{'Idempotency-Key':'key'},body:JSON.stringify(grant)});
 const op={action:'adjust' as const,remaining:2,expectedVersion:1,reason:'調整'};await api.operate('a','id /',op,'op');expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/entitlements/id%20%2F/operations?account_id=a',expect.objectContaining({body:JSON.stringify(op)}));
 await api.history('a','id',50);expect(fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/entitlements/id/history?account_id=a&offset=50');
});
it('本人の読取/予約はLIFFのIDトークンと選んだ券または支払い方法を渡す',async()=>{
 await api.mine('liff','token',{menuId:'m',startsAt:'2030-01-01T00:00:00Z'});
 expect(fetchApi).toHaveBeenLastCalledWith(expect.stringContaining('menu_id=m'),{headers:{Authorization:'Bearer token'}});
 const body={menu_id:'m',staff_id:'s',starts_at:'2030-01-01T00:00:00Z',entitlement_id:'ticket'};
 await api.requestBooking('liff','token','key',body);expect(fetchApi).toHaveBeenLastCalledWith('/api/liff/booking/requests?liffId=liff',{method:'POST',headers:{Authorization:'Bearer token','Idempotency-Key':'key'},body:JSON.stringify(body)});
});
