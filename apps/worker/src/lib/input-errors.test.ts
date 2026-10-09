import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { inputError, inputJsonBoundary } from './input-errors.js';

describe('入力エラーの共通HTTP契約', () => {
  it('機械コード、既存の補足情報と人向けの理由を一緒に返す', async () => {
    const app = new Hono();
    app.post('/', c => inputError(c, { error: 'invalid_duration', max: 60 }, 422, ['durationSeconds']));
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 'invalid_duration', max: 60, error: '視聴時間は0より大きい秒数で指定してください',
      fields: { durationSeconds: '視聴時間は0より大きい秒数で指定してください' },
    });
  });
  it('具体的な入れ子の欄を、親の欄や別の欄で上書きしない', async () => {
    const app = new Hono();
    app.post('/', c => inputError(c, { error: '値を確認してください', field: 'mileage.self' }, 422, ['name', 'mileage']));
    expect(await (await app.request('/', { method: 'POST' })).json()).toMatchObject({
      fields: { 'mileage.self': '値を確認してください' },
    });
  });
  it('既に埋まっている必須欄には誤りを付けない', async () => {
    const app = new Hono();
    app.post('/', inputJsonBoundary({ name: ['string'], text: ['string'] }),
      c => inputError(c, { error: 'name and text are required' }, 400, ['name', 'text']));
    const response = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"入力済み"}' });
    expect(await response.json()).toEqual({ error: 'name and text are required', fields: { text: 'name and text are required' } });
  });
  it('型の違う欄は400で示し、保存する処理を実行しない', async () => {
    let saved = false;
    const app = new Hono();
    app.post('/', inputJsonBoundary({ name: ['string'], enabled: ['boolean'] }), c => {
      saved = true;
      return c.json({ success: true });
    });
    const response = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":12,"enabled":"true"}' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fields: { name: expect.any(String), enabled: expect.any(String) } });
    expect(saved).toBe(false);
  });
  it('検査後も署名検証などで元の本文を読める', async () => {
    const app = new Hono();
    app.post('/', inputJsonBoundary(), async c => c.text(await c.req.text()));
    const raw = '{ "name": "本文" }';
    const response = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    expect(await response.text()).toBe(raw);
  });
  it('入力欄のない操作は本文なしで呼べる', async () => {
    const app = new Hono();
    app.post('/', inputJsonBoundary(), c => c.json({ success: true }));
    expect((await app.request('/', { method: 'POST' })).status).toBe(200);
  });
  it('権限・競合・障害の応答へ入力欄を付けない', async () => {
    for (const status of [403, 409, 500] as const) {
      const app = new Hono();
      app.post('/', c => inputError(c, { error: '元のエラー' }, status, ['name']));
      const response = await app.request('/', { method: 'POST' });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: '元のエラー' });
    }
  });
});
