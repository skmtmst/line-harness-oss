import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { clientErrors } from './client-errors.js';

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    return next();
  });
  instance.route('/', clientErrors);
  return instance;
}

const env = {
  DB: {} as D1Database,
  IMAGES: {} as R2Bucket,
  ASSETS: {} as Fetcher,
  LINE_CHANNEL_SECRET: 'line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  API_KEY: 'api-key',
  LIFF_URL: 'https://liff.example.test',
  LINE_CHANNEL_ID: 'line-channel',
  LINE_LOGIN_CHANNEL_ID: 'login-channel',
  LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
  WORKER_URL: 'https://worker.example.test',
} as Env['Bindings'];

describe('client error reporting', () => {
  test('管理画面のエラーを受け付ける', async () => {
    const response = await app().request('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '白い画面になった', path: 'https://admin.example.test/friends' }),
    }, env);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true });
  });

  test('メッセージのない報告を拒否する', async () => {
    const response = await app().request('/api/client-errors', {
      method: 'POST',
      body: JSON.stringify({ path: '/friends' }),
    }, env);
    expect(response.status).toBe(400);
  });
});
