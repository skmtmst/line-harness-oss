import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { applyTapExtras, decorateTapExtras, extrasFromTrackedLink, handleExtraPostback, validateTapExtraReferences } from './tap-extras.js';
import { autoTrackContent } from './auto-track.js';
import { getTrackedLinkByIdOrShortCode, getFriendById } from '@line-crm/db';
import { trackedLinks } from '../routes/tracked-links.js';
import { redeemCoupon } from './coupon-redemption.js';
import { handleResearchTap } from './research-tap.js';
vi.mock('./feature-enforcement.js', () => ({ featureJobCanRun: async () => true }));
let sql: SqliteD1;
const extras = { tagIds: ['tag-1', 'tag-2'], scoreChange: 10 };
beforeEach(() => {
  sql = createTestD1({ foreignKeys: true });
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant','Tenant');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id)
      VALUES ('account','Account','channel','token','secret','tenant','liff'),('other','Other','other','token','secret','tenant','other-liff');
    INSERT INTO friends(id,line_user_id,line_account_id,score) VALUES ('friend','U1','account',5),('other-friend','U2','other',0);
    INSERT INTO tags(id,name,line_account_id) VALUES ('tag-1','予約','account'),('tag-2','来店','account'),('other-tag','別店','other');`);
});
afterEach(() => sql.raw.close());
function assertEffects(score = 15) {
  expect(sql.raw.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='friend' ORDER BY tag_id").all()).toEqual([{ tag_id: 'tag-1' }, { tag_id: 'tag-2' }]);
  expect(sql.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score });
}
describe('ボタンの追加処理（実SQL）', () => {
  it('タグを複数付け、既存の合計点に足す。同じ押下の再送は二重加点しない', async () => {
    await applyTapExtras(sql.db, 'friend', 'account', extras, 'event1');
    await applyTapExtras(sql.db, 'friend', 'account', extras, 'event1');
    assertEffects();
    await applyTapExtras(sql.db, 'friend', 'account', extras, 'event2');
    assertEffects(25);
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_scores').get()).toEqual({ n: 2 });
  });
  it('別店のタグ・友だちと小数を拒否し、途中までタグを付けない', async () => {
    expect(await validateTapExtraReferences(sql.db, { tapExtras: { tagIds: ['other-tag'] } }, 'account')).toBeTruthy();
    await expect(applyTapExtras(sql.db, 'friend', 'account', { tagIds: ['tag-1', 'other-tag'], scoreChange: 10 }, 'e')).rejects.toThrow();
    await expect(applyTapExtras(sql.db, 'other-friend', 'account', extras, 'e')).rejects.toThrow();
    await expect(applyTapExtras(sql.db, 'friend', 'account', { scoreChange: 1.5 }, 'e')).rejects.toThrow();
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: 0 });
  });
  it('postbackは保存した処理を使い、元の動きへ渡す。本文やアカウントの改ざんを拒否する', async () => {
    const action = await decorateTapExtras(sql.db, { type: 'postback', label: '予約', data: 'keyword:予約', tapExtras: extras }, 'https://worker.test', 'account') as { data: string };
    expect(await handleExtraPostback(sql.db, 'friend', 'account', action.data, 'e')).toBe('keyword:予約');
    expect(await handleExtraPostback(sql.db, 'friend', 'account', action.data, 'e')).toBe('keyword:予約');
    assertEffects();
    await expect(handleExtraPostback(sql.db, 'other-friend', 'other', action.data, 'e')).rejects.toThrow();
    expect(await handleExtraPostback(sql.db, 'friend', 'account', action.data + '&d=bad', 'e')).toBeNull();
  });
  it('URLボタンも既存の計測リンクを通り、元のURLへ転送してタグ・点数を付ける', async () => {
    const original = 'https://example.test/book?menu=1#time';
    const action = await decorateTapExtras(sql.db, { type: 'uri', label: '予約', uri: original, tapExtras: extras }, 'https://worker.test', 'account') as { uri: string };
    expect(action).not.toHaveProperty('tapExtras');
    const key = new URL(action.uri).pathname.split('/').pop()!;
    const link = (await getTrackedLinkByIdOrShortCode(sql.db, key))!;
    expect(extrasFromTrackedLink(link)).toEqual(extras);
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const response = await trackedLinks.request(action.uri + '?f=friend', { headers: { 'user-agent': 'Safari' }, redirect: 'manual' }, { DB: sql.db, WORKER_URL: 'https://worker.test' }, ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(original);
    await Promise.all(pending);
    assertEffects();
    // 同じ行き先でも異なる追加処理のボタンは混ざらない。
    const other = await decorateTapExtras(sql.db, { type: 'uri', uri: original, tapExtras: { scoreChange: 20 } }, 'https://worker.test', 'account') as { uri: string };
    expect(other.uri).not.toBe(action.uri);
    expect((await decorateTapExtras(sql.db, { type: 'uri', uri: original, tapExtras: extras }, 'https://worker.test', 'account') as { uri: string }).uri).toBe(action.uri);
  });
  it('リッチメッセージ素材をLINE形式に変換してからURL追加処理を付ける', async () => {
    const payload = { imageUrl: 'https://image.test/map/1040', baseUrl: 'https://image.test/map', baseSize: { width: 1040, height: 1040 }, tapAreas: [{ x: 0, y: 0, width: 100, height: 100, actionType: 'uri', uri: 'https://example.test', tapExtras: extras }] };
    const result = await autoTrackContent(sql.db, 'rich_message', JSON.stringify(payload), 'https://worker.test', { lineAccountId: 'account' });
    expect(result.messageType).toBe('imagemap');
    const content = JSON.parse(result.content);
    expect(content.actions[0].linkUri).toContain('/t/');
    expect(result.content).not.toContain('tapExtras');
  });
  it('クーポンの利用上限を守り、再送でタグ・点数を二重に付けない', async () => {
    const payload = { description: '割引', startsAt: '2026-01-01T00:00', endsAt: '2027-01-01T00:00', oncePerFriend: true, tapExtras: extras };
    sql.raw.prepare("INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('coupon','account','coupon','割引',?,1,'2026-10-01','2026-10-01')").run(JSON.stringify(payload));
    const friend = (await getFriendById(sql.db, 'friend'))!;
    expect((await redeemCoupon(sql.db, friend, 'account', 'coupon', 'e')).ok).toBe(true);
    expect((await redeemCoupon(sql.db, friend, 'account', 'coupon', 'e')).replayed).toBe(true);
    expect((await redeemCoupon(sql.db, friend, 'account', 'coupon', 'next')).ok).toBe(false);
    assertEffects();
  });
  it('リサーチの選んだ選択肢だけを処理し、単一回答の二度押しを防ぐ', async () => {
    sql.raw.prepare("INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('research','account','research','調査',?,1,'2026-10-01','2026-10-01')").run(JSON.stringify({ questions: [{ text: '続けますか', format: 'single', required: true, choices: ['はい', 'いいえ'], choiceTapExtras: [extras, { scoreChange: 100 }] }] }));
    expect(await handleResearchTap(sql.db, 'friend', 'account', 'research:research:1:0:0')).toContain('受け付け');
    expect(await handleResearchTap(sql.db, 'friend', 'account', 'research:research:1:0:1')).toContain('回答済み');
    expect(await handleResearchTap(sql.db, 'other-friend', 'other', 'research:research:1:0:0')).toContain('使えません');
    assertEffects();
    expect(sql.raw.prepare("SELECT content FROM messages_log WHERE source='research'").all()).toEqual([{ content: 'はい' }]);
  });
});

describe('リサーチの公開版・回答期間', () => {
  it('配信後に新しい版を公開しても、押した旧版のタグ・加点を使う', async () => {
    const oldPayload={questions:[{text:'調査',format:'multiple',choices:['A','B'],choiceTapExtras:[extras,{scoreChange:20}]}]};
    const newPayload={questions:[{text:'調査',format:'single',choices:['変更'],choiceTapExtras:[{scoreChange:100}]}]};
    sql.raw.prepare("INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('r','account','research','調査',?,2,'2026-10-01','2026-10-01')").run(JSON.stringify(newPayload));
    sql.raw.prepare("INSERT INTO broadcast_asset_versions(id,asset_id,version_number,payload_json,created_at) VALUES ('rv','r',1,?,'2026-10-01')").run(JSON.stringify(oldPayload));
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:0')).toContain('受け付け');
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:1')).toContain('受け付け');
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:1')).toContain('回答済み');
    assertEffects(35);
  });
  it('回答期間の前後と範囲外の選択肢では加点しない', async () => {
    const payload={startsAt:'2099-01-01',endsAt:'2099-02-01',questions:[{text:'調査',format:'single',choices:['A'],choiceTapExtras:[extras]}]};
    sql.raw.prepare("INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('r','account','research','調査',?,1,'2026-10-01','2026-10-01')").run(JSON.stringify(payload));
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:0')).toContain('まだ回答');
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:10')).toContain('使えません');
    sql.raw.prepare("UPDATE broadcast_message_assets SET payload_json=? WHERE id='r'").run(JSON.stringify({...payload,startsAt:'2000-01-01',endsAt:'2000-02-01'}));
    expect(await handleResearchTap(sql.db,'friend','account','research:r:1:0:0')).toContain('終わって');
    expect(sql.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({score:5});
  });
});

describe('追加処理付きURLの配信別集計', () => {
  it('同じURLでも配信ごとにリンクを分け、既存のクリック集計に結び付ける', async () => {
    sql.raw.exec(`INSERT INTO broadcasts(id,title,message_type,message_content,line_account_id) VALUES ('b1','配信1','text','本文','account'),('b2','配信2','text','本文','account');`);
    const tree={type:'bubble',footer:{type:'box',layout:'vertical',contents:[{type:'button',action:{type:'uri',label:'開く',uri:'https://example.test',tapExtras:extras}}]}};
    const first=await autoTrackContent(sql.db,'flex',JSON.stringify(tree),'https://worker.test',{lineAccountId:'account',broadcastId:'b1'});
    const replay=await autoTrackContent(sql.db,'flex',JSON.stringify(tree),'https://worker.test',{lineAccountId:'account',broadcastId:'b1'});
    const second=await autoTrackContent(sql.db,'flex',JSON.stringify(tree),'https://worker.test',{lineAccountId:'account',broadcastId:'b2'});
    expect(first.content).toBe(replay.content);
    expect(first.content).not.toBe(second.content);
    expect(sql.raw.prepare('SELECT broadcast_id FROM broadcast_tracked_links ORDER BY broadcast_id').all()).toEqual([{broadcast_id:'b1'},{broadcast_id:'b2'}]);
  });
});
