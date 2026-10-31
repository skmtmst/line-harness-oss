import { Hono } from 'hono';
import { expect, it } from 'vitest';
import type { Env } from '../worker-env.js';
import { createSupportPreviewFixture } from '../test-utils/support-preview-fixture.js';
import { supportInbox } from './support-inbox.js';

const labels = [
  ['sticker', 'スタンプ'], ['image', '画像'], ['flex', 'Flexメッセージ'],
  ['video', '動画'], ['audio', '音声'], ['file', 'ファイル'], ['location', '位置情報'], ['unsent', '送信を取り消しました'],
] as const;

function previewApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: '確認担当', role: 'owner', readOnly: false, featureEnabledLineAccountIds: ['visible'] });
    await next();
  });
  app.route('/', supportInbox);
  return app;
}

it.each(labels)('%sの受信は内部JSONではなく種類名を返し、範囲外の店を混ぜない', async (type, label) => {
  const content = JSON.stringify({ type, packageId: '2713', stickerId: 'fixture', internal: '本文の目印' });
  const fixture = createSupportPreviewFixture(type, content);
  try {
    const app = previewApp();
    const before = fixture.raw.prepare('SELECT total_changes() AS count').get();
    const response = await app.request('/api/support/inbox?channel=line', {}, { DB: fixture.db } as Env['Bindings']);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: Array<{ threadId: string; preview: string }>; summary: { total: number } } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ threadId: 'visible', preview: label });
    expect(body.data.summary.total).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/本文の目印|packageId|範囲外 太郎/);
    expect(fixture.raw.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(fixture.raw.prepare("SELECT content FROM messages_log WHERE id='message-visible'").get()).toEqual({ content });
  } finally { fixture.raw.close(); }
});

it('テキストとして受けたJSONと改行・長文を、メディアや短縮本文へ置き換えない', async () => {
  const content = '{"type":"sticker"}\n問い合わせの本文' + '長文'.repeat(50);
  const fixture = createSupportPreviewFixture('text', content);
  try {
    const response = await previewApp().request('/api/support/inbox?channel=line', {}, { DB: fixture.db } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { items: [{ threadId: 'visible', preview: content }] } });
  } finally { fixture.raw.close(); }
});
