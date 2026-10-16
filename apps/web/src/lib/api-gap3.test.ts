import {beforeEach,expect,test,vi} from 'vitest';
const transport=vi.hoisted(()=>({fetchApi:vi.fn(async()=>({success:true,data:{}}))}));
vi.mock('./api',()=>transport);
import {gap3InboxApi,gap3BookingApi,customerSegmentsApi,memberRanksApi,storeComparisonApi,ecAutoLineApi,bookingPassPlansApi,gap3AiApi,mcpConnectionsApi} from './api-gap3';
beforeEach(()=>transport.fetchApi.mockClear());
test('GAP3-CLIENT-01: 店ID・ページ条件・本人token・同じキーを正しい口へ運ぶ',async()=>{
 await customerSegmentsApi.friends('a/1',1,5,'purchase','amount','20');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/analytics/customer-segments/cells/1/5/friends?account_id=a%2F1&basis=purchase&measure=amount&cursor=20');
 await gap3InboxApi.icons('a/1');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/line-accounts/a%2F1/sender-icons?offset=0');
 await memberRanksApi.activate('a',2,'activate-key');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/member-ranks/activate?account_id=a',expect.objectContaining({headers:{'Idempotency-Key':'activate-key'},body:JSON.stringify({expectedVersion:2})}));
 await bookingPassPlansApi.grant('a','plan','f','店頭払い','grant-key');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/booking/admin/entitlements?account_id=a',expect.objectContaining({headers:{'Idempotency-Key':'grant-key'},body:JSON.stringify({planId:'plan',friendId:'f',reason:'店頭払い'})}));
 await gap3BookingApi.request('l','identity',{starts_at:'date',members:[{menuId:'m'},{menuId:'m2'}],routing_token:'signed'},'same');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/liff/booking/requests?liffId=l',expect.objectContaining({headers:{Authorization:'Bearer identity','Idempotency-Key':'same'}}));
});
test('GAP3-CLIENT-02: 模擬の起動確認・再認証と停止理由、QA記録の詳細',async()=>{
 await ecAutoLineApi.enableMock('a','cart',1,'enable-key');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/ec/auto-line/rules/cart/enable?account_id=a',expect.objectContaining({headers:{'Idempotency-Key':'enable-key'},body:JSON.stringify({expectedVersion:1,enabled:true,confirmed:true,testMode:true})}));
 await mcpConnectionsApi.rotate('a','c/1',1,'step-up');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/mcp-connections/c%2F1/rotate?account_id=a',expect.objectContaining({headers:{'X-Step-Up-Token':'step-up'}}));
 await mcpConnectionsApi.stop('a','c',2,'緊急停止');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/mcp-connections/c/stop?account_id=a',expect.objectContaining({body:JSON.stringify({expectedVersion:2,reason:'緊急停止'})}));
 await gap3AiApi.log('a','log/1');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/ai-answer-logs/log%2F1?account_id=a');
 await storeComparisonApi.get({compare:'average',pageSize:50});expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/store-comparison?compare=average&pageSize=50');
});
