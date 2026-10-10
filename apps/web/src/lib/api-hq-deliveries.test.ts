import { beforeEach, expect, test, vi } from 'vitest';
const fetchApi=vi.hoisted(()=>vi.fn());
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), fetchApi }));
import { hqDeliveriesApi } from './api-hq-deliveries';
beforeEach(()=>fetchApi.mockReset().mockResolvedValue({success:true,data:[]}));
test.each(['auto_reply','friend_add_rule','reminder'] as const)('%sだけを取得する',async type=>{
 await hqDeliveriesApi.list(type);expect(fetchApi).toHaveBeenCalledWith(`/api/hq/templates?type=${type}`,{method:'GET'});
});
test('保存・確認・配布・配った先を共通のAPIへ渡し、保存失敗は成功へ読み替えない',async()=>{
 const definition={schemaVersion:1 as const,settings:{name:'お礼',keyword:'ありがとう',matchType:'exact' as const,responseType:'text',responseContent:'どういたしまして'}};
 const input={type:'auto_reply' as const,name:'お礼',requestId:'create-1234',definition};
 await hqDeliveriesApi.create(input);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates',{method:'POST',body:JSON.stringify(input)});
 await hqDeliveriesApi.preflight('id/1',['a1']);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/id%2F1/preflight',{method:'POST',body:JSON.stringify({accountIds:['a1']})});
 await hqDeliveriesApi.receivedVersions('id/1');expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/id%2F1/received-versions',{method:'GET'});
 fetchApi.mockResolvedValueOnce({success:false,error:'保存できません'});await expect(hqDeliveriesApi.create(input)).rejects.toThrow('保存できません');
 fetchApi.mockResolvedValueOnce({success:false,error:'本文を確認してください',fields:{'definition.settings.responseContent':'本文を短くしてください'}});
 await expect(hqDeliveriesApi.create(input)).rejects.toMatchObject({status:422,fields:{'definition.settings.responseContent':'本文を短くしてください'}});
});
