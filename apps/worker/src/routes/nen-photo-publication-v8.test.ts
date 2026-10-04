import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { nenMembers } from './nen-members.js';
import { permissionForApiPath } from '../middleware/auth.js';
import { nenPhotoOperations } from './nen-photo-operations.js';
import { processDuePhotoPublicationRewards } from '../services/photo-reward-sync.js';

let db: SqliteD1;
let role = 'owner';
let readOnly = false;
function target() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('staff' as never, { id: 'owner', role, readOnly, name: '管理者' } as never);
    c.env = { DB: db.db };
    await next();
  });
  app.route('/', nenMembers); app.route('/', nenPhotoOperations);
  return app;
}
function photo(id: string, status = 'adopted', consent: string | null = '2026-10-01') {
  db.raw.prepare(`INSERT INTO nen_photo_submissions
    (id,friend_id,pet_id,line_account_id,r2_key,image_url,review_image_url,public_image_url,content_type,status,publication_consent_at,created_at,updated_at)
    VALUES (?,'f','pet','a',?,'private','https://review.example/p.jpg','https://public.example/p.jpg','image/jpeg',?,?,'2026-10-01','2026-10-01')`).run(id,`private/${id}`,status,consent);
}
function request(path: string, method: string, body: unknown, key = 'operation-key') {
  return target().request(path, {method,headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
}
function publish(id: string, expectedVersion = 0, key = `publish-${id}`) {
  return request(`/api/nen-members/photos/${id}/publish`, 'POST', {accountId:'a',expectedVersion},key);
}
function outbox() { return db.raw.prepare('SELECT * FROM nen_photo_publication_reward_outbox').all() as Array<Record<string,unknown>>; }

beforeEach(() => {
  role='owner'; readOnly=false; db=createTestD1();
  db.raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','a','a','token','secret'),('b','b','b','token','secret');`);
  insertFriend(db.raw,'f',{line_account_id:'a'});
  db.raw.exec(`INSERT INTO nen_pet_profiles (id,friend_id,name,animal_type,created_at,updated_at) VALUES ('pet','f','テスト','dog','2026-10-01','2026-10-01');
    INSERT INTO nen_ec_member_snapshots (friend_id,customer_id,synced_at) VALUES ('f','123','2026-10-01');
    INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,created_at) VALUES ('v1',1,'legacy-5',5,200,'最初','2026-10-01');`);
});
afterEach(() => { db.raw.close(); vi.restoreAllMocks(); });

describe('V8 掲載APIと追加報酬（実SQL）', () => {
  it('初回掲載・同じキーの再送で版も追加報酬も増えず、別入力でのキー再利用を拒否する', async () => {
    photo('p'); expect((await publish('p')).status).toBe(200);
    expect((await publish('p')).status).toBe(200);
    expect((await publish('p',1)).status).toBe(409);
    expect(outbox()).toEqual([expect.objectContaining({photo_id:'p',points:200,policy_version:'legacy-5',status:'pending'})]);
    expect(db.raw.prepare('SELECT version FROM nen_photo_publications').get()).toEqual({version:1});
  });
  it('報酬版が変わっても再掲載で報酬を増やさず、0点の初回掲載にも遡及付与しない', async () => {
    photo('p'); await publish('p');
    db.raw.exec("UPDATE nen_photo_publications SET status='withdrawn',version=2; INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,created_at) VALUES ('v2',2,'v2',5,500,'次','2026-10-02')");
    expect((await publish('p',2,'republish-key')).status).toBe(200);
    expect(outbox()[0].points).toBe(200);
    db.raw.exec("INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,created_at) VALUES ('v3',3,'v3',5,0,'なし','2026-10-03')");
    photo('zero'); await publish('zero');
    db.raw.exec("UPDATE nen_photo_publications SET status='withdrawn',version=2 WHERE photo_id='zero'; INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,created_at) VALUES ('v4',4,'v4',5,100,'再開','2026-10-04')");
    await publish('zero',2,'restore-zero');
    expect(outbox()).toHaveLength(1);
  });
  it('未採用・同意なし・撤回済み・公開画像なしは422、別アカウントの写真は404', async () => {
    photo('pending','pending'); photo('no-consent','adopted',null); photo('withdrawn'); photo('no-image');
    db.raw.exec("UPDATE nen_photo_submissions SET publication_withdrawn_at='2026-10-02' WHERE id='withdrawn'; UPDATE nen_photo_submissions SET public_image_url=NULL WHERE id='no-image'");
    for (const id of ['pending','no-consent','withdrawn','no-image']) expect((await publish(id)).status).toBe(422);
    expect((await request('/api/nen-members/photos/withdrawn/publish','POST',{accountId:'b',expectedVersion:0})).status).toBe(404);
    expect(outbox()).toHaveLength(0);
  });
  it('読むだけの人と掲載管理権限のない担当者は操作を拒否する', async () => {
    photo('p'); readOnly=true; expect((await publish('p')).status).toBe(403);
    readOnly=false; role='staff'; expect((await publish('p')).status).toBe(403);
  });
  it('全掲載の順列を保存し、一覧と公開ギャラリーへ反映する', async () => {
    photo('p1'); photo('p2'); await publish('p1'); await publish('p2');
    const response=await request('/api/nen-members/photos/publications/order','PUT',{accountId:'a',items:[{id:'photo-publication:p2',expectedVersion:1},{id:'photo-publication:p1',expectedVersion:1}]});
    expect(response.status).toBe(200);
    const body=await (await target().request('/api/nen-members/photos/publications?accountId=a')).json() as { data: { items: Array<{photo_id: string}> } };
    expect(body.data.items.map((row: {photo_id:string})=>row.photo_id)).toEqual(['p2','p1']);
    expect(body.data.items[0]).toMatchObject({version:2,sort_order:0,publication_points:200,publication_point_sync_status:'pending'});
  });
  it('掲載順は通常一覧の200件を超えて全件を読み、保存する', async () => {
    db.raw.transaction(() => {
      for(let i=0;i<201;i++) {
        photo(`p${i}`);
        db.raw.prepare("INSERT INTO nen_photo_publications (id,photo_id,line_account_id,status,published_at,updated_at) VALUES (?,?,'a','published','2026-10-01','2026-10-01')").run(`pub${i}`,`p${i}`);
      }
    })();
    const list=await (await target().request('/api/nen-members/photos/publications/order?accountId=a')).json() as {data:{items:Array<{id:string;version:number}>}};
    expect(list.data.items).toHaveLength(201);
    const items=list.data.items.reverse().map(row=>({id:row.id,expectedVersion:row.version}));
    expect((await request('/api/nen-members/photos/publications/order','PUT',{accountId:'a',items})).status).toBe(200);
    expect(db.raw.prepare('SELECT id FROM nen_photo_publications ORDER BY sort_order LIMIT 1').get()).toEqual({id:items[0].id});
  });
  it('集合不足・古い版・別アカウントIDは409、重複・空配列は400で、全件を書き換えない', async () => {
    photo('p1'); photo('p2'); await publish('p1'); await publish('p2');
    for (const items of [
      [{id:'photo-publication:p1',expectedVersion:1}],
      [{id:'photo-publication:p1',expectedVersion:1},{id:'photo-publication:p2',expectedVersion:9}],
      [{id:'photo-publication:p1',expectedVersion:1},{id:'other-account',expectedVersion:1}],
    ]) expect((await request('/api/nen-members/photos/publications/order','PUT',{accountId:'a',items})).status).toBe(409);
    expect((await request('/api/nen-members/photos/publications/order','PUT',{accountId:'a',items:[]})).status).toBe(400);
    expect((await request('/api/nen-members/photos/publications/order','PUT',{accountId:'a',items:[{id:'photo-publication:p1',expectedVersion:1},{id:'photo-publication:p1',expectedVersion:1}]})).status).toBe(400);
    expect(db.raw.prepare('SELECT version FROM nen_photo_publications').all()).toEqual([{version:1},{version:1}]);
  });
  it('掲載が採用より先でも初回掲載の版を使い、採用時の同意を再検査する', () => {
    photo('p','pending'); photo('withdrawn','pending');
    db.raw.exec("INSERT INTO nen_photo_publications (id,photo_id,line_account_id,status,published_at,updated_at) VALUES ('pub','p','a','published','2026-10-01','2026-10-01'),('pub-w','withdrawn','a','published','2026-10-01','2026-10-01'); UPDATE nen_photo_submissions SET publication_withdrawn_at='2026-10-02' WHERE id='withdrawn'; INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,created_at) VALUES ('v2',2,'v2',5,500,'次','2026-10-02'); UPDATE nen_photo_submissions SET status='adopted'");
    expect(outbox()).toEqual([expect.objectContaining({photo_id:'p',points:200,policy_version:'legacy-5'})]);
  });
  it('追加点数を版へ保存し、再送と過去版への復帰でも中身を保つ', async () => {
    const input={points:10,publicationPoints:300,summary:'次',expectedVersion:1};
    expect((await request('/api/nen-members/photo-reward-policy/versions','POST',input,'policy-create')).status).toBe(200);
    expect((await request('/api/nen-members/photo-reward-policy/versions','POST',input,'policy-create')).status).toBe(200);
    expect((await request('/api/nen-members/photo-reward-policy/versions','POST',{...input,publicationPoints:301},'policy-create')).status).toBe(409);
    expect((await request('/api/nen-members/photo-reward-policy/revert','POST',{versionNumber:1},'policy-revert')).status).toBe(200);
    const body=await (await target().request('/api/nen-members/photo-reward-policy/versions')).json() as { data: Array<{publicationPoints: number}> };
    expect(body.data.map((v:{publicationPoints:number})=>v.publicationPoints)).toEqual([200,300,200]);
  });
  it.each([-1,1.2,100001,'200',null])('不正な追加点数 %s を400で拒否する', async (value) => {
    expect((await request('/api/nen-members/photo-reward-policy/versions','POST',{points:10,publicationPoints:value})).status).toBe(400);
  });
  it('時差のない旧予約日時も日本時間として初回掲載の版を選ぶ', async () => {
    db.raw.exec("INSERT INTO photo_reward_policies (id,version_number,policy_key,points,publication_points,summary,effective_from,created_at) VALUES ('v2',2,'v2',5,350,'旧予約',strftime('%Y-%m-%dT%H:%M:%f','now','+5 hours'),'2026-10-01')");
    photo('p'); expect((await publish('p')).status).toBe(200);
    expect(outbox()[0]).toMatchObject({points:350,policy_version:'v2'});
  });
  it('同じ掲載入力の同時再送は成功に収束し、版と報酬を1回だけ作る', async () => {
    photo('p');
    // 実D1のbatchは原子的に順番に実行される。同一SQLite接続の非同期ラッパーは
    // BEGINが重なるため、batchだけを直列化し、事前読取は同時に進める。
    const batch=db.db.batch.bind(db.db);
    let queue: Promise<unknown>=Promise.resolve();
    vi.spyOn(db.db,'batch').mockImplementation((statements) => {
      const result=queue.then(()=>batch(statements));
      queue=result.catch(()=>undefined);
      return result;
    });
    const responses=await Promise.all([publish('p'),publish('p')]);
    expect(responses.map(response=>response.status)).toEqual([200,200]);
    expect(outbox()).toHaveLength(1);
    expect(db.raw.prepare('SELECT version FROM nen_photo_publications').get()).toEqual({version:1});
  });
  it('同じ版からの報酬設定の同時保存は片方だけを通す', async () => {
    const responses=await Promise.all([
      request('/api/nen-members/photo-reward-policy/versions','POST',{points:10,publicationPoints:300,expectedVersion:1},'policy-concurrent-a'),
      request('/api/nen-members/photo-reward-policy/versions','POST',{points:20,publicationPoints:400,expectedVersion:1},'policy-concurrent-b'),
    ]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
  });
  it('V7など追加点数を送らない保存でも、掲載報酬の設定を保つ', async () => {
    expect((await request('/api/nen-members/photo-reward-policy/versions','POST',{points:10},'old-ui-policy')).status).toBe(200);
    expect(db.raw.prepare('SELECT publication_points FROM photo_reward_policies WHERE version_number=2').get()).toEqual({publication_points:200});
  });
  it('認証の第一関門も掲載管理権限を要求する', () => {
    expect(permissionForApiPath('/api/nen-members/photos/p/publish')).toBe('photo.publication.manage');
    expect(permissionForApiPath('/api/nen-members/photos/publications/order')).toBe('photo.publication.manage');
  });
  it('期限切れの処理中報酬を回収し、同時処理で二重に送らない', async () => {
    photo('p'); await publish('p');
    db.raw.exec("UPDATE nen_photo_publication_reward_outbox SET status='processing',updated_at='2026-10-01T00:00:00+09:00'");
    const keys: string[]=[];
    const fetcher=vi.fn(async (_url: unknown, init?: RequestInit) => {
      keys.push(JSON.parse(String(init?.body)).awardKey);
      return new Response(JSON.stringify({success:true}),{status:200});
    });
    const options={now:new Date(Date.now()+1000),fetcher:fetcher as typeof fetch};
    await Promise.all([processDuePhotoPublicationRewards(db.db,{baseUrl:'https://ec.example',secret:'test-secret'},options),processDuePhotoPublicationRewards(db.db,{baseUrl:'https://ec.example',secret:'test-secret'},options)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(keys).toEqual(['photo-publication-reward:p']);
  });
  it('ECへ署名と掲載専用の冪等キーで届け、成功済みを再送しない', async () => {
    photo('p'); await publish('p');
    const fetcher=vi.fn(async () => new Response(JSON.stringify({success:true,pointBalance:205}),{status:200}));
    const options={now:new Date(Date.now()+1000),fetcher:fetcher as typeof fetch};
    expect(await processDuePhotoPublicationRewards(db.db,{baseUrl:'https://ec.example',secret:'test-secret'},options)).toMatchObject({synced:1});
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body))).toEqual({customerId:123,points:200,awardKey:'photo-publication-reward:p'});
    expect(outbox()[0]).toMatchObject({status:'synced',attempt_count:1});
    await processDuePhotoPublicationRewards(db.db,{baseUrl:'https://ec.example',secret:'test-secret'},options);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('ECの一時失敗は再試行し、会員連携なしの恒久失敗は自動再送しない', async () => {
    photo('p'); await publish('p');
    db.raw.exec("DELETE FROM nen_ec_member_snapshots"); photo('unlinked'); await publish('unlinked');
    const fetcher=vi.fn(async () => new Response('{}',{status:503}));
    await processDuePhotoPublicationRewards(db.db,{baseUrl:'https://ec.example',secret:'test-secret'},{now:new Date(Date.now()+1000),fetcher:fetcher as typeof fetch});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(outbox()).toEqual(expect.arrayContaining([expect.objectContaining({photo_id:'p',status:'failed',last_error:'ec_unavailable',attempt_count:1}),expect.objectContaining({photo_id:'unlinked',last_error:'customer_unlinked',attempt_count:0})]));
  });
});
