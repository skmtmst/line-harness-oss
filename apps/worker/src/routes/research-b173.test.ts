import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { ensureResearchForm } from '../services/research-forms.js';
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineIdentity: vi.fn(async (auth: string) => auth === 'Bearer valid' ? { lineUserId: 'U1', lineAccountId: 'a1' } : null) }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn(async () => undefined) }));
import { research } from './research.js';
import { forms } from './forms.js';
let db: SqliteD1;
const payload = { description: '調査です', questions: [
  { text: 'ペット', format: 'single', required: true, choices: ['犬', '猫'] },
  { text: 'コメント', format: 'free', required: false, choices: [] },
], answerActions: [{ actionType: 'tag', config: { op: 'add', tagIds: ['t1'] }, onFailure: 'stop' }] };
beforeEach(() => {
  db = createTestD1();
  db.raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant1','試験');
    INSERT INTO line_accounts(id,channel_id,name,liff_id,login_channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('a1','ch1','試験','liff1','login1','token','secret','tenant1'), ('a2','ch2','別店','liff2','login2','token','secret','tenant1');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES ('f1','U1','a1',1);
    INSERT INTO tags(id,name,line_account_id) VALUES ('t1','回答済み','a1'),('t2','他店','a2');`);
  db.raw.prepare(`INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('r1','a1','research','リサーチ',?,1,'2026-10-09','2026-10-09')`).run(JSON.stringify(payload));
});
afterEach(() => db.raw.close());
function app() { const a = new Hono<Env>(); a.route('/', research); a.route('/', forms); return a; }
function open(auth = 'valid', liffId = 'liff1') { return app().request(`/api/liff/research/r1/form?liffId=${liffId}`, { headers: { Authorization: `Bearer ${auth}` } }, { DB: db.db }); }
const key = 'aaaaaaaa-1111-4333-8444-111111111111';
function submit(id: string, data: unknown = { question_1: '犬', question_2: '元気' }) {
  return app().request(`/api/forms/${id}/submit?liffId=liff1`, { method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ data }) }, { DB: db.db, WORKER_URL: 'https://example.test' });
}
function update(payloadOverride: Record<string, unknown>) { db.raw.prepare('UPDATE broadcast_message_assets SET payload_json=? WHERE id=?').run(JSON.stringify({ ...payload, ...payloadOverride }), 'r1'); }
describe('B-173 リサーチを既存の回答フォームへ接続', () => {
  test('公開版の質問を読む。回答保存・タグ付けと同じ回答の再送は1回', async () => {
    db.raw.prepare('UPDATE broadcast_message_assets SET draft_payload_json=? WHERE id=?').run(JSON.stringify({ questions: [] }), 'r1');
    const res = await open(); expect(res.status).toBe(200);
    const { data: { formId } } = await res.json() as { data: { formId: string } };
    const definition = await app().request(`/api/forms/${formId}?liffId=liff1`, { headers: { Authorization: 'Bearer valid' } }, { DB: db.db });
    expect(definition.status).toBe(200);
    expect(JSON.stringify(await definition.json())).toContain('ペット');
    const first = await submit(formId); expect(await first.json()).toMatchObject({ success: true }); expect(first.status).toBe(201);
    expect((await submit(formId)).status).toBe(200);
    expect(db.raw.prepare('SELECT data FROM form_submissions WHERE form_id=?').all(formId)).toEqual([{ data: JSON.stringify({ question_1: '犬', question_2: '元気' }) }]);
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags WHERE friend_id=?').all('f1')).toEqual([{ tag_id: 't1' }]);
  });
  test('未公開・他店・未認証・ブロック済みを受け付けない', async () => {
    expect((await open('invalid')).status).toBe(401);
    expect((await open('valid', 'liff2')).status).toBe(401);
    db.raw.exec(`UPDATE broadcast_message_assets SET line_account_id='a2'`); expect((await open()).status).toBe(404);
    db.raw.exec(`UPDATE broadcast_message_assets SET line_account_id='a1',published_version=0`); expect((await open()).status).toBe(404);
    db.raw.exec(`UPDATE broadcast_message_assets SET published_version=1; UPDATE friends SET is_following=0`); expect((await open()).status).toBe(403);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM forms').get()).toEqual({ n: 0 });
  });
  test('質問の公開版が変わっても、開いたフォームの質問と後処理は固定する', async () => {
    const id = await ensureResearchForm(db.db, 'r1', 'a1');
    update({ questions: [{ text: '次の質問', format: 'free', required: true }], answerActions: [] });
    db.raw.exec(`UPDATE broadcast_message_assets SET published_version=2`);
    const next = await ensureResearchForm(db.db, 'r1', 'a1'); expect(next).not.toBe(id);
    expect((await submit(id)).status).toBe(201);
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{ tag_id: 't1' }]);
    expect(db.raw.prepare('SELECT layout FROM forms WHERE id=?').get(id)).toEqual({ layout: expect.stringContaining('ペット') });
  });
  test('停止・保管したアカウントのリサーチは開かせない', async () => {
    db.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a1'");
    expect((await open()).status).toBe(404);
    db.raw.exec("UPDATE line_accounts SET is_active=1,archived_at='2026-10-09' WHERE id='a1'");
    expect((await open()).status).toBe(404);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM forms').get()).toEqual({ n: 0 });
  });
  test('必須・選択肢・受付期間・対象タグを既存の回答口でも守る', async () => {
    for (const data of [{}, { question_1: '選択肢にない値' }]) {
      const id = await ensureResearchForm(db.db, 'r1', 'a1'); expect((await submit(id, data)).status).toBe(400);
    }
    for (const override of [{ startsAt: '2999-01-01T00:00' }, { endsAt: '2000-01-01T00:00' }, { targetTagId: 't1' }]) {
      update(override); db.raw.exec(`UPDATE broadcast_message_assets SET published_version=published_version+1`);
      const id = await ensureResearchForm(db.db, 'r1', 'a1'); expect((await submit(id)).status).toBe(400);
    }
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 0 });
  });
  test('後処理の失敗は未完に残し、stop の後は実行しない。再送で再開する', async () => {
    update({ answerActions: [
      { actionType: 'tag', config: { op: 'add', tagIds: ['t2'] }, onFailure: 'stop' },
      { actionType: 'tag', config: { op: 'add', tagIds: ['t1'] }, onFailure: 'continue' },
    ] });
    const id = await ensureResearchForm(db.db, 'r1', 'a1');
    const first = await submit(id); expect(first.status).toBe(202);
    expect(db.raw.prepare('SELECT status FROM form_submit_claims').get()).toEqual({ status: 'failed' });
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([]);
    db.raw.exec(`UPDATE tags SET line_account_id='a1' WHERE id='t2'`);
    expect((await submit(id)).status).toBe(200);
    expect(db.raw.prepare('SELECT status FROM form_submit_claims').get()).toEqual({ status: 'completed' });
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags ORDER BY tag_id').all()).toEqual([{ tag_id: 't1' }, { tag_id: 't2' }]);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 1 });
  });
  test('他の統括の旧タグを回答後の処理へ指定しても追加しない', async () => {
    db.raw.exec("UPDATE tags SET line_account_id=NULL WHERE id='t1'");
    const id = await ensureResearchForm(db.db, 'r1', 'a1');
    expect((await submit(id)).status).toBe(202);
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([]);
    expect(db.raw.prepare('SELECT status FROM form_submit_claims').get()).toEqual({ status: 'failed' });
  });
  test('同時に開いても同じ公開版は1つのフォームになる', async () => {
    const result = await Promise.all([ensureResearchForm(db.db, 'r1', 'a1'), ensureResearchForm(db.db, 'r1', 'a1')]);
    expect(result[0]).toBe(result[1]); expect(db.raw.prepare('SELECT COUNT(*) AS n FROM forms').get()).toEqual({ n: 1 });
  });
  test('店舗のタグフォルダを指定した回答後の操作を実行する', async () => {
    db.raw.exec("INSERT INTO folders(id,kind,name,account_id) VALUES ('folder1','tag','回答済み','a1'); UPDATE tags SET folder_id='folder1' WHERE id='t1'");
    update({ answerActions: [{ actionType: 'tag', config: { op: 'add', folderId: 'folder1' }, onFailure: 'stop' }] });
    const id = await ensureResearchForm(db.db, 'r1', 'a1');
    expect((await submit(id)).status).toBe(201);
    expect(db.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{ tag_id: 't1' }]);
  });
});

test('未割当の旧素材は既定統括だけに公開し、別統括へ読ませない', async () => {
  db.raw.exec("UPDATE broadcast_message_assets SET line_account_id=NULL");
  expect((await open()).status).toBe(404);
  db.raw.exec("UPDATE line_accounts SET tenant_id='00000000-0000-4000-8000-000000000001' WHERE id='a1'");
  const opened = await open();
  expect(opened.status).toBe(200);
  const { data: { formId } } = await opened.json() as { data: { formId: string } };
  db.raw.exec("UPDATE line_accounts SET tenant_id='tenant1' WHERE id='a1'");
  expect((await submit(formId)).status).toBe(400);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 0 });
});

test('選んだ答えのタグと加点はLIFF回答後にだけ実行し、同じ回答の再送で二重加点しない', async () => {
  update({ questions: [
    { text: 'ペット', format: 'single', required: true, choices: ['犬', '猫'], choiceTapExtras: [{ tagIds: ['t1'], scoreChange: 10 }, { scoreChange: 50 }] },
    { text: '食事', format: 'multiple', required: true, choices: ['朝', '昼', '夜'], choiceTapExtras: [{ scoreChange: 2 }, { scoreChange: 3 }, { scoreChange: 4 }] },
  ], answerActions: [] });
  const id = await ensureResearchForm(db.db, 'r1', 'a1');
  expect(db.raw.prepare("SELECT score FROM friends WHERE id='f1'").get()).toEqual({score: 0});
  const answers = { question_1: '犬', question_2: ['朝', '夜'] };
  expect((await submit(id, answers)).status).toBe(201);
  expect((await submit(id, answers)).status).toBe(200);
  expect(db.raw.prepare("SELECT score FROM friends WHERE id='f1'").get()).toEqual({score: 16});
  expect(db.raw.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='f1'").all()).toEqual([{tag_id: 't1'}]);
  expect(db.raw.prepare("SELECT COUNT(*) n FROM friend_scores WHERE friend_id='f1'").get()).toEqual({n: 3});
});
