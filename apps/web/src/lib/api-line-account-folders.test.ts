import { afterEach,beforeAll,expect,it,vi } from 'vitest';
let api:typeof import('./api').api;
beforeAll(async()=>{process.env.NEXT_PUBLIC_API_URL='http://127.0.0.1:8788';({api}=await import('./api'));});
afterEach(()=>vi.unstubAllGlobals());
it('フォルダの一覧・作成・名前と色と順序・削除・1所属の移動に正しいリクエストを送る',async()=>{
  const fetchSpy=vi.fn(async()=>new Response(JSON.stringify({success:true,data:{folders:[],total:2,unclassifiedCount:2}}),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetchSpy);
  expect((await api.lineAccountFolders.list()).data).toEqual({folders:[],total:2,unclassifiedCount:2});
  await api.lineAccountFolders.create({name:'渋谷',color:'#2f6fde'});
  await api.lineAccountFolders.update('folder/id',{name:'店舗',color:'#1f9d55',displayOrder:2});
  await api.lineAccountFolders.move('account/id','folder/id');
  await api.lineAccountFolders.move('account/id',null);
  await api.lineAccountFolders.remove('folder/id');
  await api.lineAccounts.list(false,'folder/id');
  await api.lineAccounts.list(false,null);
  expect(fetchSpy.mock.calls.map(call=>(call as unknown[])[0])).toEqual(['/api/line-account-folders','/api/line-account-folders','/api/line-account-folders/folder%2Fid','/api/line-accounts/account%2Fid/folder','/api/line-accounts/account%2Fid/folder','/api/line-account-folders/folder%2Fid','/api/line-accounts?folderId=folder%2Fid','/api/line-accounts?folderId=__none__'].map(path=>`http://127.0.0.1:8788${path}`));
  const calls=fetchSpy.mock.calls as unknown as [string,RequestInit][];
  expect(calls[3][1]).toMatchObject({method:'PUT',body:JSON.stringify({folderId:'folder/id'})});
  expect(calls[4][1]).toMatchObject({method:'PUT',body:JSON.stringify({folderId:null})});
});
