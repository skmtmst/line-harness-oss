import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import type {Env} from '../index.js';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
const mocks=vi.hoisted(()=>({access:vi.fn(),signed:vi.fn(),stored:vi.fn(),scan:vi.fn()}));
vi.mock('../services/account-access.js',()=>({canAccessAllLineAccounts:mocks.access}));
vi.mock('../services/r2-presigned-upload.js',()=>({createR2PresignedPutUrl:mocks.signed}));
vi.mock('../services/broadcast-media-storage.js',()=>({storeBroadcastMedia:mocks.stored}));
vi.mock('./file-scan.js',()=>({ensureFileScanForUpload:mocks.scan}));
import {broadcastMediaDirect} from './broadcast-media-direct.js';
let test:SqliteD1;let app:Hono<Env>;let env:Env['Bindings'];
beforeEach(()=>{
 vi.clearAllMocks();test=createTestD1();
 app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'staff',role:'owner'} as never);await next();});app.route('/',broadcastMediaDirect);
 mocks.access.mockResolvedValue(true);mocks.signed.mockResolvedValue({url:'https://r2.example/signed',headers:{'Content-Type':'video/mp4'},expiresAt:'2030-01-01T00:00:00Z'});
 mocks.stored.mockResolvedValue({key:'broadcast-media/public.mp4',url:'https://worker.example/images/broadcast-media/public.mp4',mimeType:'video/mp4',size:200*1024*1024});
 env={DB:test.db,CF_ACCOUNT_ID:'test-account',MEDIA_R2_ACCESS_KEY_ID:'test-key',MEDIA_R2_SECRET_ACCESS_KEY:'test-secret',MEDIA_R2_BUCKET_NAME:'test-bucket',WORKER_URL:'https://worker.example'} as Env['Bindings'];
});
afterEach(()=>test.raw.close());
const post=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},env);
async function create(size=200*1024*1024){return await (await post('/api/broadcast-message-assets/upload-sessions',{filename:'video.mp4',mimeType:'video/mp4',sizeBytes:size,lineAccountId:'a'})).json() as {data:{id:string;uploadUrl:string}};}
describe('一斉配信動画のR2直接アップロード',()=>{
 it('200MBまで署名URLを発行し、それ以上と別アカウントを拒否する',async()=>{
  expect((await create()).data.uploadUrl).toBe('https://r2.example/signed');
  expect((await post('/api/broadcast-message-assets/upload-sessions',{filename:'video.mp4',mimeType:'video/mp4',sizeBytes:200*1024*1024+1,lineAccountId:'a'})).status).toBe(400);
  mocks.access.mockResolvedValue(false);
  expect((await post('/api/broadcast-message-assets/upload-sessions',{filename:'video.mp4',mimeType:'video/mp4',sizeBytes:1,lineAccountId:'b'})).status).toBe(403);
 });
 it('サイズ・署名時の所属・ETagを照合して公開し、完了の再送はコピーし直さない',async()=>{
  const {data}=await create();
  const head=vi.fn().mockResolvedValue({size:200*1024*1024,etag:'etag',httpMetadata:{contentType:'video/mp4'},customMetadata:{'upload-session-id':data.id,'line-account-id':'a'}});
  const header=new Uint8Array([0,0,0,24,102,116,121,112,109,112,52,50,0,0,0,0]);
  env.IMAGES={head,get:vi.fn(async(_key,options)=>options?.range ? {arrayBuffer:async()=>header.buffer} : {body:new ReadableStream()}),delete:vi.fn()} as unknown as R2Bucket;
  expect((await post(`/api/broadcast-message-assets/upload-sessions/${data.id}/complete`,{etag:'wrong'})).status).toBe(409);
  expect(mocks.stored).not.toHaveBeenCalled();
  expect((await post(`/api/broadcast-message-assets/upload-sessions/${data.id}/complete`,{etag:'etag'})).status).toBe(201);
  expect((await post(`/api/broadcast-message-assets/upload-sessions/${data.id}/complete`,{etag:'etag'})).status).toBe(200);
  expect(mocks.stored).toHaveBeenCalledTimes(1);expect(mocks.scan).toHaveBeenCalledTimes(1);
 });
});
