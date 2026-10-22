import { afterEach, expect, test, vi } from 'vitest';
import { uploadWorkerAssets, verifyWorkerAssets, materializeWorkerAssets, workerAssetsConfig } from '../../src/cf-api/worker-assets.js';
import { snapshotWorkerDeployment, restoreWorkerDeployment } from '../../src/cf-api/worker-deployments.js';
import { putWorkerScript } from '../../src/cf-api/workers.js';
const creds = { accountId: 'a', apiToken: 'fixture' };
const files = new Map([['index.html', Buffer.from('<script src="app.js"></script>')],['app.js',Buffer.from('new release')]]);
afterEach(()=>vi.unstubAllGlobals());
test('全ファイルを登録し要求されたbucketを送信、完了JWTとWorkerを一緒に配備する', async()=>{
 const calls: {url:string;init?:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async (url,init)=>{
  calls.push({url:String(url),init});
  if(String(url).endsWith('assets-upload-session')) {
   const manifest=JSON.parse(init.body).manifest;
   expect(Object.keys(manifest)).toEqual(['/index.html','/app.js']);
   return Response.json({success:true,result:{jwt:'upload-fixture',buckets:[Object.values(manifest).map((x:any)=>x.hash)]}});
  }
  if(String(url).includes('assets/upload')) {
   expect(init.headers.Authorization).toBe('Bearer upload-fixture');
   const parts = Array.from((init.body as FormData).values()) as File[];
   expect(await parts[0].text()).toBe(files.get('index.html')!.toString('base64'));
   expect(parts[1].type).toBe('application/javascript');
   return Response.json({success:true,result:{jwt:'completed-fixture'}},{status:201});
  }
  return Response.json({success:true,result:{}});
 }));
 const assetsJwt=await uploadWorkerAssets({creds,scriptName:'w',files});
 await putWorkerScript({creds,scriptName:'w',scriptContent:Buffer.from('script'),bindings:[{type:'assets',name:'ASSETS'}],assetsJwt});
 const metadata=JSON.parse(await ((calls.at(-1)!.init!.body as FormData).get('metadata') as Blob).text());
 expect(metadata.assets).toEqual({jwt:'completed-fixture',config:{run_worker_first:true}});
 expect(metadata.keep_assets).toBeUndefined();
});
test('既存assetsだけでも完了JWTをWorkerへ渡す',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true,result:{jwt:'complete',buckets:[]}})));
 expect(await uploadWorkerAssets({creds,scriptName:'w',files})).toBe('complete');expect(fetch).toHaveBeenCalledTimes(1);
});
test('LIFFのindexとJSが実際のrelease内容か検証し、古いJSの200を失敗にする',async()=>{
 vi.stubGlobal('fetch',vi.fn(async url=>new Response(files.get(new URL(String(url)).pathname.slice(1))!.toString())));
 await verifyWorkerAssets('https://fixture.example',files);expect(fetch).toHaveBeenCalledTimes(2);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('old SPA fallback')));
 await expect(verifyWorkerAssets('https://fixture.example',files)).rejects.toThrow('content_mismatch');
});
test('codeとassetsを含む現在versionの配分を保存し同じ配分へ戻す',async()=>{
 const versions=[{version_id:'00000000-0000-4000-8000-000000000001',percentage:100}];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  if(init?.method==='POST'){expect(JSON.parse(String(init.body))).toEqual({strategy:'percentage',versions});return Response.json({success:true});}
  return Response.json({success:true,result:{deployments:[{versions}]}});
 }));
 const snapshot=await snapshotWorkerDeployment(creds,'w');await restoreWorkerDeployment(creds,'w',snapshot);
 expect(fetch).toHaveBeenCalledTimes(2);
});


test('設置先LIFF IDだけ置換し、別appの古いbundleを受け付けない',()=>{
 const input=new Map([['index.html',Buffer.from('client')],['assets/client.js',Buffer.from('const id="__MUSUBO_LIFF_ID__";')]]);
 expect(materializeWorkerAssets(input,'123-fixture').get('assets/client.js')!.toString()).toBe('const id="123-fixture";');
 expect(input.get('assets/client.js')!.toString()).toContain('__MUSUBO_LIFF_ID__');
 expect(()=>materializeWorkerAssets(undefined)).toThrow('worker_assets_bundle_missing');
});
test('配信制御ファイルはmetadataへ渡し、公開assetやprobeに含めない',async()=>{
 const input=new Map([...files,['_headers',Buffer.from('/*\n  Cache-Control: no-cache')],['_redirects',Buffer.from('/old / 302')]]);
 const config=workerAssetsConfig(input);
 expect(config).toEqual({run_worker_first:true,_headers:'/*\n  Cache-Control: no-cache',_redirects:'/old / 302'});
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(init?.method==='POST'){
   expect(Object.keys(JSON.parse(String(init.body)).manifest)).toEqual(['/index.html','/app.js']);
   return Response.json({success:true,result:{jwt:'complete',buckets:[]}});
  }
  const path=new URL(String(url)).pathname.slice(1);
  expect(path.startsWith('_')).toBe(false);
  return new Response(input.get(path)!.toString());
 }));
 await uploadWorkerAssets({creds,scriptName:'w',files:input});
 await verifyWorkerAssets('https://fixture.example',input);
 expect(fetch).toHaveBeenCalledTimes(3);
});


test('配備直後の一時404は有限回再確認し、各要求にtimeoutを付ける',async()=>{
 let first=true;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  expect(init.signal).toBeInstanceOf(AbortSignal);
  if(first){first=false;return new Response('',{status:404});}
  return new Response(files.get(new URL(String(url)).pathname.slice(1))!.toString());
 }));
 await verifyWorkerAssets('https://fixture.example',files);
 expect(fetch).toHaveBeenCalledTimes(3);
});
