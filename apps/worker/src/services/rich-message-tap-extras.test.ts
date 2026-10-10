import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrackedLinkByIdOrShortCode } from '@line-crm/db';
import { stripTapExtras, validateImagemapMessage } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { trackedLinks } from '../routes/tracked-links.js';
import { autoTrackContent, decorateForFriendPush } from './auto-track.js';
import { processTrackedClick } from './tracked-click-steps.js';
import { decorateTapExtras, handleExtraPostback } from './tap-extras.js';
import { validateTemplateMessage } from './template-message-validation.js';

vi.mock('./feature-enforcement.js', () => ({ featureJobCanRun: async () => true }));

const workerUrl = 'https://worker.test';
const text = '予約したい 🌿\n日時は？ & # / + % =';
const destination = `https://line.me/R/oaMessage/%40shop/?${encodeURIComponent(text)}`;
const extras = { tagIds: ['tag-1', 'tag-2'], scoreChange: 10 };
const payload = {
  imageUrl: 'https://image.test/map/1040', baseUrl: 'https://image.test/map',
  baseSize: { width: 1040, height: 520 },
  tapAreas: [{ x: 0, y: 0, width: 100, height: 100, label: 'A', actionType: 'message', text, tapExtras: extras }],
};
let sql: SqliteD1;

beforeEach(() => {
  sql = createTestD1({ foreignKeys: true });
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant','Tenant');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id,line_basic_id)
      VALUES ('account','Shop','channel','token','secret','tenant','shop-liff','@shop'),
             ('other','Other','other','token','secret','tenant','other-liff','@other');
    INSERT INTO friends(id,line_user_id,line_account_id,score) VALUES ('friend','U1','account',5),('other-friend','U2','other',0);
    INSERT INTO tags(id,name,line_account_id) VALUES ('tag-1','予約','account'),('tag-2','興味','account');
    INSERT INTO broadcasts(id,title,message_type,message_content,line_account_id) VALUES ('b1','案内1','text','本文','account'),('b2','案内2','text','本文','account');`);
});
afterEach(() => sql.raw.close());

async function prepare(broadcastId = 'b1', message = payload) {
  const result = await autoTrackContent(sql.db, 'rich_message', JSON.stringify(message), workerUrl, { lineAccountId: 'account', broadcastId });
  expect(result.messageType).toBe('imagemap');
  const tree = JSON.parse(result.content);
  const action = tree.actions[0];
  expect(action).toEqual({ type: 'uri', linkUri: expect.stringMatching(/^https:\/\/worker\.test\/t\/[A-Za-z0-9_-]+$/), label: 'A', area: { x: 0, y: 0, width: 1040, height: 520 } });
  expect(tree.baseUrl).toBe(payload.baseUrl);
  expect(result.content).not.toContain('tapExtras');
  expect(validateImagemapMessage(tree)).toBeNull();
  const key = new URL(action.linkUri).pathname.split('/').pop()!;
  const link = (await getTrackedLinkByIdOrShortCode(sql.db, key))!;
  expect(link.original_url).toBe(destination);
  return { url: action.linkUri as string, link };
}

async function click(url: string, userAgent = 'Safari') {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {} } as unknown as ExecutionContext;
  const response = await trackedLinks.request(url, { headers: { 'user-agent': userAgent }, redirect: 'manual' }, { DB: sql.db, WORKER_URL: workerUrl }, ctx);
  await Promise.all(pending);
  return response;
}

function assertEffects(score = 15) {
  expect(sql.raw.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='friend' ORDER BY tag_id").all()).toEqual([{ tag_id: 'tag-1' }, { tag_id: 'tag-2' }]);
  expect(sql.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score });
}

describe('リッチメッセージのテキストと追加処理（実SQL）', () => {
  it('計測を1回通り、文を欠かさずLINE入力欄へ転送し、押された数・タグ・合計点を記録する', async () => {
    expect(validateTemplateMessage('rich_message', JSON.stringify(payload))).toEqual({ ok: true });
    const { url, link } = await prepare();
    const response = await click(`${url}?f=friend`, 'Line/15.0');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(destination);
    expect((await getTrackedLinkByIdOrShortCode(sql.db, link.id))!.click_count).toBe(1);
    expect(sql.raw.prepare('SELECT tracked_link_id,friend_id FROM link_clicks').all()).toEqual([{ tracked_link_id: link.id, friend_id: 'friend' }]);
    expect(sql.raw.prepare('SELECT broadcast_id,tracked_link_id FROM broadcast_tracked_links').all()).toEqual([{ broadcast_id: 'b1', tracked_link_id: link.id }]);
    assertEffects();
    const run = sql.raw.prepare("SELECT subject_id,input_json FROM workflow_steps WHERE process_kind='tracked_click' AND step_key='__run'").get() as { subject_id: string; input_json: string };
    await processTrackedClick({ DB: sql.db } as Env['Bindings'], run.subject_id, JSON.parse(run.input_json));
    assertEffects();
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_scores').get()).toEqual({ n: 1 });
  });

  it('一斉配信では自店LIFFで友だちを特定した後にだけ1回数える', async () => {
    const { url, link } = await prepare();
    const identify = await click(url, 'Line/15.0');
    expect(identify.headers.get('location')).toBe(`https://liff.line.me/shop-liff?redirect=${encodeURIComponent(url)}`);
    expect((await getTrackedLinkByIdOrShortCode(sql.db, link.id))!.click_count).toBe(0);
    expect(sql.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score: 5 });
    const response = await click(`${url}?lu=U1`, 'Line/15.0');
    expect(response.headers.get('location')).toBe(destination);
    expect((await getTrackedLinkByIdOrShortCode(sql.db, link.id))!.click_count).toBe(1);
    assertEffects();
  });

  it('1人への送信は友だちの目印を付け、LIFFを挟まず入力欄へ戻る', async () => {
    const result = await decorateForFriendPush(sql.db, 'rich_message', JSON.stringify(payload), workerUrl, { lineAccountId: 'account', friendId: 'friend' });
    const url = JSON.parse(result.content).actions[0].linkUri;
    expect(new URL(url).searchParams.get('f')).toBe('friend');
    expect((await click(url, 'Line/15.0')).headers.get('location')).toBe(destination);
    assertEffects();
  });

  it('送り直しはリンクを再利用し、別配信・別の文・別の追加処理とは分ける', async () => {
    const first = await prepare();
    expect((await prepare()).url).toBe(first.url);
    expect((await prepare('b2')).url).not.toBe(first.url);
    for (const patch of [{ text: '別の文' }, { tapExtras: { ...extras, scoreChange: 20 } }]) {
      const result = await autoTrackContent(sql.db, 'rich_message', JSON.stringify({ ...payload, tapAreas: [{ ...payload.tapAreas[0], ...patch }] }), workerUrl, { lineAccountId: 'account', broadcastId: 'b1' });
      expect(JSON.parse(result.content).actions[0].linkUri).not.toBe(first.url);
    }
    await click(`${first.url}?f=friend`);
    await click(`${first.url}?f=friend`);
    expect((await getTrackedLinkByIdOrShortCode(sql.db, first.link.id))!.click_count).toBe(2);
    assertEffects(25);
  });

  it('既存のimagemapにも同じ処理を使い、postbackへの偽装は拒否する', async () => {
    const node = { type: 'message', text, tapExtras: extras, area: { x: 0, y: 0, width: 1040, height: 520 } };
    const result = await autoTrackContent(sql.db, 'imagemap', JSON.stringify({ baseUrl: payload.baseUrl, baseSize: payload.baseSize, altText: '案内', actions: [node] }), workerUrl, { lineAccountId: 'account' });
    const action = JSON.parse(result.content).actions[0];
    expect(action.type).toBe('uri');
    expect(action).not.toHaveProperty('text');
    const key = new URL(action.linkUri).pathname.split('/').pop()!;
    await expect(handleExtraPostback(sql.db, 'friend', 'account', `tx=${key}`, 'forged')).rejects.toThrow('invalid_tap_extra_snapshot');
    expect((await click(`${action.linkUri}?f=friend`)).headers.get('location')).toBe(destination);
    assertEffects();
  });

  it('送る店のLINE IDが取れなければ、別店や空の入力画面へ送らない', async () => {
    const node = { type: 'message', text, tapExtras: extras, area: { x: 0, y: 0, width: 1040, height: 520 } };
    sql.raw.exec("UPDATE line_accounts SET line_basic_id=NULL WHERE id='account'");
    await expect(decorateTapExtras(sql.db, node, workerUrl, 'account')).rejects.toThrow('LINE ID');
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM tracked_links').get()).toEqual({ n: 0 });
    for (const basicId of ['', 'bad/id', '@shop?next=other']) {
      sql.raw.prepare("UPDATE line_accounts SET line_basic_id=? WHERE id='account'").run(basicId);
      await expect(decorateTapExtras(sql.db, node, workerUrl, 'account')).rejects.toThrow('LINE ID');
    }
    sql.raw.exec("UPDATE line_accounts SET line_basic_id='@shop',is_active=0 WHERE id='account'");
    await expect(decorateTapExtras(sql.db, node, workerUrl, 'account')).rejects.toThrow('LINE ID');
    sql.raw.exec("UPDATE line_accounts SET is_active=1,archived_at='2026-10-10' WHERE id='account'");
    await expect(decorateTapExtras(sql.db, node, workerUrl, 'account')).rejects.toThrow('LINE ID');
    await expect(decorateTapExtras(sql.db, { ...node, tapExtras: { scoreChange: 10 } }, workerUrl, null)).rejects.toThrow('LINE ID');
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM tracked_links').get()).toEqual({ n: 0 });
  });

  it('400文字の文も短い計測リンクで送り、配布先の店のLINE IDを使う', async () => {
    const longText = 'あ'.repeat(400);
    const node = { type: 'message', text: longText, tapExtras: { scoreChange: 3 }, area: { x: 0, y: 0, width: 1040, height: 520 } };
    const action = await decorateTapExtras(sql.db, node, workerUrl, 'other') as { linkUri: string };
    expect(action.linkUri.length).toBeLessThan(1000);
    expect((await click(`${action.linkUri}?f=other-friend`)).headers.get('location')).toBe(`https://line.me/R/oaMessage/%40other/?${encodeURIComponent(longText)}`);
    expect(sql.raw.prepare("SELECT score FROM friends WHERE id='other-friend'").get()).toEqual({ score: 3 });
    for (const invalid of ['', 'あ'.repeat(401)]) await expect(decorateTapExtras(sql.db, { ...node, text: invalid }, workerUrl, 'other')).rejects.toThrow('1〜400文字');
  });

  it('プレビュー・テスト送信・無効なリンクは数えず、タグ・点数も付けない', async () => {
    const { url, link } = await prepare();
    expect((await click(`${url}?f=friend`, 'facebookexternalhit/1.1')).status).toBe(200);
    expect((await getTrackedLinkByIdOrShortCode(sql.db, link.id))!.click_count).toBe(0);
    const testSend = await autoTrackContent(sql.db, 'rich_message', JSON.stringify(stripTapExtras(payload)), workerUrl, { lineAccountId: 'account' });
    expect(testSend.content).not.toContain('/t/');
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM tracked_links').get()).toEqual({ n: 1 });
    sql.raw.prepare('UPDATE tracked_links SET is_active=0 WHERE id=?').run(link.id);
    expect((await click(`${url}?f=friend`)).status).toBe(404);
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: 0 });
    expect(sql.raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score: 5 });
  });

  it('別店の友だちの目印ではタグ・点数を付けない', async () => {
    const { url } = await prepare();
    expect((await click(`${url}?f=other-friend`)).headers.get('location')).toBe(destination);
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: 0 });
    expect(sql.raw.prepare("SELECT score FROM friends WHERE id='other-friend'").get()).toEqual({ score: 0 });
  });
});
