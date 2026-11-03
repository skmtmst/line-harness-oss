import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { adminAuth } from './admin-auth.js';

/**
 * 管理画面ログイン専用のLINE Loginチャネル（他社向けサービス musubo 用）。
 *
 * `LINE_LOGIN_CHANNEL_ID` は会員向けLIFF連携（`routes/liff.ts`）の既定チャネルも
 * 兼ねているため、管理画面の入口だけを別プロバイダーのチャネルへ移せるようにした。
 * - `ADMIN_LINE_LOGIN_CHANNEL_ID` / `..._SECRET` があればそれを使う
 * - なければ従来の共通チャネルへ戻り、現在の挙動を変えない
 */

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    ADMIN_ORIGIN: 'https://admin.example.com',
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
    LINE_LOGIN_CHANNEL_ID: 'shared-login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'shared-login-secret',
    ...overrides,
  } as Env['Bindings'];
}

async function authorizeParams(overrides: Partial<Env['Bindings']> = {}) {
  const app = new Hono<Env>();
  app.route('/', adminAuth);
  const res = await app.request('https://api.example.com/api/auth/line', {}, env(overrides));
  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  return new URL(location as string).searchParams;
}

describe('管理画面ログイン用のLINE Loginチャネル', () => {
  it('専用設定があれば、そのチャネルIDで認可へ飛ばす', async () => {
    const params = await authorizeParams({
      ADMIN_LINE_LOGIN_CHANNEL_ID: 'musubo-admin-channel',
      ADMIN_LINE_LOGIN_CHANNEL_SECRET: 'musubo-admin-secret',
    });
    expect(params.get('client_id')).toBe('musubo-admin-channel');
    expect(params.get('redirect_uri')).toBe('https://api.example.com/api/auth/line/callback');
  });

  it('専用設定が無ければ、従来の共通チャネルを使う', async () => {
    const params = await authorizeParams();
    expect(params.get('client_id')).toBe('shared-login-channel');
  });

  it('空文字や空白だけの専用設定は未設定として扱う', async () => {
    const params = await authorizeParams({
      ADMIN_LINE_LOGIN_CHANNEL_ID: '   ',
      ADMIN_LINE_LOGIN_CHANNEL_SECRET: '',
    });
    expect(params.get('client_id')).toBe('shared-login-channel');
  });

  it('共通チャネルが無く専用設定だけでも、管理画面ログインは動く', async () => {
    const params = await authorizeParams({
      LINE_LOGIN_CHANNEL_ID: '',
      LINE_LOGIN_CHANNEL_SECRET: '',
      ADMIN_LINE_LOGIN_CHANNEL_ID: 'musubo-admin-channel',
      ADMIN_LINE_LOGIN_CHANNEL_SECRET: 'musubo-admin-secret',
    });
    expect(params.get('client_id')).toBe('musubo-admin-channel');
  });

  it('どちらも無ければ設定不備として500を返す', async () => {
    const app = new Hono<Env>();
    app.route('/', adminAuth);
    const res = await app.request(
      'https://api.example.com/api/auth/line',
      {},
      env({ LINE_LOGIN_CHANNEL_ID: '', LINE_LOGIN_CHANNEL_SECRET: '' }),
    );
    expect(res.status).toBe(500);
  });
});
