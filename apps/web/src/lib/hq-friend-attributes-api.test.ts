import {beforeEach,expect,test,vi} from 'vitest';
const transport=vi.hoisted(()=>{class ApiError extends Error{constructor(public status:number,public code?:string){super(code)}}return {fetchApi:vi.fn(),ApiError}});
vi.mock('./api',()=>transport);
import {hqFriendAttributesApi} from './hq-friend-attributes-api';
beforeEach(()=>{transport.fetchApi.mockReset();transport.fetchApi.mockResolvedValue({success:true,data:{ok:true}})});
test('friend attribute create uses the common authenticated transport and a stable creation key',async()=>{
 const input={type:'friend_field' as const,name:'欄',definition:{schemaVersion:1 as const,field:{name:'ペット名',fieldKey:'pet_name',type:'time' as const},folders:[]}};
 await hqFriendAttributesApi.create(input,'request-fixture');
 expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/templates',{method:'POST',headers:{'Idempotency-Key':'request-fixture'},body:JSON.stringify({...input,requestId:'request-fixture'})});
 await hqFriendAttributesApi.list('mark');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=mark',{method:'GET'});
});
test('skip remains an explicit choice, separate from preflight, and paths are escaped',async()=>{
 await hqFriendAttributesApi.preflight('t/1',['a']);expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/t%2F1/preflight',{method:'POST',body:JSON.stringify({accountIds:['a']})});
 const resolutions=[{accountId:'a',sourceId:'mark',mode:'skip' as const}];
 await hqFriendAttributesApi.distribute('t/1','p',resolutions);expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/t%2F1/distribute',{method:'POST',body:JSON.stringify({preflightId:'p',resolutions})});
 await hqFriendAttributesApi.result('t/1','p/1');expect(transport.fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/t%2F1/distributions/p%2F1',{method:'GET'});
});
test('rejections remain errors rather than fabricated results or totals',async()=>{
 transport.fetchApi.mockRejectedValue(new transport.ApiError(403));await expect(hqFriendAttributesApi.kindCounts()).rejects.toThrow('権限');
 await expect(hqFriendAttributesApi.listStats('friend_field')).rejects.toThrow();
});
