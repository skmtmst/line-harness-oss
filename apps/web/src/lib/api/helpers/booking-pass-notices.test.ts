import {expect,test,vi} from 'vitest';
const transport=vi.hoisted(()=>({fetchApi:vi.fn()}));
vi.mock('../../api',()=>transport);
import {bookingPassNoticesApi} from './booking-pass-notices';
test('残数・期限の設定と模擬操作はtestMode:true、店と券種を符号化する',async()=>{
 await bookingPassNoticesApi.settings('a/b','p/q');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/pass-plans/p%2Fq/notice-settings?account_id=a%2Fb');
 await bookingPassNoticesApi.save('a','p',{remainingOne:true,expiry14Days:false,expectedVersion:2});expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/pass-plans/p/notice-settings?account_id=a',{method:'PUT',body:JSON.stringify({remainingOne:true,expiry14Days:false,expectedVersion:2,testMode:true})});
 await bookingPassNoticesApi.list('a',{planId:'p/q',offset:10,limit:10});expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/pass-notices?account_id=a&planId=p%2Fq&offset=10&limit=10');
 await bookingPassNoticesApi.simulate('a');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/pass-notices/simulate?account_id=a',{method:'POST',body:'{"testMode":true}'});
});
