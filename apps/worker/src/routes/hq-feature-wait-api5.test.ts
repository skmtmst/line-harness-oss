import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';
import { messageListFacts } from '../services/hq-templates/message-list-facts.js';

let sql: ReturnType<typeof createTestD1>;
let app: Hono<Env>;
let staff: NonNullable<Env['Variables']['staff']>;
const definition = (content: string, name = '定型文') => ({
  schemaVersion: 1,
  template: { id: 'source', name, category: 'reply', messageType: 'text', messageContent: content,
    carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'published' },
  media: [],
});
async function request(query: string, method = 'GET', body?: unknown, database = sql.db) {
  const response = await app.request(`/api/hq/templates${query}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: database } as Env['Bindings']);
  return { status: response.status, body: await response.json() as { data: Array<{ id: string; message_count: number | null; has_interpolations: boolean | null; message_type: string | null }>; stats: Record<string, unknown> } };
}
async function create(content: string, name = '定型文') {
  const response = await request('', 'POST', { type: 'template', name, definition: definition(content,name), requestId: crypto.randomUUID() });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as unknown as { data: { template: { id: string } } }).data.template.id;
}
const totalChanges = () => (sql.raw.prepare('SELECT total_changes() n').get() as { n: number }).n;

beforeEach(() => {
  sql = createTestD1({ foreignKeys: true });
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES('api5','組5'),('other','別組織');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('api5-owner','所有者','owner','fixture','api5');`);
  for (const [id,tenant] of [['a','api5'],['b','api5'],['other-account','other'],['inactive','api5'],['archived','api5']]) {
    sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES(?,?,?,'fixture','fixture',?)").run(id,id,id,tenant);
  }
  staff = { id: 'api5-owner', name: '所有者', role: 'owner', tenantId: 'api5', readOnly: false };
  app = new Hono<Env>();
  app.use('*', async (c,next) => { c.set('staff',staff); await next(); });
  app.route('/', hqTemplates);
});
afterEach(() => { sql.raw.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe(': 保存した通数・差し込みで統括テンプレートを探す', () => {
  it('保存→一覧→絞り込みを実SQLで確認し、本文を返さず外部通信・書込みを行わない', async () => {
    const ids = [await create('名前 {{name}} 様'), await create('本文だけ', '{{name}} は名前にだけ'), await create('共通 {予約ページ}')];
    const writes = totalChanges();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_NETWORK'));
    const listed = await request('?type=template&kind=message');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(3);
    expect(listed.body.data.find(row => row.id === ids[0])).toMatchObject({ message_count: 1, has_interpolations: true, message_type: 'text' });
    expect(listed.body.data.find(row => row.id === ids[1])).toMatchObject({ message_count: 1, has_interpolations: false });
    expect((await request('?type=template&message_count=single&has_interpolations=true')).body.data.map(row => row.id).sort()).toEqual([ids[0],ids[2]].sort());
    expect((await request('?type=template&has_interpolations=false')).body.data.map(row => row.id)).toEqual([ids[1]]);
    expect((await request('?type=template&message_count=multiple')).body.data).toEqual([]);
    expect((await request('?type=template&kind=message&search=本文だけ&undistributed=true&folder_id=')).body.data.map(row=>row.id)).toEqual([ids[1]]);
    expect((await request('?type=template&kind=message&search=%7B%7Bname%7D%7D')).body.data.map(row=>row.id).sort()).toEqual([ids[0],ids[1]].sort());
    expect((await request('?type=template&undistributed=false')).body.data).toEqual([]);
    expect(JSON.stringify(listed.body)).not.toContain('名前 {{name}} 様');
    expect(totalChanges()).toBe(writes);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('組1の保管状態と組5の本文検索・通数・差し込み条件を同時に使える',async()=>{
    const archived=await create('保管の検索 {{name}}'),active=await create('有効の検索 {{name}}');
    sql.raw.prepare("UPDATE hq_templates SET archived_at=datetime('now') WHERE id=?").run(archived);
    const filter='&search=検索&message_count=single&has_interpolations=true&undistributed=true&folder_id=';
    for(const [status,ids] of [['active',[active]],['archived',[archived]],['all',[active,archived]]] as const){
      const response=await request('?type=template&kind=message&status='+status+filter);
      expect(response.status).toBe(200);expect(response.body.data.map(row=>row.id).sort()).toEqual([...ids].sort());
      expect(response.body).toMatchObject({status,archive_counts:{active:1,archived:1}});
    }
  });

  it('カードは1通、依存画像を通数に足さず、壊れた版・未知の複数通を1通にしない', async () => {
    const single = definition('本文');
    const media = ['one','two'].map(id => ({ id,kind:'image',filename:`${id}.png`,mimeType:'image/png',sizeBytes:10,
      width:100,height:100,durationMs:null,r2Key:`hq-templates/api5/${id}.png`,publicUrl:`https://worker.test/${id}.png`,
      versionId:`version-${id}`,versionNo:1,contentHash:'a'.repeat(64) }));
    expect(messageListFacts(JSON.stringify({...single,media}))).toEqual({ message_count:1,has_interpolations:false });
    expect(messageListFacts(JSON.stringify({ ...single, card: { format:'flex', title:'案内', body:'{{field.pet_name}}', buttons:[] } })))
      .toEqual({ message_count:1, has_interpolations:true });
    for (const raw of [null, '{}', 'null', JSON.stringify({...single, messages: []})]) {
      expect(messageListFacts(raw)).toEqual({ message_count:null, has_interpolations:null });
    }
    const id = await create('元の本文');
    sql.raw.prepare("UPDATE hq_template_versions SET definition_json='{}' WHERE template_id=?").run(id);
    expect((await request('?type=template')).body.data[0]).toMatchObject({ message_count:null, has_interpolations:null });
    expect((await request('?type=template&has_interpolations=false')).body.data).toEqual([]);
    expect((await request('?type=template&message_count=single')).body.data).toEqual([]);
  });

  it('不正な条件を拒み、閲覧権限と組織・アカウント境界を保つ', async () => {
    await create('本文');
    for (const query of ['?message_count=0','?message_count=','?has_interpolations=1','?has_interpolations=']) {
      expect((await request(query)).status).toBe(400);
    }
    staff.readOnly = true;
    expect((await request('?type=template')).status).toBe(200);
    sql.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='api5-owner'");
    expect((await request('?type=template')).status).toBe(403);
    sql.raw.exec("UPDATE staff_members SET tenant_id='api5',account_scope='accounts' WHERE id='api5-owner'");
    expect((await request('?type=template')).status).toBe(403);
    sql.raw.exec("UPDATE staff_members SET account_scope='all',role='staff' WHERE id='api5-owner'");
    expect((await request('?type=template')).status).toBe(403);
  });
});

describe(': 対応状況とマーク変更を別々に集計する', () => {
  function seed() {
    sql.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='inactive'; UPDATE line_accounts SET archived_at=datetime('now') WHERE id='archived'");
    for (const [id,account,status,hidden] of [
      ['a-1','a','unread',0], ['a-2','a','in_progress',0], ['b-1','b','resolved',0],
      ['hidden','a','unread',1], ['other-friend','other-account','unread',0],
      ['inactive-friend','inactive','unread',0], ['archived-friend','archived','unread',0],
    ] as const) {
      sql.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id,is_hidden) VALUES(?,?,?,?)').run(id,id,account,hidden);
      sql.raw.prepare("INSERT INTO chats(id,friend_id,line_account_id,status,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))").run(`chat-${id}`,id,account,status);
    }
    // Free-form mark names do not determine the fixed inbox states.
    sql.raw.exec("INSERT INTO support_marks(id,name,color) VALUES('custom-mark','未対応','#00AA00'); UPDATE friends SET support_mark_id='custom-mark' WHERE id IN ('a-1','a-2','b-1')");
    // A damaged cross-account chat is excluded, rather than attributed to either shop.
    sql.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('mismatch','mismatch','a'); INSERT INTO chats(id,friend_id,line_account_id,status,created_at,updated_at) VALUES('cross','mismatch','b','in_progress',datetime('now'),datetime('now'))");
  }
  it('全有効店の重複しない人数と直近168時間の記録を返し、0と割合未定義を分ける', async () => {
    seed();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    const events = [
      ['1','a-1','support_mark','changed','2026-10-09T09:00:00.000'],
      ['2','a-2','support_mark','changed','2026-10-15T23:00:00Z'],
      ['3','b-1','support_mark','changed','2026-10-16T08:59:59+09:00'],
      ['old','a-1','support_mark','changed','2026-10-09T08:59:59'],
      ['end','a-1','support_mark','changed','2026-10-16T00:00:00Z'],
      ['other','other-friend','support_mark','changed','2026-10-15T23:00:00Z'],
      ['hidden','hidden','support_mark','changed','2026-10-15T23:00:00Z'],
      ['inactive','inactive-friend','support_mark','changed','2026-10-15T23:00:00Z'],
      ['archived','archived-friend','support_mark','changed','2026-10-15T23:00:00Z'],
      ['tag','a-1','tag','changed','2026-10-15T23:00:00Z'],
      ['created','a-1','support_mark','created','2026-10-15T23:00:00Z'],
    ];
    for (const event of events) sql.raw.prepare('INSERT INTO operation_audit(id,friend_id,target_kind,action,created_at) VALUES(?,?,?,?,?)').run(...event);
    const writes=totalChanges();
    staff.readOnly=true;
    const result=await request('?type=mark');
    expect(result.status).toBe(200);
    expect(result.body.stats).toMatchObject({ supportStatus:{ source:'chats',friendCount:3,unhandledFriendCount:1,inProgressFriendCount:1 },
      markChanges:{ source:'operation_audit', count:3, coverage:'recorded_events_only', since:'2026-10-09T00:00:00.000Z',until:'2026-10-16T00:00:00.000Z' } });
    expect((result.body.stats.supportStatus as { unhandledPercent:number }).unhandledPercent).toBeCloseTo(100/3);
    expect((await request('?kind=support_mark')).body.stats).toEqual(result.body.stats);
    expect(totalChanges()).toBe(writes);
    vi.useRealTimers();
  });

  it('空の集計・別組織の非表示と取得失敗を区別する', async () => {
    const result=await request('?type=mark');
    expect(result.body.stats).toMatchObject({ supportStatus:{ friendCount:0,unhandledFriendCount:0,inProgressFriendCount:0,unhandledPercent:null }, markChanges:{count:0} });
    const failed = { ...sql.db, prepare: (query:string) => {
      if (query.includes('AS inbox_friend_count')) throw new Error('DB_UNAVAILABLE');
      return sql.db.prepare(query);
    } } as D1Database;
    expect((await request('?type=mark','GET',undefined,failed)).status).toBe(500);
    sql.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='api5-owner'");
    expect((await request('?type=mark')).status).toBe(403);
  });
});
